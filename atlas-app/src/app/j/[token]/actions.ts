'use server';

import { ComplaintError } from '@/server/complaints';
import { customerAct, ownedByToken } from '@/server/job-customer';

/**
 * The no-login job link's one action (workflow slice 5). The token in the URL
 * is the credential - it opens exactly one job and nothing else, and stops
 * working 30 days after the job is closed.
 */
export async function linkAct(token: string, op: string, body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string }> {
  try {
    const job = await ownedByToken(token);
    await customerAct(job, op, {
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 1000) : null,
      note: typeof body.note === 'string' ? body.note.slice(0, 1000) : null,
      preferred: typeof body.preferred === 'string' ? body.preferred.slice(0, 300) : null,
      stars: typeof body.stars === 'number' ? body.stars : undefined,
      techStars: typeof body.techStars === 'number' ? body.techStars : null,
      comment: typeof body.comment === 'string' ? body.comment.slice(0, 1000) : null,
    }, 'link');
    return { ok: true };
  } catch (e) {
    if (e instanceof ComplaintError) return { error: e.message };
    console.error('[job link] action failed', e);
    return { error: 'Something went wrong. Please try again, or call us.' };
  }
}
