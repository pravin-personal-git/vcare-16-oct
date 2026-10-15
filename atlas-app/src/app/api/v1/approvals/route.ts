import { jsonBody, staff, V1Error } from '@/server/auth/v1-staff';
import { ApprovalInboxError, decideFromInbox, waitingOn } from '@/server/approvals';
import { HierarchyError } from '@/server/hierarchy';

/**
 * Waiting on me, on the phone (5 Oct 2026). A manager who is not the owner -
 * Gurjeet approving a leave or an order - had to open the website to decide
 * anything. Same list and same decision path as My Desk on the web, so every
 * rule (levels, own request, owner override, held actions) applies unchanged.
 */
export async function GET(req: Request) {
  return staff(req, null, async (ctx) => {
    const isOwner = ctx.permissions.has('settings.edit');
    const items = await waitingOn(ctx.scope, ctx.user.id, { everyone: isOwner, permissions: ctx.permissions });
    return { items, isOwner };
  });
}

export async function POST(req: Request) {
  return staff(req, null, async (ctx) => {
    const b = await jsonBody(req);
    const type = String(b.type ?? '');
    const entityId = String(b.entityId ?? '');
    const decision = b.decision === 'rejected' ? 'rejected' : b.decision === 'approved' ? 'approved' : null;
    if (!type || !entityId || !decision) throw new V1Error('Choose a request and Approve or Reject.');
    const note = typeof b.note === 'string' ? b.note.slice(0, 1000) : null;
    try {
      await decideFromInbox(ctx.scope, type, entityId, decision, ctx.user.id, note, ctx.permissions);
    } catch (e) {
      // These say plainly why (own request, wrong level, reason missing).
      if (e instanceof ApprovalInboxError || e instanceof HierarchyError) throw new V1Error(e.message);
      if (e instanceof Error && e.message && e.message.length < 200 && !/prisma|invocation/i.test(e.message)) throw new V1Error(e.message);
      throw e;
    }
    return { ok: true, message: decision === 'approved' ? 'Approved.' : 'Rejected.' };
  });
}
