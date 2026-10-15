'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { StockInError, stockInByScan, type StockInLine } from '@/server/stock-in';

/** Stock in by scan (G6, 12 Oct 2026) - the same right as Adjust stock: products.edit. */
export async function stockInAction(input: { reason: string; note: string | null; lines: StockInLine[] }) {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('products.edit')) return { error: 'You do not have permission to change stock.' };
    if (ctx.scope.kind !== 'single') return { error: 'Select a single store first.' };
    const r = await stockInByScan(ctx.scope, input, ctx.user.id);
    await db.activityLog.create({
      data: {
        storeId: ctx.scope.storeId, userId: ctx.user.id, activityType: 'created', entityType: 'StockIn',
        entityId: r.ref, description: `Stock in by scan ${r.ref}: ${r.qty} item(s), ${r.units} unit(s) - ${input.reason}`,
      },
    }).catch((e) => console.error('[stock-in] audit write failed (non-fatal)', e));
    revalidatePath('/products');
    revalidatePath('/stock-units');
    return { ok: true as const, ...r };
  } catch (e) {
    if (e instanceof StockInError) return { error: e.message };
    console.error('[stock-in] failed', e);
    return { error: 'Could not bring the stock in. Nothing was saved.' };
  }
}
