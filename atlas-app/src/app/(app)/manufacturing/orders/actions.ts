'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { createProductionOrder, completeProductionOrder, cancelProductionOrder } from '@/server/manufacturing';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

/** Active BOMs, for the "produce against which BOM" picker. */
export async function loadActiveBoms() {
  const ctx = await requireContext();
  return db.billOfMaterials.findMany({
    where: { ...scopeWhere(ctx.scope), isActive: true },
    select: {
      id: true, outputQty: true,
      finishedProduct: { select: { productName: true, productCode: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
}

export async function createProductionOrderAction(input: {
  bomId: string;
  qtyToProduce: number;
  notes: string | null;
}): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('products.edit')) {
    return { error: 'You do not have permission to edit products.' };
  }
  try {
    await createProductionOrder(ctx.scope, input, ctx.user.id);
    revalidatePath('/manufacturing/orders');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save.' };
  }
}

export async function completeOrderAction(id: string): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('products.edit')) {
    return { error: 'You do not have permission to edit products.' };
  }
  try {
    await completeProductionOrder(ctx.scope, id, ctx.user.id);
    revalidatePath('/manufacturing/orders');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not complete.' };
  }
}

export async function cancelOrderAction(id: string, reason: string): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('products.edit')) {
    return { error: 'You do not have permission to edit products.' };
  }
  try {
    await cancelProductionOrder(ctx.scope, id, reason);
    revalidatePath('/manufacturing/orders');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not cancel.' };
  }
}
