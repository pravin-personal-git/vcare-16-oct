'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { saveOrderStages } from '@/server/order-stages';
import { friendlyError } from '@/lib/friendly-error';

/** Settings › Sales order stages (11 Oct 2026). Admins only. */
export async function saveOrderStagesAction(raw: unknown): Promise<{ ok?: true; error?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) return { error: 'Only an admin can change the order stages.' };
    if (ctx.scope.kind !== 'single') return { error: 'Pick a branch first (top bar). Each branch keeps its own stages.' };
    await saveOrderStages(ctx.scope, raw);
    revalidatePath('/sales/orders');
    revalidatePath('/settings/order-stages');
    return { ok: true };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
