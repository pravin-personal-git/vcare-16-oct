'use server';

import { revalidatePath } from 'next/cache';
import { requirePortalContext } from '@/server/portal-context';
import { createPortalComplaint, ComplaintError } from '@/server/portal';
import { fieldSetup } from '@/server/custom-fields';
import { stdRequired, stdShown } from '@/lib/custom-fields';

export interface RaiseComplaintState {
  error?: string;
  ok?: boolean;
}

/**
 * The ownership guarantee: every write this action can cause always targets
 * `ctx.party.id`, which comes only from a valid, non-revoked portal session -
 * never from the submitted form. A request with no session throws here,
 * before createPortalComplaint (and the db writes inside it) ever runs.
 */
async function assertOwned() {
  return requirePortalContext();
}

export async function raiseComplaint(_prev: RaiseComplaintState, formData: FormData): Promise<RaiseComplaintState> {
  try {
    const ctx = await assertOwned();

    const description = String(formData.get('description') ?? '').trim();
    if (!description) return { error: 'Describe the issue.' };

    const productId = String(formData.get('productId') ?? '').trim() || null;
    const siteLocation = String(formData.get('siteLocation') ?? '').trim() || null;

    // A pin only when one was actually sent, and only demanded when the
    // business asks for it (Settings > Custom Fields > Complaints).
    const lat = Number(formData.get('siteLat'));
    const lng = Number(formData.get('siteLng'));
    const source = String(formData.get('siteSource') ?? '');
    const hasPin = Number.isFinite(lat) && Number.isFinite(lng)
      && (source === 'gps' || source === 'maps_link');

    const rules = await fieldSetup({ kind: 'single', storeId: ctx.party.storeId, writable: false }, 'complaint');
    if (stdShown(rules, 'siteLocation') && stdRequired(rules, 'siteLocation') && !hasPin) {
      return { error: 'Share your location or paste a Maps link before raising the complaint.' };
    }

    const siteLat = hasPin ? lat : null;
    const siteLng = hasPin ? lng : null;
    const siteSource = hasPin ? (source as 'gps' | 'maps_link') : null;

    const customFields: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('field:')) {
        const v = String(value).trim();
        if (v) customFields[key.slice('field:'.length)] = v;
      }
    }

    await createPortalComplaint(ctx.party.id, ctx.party.storeId, {
      productId, siteLocation, siteLat, siteLng, siteSource, description, customFields,
    });

    revalidatePath('/portal/complaints');
    return { ok: true };
  } catch (err) {
    const msg = err instanceof ComplaintError ? err.message : 'Could not raise the complaint. Please try again.';
    if (!(err instanceof ComplaintError)) console.error('[portal-complaints] raise failed', err);
    return { error: msg };
  }
}
