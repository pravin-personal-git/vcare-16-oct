import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { FEED_MAX_ROWS } from '@/lib/list-limits';
import { scopeWhere, type StoreScope } from './store-scope';
import { openApprovalRequest, resolveHierarchyApprover } from './hierarchy';
import { notify, ownersOf } from './notify';
import {
  applicableLevels, decideVerdict, evaluateRule, hoursSince, requestType, REQUEST_TYPES,
  type ApproverKind, type DecideVerdict, type Rule, type RuleLevel,
} from '@/lib/approval-rules';
import { approvalHandler } from './approval-handlers';

/**
 * Approval rules on top of the one approval engine (27 Sep 2026,
 * NOTIFICATIONS-APPROVALS-SPEC.md §3-4).
 *
 * - `requestApproval` is asked when something needs a sign-off. With a rule
 *   for its type it either approves at once (not needed / skip list / below
 *   the threshold) or opens a request and tells the approvers.
 * - No rule saved yet = exactly the old behaviour (reporting line or role
 *   chain), plus the approvers - or the owner - are now notified.
 * - Who may decide a level, for My Reminders & Requests and for the engine.
 * - The nudge / escalation sweep.
 */

export async function loadRule(storeId: string, type: string): Promise<Rule | null> {
  const r = await db.approvalRule.findUnique({
    where: { storeId_requestType: { storeId, requestType: type } },
    include: { levels: true },
  });
  if (!r) return null;
  return {
    needsApproval: r.needsApproval, thresholdPaise: r.thresholdPaise, skipRoleIds: r.skipRoleIds, skipUserIds: r.skipUserIds,
    maxDiscountPct: r.maxDiscountPct, minMarginPct: r.minMarginPct,
    nudgeHours: r.nudgeHours, escalateHours: r.escalateHours, escalateTo: r.escalateTo === 'next_level' ? 'next_level' : 'owner',
    levels: r.levels.map((l): RuleLevel => ({
      level: l.level, approverKind: l.approverKind as ApproverKind, roleId: l.roleId, userId: l.userId, minAmountPaise: l.minAmountPaise,
    })),
  };
}

export async function roleIdsOf(storeId: string, userId: string) {
  return (await db.userStoreRole.findMany({ where: { storeId, userId }, select: { roleId: true } })).map((r) => r.roleId);
}

/** People who can decide one rule level, never the requester (unless nobody else could). */
async function approversForLevel(storeId: string, level: RuleLevel, requesterId: string): Promise<string[]> {
  let ids: string[] = [];
  if (level.approverKind === 'manager' || level.approverKind === 'manager2') {
    const a = await resolveHierarchyApprover(requesterId, level.approverKind === 'manager' ? 1 : 2);
    ids = a ? [a.userId] : [];
  } else if (level.approverKind === 'role' && level.roleId) {
    ids = (await db.userStoreRole.findMany({ where: { storeId, roleId: level.roleId, user: { isActive: true } }, select: { userId: true } })).map((r) => r.userId);
  } else if (level.approverKind === 'user' && level.userId) {
    ids = [level.userId];
  } else {
    ids = await ownersOf(storeId);
  }
  ids = ids.filter((id) => id !== requesterId);
  if (!ids.length) ids = (await ownersOf(storeId)).filter((id) => id !== requesterId);
  // A one-person business: the owner is the only one who can ever say yes.
  if (!ids.length) ids = await ownersOf(storeId);
  return [...new Set(ids)];
}

/** Who the request is waiting on right now. */
export async function currentApprovers(req: {
  storeId: string; entityType: string; requestedBy: string; currentLevel: number; amountPaise: number | null;
}): Promise<string[]> {
  const rule = await loadRule(req.storeId, req.entityType);
  if (rule) {
    const level = applicableLevels(rule, req.amountPaise)[req.currentLevel - 1];
    return level ? approversForLevel(req.storeId, level, req.requestedBy) : ownersOf(req.storeId);
  }
  const t = requestType(req.entityType);
  if (t?.legacy === 'hierarchy') {
    const a = await resolveHierarchyApprover(req.requestedBy, req.currentLevel);
    return a ? [a.userId] : ownersOf(req.storeId);
  }
  const chain = await db.approvalChain.findFirst({ where: { storeId: req.storeId, entityType: req.entityType, level: req.currentLevel } });
  if (chain) {
    const holders = await db.userStoreRole.findMany({ where: { storeId: req.storeId, roleId: chain.approverRoleId, user: { isActive: true } }, select: { userId: true } });
    const ids = holders.map((h) => h.userId).filter((id) => id !== req.requestedBy);
    if (ids.length) return ids;
  }
  return ownersOf(req.storeId);
}

export interface ApprovalAsk {
  type: string;
  entityId: string;
  requesterId: string;
  /** Filled from the handler when not given. */
  amountPaise?: number | null;
  title?: string;
  summary?: string | null;
  /** A held action's details, run once approved (server/approval-actions). */
  payload?: Prisma.InputJsonValue;
  /**
   * Where this request opens, when the type's own rule cannot say.
   *
   * Most types resolve a link from their entityId, because the entityId is a
   * record. A HELD action's is not - the record does not exist yet, which is
   * the whole point of holding it - so there is nothing for a `?open=` to
   * find. Such an action names the screen that gives the approver the
   * context instead: the van whose stock is being written off, say.
   */
  href?: string | null;
  /** Discount and margin of a quotation / invoice, for rules that test them. */
  pricing?: { discountPct: number | null; marginPct: number | null };
}

export type ApprovalAnswer =
  | { auto: true; reason: string }
  | { auto: false; requestId: string }
  /** No rule and no legacy route: decided directly on its own screen, as before. */
  | { auto: false; requestId: null };

/**
 * Ask whether something needs approval. On `auto`, the caller (or
 * `settleAuto`) marks it approved; otherwise it now waits and the approvers
 * have been told.
 */
export async function requestApproval(storeId: string, ask: ApprovalAsk): Promise<ApprovalAnswer> {
  const handler = approvalHandler(ask.type);
  const info = handler ? await handler.describe(storeId, ask.entityId).catch(() => null) : null;
  const amountPaise = ask.amountPaise ?? info?.amountPaise ?? null;
  const title = ask.title ?? info?.title ?? requestType(ask.type)?.label ?? 'Approval';
  const summary = ask.summary ?? info?.summary ?? null;
  const href = ask.href ?? requestType(ask.type)?.href(ask.entityId) ?? null;

  const open = await db.approvalRequest.findFirst({
    where: { storeId, entityType: ask.type, entityId: ask.entityId, status: 'PENDING' },
    select: { id: true },
  });
  if (open) return { auto: false, requestId: open.id };

  const rule = await loadRule(storeId, ask.type);
  if (rule) {
    const verdict = evaluateRule(rule, { userId: ask.requesterId, roleIds: await roleIdsOf(storeId, ask.requesterId), amountPaise, ...ask.pricing });
    if (verdict.auto) return { auto: true, reason: verdict.reason };
  } else {
    // The old routes, unchanged: reporting line for people requests, a role
    // chain where one was set. Neither = decided on its own screen.
    const t = requestType(ask.type);
    const routed = t?.legacy === 'hierarchy'
      ? !!(await resolveHierarchyApprover(ask.requesterId, 1))
      : (await db.approvalChain.count({ where: { storeId, entityType: ask.type } })) > 0;
    if (!routed) {
      // Still tell whoever can decide it - the owner - that it is waiting.
      await notify({
        storeId, userIds: (await ownersOf(storeId)).filter((u) => u !== ask.requesterId), kind: 'approval_waiting',
        title: `${title} waiting for approval`, body: summary, href,
        entityType: ask.type, entityId: ask.entityId, dedupeKey: `waiting:${ask.type}:${ask.entityId}:direct`,
      });
      return { auto: false, requestId: null };
    }
  }

  const created = await db.approvalRequest.create({
    data: {
      storeId, entityType: ask.type, entityId: ask.entityId, requestedBy: ask.requesterId, currentLevel: 1, title, summary, amountPaise, href,
      ...(ask.payload !== undefined ? { payload: ask.payload } : {}),
    },
    select: { id: true, storeId: true, entityType: true, requestedBy: true, currentLevel: true, amountPaise: true },
  });
  await tellApprovers(created);
  return { auto: false, requestId: created.id };
}

/**
 * Would this need somebody's approval under the saved rule? No rule saved
 * means no - the module then behaves exactly as it did before rules existed.
 * Used where a document must stop BEFORE its final step (credit notes,
 * purchase bills - 5 Oct 2026) rather than be approved after the fact.
 */
export async function approvalNeeded(
  storeId: string, type: string, requesterId: string, amountPaise: number | null,
  pricing?: { discountPct: number | null; marginPct: number | null },
): Promise<boolean> {
  const rule = await loadRule(storeId, type);
  if (!rule) return false;
  return !evaluateRule(rule, { userId: requesterId, roleIds: await roleIdsOf(storeId, requesterId), amountPaise, ...pricing }).auto;
}

/**
 * Ask, and when the answer is "no approval needed", approve it through the
 * module's own decide function - so the record ends up exactly as if
 * someone had pressed Approve, with the reason in its note.
 */
export async function requestOrApprove(storeId: string, ask: ApprovalAsk): Promise<ApprovalAnswer> {
  const answer = await requestApproval(storeId, ask);
  if (answer.auto) {
    const handler = approvalHandler(ask.type);
    if (handler) {
      await handler.decide({ kind: 'single', storeId, writable: true }, ask.entityId, 'approved', ask.requesterId, `Approved automatically - ${answer.reason}`, true)
        .catch((e) => console.error(`[approvals] auto-approve ${ask.type} failed`, e));
    }
  }
  return answer;
}

async function tellApprovers(req: { id: string; storeId: string; entityType: string; requestedBy: string; currentLevel: number; amountPaise: number | null }) {
  const full = await db.approvalRequest.findUnique({ where: { id: req.id }, select: { title: true, summary: true, href: true, entityId: true } });
  const who = await db.user.findUnique({ where: { id: req.requestedBy }, select: { fullName: true } });
  await notify({
    storeId: req.storeId, userIds: await currentApprovers(req), kind: 'approval_waiting',
    title: `${full?.title ?? 'A request'} from ${who?.fullName ?? 'someone'} needs your approval`,
    body: full?.summary ?? null, href: '/my/reminders', entityType: req.entityType, entityId: full?.entityId ?? null,
    dedupeKey: `waiting:${req.id}:L${req.currentLevel}`,
  });
}

/** Called by the engine after each step. */
export async function afterStep(requestId: string, final: 'APPROVED' | 'REJECTED' | null) {
  const req = await db.approvalRequest.findUnique({ where: { id: requestId } });
  if (!req) return;
  if (final === null) { await tellApprovers(req); return; }
  await notify({
    storeId: req.storeId, userIds: [req.requestedBy], kind: 'approval_decided',
    title: `${req.title ?? requestType(req.entityType)?.label ?? 'Your request'} was ${final === 'APPROVED' ? 'approved' : 'rejected'}`,
    body: req.note ? `Note: ${req.note}` : null, href: req.href ?? '/my/reminders',
    entityType: req.entityType, entityId: req.entityId, dedupeKey: `decided:${req.id}`,
  });
}

/**
 * May this person decide the request's current level? Rule-based requests:
 * one of that level's approvers, or an owner. The old routes are checked by
 * the engine itself, as before.
 */
export async function canDecideRuleLevel(req: {
  storeId: string; entityType: string; requestedBy: string; currentLevel: number; amountPaise: number | null;
}, deciderId: string): Promise<{ verdict: DecideVerdict; waitingOn: string[]; isLast: boolean; ruleBased: boolean }> {
  const fine: DecideVerdict = { ok: true, override: null };
  const rule = await loadRule(req.storeId, req.entityType);
  if (!rule) return { verdict: fine, waitingOn: [], isLast: true, ruleBased: false };
  const levels = applicableLevels(rule, req.amountPaise);
  const level = levels[req.currentLevel - 1];
  const isLast = req.currentLevel >= levels.length;
  if (!level) return { verdict: fine, waitingOn: [], isLast: true, ruleBased: true };
  const approvers = await approversForLevel(req.storeId, level, req.requestedBy);
  const owners = await ownersOf(req.storeId);
  const verdict = decideVerdict({ deciderId, requesterId: req.requestedBy, approvers, owners });
  return { verdict, waitingOn: approvers, isLast, ruleBased: true };
}

// ------------------------------------------------------------------ inbox

export interface InboxItem {
  requestId: string | null;
  type: string;
  typeLabel: string;
  entityId: string;
  title: string;
  summary: string | null;
  amountPaise: number | null;
  requesterName: string;
  level: number;
  levels: number | null;
  since: string;
  href: string;
  /** Owner seeing it because it is escalated or has nobody else. */
  asOwner: boolean;
  /**
   * Who it is stuck with right now, by name (4 Oct 2026). Empty for items
   * with no open request - those are the owner's to decide on their screen.
   */
  waitingOnNames: string[];
  /** The person looking raised it themselves. Only an owner can decide these. */
  raisedByMe: boolean;
  /**
   * Approving needs a note, and this is what to ask (30 Oct 2026): a job the
   * technician closed "customer approved" without the code needs the call
   * written down. Approve without it used to fail with a banner at the top of
   * My Desk that nobody saw (Prachi, CMP-DURG001-2026-0041).
   */
  noteToApprove: string | null;
}

/**
 * Items with no open request - decided on their own screen - in one branch,
 * each with who may decide it: the owners, plus, for field jobs, everyone
 * whose role has Complaints: Approve. Shared by My Desk's Waiting on me and
 * Team follow-up so the two never count differently (30 Oct 2026: Team
 * follow-up counted only requests, and Vcare's waiting items are nearly all
 * of this kind).
 * shortcut: deciders come from roles, not a person's own access switches; read the full context if those start granting Approve.
 */
export async function directItems(storeId: string, open: { entityType: string; entityId: string }[]) {
  const owners = await ownersOf(storeId);
  const out: { type: string; label: string; href: string; item: Awaited<ReturnType<NonNullable<ReturnType<typeof approvalHandler>>['pendingDirect']>>[number]; deciders: string[] }[] = [];
  for (const t of REQUEST_TYPES) {
    const h = approvalHandler(t.key);
    if (!h) continue;
    const pending = await h.pendingDirect(storeId).catch(() => []);
    if (!pending.length) continue;
    const perm = DIRECT_DECIDERS[t.key];
    const holders = perm
      ? (await db.userStoreRole.findMany({ where: { storeId, user: { isActive: true }, role: { permissions: { some: { permission: { key: perm } } } } }, select: { userId: true } })).map((r) => r.userId)
      : [];
    const deciders = [...new Set([...owners, ...holders])];
    for (const p of pending) {
      if (open.some((r) => r.entityType === t.key && r.entityId === p.id)) continue;
      out.push({ type: t.key, label: t.label, href: t.href(p.id), item: p, deciders });
    }
  }
  return out;
}

/** What to ask before approving, per item - see InboxItem.noteToApprove. */
async function notesToApprove(items: { type: string; entityId: string }[]): Promise<Set<string>> {
  const ids = items.filter((i) => i.type === 'job_close').map((i) => i.entityId);
  if (!ids.length) return new Set();
  return new Set((await db.complaint.findMany({ where: { id: { in: ids }, needsCallback: true }, select: { id: true } })).map((c) => c.id));
}
const CALL_NOTE = 'The technician closed this without the customer\'s code. Call the customer - what did they say?';

/**
 * Items with no Approval Rule (no open request) go to the owner - and, for
 * field jobs, to anyone whose role has Complaints & visits: Approve (Pravin,
 * 28 Sep 2026: "apart from admin, another employee must manage this").
 */
const DIRECT_DECIDERS: Record<string, string> = { job_challan: 'complaints.approve', job_close: 'complaints.approve', warranty_void: 'complaints.approve' };

/** May this person decide an item that has no open request? */
export async function mayDecideDirect(scope: StoreScope, userId: string, type: string, permissions?: ReadonlySet<string>): Promise<boolean> {
  const perm = DIRECT_DECIDERS[type];
  if (perm && permissions?.has(perm)) return true;
  const storeIds = scope.kind === 'single' ? [scope.storeId] : scope.storeIds;
  for (const s of storeIds) if ((await ownersOf(s)).includes(userId)) return true;
  return false;
}

/** Everything waiting on this person (the owner can ask for everyone's). */
export async function waitingOn(scope: StoreScope, userId: string, opts: { everyone?: boolean; permissions?: ReadonlySet<string> } = {}): Promise<InboxItem[]> {
  const storeIds = scope.kind === 'single' ? [scope.storeId] : scope.storeIds;
  const items: InboxItem[] = [];
  const names = new Map<string, string>();
  const nameOf = async (id: string) => {
    if (!names.has(id)) names.set(id, (await db.user.findUnique({ where: { id }, select: { fullName: true } }))?.fullName ?? 'Someone');
    return names.get(id)!;
  };

  const open = await db.approvalRequest.findMany({ where: { storeId: { in: storeIds }, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: FEED_MAX_ROWS });
  for (const r of open) {
    const owners = await ownersOf(r.storeId);
    const approvers = await currentApprovers(r);
    const mine = approvers.includes(userId);
    const asOwner = owners.includes(userId) && (!!r.escalatedAt || opts.everyone === true);
    if (!mine && !asOwner) continue;
    const rule = await loadRule(r.storeId, r.entityType);
    const waitingOnNames = await Promise.all(approvers.map(nameOf));
    items.push({
      requestId: r.id, type: r.entityType, typeLabel: requestType(r.entityType)?.label ?? r.entityType, entityId: r.entityId,
      title: r.title ?? requestType(r.entityType)?.label ?? 'Request', summary: r.summary, amountPaise: r.amountPaise,
      requesterName: await nameOf(r.requestedBy), level: r.currentLevel,
      levels: rule ? applicableLevels(rule, r.amountPaise).length : null,
      since: r.createdAt.toISOString(), href: r.href ?? requestType(r.entityType)?.href(r.entityId) ?? '/',
      asOwner: !mine, waitingOnNames, raisedByMe: r.requestedBy === userId, noteToApprove: null,
    });
  }

  // Items with no open request (decided on their own screen): the owner's to decide.
  for (const storeId of storeIds) {
    const isOwner = (await ownersOf(storeId)).includes(userId);
    for (const d of await directItems(storeId, open)) {
      const perm = DIRECT_DECIDERS[d.type];
      if (!isOwner && !(perm && opts.permissions?.has(perm))) continue;
      const p = d.item;
      items.push({
        requestId: null, type: d.type, typeLabel: d.label, entityId: p.id, title: p.title, summary: p.summary,
        amountPaise: p.amountPaise, requesterName: p.requesterId ? await nameOf(p.requesterId) : '-', level: 1, levels: null,
        since: p.since.toISOString(), href: d.href, asOwner: false,
        waitingOnNames: [], raisedByMe: p.requesterId === userId, noteToApprove: null,
      });
    }
  }
  const needNote = await notesToApprove(items);
  for (const i of items) if (i.type === 'job_close' && needNote.has(i.entityId)) i.noteToApprove = CALL_NOTE;
  return items.sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}

export interface MyRequestItem {
  requestId: string; type: string; typeLabel: string; title: string; summary: string | null; amountPaise: number | null;
  status: string; level: number; waitingOn: string[]; note: string | null; since: string; decidedAt: string | null; href: string;
}

/**
 * `allHistory` (My Desk, 9 Oct 2026): every request this person ever raised,
 * not only the last 30 days of decided ones - My Desk now filters by date, and
 * "This financial year" quietly missing May would be a filter that lies. One
 * person's own requests are few; FEED_MAX_ROWS still caps it.
 */
export async function myRequests(scope: StoreScope, userId: string, allHistory = false): Promise<MyRequestItem[]> {
  const window: Prisma.ApprovalRequestWhereInput = allHistory ? {} : { OR: [{ status: 'PENDING' }, { decidedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }] };
  const rows = await db.approvalRequest.findMany({
    where: { ...scopeWhere(scope), requestedBy: userId, ...window },
    orderBy: { createdAt: 'desc' }, take: FEED_MAX_ROWS,
  });
  const out: MyRequestItem[] = [];
  for (const r of rows) {
    const waiting = r.status === 'PENDING' ? await currentApprovers(r) : [];
    const names = waiting.length ? (await db.user.findMany({ where: { id: { in: waiting } }, select: { fullName: true } })).map((u) => u.fullName) : [];
    out.push({
      requestId: r.id, type: r.entityType, typeLabel: requestType(r.entityType)?.label ?? r.entityType,
      title: r.title ?? requestType(r.entityType)?.label ?? 'Request', summary: r.summary, amountPaise: r.amountPaise,
      status: r.status, level: r.currentLevel, waitingOn: names, note: r.note, since: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null, href: r.href ?? requestType(r.entityType)?.href(r.entityId) ?? '/',
    });
  }
  return out;
}

/** Approve or reject from My Reminders & Requests - through the module's own decide. */
export async function decideFromInbox(
  scope: StoreScope, type: string, entityId: string, decision: 'approved' | 'rejected', userId: string, note: string | null,
  permissions?: ReadonlySet<string>,
) {
  if (decision === 'rejected' && !note?.trim()) throw new ApprovalInboxError('Say why it is being rejected.');
  const handler = approvalHandler(type);
  if (!handler) throw new ApprovalInboxError('This kind of request cannot be decided from here yet - open it instead.');
  // With a request open, the Approval Rule decides who may (checked in the
  // step). Without one, only the owner - or, for field jobs, Complaints:
  // Approve. Before 28 Sep 2026 anyone signed in could decide these.
  if (!(await openApprovalRequest(scope, type, entityId)) && !(await mayDecideDirect(scope, userId, type, permissions))) {
    throw new ApprovalInboxError('You cannot approve this - ask the owner, or someone whose role has the Approve level.');
  }
  await handler.decide(scope, entityId, decision, userId, note?.trim() || null, false);
}

export class ApprovalInboxError extends Error {}

// ------------------------------------------------------------------ nudges & escalation

/** Remind approvers after nudgeHours; after escalateHours also tell the next level or the owner. Once each. */
export async function escalationSweep(storeId: string, now: Date = new Date()) {
  const open = await db.approvalRequest.findMany({ where: { storeId, status: 'PENDING' } });
  for (const r of open) {
    const rule = await loadRule(storeId, r.entityType);
    const nudgeHours = rule?.nudgeHours ?? 24;
    const escalateHours = rule?.escalateHours ?? 48;
    const age = hoursSince(r.createdAt, now);
    if (age >= nudgeHours && !r.lastNudgedAt) {
      await notify({
        storeId, userIds: await currentApprovers(r), kind: 'approval_waiting',
        title: `Reminder: ${r.title ?? 'a request'} has waited ${Math.floor(age)} hours for your approval`,
        body: r.summary, href: '/my/reminders', entityType: r.entityType, entityId: r.entityId, dedupeKey: `nudge:${r.id}:L${r.currentLevel}`,
      });
      await db.approvalRequest.update({ where: { id: r.id }, data: { lastNudgedAt: now } });
    }
    if (age >= escalateHours && !r.escalatedAt) {
      let to = await ownersOf(storeId);
      if (rule?.escalateTo === 'next_level') {
        const next = applicableLevels(rule, r.amountPaise)[r.currentLevel];
        if (next) to = await approversForLevel(storeId, next, r.requestedBy);
      }
      await notify({
        storeId, userIds: to, kind: 'escalation',
        title: `Escalated: ${r.title ?? 'a request'} has waited ${Math.floor(age)} hours`,
        body: r.summary, href: '/my/reminders', entityType: r.entityType, entityId: r.entityId, dedupeKey: `escalate:${r.id}`,
      });
      await db.approvalRequest.update({ where: { id: r.id }, data: { escalatedAt: now } });
    }
  }
}

/**
 * Which of these records have an approval request open right now (any type) -
 * for the "Awaiting approval" badge on list screens (5 Oct 2026).
 */
export async function awaitingApproval(scope: StoreScope, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.approvalRequest.findMany({
    where: { ...scopeWhere(scope), status: 'PENDING', entityId: { in: ids } },
    select: { entityId: true },
  });
  return new Set(rows.map((r) => r.entityId));
}
