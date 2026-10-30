import 'server-only';
import { db } from './db';
import { platformScopeOrgWhere, type PlatformScope } from './platform-scope';
import { commentRows, HelpdeskError, type HelpdeskCommentRow, type TicketStatus } from './helpdesk';

/**
 * SUPPORT IN THE PLATFORM PORTAL (30 Oct 2026). Helpdesk tickets a business
 * sent to the software's own support team (`HelpdeskTicket.toSupport`), from
 * every business in the viewer's platform scope - the Platform Owner sees all,
 * a Reseller only their subtree. Replies are written as `fromSupport`; an
 * `internal` note stays here and is never shown to the business.
 */

export interface SupportTicketRow {
  id: string;
  ticketNo: string;
  subject: string;
  status: TicketStatus;
  priority: string;
  businessName: string;
  branchName: string;
  raisedByName: string;
  createdAt: Date;
  lastAt: Date;
  /** The business spoke last (or nobody from support has answered yet). */
  waitingOnUs: boolean;
}

const ticketWhere = (scope: PlatformScope) => ({ toSupport: true, store: { organization: platformScopeOrgWhere(scope) } });

export async function listSupportTickets(scope: PlatformScope, opts: { status?: TicketStatus } = {}): Promise<SupportTicketRow[]> {
  const rows = await db.helpdeskTicket.findMany({
    where: { ...ticketWhere(scope), ...(opts.status ? { status: opts.status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: {
      id: true, ticketNo: true, subject: true, status: true, priority: true, createdAt: true,
      raisedBy: { select: { fullName: true } },
      store: { select: { name: true, organization: { select: { name: true } } } },
      comments: { where: { internal: false, kind: 'note' }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, fromSupport: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, ticketNo: r.ticketNo, subject: r.subject, status: r.status as TicketStatus, priority: r.priority,
    businessName: r.store.organization.name, branchName: r.store.name, raisedByName: r.raisedBy.fullName,
    createdAt: r.createdAt, lastAt: r.comments[0]?.createdAt ?? r.createdAt,
    waitingOnUs: (r.status === 'open' || r.status === 'in_progress') && !r.comments[0]?.fromSupport,
  }));
}

/** Open, unanswered tickets - the count on the portal's Support tab. */
export async function supportWaitingCount(scope: PlatformScope): Promise<number> {
  return (await listSupportTickets(scope)).filter((t) => t.waitingOnUs).length;
}

export interface SupportTicketDetail {
  id: string;
  ticketNo: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: string;
  organizationId: string;
  businessName: string;
  branchName: string;
  raisedByName: string;
  createdAt: Date;
  context: Record<string, unknown> | null;
  comments: HelpdeskCommentRow[];
}

async function ticketInScope(scope: PlatformScope, id: string) {
  const t = await db.helpdeskTicket.findFirst({
    where: { id, ...ticketWhere(scope) },
    include: { raisedBy: { select: { fullName: true } }, store: { select: { id: true, name: true, organizationId: true, organization: { select: { name: true } } } } },
  });
  if (!t) throw new HelpdeskError('Ticket not found, or not in your scope.');
  return t;
}

export async function getSupportTicket(scope: PlatformScope, id: string): Promise<SupportTicketDetail> {
  const t = await ticketInScope(scope, id);
  return {
    id: t.id, ticketNo: t.ticketNo, subject: t.subject, description: t.description,
    status: t.status as TicketStatus, priority: t.priority,
    organizationId: t.store.organizationId, businessName: t.store.organization.name, branchName: t.store.name,
    raisedByName: t.raisedBy.fullName, createdAt: t.createdAt,
    context: (t.context as Record<string, unknown> | null) ?? null,
    comments: await commentRows(t.id, { withInternal: true }),
  };
}

/** A reply to the business, or an internal note. Returns the comment, for files, and the ticket's branch. */
export async function replySupportTicket(
  scope: PlatformScope, id: string, userId: string, body: string, internal: boolean,
): Promise<{ commentId: string; storeId: string }> {
  const t = await ticketInScope(scope, id);
  const text = body.trim();
  if (!text) throw new HelpdeskError('Write something first.');
  const c = await db.$transaction(async (tx) => {
    const row = await tx.helpdeskComment.create({ data: { ticketId: t.id, kind: 'note', body: text, authorId: userId, fromSupport: true, internal }, select: { id: true } });
    // A first answer picks the ticket up.
    if (!internal && t.status === 'open') await tx.helpdeskTicket.update({ where: { id: t.id }, data: { status: 'in_progress' } });
    return row;
  });
  return { commentId: c.id, storeId: t.store.id };
}

/** May this support person add a file to this comment? Returns the ticket's branch. */
export async function supportCommentStore(scope: PlatformScope, ticketId: string, commentId: string, userId: string): Promise<string> {
  const t = await ticketInScope(scope, ticketId);
  const c = await db.helpdeskComment.findFirst({ where: { id: commentId, ticketId, authorId: userId, fromSupport: true }, select: { id: true } });
  if (!c) throw new HelpdeskError('That message is not yours to add a file to.');
  return t.store.id;
}

const SUPPORT_NEXT: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed', 'open'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};

export async function setSupportTicketStatus(scope: PlatformScope, id: string, userId: string, status: TicketStatus): Promise<void> {
  const t = await ticketInScope(scope, id);
  const from = t.status as TicketStatus;
  if (!SUPPORT_NEXT[from]?.includes(status)) throw new HelpdeskError(`A ${from.replace('_', ' ')} ticket cannot move to ${status.replace('_', ' ')}.`);
  await db.$transaction([
    db.helpdeskTicket.update({
      where: { id: t.id },
      data: {
        status,
        resolvedAt: status === 'resolved' ? new Date() : status === 'open' ? null : t.resolvedAt,
        closedAt: status === 'closed' ? new Date() : status === 'open' ? null : t.closedAt,
      },
    }),
    db.helpdeskComment.create({ data: { ticketId: t.id, kind: 'status_change', statusFrom: from, statusTo: status, authorId: userId, fromSupport: true } }),
  ]);
}
