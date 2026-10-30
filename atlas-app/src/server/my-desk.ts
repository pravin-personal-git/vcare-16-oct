import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { FEED_MAX_ROWS } from '@/lib/list-limits';
import { listAllocations, listLeaveTypes } from './leave-types';
import { createLeaveRequest } from './attendance';
import { isDayKey } from '@/lib/attendance-day';
import { requestCompOff, requestLeaveAllocation } from './leave-types';
import { requestLeaveEncashment, requestReimbursement } from './staff-claims';
import { requestAsset } from './assets';
import { submitResignation } from './offboarding';
import { currentApprovers } from './approvals';
import { requestType } from '@/lib/approval-rules';

/**
 * My Desk (27 Sep 2026, streamline roadmap S2): one place where anyone raises
 * their own requests - leave, WFH, half day, comp-off, extra leave,
 * reimbursement, leave encashment, an asset, resignation - and sees where
 * each one is.
 *
 * Before this, every one of these lived inside an admin screen that needed an
 * admin permission (a leave request needed attendance.edit), so an ordinary
 * employee could not ask for anything. Raising is always for the signed-in
 * person themselves; deciding stays on the admin screens and in "Waiting on
 * me", through the same approval rules.
 *
 * The list reads each request's own table rather than ApprovalRequest: a
 * request with no approval rule and no reporting line creates no
 * ApprovalRequest row (approvals.ts), and would otherwise be invisible.
 */

export const DESK_KINDS = [
  'leave', 'half_day', 'wfh', 'comp_off', 'leave_allocation', 'reimbursement', 'leave_encashment', 'asset_request', 'resignation',
] as const;
export type DeskKind = (typeof DESK_KINDS)[number];

export const DESK_KIND_LABEL: Record<DeskKind, string> = {
  leave: 'Leave', half_day: 'Half day', wfh: 'Work from home', comp_off: 'Comp-off',
  leave_allocation: 'Extra leave days', reimbursement: 'Reimbursement', leave_encashment: 'Leave encashment',
  asset_request: 'Asset', resignation: 'Resignation',
};

/** Approval-engine type for each desk kind (half day travels as 'leave'). */
const ENGINE_TYPE: Record<DeskKind, string> = {
  leave: 'leave', half_day: 'leave', wfh: 'wfh', comp_off: 'comp_off', leave_allocation: 'leave_allocation',
  reimbursement: 'reimbursement', leave_encashment: 'leave_encashment', asset_request: 'asset_request', resignation: 'resignation',
};

export const REIMBURSEMENT_CATEGORIES = ['travel', 'medical', 'food', 'other'];

export class DeskError extends Error {}

export interface DeskRequest {
  id: string;
  kind: DeskKind;
  label: string;
  detail: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  /** Names of whoever the request is waiting on, when an approval rule routes it. */
  waitingOn: string[];
}

const day = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
const range = (a: Date, b: Date) => (a.getTime() === b.getTime() ? day(a) : `${day(a)} - ${day(b)}`);
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

/** Everything this person asked for: pending first, then the last 90 days. */
/** `allHistory`: no 90-day window - same reason as `myRequests` in server/approvals. */
export async function myDeskRequests(scope: StoreScope, userId: string, allHistory = false): Promise<DeskRequest[]> {
  const w = scopeWhere(scope);
  const since = new Date(allHistory ? 0 : Date.now() - 90 * 86_400_000);
  const recent = { OR: [{ status: 'pending' }, { createdAt: { gte: since } }] };
  const take = FEED_MAX_ROWS;

  const [leaves, compOffs, allocs, claims, encash, assets, resigns, types] = await Promise.all([
    db.leaveRequest.findMany({ where: { ...w, userId, ...recent }, orderBy: { createdAt: 'desc' }, take }),
    db.compOffEntry.findMany({ where: { ...w, userId, requestedBy: userId, ...recent }, orderBy: { createdAt: 'desc' }, take }),
    db.leaveAllocationRequest.findMany({ where: { ...w, userId, ...recent }, orderBy: { createdAt: 'desc' }, take }),
    db.reimbursementClaim.findMany({ where: { ...w, userId, ...recent }, orderBy: { createdAt: 'desc' }, take }),
    db.leaveEncashment.findMany({ where: { ...w, userId, ...recent }, orderBy: { createdAt: 'desc' }, take }),
    db.assetRequest.findMany({ where: { ...w, requestedById: userId, ...recent }, orderBy: { createdAt: 'desc' }, take }),
    db.resignation.findMany({ where: { ...w, userId, OR: [{ status: 'submitted' }, { createdAt: { gte: since } }] }, orderBy: { createdAt: 'desc' }, take }),
    db.leaveType.findMany({ where: { ...w }, select: { id: true, name: true } }),
  ]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const base = (kind: DeskKind, r: { id: string; status: string; createdAt: Date; decidedAt: Date | null; decisionNote: string | null }, detail: string): DeskRequest => ({
    id: r.id, kind, label: DESK_KIND_LABEL[kind], detail, status: r.status === 'submitted' ? 'pending' : r.status,
    createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null, decisionNote: r.decisionNote, waitingOn: [],
  });

  const out: DeskRequest[] = [
    ...leaves.map((r) => {
      const kind: DeskKind = r.kind === 'wfh' ? 'wfh' : r.kind === 'half_day' ? 'half_day' : 'leave';
      const t = r.leaveTypeId ? typeName.get(r.leaveTypeId) : null;
      return base(kind, r, [range(r.fromDate, r.toDate), t, r.reason].filter(Boolean).join(' · '));
    }),
    ...compOffs.map((r) => base('comp_off', r, [`${Math.abs(r.days)} day${Math.abs(r.days) === 1 ? '' : 's'}`, r.reason].filter(Boolean).join(' · '))),
    ...allocs.map((r) => base('leave_allocation', r, [`${r.requestedDays} × ${typeName.get(r.leaveTypeId) ?? 'leave'}`, r.description].join(' · '))),
    ...claims.map((r) => base('reimbursement', r, [rupees(r.amountPaise), r.category, day(r.expenseDate), r.description].filter(Boolean).join(' · '))),
    ...encash.map((r) => base('leave_encashment', r, `${Number(r.days)} × ${typeName.get(r.leaveTypeId) ?? 'leave'} · ${rupees(r.amountPaise)}`)),
    ...assets.map((r) => base('asset_request', r, [r.assetType, r.reason].filter(Boolean).join(' · '))),
    ...resigns.map((r) => base('resignation', r, `Last day ${day(r.lastWorkingDay)} · ${r.noticeDays} days notice`)),
  ];

  // Who each open request waits on, where an approval rule or chain routes it.
  const pending = out.filter((r) => r.status === 'pending');
  if (pending.length) {
    const open = await db.approvalRequest.findMany({
      where: { ...w, status: 'PENDING', entityId: { in: pending.map((r) => r.id) } },
      select: { entityId: true, entityType: true, storeId: true, requestedBy: true, currentLevel: true, amountPaise: true },
    });
    for (const a of open) {
      const row = pending.find((r) => r.id === a.entityId && ENGINE_TYPE[r.kind] === a.entityType);
      if (!row) continue;
      const ids = await currentApprovers(a);
      row.waitingOn = ids.length ? (await db.user.findMany({ where: { id: { in: ids } }, select: { fullName: true } })).map((u) => u.fullName) : [];
    }
  }

  return out.sort((a, b) =>
    (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.createdAt.localeCompare(a.createdAt));
}

export interface DeskOptions {
  leaveTypes: { id: string; name: string; balanceDays: number | null }[];
  compOffAvailable: number;
  categories: string[];
  hasOpenResignation: boolean;
}

/** What the "New request" form needs: leave types with my balance this year. */
export async function myDeskOptions(scope: StoreScope, userId: string): Promise<DeskOptions> {
  if (scope.kind !== 'single') {
    return { leaveTypes: [], compOffAvailable: 0, categories: REIMBURSEMENT_CATEGORIES, hasOpenResignation: false };
  }
  const year = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 4));
  const [types, alloc, openResignation] = await Promise.all([
    listLeaveTypes(scope, { activeOnly: true }),
    listAllocations(scope, year).catch(() => null),
    db.resignation.count({ where: { storeId: scope.storeId, userId, status: 'submitted' } }),
  ]);
  const mine = alloc?.rows.find((r) => r.userId === userId);
  return {
    leaveTypes: types.map((t) => ({ id: t.id, name: t.name, balanceDays: mine?.cells.find((c) => c.leaveTypeId === t.id)?.balanceDays ?? null })),
    compOffAvailable: mine?.compOffAvailable ?? 0,
    categories: REIMBURSEMENT_CATEGORIES,
    hasOpenResignation: openResignation > 0,
  };
}

export interface DeskRequestInput {
  kind: DeskKind;
  leaveTypeId?: string | null;
  fromDate?: string;
  toDate?: string;
  days?: number;
  amountRupees?: number;
  category?: string;
  expenseDate?: string;
  assetType?: string;
  noticeDays?: number;
  lastWorkingDay?: string;
  reason?: string | null;
}

const dateOf = (v: string | undefined, what: string) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new DeskError(`Choose the ${what}.`);
  return new Date(`${v}T00:00:00+05:30`);
};

/**
 * Leave goes in as the India day itself, not a Date (9 Oct 2026): the Date
 * above is midnight India time, which `createLeaveRequest` used to round down
 * to the UTC day before - every leave raised from My Desk was saved a day early.
 */
const dayOf = (v: string | undefined, what: string) => {
  if (!isDayKey(v)) throw new DeskError(`Choose the ${what}.`);
  return v;
};

/** Raise one request for the signed-in person, through the module's own function. */
export async function raiseDeskRequest(scope: StoreScope, userId: string, input: DeskRequestInput): Promise<void> {
  const reason = input.reason?.trim() || null;
  switch (input.kind) {
    case 'leave': case 'half_day': case 'wfh': {
      const from = dayOf(input.fromDate, 'first day');
      const to = input.kind === 'half_day' ? from : dayOf(input.toDate || input.fromDate, 'last day');
      await createLeaveRequest(scope, { userId, kind: input.kind, leaveTypeId: input.leaveTypeId ?? null, fromDate: from, toDate: to, reason });
      return;
    }
    case 'comp_off':
      await requestCompOff(scope, { userId, days: Number(input.days ?? 0), reason });
      return;
    case 'leave_allocation':
      if (!input.leaveTypeId) throw new DeskError('Choose the leave type.');
      await requestLeaveAllocation(scope, { leaveTypeId: input.leaveTypeId, requestedDays: Number(input.days ?? 0), description: reason ?? '' }, userId);
      return;
    case 'reimbursement': {
      const amountPaise = Math.round(Number(input.amountRupees ?? 0) * 100);
      await requestReimbursement(scope, {
        category: REIMBURSEMENT_CATEGORIES.includes(input.category ?? '') ? input.category! : 'other',
        amountPaise, expenseDate: dateOf(input.expenseDate, 'date of the expense'), description: reason,
      }, userId);
      return;
    }
    case 'leave_encashment':
      if (!input.leaveTypeId) throw new DeskError('Choose the leave type.');
      await requestLeaveEncashment(scope, { leaveTypeId: input.leaveTypeId, days: Number(input.days ?? 0) }, userId);
      return;
    case 'asset_request':
      await requestAsset(scope, { assetType: input.assetType ?? '', reason }, userId);
      return;
    case 'resignation':
      await submitResignation(scope, {
        reason, noticeDays: Math.max(0, Math.trunc(Number(input.noticeDays ?? 0))),
        lastWorkingDay: dateOf(input.lastWorkingDay, 'last working day'),
      }, userId);
      return;
    default:
      throw new DeskError('Choose what you are asking for.');
  }
}

export interface TeamFollowUpRow {
  userId: string;
  name: string;
  /** Their role here, so the owner knows whose desk it is (30 Oct 2026). */
  role: string | null;
  unread: number;
  /** Unread split by notification kind - what they are ignoring, not just how much. */
  unreadByKind: Record<string, number>;
  oldestUnreadAt: string | null;
  overdueReminders: number;
  approvalsWaiting: number;
  oldestApprovalAt: string | null;
  lastSeenAt: string | null;
  /**
   * The approvals behind `approvalsWaiting`, oldest first (4 Oct 2026). The
   * count alone said someone was behind but not on what - the owner then had
   * to go and ask.
   */
  approvals: TeamApproval[];
}

export interface TeamApproval {
  requestId: string;
  title: string;
  type: string;
  typeLabel: string;
  requesterName: string;
  amountPaise: number | null;
  since: string;
  href: string;
}

/**
 * The owner's view of who is keeping up (queued request, 27 Sep 2026):
 * per person, unread notifications, overdue reminders and approvals sitting
 * with them. Replaces the "Everyone's pending items" tick box, which only
 * added requests waiting on others and never said who was behind.
 */
export async function teamFollowUp(scope: StoreScope): Promise<TeamFollowUpRow[]> {
  const w = scopeWhere(scope);
  const storeIds = scope.kind === 'single' ? [scope.storeId] : scope.storeIds;
  const now = new Date();
  const [people, unread, overdue, open, sessions] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, storeRoles: { some: { storeId: { in: storeIds } } } },
      select: { id: true, fullName: true, storeRoles: { where: { storeId: { in: storeIds } }, select: { role: { select: { name: true } } }, take: 1 } },
      orderBy: { fullName: 'asc' }, take: FEED_MAX_ROWS,
    }),
    db.notification.groupBy({ by: ['userId', 'kind'], where: { ...w, readAt: null }, _count: { _all: true }, _min: { createdAt: true } }),
    db.personalReminder.groupBy({
      by: ['userId'], where: { ...w, doneAt: null, OR: [{ snoozedUntil: null, dueAt: { lt: now } }, { snoozedUntil: { lt: now } }] }, _count: { _all: true },
    }),
    db.approvalRequest.findMany({
      where: { ...w, status: 'PENDING' }, take: FEED_MAX_ROWS,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, storeId: true, entityType: true, entityId: true, requestedBy: true, currentLevel: true,
        amountPaise: true, createdAt: true, title: true, href: true,
      },
    }),
    db.loginSession.groupBy({ by: ['userId'], where: { user: { storeRoles: { some: { storeId: { in: storeIds } } } } }, _max: { lastActiveAt: true } }),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));
  const missing = [...new Set(open.map((r) => r.requestedBy))].filter((id) => !nameOf.has(id));
  if (missing.length) {
    for (const x of await db.user.findMany({ where: { id: { in: missing } }, select: { id: true, fullName: true } })) nameOf.set(x.id, x.fullName);
  }
  // `open` is oldest first, so each person's list is too, and the first is the oldest.
  const waiting = new Map<string, TeamApproval[]>();
  for (const r of open) {
    const t = requestType(r.entityType);
    const item: TeamApproval = {
      requestId: r.id, title: r.title ?? t?.label ?? 'Request', type: r.entityType, typeLabel: t?.label ?? r.entityType,
      requesterName: nameOf.get(r.requestedBy) ?? 'Someone', amountPaise: r.amountPaise,
      since: r.createdAt.toISOString(), href: r.href ?? t?.href(r.entityId) ?? '/my/reminders',
    };
    for (const id of await currentApprovers(r)) {
      const list = waiting.get(id);
      if (list) list.push(item); else waiting.set(id, [item]);
    }
  }
  // One row per person and kind: add up the total and keep the oldest.
  const u = new Map<string, { total: number; oldest: Date | null; byKind: Record<string, number> }>();
  for (const r of unread) {
    const cur = u.get(r.userId) ?? { total: 0, oldest: null, byKind: {} };
    cur.total += r._count._all;
    cur.byKind[r.kind] = r._count._all;
    if (r._min.createdAt && (!cur.oldest || r._min.createdAt < cur.oldest)) cur.oldest = r._min.createdAt;
    u.set(r.userId, cur);
  }
  const o = new Map(overdue.map((r) => [r.userId, r._count._all]));
  const s = new Map(sessions.map((r) => [r.userId, r._max.lastActiveAt]));
  return people.map((p) => ({
    userId: p.id, name: p.fullName, role: p.storeRoles[0]?.role.name ?? null,
    unread: u.get(p.id)?.total ?? 0,
    unreadByKind: u.get(p.id)?.byKind ?? {},
    oldestUnreadAt: u.get(p.id)?.oldest?.toISOString() ?? null,
    overdueReminders: o.get(p.id) ?? 0,
    approvalsWaiting: waiting.get(p.id)?.length ?? 0,
    oldestApprovalAt: waiting.get(p.id)?.[0]?.since ?? null,
    lastSeenAt: s.get(p.id)?.toISOString() ?? null,
    approvals: waiting.get(p.id) ?? [],
  })).sort((a, b) => (b.unread + b.overdueReminders * 3 + b.approvalsWaiting * 5) - (a.unread + a.overdueReminders * 3 + a.approvalsWaiting * 5) || a.name.localeCompare(b.name));
}
