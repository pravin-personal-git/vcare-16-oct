'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { pickUpRequest, ShopRequestError } from '@/server/shop-requests';

/** "I'll take it" on a shop buy request: its lead becomes this person's (first one wins). */
export async function pickUpAction(cartId: string): Promise<{ ok?: boolean; error?: string; leadId?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('leads.edit') && !ctx.permissions.has('leads.create')) {
      return { error: 'Picking up a shop request needs the Leads permission.' };
    }
    const r = await pickUpRequest(ctx.scope, cartId, ctx.user.id);
    revalidatePath('/sales/shop-requests');
    revalidatePath('/crm/leads');
    return { ok: true, leadId: r.leadId };
  } catch (e) {
    if (e instanceof ShopRequestError) return { error: e.message };
    console.error('[shop-requests] pick up failed', e);
    return { error: 'Could not pick it up. Please try again.' };
  }
}
