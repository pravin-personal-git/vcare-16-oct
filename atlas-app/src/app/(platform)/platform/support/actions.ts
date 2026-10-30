'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformContext } from '@/server/platform-context';
import { resolveBestOrgScope } from '@/server/platform-scope';
import { HelpdeskError, type TicketStatus } from '@/server/helpdesk';
import { replySupportTicket, setSupportTicketStatus } from '@/server/platform-support';
import { friendlyError } from '@/lib/friendly-error';

/** Support in the platform portal (30 Oct 2026) - server/platform-support. */
async function scoped() {
  const ctx = await requirePlatformContext();
  const scope = await resolveBestOrgScope(ctx.memberships);
  if (!scope) throw new HelpdeskError('Your account has no scope over any business.');
  return { ctx, scope };
}

export async function replyAction(ticketId: string, body: string, internal: boolean): Promise<{ commentId: string } | { error: string }> {
  try {
    const { ctx, scope } = await scoped();
    const r = await replySupportTicket(scope, ticketId, ctx.user.id, body, internal);
    revalidatePath(`/platform/support/${ticketId}`);
    return { commentId: r.commentId };
  } catch (e) {
    return { error: friendlyError(e, e instanceof HelpdeskError) };
  }
}

export async function statusAction(ticketId: string, status: TicketStatus): Promise<{ ok: true } | { error: string }> {
  try {
    const { ctx, scope } = await scoped();
    await setSupportTicketStatus(scope, ticketId, ctx.user.id, status);
    revalidatePath(`/platform/support/${ticketId}`);
    revalidatePath('/platform/support');
    return { ok: true };
  } catch (e) {
    return { error: friendlyError(e, e instanceof HelpdeskError) };
  }
}
