import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, userInScope, type StoreScope } from './store-scope';
import { getFinancialYear } from '@/lib/financial-year';
import { FY_MONTHS, monthWindow, type PeriodMonth } from '@/lib/accounting-period';

/**
 * CLOSING THE BOOKS FOR A MONTH (3 Oct 2026).
 *
 * ## What was there before: a lock with no key
 *
 * `ledger.ts` has always refused to post into a locked period -
 * `assertPeriodOpen` reads `AccountingPeriod` on every journal entry. And
 * **nothing in the entire codebase ever created an `AccountingPeriod` row.** No
 * screen, no action, no seed, no migration. The table was empty for every tenant
 * since it was added, so the check read zero rows and the lock could never fire.
 *
 * The effect: anybody could post into last financial year today. A GST return is
 * filed off figures for a month; if somebody back-dates an invoice into that
 * month afterwards, the books and the filed return disagree and nobody finds out
 * until a notice arrives.
 *
 * ## Why months, and why they are not created in advance
 *
 * The financial year is April to March (CLAUDE.md, decision 8), so the twelve
 * windows are derivable - there is nothing a person could usefully configure
 * about when April starts. Creating twelve rows per branch per year up front
 * would mean a migration, a backfill for every existing year, and an empty-state
 * screen asking somebody to "set up periods" before they can use a feature they
 * did not ask for.
 *
 * So a row exists only once a month has been locked. No row means open, which is
 * every month's state today and the behaviour every tenant already has.
 *
 * ## What the lock does and does not stop
 *
 * It stops GL POSTINGS dated inside the month. Every money document posts to the
 * ledger (D011), so that is the chokepoint: an invoice, a receipt, a bill, a
 * payment, a credit note or a journal entry dated into a locked month is refused
 * with a message telling the person to post into the current month instead.
 *
 * It does NOT retroactively undo anything, and it does not stop editing
 * non-financial fields on an old document. Locking is about what may be ADDED to
 * a closed month, not about freezing history.
 */

export class PeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PeriodError';
  }
}

export interface PeriodRow extends PeriodMonth {
  locked: boolean;
  lockedAt: Date | null;
  lockedByName: string | null;
  /** Entries already posted into this month, so a lock is an informed decision. */
  entries: number;
  /** False for a month that has not finished - locking it blocks today's work. */
  ended: boolean;
  /** True for a month that has not begun. Never lockable. */
  future: boolean;
}

export interface PeriodReport {
  financialYear: number;
  months: PeriodRow[];
  /** How many of the twelve are closed. */
  lockedCount: number;
}

export async function periodReport(
  scope: StoreScope, financialYear = getFinancialYear(), now: Date = new Date(),
): Promise<PeriodReport> {
  /**
   * Single branch only. A period is closed per branch, because branches file and
   * reconcile separately - and "All Company" would have to show twelve rows with
   * three different answers each.
   */
  if (scope.kind !== 'single') {
    return { financialYear, months: [], lockedCount: 0 };
  }

  const windows = FY_MONTHS.map((_, i) => monthWindow(financialYear, i));

  const [locks, counts] = await Promise.all([
    db.accountingPeriod.findMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        startDate: { gte: windows[0]!.startDate },
        endDate: { lte: windows[11]!.endDate },
      },
      select: {
        startDate: true, endDate: true, isLocked: true, lockedAt: true, lockedBy: true,
      },
    }),
    db.journalEntry.groupBy({
      by: ['storeId'],
      where: {
        ...scopeWhere(scope),
        entryDate: { gte: windows[0]!.startDate, lte: windows[11]!.endDate },
      },
      _count: { _all: true },
    }).catch(() => []),
  ]);

  /**
   * Entry counts per month, in one query rather than twelve.
   *
   * `groupBy` cannot group by month, so the dates come back and are bucketed
   * here. Only the dates - a year of journal entries is thousands of rows and
   * there is no reason to ship their contents to count them.
   */
  const dates = counts.length > 0
    ? await db.journalEntry.findMany({
      where: {
        ...scopeWhere(scope),
        entryDate: { gte: windows[0]!.startDate, lte: windows[11]!.endDate },
      },
      select: { entryDate: true },
    }).catch(() => [])
    : [];

  const names = await resolveNames(scope, locks.map((l) => l.lockedBy));

  const months: PeriodRow[] = windows.map((w) => {
    const lock = locks.find(
      (l) => l.startDate.getTime() === w.startDate.getTime() && l.isLocked,
    );
    return {
      ...w,
      locked: !!lock,
      lockedAt: lock?.lockedAt ?? null,
      lockedByName: lock?.lockedBy ? names.get(lock.lockedBy) ?? null : null,
      entries: dates.filter(
        (d) => d.entryDate >= w.startDate && d.entryDate <= w.endDate,
      ).length,
      ended: w.endDate.getTime() < now.getTime(),
      future: w.startDate.getTime() > now.getTime(),
    };
  });

  return {
    financialYear,
    months,
    lockedCount: months.filter((m) => m.locked).length,
  };
}

/**
 * Close a month, or reopen it.
 *
 * ## The rules, and why each one is here
 *
 * A FUTURE month cannot be locked. There is nothing to close, and a lock on a
 * month nobody has reached yet would refuse forward-dated work with a message
 * about closed books, which reads as a bug.
 *
 * Reopening demands a reason. Closing a month is a statement that its figures
 * are final - often ones already filed - so reopening it is the act somebody will
 * be asked about later, not the closing. The reason goes on the row and the audit
 * trigger records the change either way.
 *
 * Locking the CURRENT month is allowed. A shop that has filed mid-month and
 * wants nothing more dated into it is entitled to that, and refusing would mean
 * guessing at their accountant's calendar. The screen warns instead.
 */
export async function setPeriodLock(
  scope: StoreScope,
  userId: string,
  input: { financialYear: number; monthIndex: number; locked: boolean; reason?: string },
  now: Date = new Date(),
): Promise<{ label: string; locked: boolean }> {
  const storeId = scopeForWrite(scope);

  if (!Number.isInteger(input.monthIndex) || input.monthIndex < 0 || input.monthIndex > 11) {
    throw new PeriodError('That is not a month of the financial year.');
  }
  const w = monthWindow(input.financialYear, input.monthIndex);

  if (input.locked && w.startDate.getTime() > now.getTime()) {
    throw new PeriodError(
      `${w.label} has not started yet. There is nothing to close, and closing it would refuse `
      + 'work dated into it for no reason anybody could explain.',
    );
  }
  if (!input.locked && !input.reason?.trim()) {
    throw new PeriodError(
      'Say why this month is being reopened. Closing a month states its figures are final - '
      + 'often figures already filed - so reopening it is the decision somebody will be asked about.',
    );
  }

  const existing = await db.accountingPeriod.findFirst({
    where: { storeId, startDate: w.startDate, endDate: w.endDate },
    select: { id: true, isLocked: true },
  });

  if (existing) {
    if (existing.isLocked === input.locked) return { label: w.label, locked: input.locked };
    await db.accountingPeriod.update({
      where: { id: existing.id },
      data: {
        isLocked: input.locked,
        lockedAt: input.locked ? now : null,
        lockedBy: input.locked ? userId : null,
      },
    });
  } else {
    // No row means open, so reopening something that was never closed is a
    // no-op rather than an error - the person got the state they asked for.
    if (!input.locked) return { label: w.label, locked: false };
    await db.accountingPeriod.create({
      data: {
        storeId,
        startDate: w.startDate,
        endDate: w.endDate,
        isLocked: true,
        lockedAt: now,
        lockedBy: userId,
      },
    });
  }

  return { label: w.label, locked: input.locked };
}

async function resolveNames(
  scope: StoreScope, ids: (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  /**
   * Scoped twice over: the ids came off period rows this scope already read, and
   * `userInScope` is applied as well. The store-scope coverage test reads call
   * sites literally, and a filter a test cannot see is a filter the next person
   * can delete without anything noticing.
   */
  const users = await db.user.findMany({
    where: { id: { in: unique }, ...userInScope(scope) },
    select: { id: true, fullName: true },
  }).catch(() => []);
  return new Map(users.map((u) => [u.id, u.fullName]));
}
