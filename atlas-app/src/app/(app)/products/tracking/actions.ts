'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { applyTrackingChange, type TrackingChange, type TrackingChangeResult } from '@/server/stock-tracking';
import { friendlyError } from '@/lib/friendly-error';

/**
 * Change how a set of products is tracked. On `products.edit`, the permission
 * that already governs editing a product: this IS a product setting, and it
 * also decides whether a line carries an HSN or a SAC.
 */
export async function applyTrackingAction(
  productIds: string[],
  change: TrackingChange,
): Promise<{ error?: string; result?: TrackingChangeResult }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('products.edit')) return { error: 'You cannot change products.' };
    if (ctx.scope.kind === 'all') return { error: 'Select a single store first.' };
    const result = await applyTrackingChange(ctx.scope, productIds, change);
    revalidatePath('/products/tracking');
    revalidatePath('/products');
    revalidatePath('/stock-units');
    return { result };
  } catch (err) {
    console.error('[tracking] change failed', err);
    return { error: friendlyError(err, true) };
  }
}
