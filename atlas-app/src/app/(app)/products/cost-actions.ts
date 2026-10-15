'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  CostError, purchaseHistory, recordPurchasePrice, setCostMethod,
  type PurchaseHistoryRow,
} from '@/server/product-cost';
import type { CostMethod } from '@/lib/costing';
import { friendlyError } from '@/lib/friendly-error';

export interface CostActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

async function guard(
  run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<string | void>,
): Promise<CostActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('products.edit')) {
      return { error: 'You do not have permission to change product costs.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store - cost is recorded per branch.' };
    }
    const message = await run(ctx);
    revalidatePath('/products');
    return { ok: true, ...(message ? { message } : {}) };
  } catch (err) {
    if (err instanceof CostError) return { error: err.message };
    console.error('[product-cost] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function addPurchasePrice(input: {
  productId: string;
  unitCostPaise: number;
  qty: number;
  purchasedAt: string | null;
  reference: string | null;
  note: string | null;
}): Promise<CostActionState> {
  return guard(async (ctx) => {
    await recordPurchasePrice(ctx.scope, ctx.user.id, {
      productId: input.productId,
      unitCostPaise: input.unitCostPaise,
      qty: input.qty,
      purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : undefined,
      reference: input.reference,
      note: input.note,
    });
    return 'Recorded. Cost and margin update everywhere this product is priced.';
  });
}

export async function changeCostMethod(method: CostMethod): Promise<CostActionState> {
  return guard(async (ctx) => {
    await setCostMethod(ctx.scope, method);
    return 'Costing basis changed. Every margin and the stock valuation now use it.';
  });
}

/**
 * History for one product.
 *
 * Read-only and permission-free beyond the session, deliberately - anyone who
 * can see the cost figure on the grid should be able to see how it was arrived
 * at. A number nobody can interrogate is a number nobody should trust.
 */
export async function getPurchaseHistory(
  productId: string,
): Promise<{ rows: PurchaseHistoryRow[]; error?: string }> {
  try {
    const ctx = await requireContext();
    if (ctx.scope.kind === 'all') return { rows: [], error: 'Select a single store.' };
    return { rows: await purchaseHistory(ctx.scope, productId) };
  } catch (err) {
    console.error('[product-cost] history failed', err);
    return { rows: [], error: 'Could not load the purchase history.' };
  }
}
