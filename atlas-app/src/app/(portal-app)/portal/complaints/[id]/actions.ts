'use server';

import { requirePortalContext } from '@/server/portal-context';
import { ComplaintError } from '@/server/complaints';
import { customerAct, ownedByParty } from '@/server/job-customer';

/** The portal customer acting on their own job (workflow slice 5). */
export async function portalJobAct(complaintId: string, op: string, body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string }> {
  try {
    const ctx = await requirePortalContext();
    const job = await ownedByParty(ctx.party.id, ctx.party.storeId, complaintId);
    await customerAct(job, op, {
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 1000) : null,
      note: typeof body.note === 'string' ? body.note.slice(0, 1000) : null,
      preferred: typeof body.preferred === 'string' ? body.preferred.slice(0, 300) : null,
      stars: typeof body.stars === 'number' ? body.stars : undefined,
      techStars: typeof body.techStars === 'number' ? body.techStars : null,
      comment: typeof body.comment === 'string' ? body.comment.slice(0, 1000) : null,
    }, 'portal');
    return { ok: true };
  } catch (e) {
    if (e instanceof ComplaintError) return { error: e.message };
    console.error('[portal job] action failed', e);
    return { error: 'Something went wrong. Please try again.' };
  }
}
