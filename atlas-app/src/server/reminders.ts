import 'server-only';
import { db } from './db';
import { FEED_MAX_ROWS, LIST_MAX_ROWS } from '@/lib/list-limits';
import { istDayStart } from '@/lib/ist';
import { morningSummaryText } from '@/lib/morning-summary';
import { SLA_START, slaChecks } from '@/lib/job-sla';
import { getJobSettings } from './job-settings';
import { supplierBalances } from './purchases';
import { stockReport } from './stock-report';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { businessSettings, notify, ownersOf, pushData, saveBusinessSettings } from './notify';
import { teamIds } from './team-reach';
import { userInScope } from './store-scope';
import { OWNER_PERMISSION } from '@/lib/mobile-home';
import { escalationSweep } from './approvals';
import { istDay, offsetsOf, reminderDue, reminderLabel } from '@/lib/renewal-cycle';
import { jobSlaSweep } from './job-notify';

/**
 * The reminder generator (27 Sep 2026, NOTIFICATIONS-APPROVALS-SPEC.md
 * "Timing and jobs"). One idempotent pass per branch:
 *   - renewal reminders on the chosen days before each due date;
 *   - personal reminders whose time has come;
 *   - approval nudges and escalations;
 *   - the owner's morning summary (once a day, from 8 AM India time).
 * Called by the daily Vercel cron and, throttled to once per 10 minutes per
 * branch, whenever someone has the app open - so a reminder set for 11:00
 * arrives near 11:00 without an hourly cron. Dedupe keys make running it
 * twice harmless.
 */
const THROTTLE_MS = 10 * 60_000;

export async function runReminders(storeId: string, opts: { force?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const settings = await businessSettings(storeId);
  if (!opts.force && settings.lastRunAt && now.getTime() - Date.parse(settings.lastRunAt) < THROTTLE_MS) return { skipped: true };
  await saveBusinessSettings(storeId, { lastRunAt: now.toISOString() });

  const owners = await ownersOf(storeId);
  let sent = 0;

  // 1. Renewals
  const policies = await db.policyRenewal.findMany({
    where: { storeId, isActive: true, status: 'active' },
    include: { party: { select: { companyName: true, firstName: true } } },
  });
  for (const p of policies) {
    const offsets = offsetsOf(p.reminderOffsets, settings.renewalOffsets);
    const offset = reminderDue(p.expiryDate, offsets, now);
    if (offset === null) continue;
    const who = p.party ? ` - ${p.party.companyName || p.party.firstName}` : '';
    sent += await notify({
      storeId, userIds: [...owners, ...(p.responsibleUserId ? [p.responsibleUserId] : [])], kind: 'renewal',
      title: `${p.title}${who} ${reminderLabel(offset)}`,
      body: `Due ${p.expiryDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}${p.expectedAmountPaise ? ` · ₹${(p.expectedAmountPaise / 100).toLocaleString('en-IN')}` : ''}${p.ownerKind === 'client' ? ' · send the client a reminder on WhatsApp from the renewals page' : ''}`,
      href: `/hrm/renewal?open=${p.id}`, entityType: 'policy_renewal', entityId: p.id,
      dedupeKey: `renewal:${p.id}:${istDay(p.expiryDate)}:${offset}`,
    });
  }

  // 2. Personal reminders
  const due = await db.personalReminder.findMany({
    where: { storeId, doneAt: null, dueAt: { lte: now }, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
    take: FEED_MAX_ROWS,
  });
  for (const r of due) {
    sent += await notify({
      storeId, userIds: [r.userId], kind: 'reminder', title: r.title, body: r.note, href: r.href ?? '/my/reminders',
      entityType: 'personal_reminder', entityId: r.id,
      dedupeKey: `reminder:${r.id}:${(r.snoozedUntil ?? r.dueAt).toISOString()}`,
    });
  }

  // 3. Approvals waiting too long
  await escalationSweep(storeId, now).catch((e) => console.error('[reminders] escalation sweep', e));
  // 3b. Field-job deadlines (workflow slice 7)
  sent += await jobSlaSweep(storeId, now).catch((e) => { console.error('[reminders] job deadlines', e); return 0; });

  // 4. The owner's morning summary
  const istHour = new Date(now.getTime() + 330 * 60_000).getUTCHours();
  // Keyed per branch: an owner of two branches gets one summary for each.
  const summaryKey = `summary:${storeId}:${istDay(now)}`;
  // This sweep runs every ten minutes while anyone has the app open, and the
  // summary reads the whole book (a few seconds) - so once every owner has
  // today's, it is not worked out again.
  const alreadySent = owners.length > 0
    && (await db.notification.count({ where: { userId: { in: owners }, dedupeKey: summaryKey } })) >= new Set(owners).size;
  if (settings.dailySummary && istHour >= 8 && owners.length > 0 && !alreadySent) {
    const text = await dailySummary(storeId, now);
    const day = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
    sent += await notify({
      storeId, userIds: owners, kind: 'system', title: `Good morning - your business on ${day}`, body: text,
      href: '/dashboard', dedupeKey: summaryKey,
    });
  }
  return { skipped: false, sent };
}

/**
 * The facts behind the owner's morning summary (6 Oct 2026) - see
 * lib/morning-summary for why each one is there. Money comes from the same
 * rules as the Accounts dashboard (issued invoices, received receipts,
 * supplierBalances, stockReport), so the 8 AM message and the screen it opens
 * never disagree. Always returns text: an owner should hear "nothing sold
 * yesterday" rather than nothing.
 */
export async function dailySummary(storeId: string, now: Date = new Date()): Promise<string> {
  const scope: StoreScope = { kind: 'single', storeId, writable: false };
  const todayStart = istDayStart(istDay(now));
  const yStart = new Date(todayStart.getTime() - 86_400_000);
  const week = new Date(now.getTime() + 7 * 86_400_000);
  const dayEnd = new Date(now.getTime() + 24 * 3_600_000);
  const DONE = ['resolved', 'closed', 'cancelled'];

  const [
    sales, collected, openInvoices, suppliers, stock,
    approvals, renewalsWeek, renewalsOverdue, remindersToday,
    jobsOpen, jobsUnassigned, jobsNewYesterday, jobsClosedYesterday, jobsWaitingClose, slaJobs,
    newLeadsYesterday, jobSettings,
  ] = await Promise.all([
    db.invoice.aggregate({ where: { storeId, lifecycle: 'sent', deletedAt: null, invoiceDate: { gte: yStart, lt: todayStart } }, _sum: { grandTotalPaise: true }, _count: true }),
    db.receipt.aggregate({ where: { storeId, status: 'received', deletedAt: null, receivedAt: { gte: yStart, lt: todayStart } }, _sum: { amountPaise: true }, _count: true }),
    db.invoice.findMany({ where: { storeId, lifecycle: 'sent', deletedAt: null }, select: { customerName: true, dueDate: true, grandTotalPaise: true, amountPaidPaise: true }, take: LIST_MAX_ROWS }),
    supplierBalances(scope),
    stockReport(scope),
    db.approvalRequest.count({ where: { storeId, status: 'PENDING' } }),
    db.policyRenewal.count({ where: { storeId, isActive: true, status: 'active', expiryDate: { gte: now, lte: week } } }),
    db.policyRenewal.count({ where: { storeId, isActive: true, status: 'active', expiryDate: { lt: todayStart } } }),
    db.personalReminder.count({ where: { storeId, doneAt: null, dueAt: { lte: dayEnd } } }),
    db.complaint.count({ where: { storeId, status: { notIn: DONE } } }),
    db.complaint.count({ where: { storeId, status: 'received' } }),
    db.complaint.count({ where: { storeId, createdAt: { gte: yStart, lt: todayStart } } }),
    db.complaint.count({ where: { storeId, closedAt: { gte: yStart, lt: todayStart } } }),
    db.complaint.count({ where: { storeId, status: 'resolved' } }),
    // Same population as the deadline alerts (job-notify jobSlaSweep).
    db.complaint.findMany({
      where: { storeId, status: { notIn: [...DONE, 'awaiting_customer', 'awaiting_estimate'] }, createdAt: { gte: SLA_START }, legacyRef: null },
      select: { status: true, priority: true, createdAt: true, assignedAt: true, onSiteSince: true, timeOnSiteSec: true, visits: { where: { checkedInAt: { not: null } }, select: { id: true }, take: 1 } },
      take: FEED_MAX_ROWS,
    }),
    db.lead.count({ where: { storeId, deletedAt: null, createdAt: { gte: yStart, lt: todayStart } } }),
    getJobSettings(storeId),
  ]);

  // Who owes us - the Accounts dashboard's rule: issued invoices, less what was paid.
  let receivablePaise = 0;
  let overduePaise = 0;
  const overdueBy = new Map<string, number>();
  for (const i of openInvoices) {
    const owed = Math.max(0, i.grandTotalPaise - i.amountPaidPaise);
    if (!owed) continue;
    receivablePaise += owed;
    if (i.dueDate < todayStart) {
      overduePaise += owed;
      overdueBy.set(i.customerName, (overdueBy.get(i.customerName) ?? 0) + owed);
    }
  }
  const biggest = [...overdueBy.entries()].sort((a, b) => b[1] - a[1])[0];

  const jobsMissedDeadline = slaJobs.filter((j) => slaChecks({
    status: j.status, priority: j.priority, createdAt: j.createdAt, assignedAt: j.assignedAt,
    arrived: !!j.onSiteSince || j.timeOnSiteSec > 0 || j.visits.length > 0,
  }, jobSettings.sla, now).some((c) => c.state === 'missed')).length;

  return morningSummaryText({
    salesPaise: sales._sum.grandTotalPaise ?? 0, invoiceCount: sales._count,
    collectedPaise: collected._sum.amountPaise ?? 0, receiptCount: collected._count,
    receivablePaise, overduePaise, overdueCustomers: overdueBy.size,
    biggestDebtor: biggest ? { name: biggest[0], paise: biggest[1] } : null,
    payablePaise: suppliers.reduce((t, x) => t + Math.max(0, x.outstandingPaise), 0),
    jobsOpen, jobsUnassigned, jobsMissedDeadline, jobsNewYesterday, jobsClosedYesterday, jobsWaitingClose,
    reorderCount: stock.reorderCount, outOfStockCount: stock.outOfStockCount,
    newLeadsYesterday, approvals, renewalsWeek, renewalsOverdue, remindersToday,
  });
}

/** Page-load trigger for every branch in scope (throttled inside). */
export async function runRemindersForScope(scope: StoreScope) {
  const ids = scope.kind === 'single' ? [scope.storeId] : scope.storeIds;
  for (const id of ids) await runReminders(id).catch((e) => console.error('[reminders] run failed', e));
}

// ------------------------------------------------------------------ personal reminders

export class ReminderError extends Error {}
export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly';
const REPEATS: Repeat[] = ['none', 'daily', 'weekly', 'monthly'];

export interface ReminderInput { title: string; note: string | null; dueAt: Date; repeat: string; forUserId?: string | null; href?: string | null }

/**
 * WHO MAY SET A REMINDER FOR WHOM (decision 12, 13 Oct 2026): everyone for
 * themselves; a manager for their team (everyone who reports to them, at any
 * depth - server/team-reach, the same team as data reach); the owner / admin
 * (settings.edit) for anybody in the branch. Self is always first.
 */
export async function reminderTargets(scope: StoreScope, userId: string, permissions: ReadonlySet<string>) {
  const admin = permissions.has(OWNER_PERMISSION);
  const team = admin ? null : await teamIds(scope, userId);
  const rows = await db.user.findMany({
    where: admin
      ? { isActive: true, ...userInScope(scope) }
      : { id: { in: [userId, ...(team ?? [])] }, isActive: true },
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
    take: LIST_MAX_ROWS,
  });
  const me = rows.find((r) => r.id === userId);
  return [
    { id: userId, name: me?.fullName ?? 'Me', self: true },
    ...rows.filter((r) => r.id !== userId).map((r) => ({ id: r.id, name: r.fullName, self: false })),
  ];
}

/**
 * Tell the person's phones their reminders changed, so each one (re)sets
 * its own alarm now - not at the next sweep, which may be hours away with
 * every phone locked (G-40). Silent: nothing shows, the app only re-reads.
 */
export async function syncReminderPhones(userIds: string[]) {
  for (const id of new Set(userIds)) {
    await pushData(id, { kind: 'reminder_sync' }).catch(() => undefined);
  }
}

export async function addReminder(scope: StoreScope, userId: string, input: ReminderInput, permissions?: ReadonlySet<string>) {
  const storeId = scopeForWrite(scope);
  if (!input.title.trim()) throw new ReminderError('What should we remind about?');
  if (Number.isNaN(input.dueAt.getTime())) throw new ReminderError('Choose a date and time.');
  if (!REPEATS.includes(input.repeat as Repeat)) throw new ReminderError('Choose how often it repeats.');
  let target = userId;
  if (input.forUserId && input.forUserId !== userId) {
    const allowed = await reminderTargets(scope, userId, permissions ?? new Set());
    if (!allowed.some((t) => t.id === input.forUserId)) {
      throw new ReminderError('You can set reminders for yourself and your team.');
    }
    target = input.forUserId;
  }
  const row = await db.personalReminder.create({
    data: {
      storeId, userId: target, createdBy: userId, title: input.title.trim().slice(0, 200), note: input.note?.trim() || null,
      dueAt: input.dueAt, repeat: input.repeat, href: input.href ?? null,
    },
  });
  await syncReminderPhones([target]);
  return row;
}

function nextOccurrence(d: Date, repeat: Repeat): Date | null {
  const n = new Date(d);
  if (repeat === 'daily') n.setUTCDate(n.getUTCDate() + 1);
  else if (repeat === 'weekly') n.setUTCDate(n.getUTCDate() + 7);
  else if (repeat === 'monthly') n.setUTCMonth(n.getUTCMonth() + 1);
  else return null;
  return n;
}

async function mine(scope: StoreScope, userId: string, id: string, orCreator = false) {
  const r = await db.personalReminder.findFirst({
    where: { id, ...scopeWhere(scope), ...(orCreator ? { OR: [{ userId }, { createdBy: userId }] } : { userId }) },
  });
  if (!r) throw new ReminderError('Reminder not found.');
  return r;
}

/**
 * Done: a repeating reminder moves to its next time (skipping any already past).
 * `pressedAt` (the phone's alarm card, G-40): when Done was pressed. A Done that
 * reaches us twice - re-sent from the phone's queue after a dropped answer -
 * must not skip a day of a daily reminder, so a reminder already finished, or
 * already moved past the moment that was ringing, is left as it is.
 */
export async function completeReminder(scope: StoreScope, userId: string, id: string, pressedAt?: Date) {
  const r = await mine(scope, userId, id);
  if (pressedAt && (r.doneAt || (r.snoozedUntil ?? r.dueAt).getTime() > pressedAt.getTime() + 60_000)) return r;
  let next = nextOccurrence(r.dueAt, r.repeat as Repeat);
  while (next && next.getTime() <= Date.now()) next = nextOccurrence(next, r.repeat as Repeat);
  const row = await db.personalReminder.update({
    where: { id },
    data: next ? { dueAt: next, snoozedUntil: null } : { doneAt: new Date() },
  });
  await syncReminderPhones([r.userId]);
  return row;
}

export async function snoozeReminder(scope: StoreScope, userId: string, id: string, until: Date) {
  const r = await mine(scope, userId, id);
  if (until.getTime() <= Date.now()) throw new ReminderError('Choose a later time.');
  const row = await db.personalReminder.update({ where: { id }, data: { snoozedUntil: until } });
  await syncReminderPhones([r.userId]);
  return row;
}

export async function deleteReminder(scope: StoreScope, userId: string, id: string) {
  // The person it rings for, or whoever set it for them (a manager may take back their own).
  const r = await mine(scope, userId, id, true);
  // Tombstoned, not removed (3 Oct 2026) - a reminder that reappears after
  // somebody dismissed it is the most irritating possible sync bug.
  const row = await db.personalReminder.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: userId } });
  await syncReminderPhones([r.userId]);
  return row;
}

export async function myReminders(scope: StoreScope, userId: string) {
  const rows = await db.personalReminder.findMany({
    where: { ...scopeWhere(scope), userId, doneAt: null },
    orderBy: { dueAt: 'asc' }, take: FEED_MAX_ROWS,
  });
  return rows.map((r) => ({
    id: r.id, title: r.title, note: r.note, dueAt: r.dueAt.toISOString(), repeat: r.repeat, href: r.href,
    snoozedUntil: r.snoozedUntil?.toISOString() ?? null, byOther: r.createdBy !== userId,
    /**
     * When it rings next, and the key the phone's alarm and the server's push
     * share - so a phone that already rang from its own alarm ignores the
     * backup push for the same moment (G-40).
     */
    ringAt: (r.snoozedUntil ?? r.dueAt).toISOString(),
    alarmKey: `reminder:${r.id}:${(r.snoozedUntil ?? r.dueAt).toISOString()}`,
    // For My Desk's "Created on" date filter (9 Oct 2026).
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Reminders this person set for somebody else and that are still to ring - "Set for my team" on the phone. */
export async function remindersISetForOthers(scope: StoreScope, userId: string) {
  const rows = await db.personalReminder.findMany({
    where: { ...scopeWhere(scope), createdBy: userId, userId: { not: userId }, doneAt: null },
    include: { user: { select: { fullName: true } } },
    orderBy: { dueAt: 'asc' }, take: FEED_MAX_ROWS,
  });
  return rows.map((r) => ({
    id: r.id, title: r.title, note: r.note, dueAt: r.dueAt.toISOString(), repeat: r.repeat,
    forName: r.user.fullName, snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
  }));
}
