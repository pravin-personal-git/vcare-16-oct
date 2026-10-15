'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { createBom, updateBom, setBomActive, type BomComponentInput } from '@/server/manufacturing';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

/** Products available as the finished good or as a component. */
export async function loadProducts() {
  const ctx = await requireContext();
  return db.product.findMany({
    where: scopeWhere(ctx.scope),
    select: { id: true, productName: true, productCode: true },
    orderBy: { productName: 'asc' },
    take: LIST_MAX_ROWS,
  });
}

export async function createBomAction(input: {
  finishedProductId: string;
  outputQty: number;
  notes: string | null;
  components: BomComponentInput[];
}): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('products.edit')) {
    return { error: 'You do not have permission to edit products.' };
  }
  try {
    await createBom(ctx.scope, input, ctx.user.id);
    revalidatePath('/manufacturing/bom');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save.' };
  }
}

export async function updateBomAction(id: string, input: {
  outputQty: number;
  notes: string | null;
  components: BomComponentInput[];
}): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('products.edit')) {
    return { error: 'You do not have permission to edit products.' };
  }
  try {
    await updateBom(ctx.scope, id, input);
    revalidatePath('/manufacturing/bom');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save.' };
  }
}

export async function setBomActiveAction(id: string, isActive: boolean): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('products.edit')) {
    return { error: 'You do not have permission to edit products.' };
  }
  try {
    await setBomActive(ctx.scope, id, isActive);
    revalidatePath('/manufacturing/bom');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not update.' };
  }
}
