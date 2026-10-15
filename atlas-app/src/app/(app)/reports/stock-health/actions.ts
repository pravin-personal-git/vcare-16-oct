'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { reconcileProductIdentity } from '@/server/unit-allocation';
import { friendlyError } from '@/lib/friendly-error';

/**
 * Make one product's identity ledger match its shelf count.
 *
 * Gated on `stock.adjust`, not `stock.view`: this writes. It creates unit
 * records or marks units lost, and either is a change to what the business can
 * say about its own stock. The same permission as a stock count, because it is
 * the same kind of act - asserting what is physically on the shelf.
 *
 * One product at a time, deliberately - no "fix all 91". A bulk button would be
 * one click that creates thousands of unit records across products nobody has
 * looked at, and the whole reason this report exists is that a number nobody
 * looked at went wrong.
 */
export async function reconcileProductAction(productId: string): Promise<{
  ok?: boolean; message?: string; error?: string;
}> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('stock.adjust')) {
      return { error: 'You do not have permission to correct stock.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Pick a single branch first. Stock belongs to one branch, not to all of them at once.' };
    }

    const r = await reconcileProductIdentity(ctx.scope, ctx.scope.storeId, ctx.user.id, productId);

    revalidatePath('/reports/stock-health');
    revalidatePath('/product-journey');
    revalidatePath('/stock-units');

    if (r.tagged === 0 && r.lost === 0) {
      return { ok: true, message: `${r.productName} already agrees with itself. Nothing to change.` };
    }
    if (r.tagged > 0) {
      return {
        ok: true,
        message: `${r.tagged} item${r.tagged === 1 ? '' : 's'} of ${r.productName} now carry a number. `
          + 'Print the labels from Serial & Batch Stock and stick them on.',
      };
    }
    return {
      ok: true,
      message: `${r.lost} numbered item${r.lost === 1 ? '' : 's'} of ${r.productName} marked lost - `
        + 'they were on record and are not on the shelf. The serials are kept, not deleted.',
    };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
