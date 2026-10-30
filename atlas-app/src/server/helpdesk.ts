import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { signedUrls } from './storage';

/**
 * Common Hub - Helpdesk: internal employee tickets. Distinct from the
 * customer-facing `Complaint` module - a Helpdesk ticket is raised BY an
 * employee, not about one, and never touches a `Party`.
 *
 * Categories are per-store and admin-defined rather than a fixed enum
 * ("IT", "HR", "Facilities", whatever departments this particular business
 * actually runs) - the same "flexible and customisable" principle applied
 * to salary components and asset types elsewhere in this build.
 *
 * `helpdesk.view` sees every ticket in the store (the support queue) and
 * `helpdesk.edit` can assign/resolve one and manage categories - the same
 * view/edit split already used for `complaints.*`. Raising a ticket and
 * commenting on your OWN ticket need neither permission, the same as
 * `asset_request`.
 *
 * 30 Oct 2026: a ticket can also go to the software's own support team
 * (`toSupport`), who answer it from the platform portal (server/platform-
 * support). Their replies carry `fromSupport`; their `internal` notes are
 * never shown to the business. Screenshots hang off a comment as
 * `helpdesk_comment` attachments.
 */

export class HelpdeskError extends Error {}

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

// ------------------------------------------------------------- categories

export interface HelpdeskCategoryRow {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  openTicketCount: number;
}

export async function listHelpdeskCategories(scope: StoreScope, opts: { activeOnly?: boolean } = {}): Promise<HelpdeskCategoryRow[]> {
  const rows = await db.helpdeskCategory.findMany({
    where: { ...scopeWhere(scope), ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: { sortOrder: 'asc' },
    include: { tickets: { where: { status: { in: ['open', 'in_progress'] } }, select: { id: true } } },
  });
  return rows.map((r) => ({
    id: r.id, name: r.name, sortOrder: r.sortOrder, isActive: r.isActive,
    openTicketCount: r.tickets.length,
  }));
}

export async function createHelpdeskCategory(scope: StoreScope, name: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!name.trim()) throw new HelpdeskError('Category name is required.');

  const existing = await db.helpdeskCategory.findFirst({ where: { storeId, name: name.trim() } });
  if (existing) {
    if (existing.isActive) throw new HelpdeskError('That category already exists.');
    await db.helpdeskCategory.update({ where: { id: existing.id }, data: { isActive: true } });
    return;
  }

  const maxSort = await db.helpdeskCategory.aggregate({ where: { storeId }, _max: { sortOrder: true } });
  await db.helpdeskCategory.create({
    data: { storeId, name: name.trim(), sortOrder: (maxSort._max.sortOrder ?? 0) + 1 },
  });
}

export async function removeHelpdeskCategory(scope: StoreScope, id: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const found = await db.helpdeskCategory.findFirst({ where: { id, storeId } });
  if (!found) throw new HelpdeskError('That category is not in your scope.');
  // Soft-remove only - tickets already raised against it keep their
  // categoryId (see the schema note on HelpdeskTicket.category), they just
  // stop being an option for new ones.
  await db.helpdeskCategory.update({ where: { id }, data: { isActive: false } });
}

// ----------------------------------------------------------------- tickets

export interface HelpdeskTicketRow {
  id: string;
  ticketNo: string;
  raisedById: string;
  raisedByName: string;
  categoryId: string | null;
  categoryName: string | null;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignedToId: string | null;
  assignedToName: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  commentCount: number;
  toSupport: boolean;
}

function toTicketRow(r: {
  id: string; ticketNo: string; raisedById: string; raisedBy: { fullName: string };
  categoryId: string | null; category: { name: string } | null;
  subject: string; description: string; priority: string; status: string;
  assignedToId: string | null; assignedTo: { fullName: string } | null;
  resolvedAt: Date | null; closedAt: Date | null; createdAt: Date;
  comments: { id: string }[]; toSupport: boolean;
}): HelpdeskTicketRow {
  return {
    id: r.id, ticketNo: r.ticketNo, raisedById: r.raisedById, raisedByName: r.raisedBy.fullName,
    categoryId: r.categoryId, categoryName: r.category?.name ?? null,
    subject: r.subject, description: r.description,
    priority: r.priority as TicketPriority, status: r.status as TicketStatus,
    assignedToId: r.assignedToId, assignedToName: r.assignedTo?.fullName ?? null,
    resolvedAt: r.resolvedAt, closedAt: r.closedAt, createdAt: r.createdAt,
    commentCount: r.comments.length,
    toSupport: r.toSupport,
  };
}

/**
 * `canViewAll` (holds `helpdesk.view` or `helpdesk.edit`) sees the whole
 * store's queue; everyone else sees only tickets they raised themselves -
 * a helpdesk ticket can carry an HR or personal complaint, unlike an asset
 * request, so this one does NOT follow the "everybody sees everything"
 * shape the Asset Requests screen uses.
 */
export async function listHelpdeskTickets(
  scope: StoreScope,
  viewer: { userId: string; canViewAll: boolean },
  opts: { status?: TicketStatus; mineOnly?: boolean } = {},
): Promise<HelpdeskTicketRow[]> {
  const restrictToSelf = !viewer.canViewAll || opts.mineOnly;
  const rows = await db.helpdeskTicket.findMany({
    where: {
      ...scopeWhere(scope),
      ...(restrictToSelf ? { raisedById: viewer.userId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      raisedBy: { select: { fullName: true } },
      category: { select: { name: true } },
      assignedTo: { select: { fullName: true } },
      comments: { where: { internal: false }, select: { id: true } },
    },
    take: LIST_MAX_ROWS,
  });
  return rows.map(toTicketRow);
}

async function getTicketForViewer(scope: StoreScope, ticketId: string, viewer: { userId: string; canViewAll: boolean }) {
  const ticket = await db.helpdeskTicket.findFirst({ where: { id: ticketId, ...scopeWhere(scope) } });
  if (!ticket) throw new HelpdeskError('Ticket not found in your scope.');
  if (!viewer.canViewAll && ticket.raisedById !== viewer.userId) {
    throw new HelpdeskError('You can only open your own tickets.');
  }
  return ticket;
}

export interface HelpdeskCommentRow {
  id: string;
  kind: string;
  body: string | null;
  statusFrom: string | null;
  statusTo: string | null;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
  fromSupport: boolean;
  internal: boolean;
  files: CommentFile[];
}

export interface CommentFile { id: string; fileName: string; mimeType: string; url: string | null }

/** Screenshots and files on each comment, with short-lived links. */
export async function commentFiles(commentIds: string[]): Promise<Map<string, CommentFile[]>> {
  const rows = commentIds.length
    ? await db.documentAttachment.findMany({ where: { docType: 'helpdesk_comment', docId: { in: commentIds } }, orderBy: { uploadedAt: 'asc' } })
    : [];
  const urls = rows.length ? await signedUrls(rows.map((r) => r.storagePath)).catch(() => new Map<string, string>()) : new Map<string, string>();
  const out = new Map<string, CommentFile[]>();
  for (const r of rows) out.set(r.docId, [...(out.get(r.docId) ?? []), { id: r.id, fileName: r.fileName, mimeType: r.mimeType, url: urls.get(r.storagePath) ?? null }]);
  return out;
}

/** Comments with their authors and files - `internal` notes only for the support team. */
export async function commentRows(ticketId: string, opts: { withInternal: boolean }): Promise<HelpdeskCommentRow[]> {
  const rows = await db.helpdeskComment.findMany({
    where: { ticketId, ...(opts.withInternal ? {} : { internal: false }) },
    orderBy: { createdAt: 'asc' },
  });
  const authorIds = [...new Set(rows.map((r) => r.authorId).filter((x): x is string => !!x))];
  const [authors, files] = await Promise.all([
    authorIds.length ? db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, fullName: true } }) : [],
    commentFiles(rows.map((r) => r.id)),
  ]);
  const nameById = new Map(authors.map((a) => [a.id, a.fullName]));
  return rows.map((r) => ({
    id: r.id, kind: r.kind, body: r.body, statusFrom: r.statusFrom, statusTo: r.statusTo,
    authorId: r.authorId, authorName: r.authorId ? nameById.get(r.authorId) ?? null : null,
    createdAt: r.createdAt, fromSupport: r.fromSupport, internal: r.internal, files: files.get(r.id) ?? [],
  }));
}

export async function listHelpdeskComments(
  scope: StoreScope, ticketId: string, viewer: { userId: string; canViewAll: boolean },
): Promise<HelpdeskCommentRow[]> {
  await getTicketForViewer(scope, ticketId, viewer);
  return commentRows(ticketId, { withInternal: false });
}

export interface TicketInput {
  categoryId: string | null;
  subject: string;
  description: string;
  priority: TicketPriority;
  /** Send it to the software's support team as well. */
  toSupport?: boolean;
  /** Page, browser, roles... captured when it was raised. */
  context?: Record<string, string | null>;
}

function validateTicket(input: TicketInput) {
  if (!input.subject.trim()) throw new HelpdeskError('Subject is required.');
  if (!input.description.trim()) throw new HelpdeskError('Describe the issue.');
}

export async function raiseHelpdeskTicket(scope: StoreScope, input: TicketInput, userId: string): Promise<{ id: string; ticketNo: string; commentId: string }> {
  const storeId = scopeForWrite(scope);
  validateTicket(input);

  if (input.categoryId) {
    const category = await db.helpdeskCategory.findFirst({ where: { id: input.categoryId, storeId, isActive: true } });
    if (!category) throw new HelpdeskError('That category is not available.');
  }

  const ticketNo = await allocateDocumentNumber(storeId, 'HD');
  const ticket = await db.helpdeskTicket.create({
    data: {
      storeId, ticketNo, raisedById: userId,
      categoryId: input.categoryId, subject: input.subject.trim(), description: input.description.trim(),
      priority: input.priority,
      toSupport: !!input.toSupport, sentToSupportAt: input.toSupport ? new Date() : null,
      context: input.context ?? undefined,
      comments: { create: { kind: 'note', body: input.toSupport ? 'Ticket raised and sent to software support.' : 'Ticket raised.', authorId: userId } },
    },
    include: { comments: { select: { id: true } } },
  });
  return { id: ticket.id, ticketNo: ticket.ticketNo, commentId: ticket.comments[0].id };
}

/** A note on a ticket - either side (the raiser or support) can add one. */
export async function addHelpdeskComment(
  scope: StoreScope, ticketId: string, body: string, viewer: { userId: string; canViewAll: boolean },
): Promise<{ id: string }> {
  if (!body.trim()) throw new HelpdeskError('Comment cannot be empty.');
  await getTicketForViewer(scope, ticketId, viewer);
  return db.helpdeskComment.create({
    data: { ticketId, kind: 'note', body: body.trim(), authorId: viewer.userId },
    select: { id: true },
  });
}

/** Hand a ticket to the software's support team - the raiser or this business's helpdesk. */
export async function sendTicketToSupport(scope: StoreScope, ticketId: string, viewer: { userId: string; canViewAll: boolean }): Promise<void> {
  const ticket = await getTicketForViewer(scope, ticketId, viewer);
  if (ticket.toSupport) return;
  await db.$transaction([
    db.helpdeskTicket.update({ where: { id: ticketId }, data: { toSupport: true, sentToSupportAt: new Date() } }),
    db.helpdeskComment.create({ data: { ticketId, kind: 'note', body: 'Sent to software support.', authorId: viewer.userId } }),
  ]);
}

/** A file may go on a person's own comment, on a ticket they can open. Returns the ticket's branch. */
export async function assertOwnComment(scope: StoreScope, ticketId: string, commentId: string, viewer: { userId: string; canViewAll: boolean }): Promise<string> {
  const ticket = await getTicketForViewer(scope, ticketId, viewer);
  const c = await db.helpdeskComment.findFirst({ where: { id: commentId, ticketId, authorId: viewer.userId }, select: { id: true } });
  if (!c) throw new HelpdeskError('That message is not yours to add a file to.');
  return ticket.storeId;
}

/** Assign (or reassign) a ticket to a support user - `helpdesk.edit` only. */
export async function assignHelpdeskTicket(scope: StoreScope, ticketId: string, assigneeId: string, byUserId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const ticket = await db.helpdeskTicket.findFirst({ where: { id: ticketId, storeId } });
  if (!ticket) throw new HelpdeskError('Ticket not found in your scope.');

  const holdsRole = await db.userStoreRole.findFirst({ where: { storeId, userId: assigneeId } });
  if (!holdsRole) throw new HelpdeskError('That person does not have access to this store.');
  const assignee = await db.user.findUniqueOrThrow({ where: { id: assigneeId }, select: { fullName: true } });

  await db.$transaction([
    db.helpdeskTicket.update({
      where: { id: ticketId },
      data: { assignedToId: assigneeId, ...(ticket.status === 'open' ? { status: 'in_progress' } : {}) },
    }),
    db.helpdeskComment.create({
      data: { ticketId, kind: 'assignment', body: `Assigned to ${assignee.fullName}`, authorId: byUserId },
    }),
  ]);
}

const NEXT_STATUS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed', 'open'],
  resolved: ['closed', 'open'], // the raiser reopening a fix that didn't work
  closed: ['open'],
};

/** Move a ticket through its status lifecycle - `helpdesk.edit` for resolving/closing, either side may reopen. */
export async function setHelpdeskTicketStatus(
  scope: StoreScope, ticketId: string, status: TicketStatus, note: string | null, viewer: { userId: string; canViewAll: boolean },
): Promise<void> {
  const ticket = await getTicketForViewer(scope, ticketId, viewer);
  const from = ticket.status as TicketStatus;
  if (!NEXT_STATUS[from].includes(status)) {
    throw new HelpdeskError(`A ${from.replace('_', ' ')} ticket cannot move directly to ${status.replace('_', ' ')}.`);
  }
  // Resolving or closing is a support action; reopening is open to the
  // person who raised it too, so a fix that didn't work isn't blocked on
  // whoever happens to hold `helpdesk.edit` being online.
  const isReopen = status === 'open';
  if (!isReopen && !viewer.canViewAll) throw new HelpdeskError('Only the support team can resolve or close a ticket.');

  await db.$transaction([
    db.helpdeskTicket.update({
      where: { id: ticketId },
      data: {
        status,
        resolvedAt: status === 'resolved' ? new Date() : status === 'open' ? null : ticket.resolvedAt,
        closedAt: status === 'closed' ? new Date() : status === 'open' ? null : ticket.closedAt,
      },
    }),
    db.helpdeskComment.create({
      data: { ticketId, kind: 'status_change', statusFrom: from, statusTo: status, body: note?.trim() || null, authorId: viewer.userId },
    }),
  ]);
}

/** Everyone holding a role in this store - the pool a ticket can be assigned to. */
export async function listHelpdeskAssignableUsers(scope: StoreScope) {
  const storeId = scopeForWrite(scope);
  const roles = await db.userStoreRole.findMany({
    where: { storeId },
    distinct: ['userId'],
    select: { user: { select: { id: true, fullName: true } } },
  });
  return roles.map((r) => r.user).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

// --------------------------------------------------------------- dashboard

export interface HelpdeskDashboard {
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  unassigned: number;
  mineOpen: number;
}

export async function getHelpdeskDashboard(scope: StoreScope, viewer: { userId: string; canViewAll: boolean }): Promise<HelpdeskDashboard> {
  const where = viewer.canViewAll ? scopeWhere(scope) : { ...scopeWhere(scope), raisedById: viewer.userId };
  const tickets = await db.helpdeskTicket.findMany({
    where, select: { status: true, assignedToId: true, raisedById: true },
  });

  return {
    open: tickets.filter((t) => t.status === 'open').length,
    inProgress: tickets.filter((t) => t.status === 'in_progress').length,
    resolved: tickets.filter((t) => t.status === 'resolved').length,
    closed: tickets.filter((t) => t.status === 'closed').length,
    unassigned: tickets.filter((t) => !t.assignedToId && (t.status === 'open' || t.status === 'in_progress')).length,
    mineOpen: tickets.filter((t) => t.raisedById === viewer.userId && (t.status === 'open' || t.status === 'in_progress')).length,
  };
}

// --------------------------------------------------------------------- FAQs
// atlas-hrns's real FAQCategory/FAQ (roadmap §4.9) - deliberately separate
// from HelpdeskCategory above, which is for tickets, not reference reading.

export interface FaqCategoryRow {
  id: string;
  title: string;
  faqCount: number;
}

export async function listFaqCategories(scope: StoreScope): Promise<FaqCategoryRow[]> {
  const rows = await db.helpdeskFaqCategory.findMany({
    where: scopeWhere(scope),
    orderBy: { title: 'asc' },
    include: { faqs: { select: { id: true } } },
  });
  return rows.map((r) => ({ id: r.id, title: r.title, faqCount: r.faqs.length }));
}

export async function createFaqCategory(scope: StoreScope, title: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!title.trim()) throw new HelpdeskError('Category name is required.');
  const existing = await db.helpdeskFaqCategory.findFirst({ where: { storeId, title: title.trim() } });
  if (existing) throw new HelpdeskError('A category with that name already exists.');
  await db.helpdeskFaqCategory.create({ data: { storeId, title: title.trim() } });
}

export async function removeFaqCategory(
  scope: StoreScope, id: string, userId: string | null = null,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const category = await db.helpdeskFaqCategory.findFirst({ where: { id, storeId }, include: { faqs: { select: { id: true } } } });
  if (!category) throw new HelpdeskError('Category not found in your scope.');
  /**
   * Only LIVE FAQs block it. `faqs` here is a RELATION read, which
   * `server/soft-delete` deliberately does not filter - so a category whose FAQs
   * were all removed would stay undeletable forever. Filtered explicitly instead.
   */
  if (category.faqs.length > 0) throw new HelpdeskError('Move or remove its FAQs first - a category with FAQs cannot be deleted.');
  await db.helpdeskFaqCategory.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: userId } });
}

export interface FaqRow {
  id: string;
  categoryId: string;
  categoryTitle: string;
  question: string;
  answer: string;
}

export async function listFaqs(scope: StoreScope): Promise<FaqRow[]> {
  const rows = await db.helpdeskFaq.findMany({
    where: scopeWhere(scope),
    orderBy: { createdAt: 'asc' },
    include: { category: { select: { title: true } } },
  });
  return rows.map((r) => ({ id: r.id, categoryId: r.categoryId, categoryTitle: r.category.title, question: r.question, answer: r.answer }));
}

export interface FaqInput {
  categoryId: string;
  question: string;
  answer: string;
}

export async function saveFaq(scope: StoreScope, id: string | null, input: FaqInput): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!input.question.trim() || !input.answer.trim()) throw new HelpdeskError('Both a question and an answer are required.');
  const category = await db.helpdeskFaqCategory.findFirst({ where: { id: input.categoryId, storeId } });
  if (!category) throw new HelpdeskError('Category not found in your scope.');

  if (id) {
    const existing = await db.helpdeskFaq.findFirst({ where: { id, storeId } });
    if (!existing) throw new HelpdeskError('FAQ not found in your scope.');
    await db.helpdeskFaq.update({
      where: { id },
      data: { categoryId: input.categoryId, question: input.question.trim(), answer: input.answer.trim() },
    });
  } else {
    await db.helpdeskFaq.create({
      data: { storeId, categoryId: input.categoryId, question: input.question.trim(), answer: input.answer.trim() },
    });
  }
}

export async function removeFaq(
  scope: StoreScope, id: string, userId: string | null = null,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const existing = await db.helpdeskFaq.findFirst({ where: { id, storeId } });
  if (!existing) throw new HelpdeskError('FAQ not found in your scope.');
  await db.helpdeskFaq.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: userId } });
}
