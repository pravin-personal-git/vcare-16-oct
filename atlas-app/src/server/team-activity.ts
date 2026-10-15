import 'server-only';
import { db } from './db';
import { istDate } from '@/lib/date-ranges';
import { scopeWhere, userInScope, type StoreScope } from './store-scope';
import {
  teamActivity, EMPTY_COUNTS, type ActivityCounts, type ActivityRow,
} from '@/lib/team-activity';

/**
 * What everybody did, in one period (Vcare wave 4, 8 Oct 2026).
 *
 * Twelve grouped counts rather than twelve lists. Each is one `groupBy` over a
 * table Atlas already fills, keyed by whichever column names the person -
 * which is a different column on nearly every table, and that difference IS
 * the work here:
 *
 *     CallLog         userId             whose phone logged it
 *     Lead            assignedToUserId   who owns it, not who typed it in
 *     Quotation       salespersonId      whose sale it is
 *     SalesOrder      salespersonId
 *     Invoice         salespersonId
 *     Task            assignedToId       who has to do it
 *     ServiceVisit    technicianId       who went
 *     AttendanceDay   userId
 *
 * `salespersonId` and not `createdBy` on the three sales documents, on purpose.
 * A back-office clerk types in most of Vcare's quotations; counting the typist
 * would make the clerk the best salesperson in the branch and leave the person
 * who actually won the work at zero.
 *
 * NOT MEASURED, and said rather than faked: money collected. `Receipt` has no
 * column naming who took it. An empty column would read as "collected
 * nothing"; leaving the measure out reads as what it is. Adding
 * `Receipt.collectedBy` is the fix and is not done.
 */

type Counts = Map<string, Partial<ActivityCounts>>;

/** Add one measure to a person's tally, creating their entry on first touch. */
const add = (m: Counts, userId: string | null, key: keyof ActivityCounts, n: number) => {
  if (!userId || !n) return;
  const cur = m.get(userId) ?? {};
  cur[key] = (cur[key] ?? 0) + n;
  m.set(userId, cur);
};

export interface TeamActivityReport {
  rows: ActivityRow[];
  /** People the report covers, so the screen can say who it looked at. */
  peopleCount: number;
}

export async function teamActivityReport(
  scope: StoreScope, from: Date, to: Date,
  /** Narrows to one person, for somebody who may only see their own line. */
  onlyUserId: string | null = null,
): Promise<TeamActivityReport> {
  const where = scopeWhere(scope);
  const window = { gte: from, lt: to };
  const mine = onlyUserId ? { in: [onlyUserId] } : undefined;

  const [
    people, calls, leads, converted, quotes, orders, invoices, tasksGiven, tasksDone, visits, present,
  ] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, ...userInScope(scope), ...(onlyUserId ? { id: onlyUserId } : {}) },
      select: { id: true, fullName: true, department: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
    }),

    // Calls carry direction and duration, so one read answers four measures.
    db.callLog.findMany({
      where: { ...where, startedAt: window, ...(mine ? { userId: mine } : {}) },
      select: { userId: true, direction: true, durationSec: true },
    }),

    /*
      A lead counts for the period when it was raised OR last touched in it.
      `updatedAt` alone would count every lead somebody opened; `createdAt`
      alone would miss the ones being worked. Both, de-duplicated by the
      query returning each row once.
    */
    db.lead.groupBy({
      by: ['assignedToUserId'],
      where: { ...where, deletedAt: null, ...(mine ? { assignedToUserId: mine } : {}),
        OR: [{ createdAt: window }, { updatedAt: window }] },
      _count: true,
    }),
    db.lead.groupBy({
      by: ['assignedToUserId'],
      where: { ...where, deletedAt: null, convertedAt: window, ...(mine ? { assignedToUserId: mine } : {}) },
      _count: true,
    }),

    db.quotation.groupBy({
      by: ['salespersonId'],
      where: { ...where, deletedAt: null, createdAt: window, ...(mine ? { salespersonId: mine } : {}) },
      _count: true, _sum: { grandTotalPaise: true },
    }),
    db.salesOrder.groupBy({
      by: ['salespersonId'],
      where: { ...where, deletedAt: null, createdAt: window, ...(mine ? { salespersonId: mine } : {}) },
      _count: true, _sum: { grandTotalPaise: true },
    }),
    db.invoice.groupBy({
      by: ['salespersonId'],
      where: { ...where, deletedAt: null, createdAt: window, ...(mine ? { salespersonId: mine } : {}) },
      _count: true, _sum: { grandTotalPaise: true },
    }),

    db.task.groupBy({
      by: ['assignedToId'],
      where: { ...where, deletedAt: null, createdAt: window, ...(mine ? { assignedToId: mine } : {}) },
      _count: true,
    }),
    db.task.groupBy({
      by: ['assignedToId'],
      where: { ...where, deletedAt: null, completedAt: window, ...(mine ? { assignedToId: mine } : {}) },
      _count: true,
    }),

    /*
      Visits scope through their own store now that one can belong to an
      installation instead of a complaint (wave 3), with the complaint route
      kept for any row the backfill could not reach.
    */
    db.serviceVisit.groupBy({
      by: ['technicianId'],
      where: {
        status: 'completed', completedAt: window,
        // Spelled out rather than reusing `where`, so the scope ratchet can
        // see it - and so a reader of this one query can too.
        OR: [scopeWhere(scope), { complaint: scopeWhere(scope) }],
        ...(mine ? { technicianId: mine } : {}),
      },
      _count: true,
    }),

    /*
      Present means they actually clocked in, not that a row exists.
      `AttendanceDay` is created for everyone; `firstInAt` is the fact.
      `workDate` is text (YYYY-MM-DD), so the window is compared as text -
      which sorts correctly in that format. The window's ends are India
      midnights, so they are read as India days: `toISOString` read them in
      UTC, a day early, until 9 Oct 2026.
    */
    db.attendanceDay.groupBy({
      by: ['userId'],
      where: {
        ...where,
        firstInAt: { not: null },
        workDate: { gte: istDate(from), lt: istDate(to) },
        ...(mine ? { userId: mine } : {}),
      },
      _count: true,
    }),
  ]);

  const counts: Counts = new Map();

  for (const c of calls) {
    if (c.durationSec === 0) add(counts, c.userId, 'callsNoAnswer', 1);
    else if (c.direction === 'incoming') add(counts, c.userId, 'callsIn', 1);
    else add(counts, c.userId, 'callsOut', 1);
    add(counts, c.userId, 'callMinutes', Math.round(c.durationSec / 60));
  }

  for (const r of leads) add(counts, r.assignedToUserId, 'leadsOwned', r._count);
  for (const r of converted) add(counts, r.assignedToUserId, 'leadsConverted', r._count);

  for (const r of quotes) {
    add(counts, r.salespersonId, 'quotations', r._count);
    add(counts, r.salespersonId, 'quotationValuePaise', r._sum.grandTotalPaise ?? 0);
  }
  for (const r of orders) {
    add(counts, r.salespersonId, 'orders', r._count);
    add(counts, r.salespersonId, 'orderValuePaise', r._sum.grandTotalPaise ?? 0);
  }
  for (const r of invoices) {
    add(counts, r.salespersonId, 'invoices', r._count);
    add(counts, r.salespersonId, 'invoiceValuePaise', r._sum.grandTotalPaise ?? 0);
  }

  for (const r of tasksGiven) add(counts, r.assignedToId, 'tasksAssigned', r._count);
  for (const r of tasksDone) add(counts, r.assignedToId, 'tasksDone', r._count);
  for (const r of visits) add(counts, r.technicianId, 'visitsDone', r._count);
  for (const r of present) add(counts, r.userId, 'daysPresent', r._count);

  const rows = teamActivity(
    counts,
    new Map(people.map((u) => [u.id, { name: u.fullName, departmentName: u.department?.name ?? null }])),
  );
  return { rows, peopleCount: people.length };
}

export { EMPTY_COUNTS };
