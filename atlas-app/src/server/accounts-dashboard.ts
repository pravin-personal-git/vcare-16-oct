import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { glSummary } from './gl-summary';
import { supplierBalances } from './purchases';
import { listStaffAccounts } from './staff-accounts';
import { duplicateExpenses } from './duplicate-expenses';
import { financialYearRange, getFinancialYear } from '@/lib/financial-year';
import { istDayStart, presetRange } from '@/lib/date-ranges';

/**
 * THE ACCOUNTS DASHBOARD (9 Oct 2026).
 *
 * The Accounts menu became a place to READ rather than a place to record, and
 * a menu you only read needs a front page. This is the one screen a CA or an
 * owner opens to see where the money stands over whatever stretch of time they
 * pick.
 *
 * NOTHING HERE IS STORED. `glSummary` is the same function the main dashboard's
 * profit tile reads and the same one the P&L report has read since 8 Oct, so
 * the three cannot drift apart. What differs between them is the period, and
 * this is the screen that lets you choose it.
 *
 * WHAT IS DELIBERATELY ABSENT: anything that can be acted on. No approve, no
 * pay, no edit. The "worth a look" list points at problems and leaves the
 * decision to a person - the same stance as the duplicate check it reuses.
 */

export type RangeKey = 'week' | 'month' | 'last_month' | 'fy' | 'custom';

export interface DateRange {
  key: RangeKey;
  from: Date;
  /** Exclusive - the first instant after the range. */
  to: Date;
  label: string;
}

const IST = 'Asia/Kolkata';
const dayLabel = (d: Date) =>
  d.toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' });

/*
 * India days (9 Oct 2026). These were built with `new Date(y, m, d)` - the
 * SERVER's calendar, which is UTC on Vercel - so "this month" began at 05:30
 * India time on the 1st and "this week" turned over at 05:30 on Monday. The
 * presets now come from lib/date-ranges, the same ones every list filter uses.
 */
const DAY_MS = 86_400_000;

/**
 * Resolve the period somebody asked for.
 *
 * `to` is EXCLUSIVE and lands at midnight the day after the last day, because
 * an entry dated today carries a time: a range ending at today 00:00 would
 * silently drop everything recorded since.
 */
export function resolveRange(key: string | undefined, from?: string, to?: string, now = new Date()): DateRange {
  if (key === 'custom' && from && to) {
    const f = istDayStart(from);
    const t = istDayStart(to);
    if (f && t) {
      return {
        key: 'custom', from: f, to: new Date(t.getTime() + DAY_MS),
        label: `${dayLabel(f)} - ${dayLabel(t)}`,
      };
    }
  }

  if (key === 'week') {
    // Monday to today, which is what "this week" means to somebody running a shop.
    const w = presetRange('this_week', now);
    return { key: 'week', from: w.from!, to: w.to!, label: `${dayLabel(w.from!)} - ${dayLabel(now)}` };
  }

  if (key === 'last_month') {
    const m = presetRange('last_month', now);
    return {
      key: 'last_month', from: m.from!, to: m.to!,
      label: m.from!.toLocaleDateString('en-IN', { timeZone: IST, month: 'long', year: 'numeric' }),
    };
  }

  if (key === 'fy') {
    const fy = financialYearRange(getFinancialYear(now));
    return { key: 'fy', from: fy.start, to: fy.end, label: `${dayLabel(fy.start)} - ${dayLabel(fy.end)}` };
  }

  const m = presetRange('this_month', now);
  return {
    key: 'month', from: m.from!, to: m.to!,
    label: m.from!.toLocaleDateString('en-IN', { timeZone: IST, month: 'long', year: 'numeric' }),
  };
}

export interface AccountsDashboard {
  range: DateRange;
  /** For the range, from the ledger. */
  revenuePaise: number;
  expensesPaise: number;
  profitPaise: number;
  /** True when nothing at all is posted in the range - a measured zero is not the same as no measurement. */
  empty: boolean;
  /** One line per expense account, biggest first. */
  expenseLines: { label: string; amountPaise: number }[];
  /** Outstanding TODAY, not for the range - a debt has no period. */
  receivablePaise: number;
  receivableCount: number;
  payablePaise: number;
  payableCount: number;
  owedByStaffPaise: number;
  owedToStaffPaise: number;
  /** Collected on sales and paid on purchases, for the range. */
  outputTaxPaise: number;
  inputTaxPaise: number;
  /** Things a person should look at. Never acted on automatically. */
  attention: { kind: 'bad' | 'warn' | 'info'; text: string; href?: string }[];
}

const rupees = (paise: number) =>
  `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

export async function accountsDashboard(scope: StoreScope, range: DateRange): Promise<AccountsDashboard> {
  const inRange = { ...scopeWhere(scope), entryDate: { gte: range.from, lt: range.to } };

  const [gl, expenseAccounts, invoices, openInvoices, bills, suppliers, staff, duplicates, lockedPeriod, unnamedFuel, pendingVouchers] =
    await Promise.all([
      glSummary(scope, range.from, range.to),
      db.account.findMany({ where: { type: 'expense' }, select: { id: true, name: true } }),
      db.invoice.findMany({
        where: { ...scopeWhere(scope), lifecycle: 'sent', invoiceDate: { gte: range.from, lt: range.to } },
        select: { cgstPaise: true, sgstPaise: true, igstPaise: true },
      }),
      // Still owed today. Deliberately not filtered by the range: a debt does
      // not belong to a month, and showing "receivable in October" would be a
      // different and far less useful number.
      db.invoice.findMany({
        where: { ...scopeWhere(scope), lifecycle: 'sent' },
        select: { grandTotalPaise: true, amountPaidPaise: true },
      }),
      db.purchaseBill.findMany({
        where: { ...scopeWhere(scope), lifecycle: 'received', billDate: { gte: range.from, lt: range.to } },
        select: { cgstPaise: true, sgstPaise: true, igstPaise: true },
      }),
      supplierBalances(scope).catch(() => null),
      listStaffAccounts(scope),
      duplicateExpenses(scope).catch(() => []),
      db.accountingPeriod.findFirst({
        where: { ...scopeWhere(scope), isLocked: true },
        orderBy: { endDate: 'desc' },
        select: { endDate: true },
      }).catch(() => null),
      db.transaction.count({
        where: {
          ...scopeWhere(scope), txnType: 'expense', status: 'approved',
          categoryAccountCode: '5850', paidToUserId: null,
          txnDate: { gte: range.from, lt: range.to },
        },
      }),
      db.transaction.count({ where: { ...scopeWhere(scope), txnType: 'expense', status: 'pending' } }),
    ]);

  const accountById = new Map(expenseAccounts.map((a) => [a.id, a]));
  const grouped = expenseAccounts.length > 0
    ? await db.journalLine.groupBy({
      by: ['accountId'],
      where: { accountId: { in: expenseAccounts.map((a) => a.id) }, journalEntry: inRange },
      _sum: { debitPaise: true, creditPaise: true },
    })
    : [];

  // Expense accounts are debit-natured, so the figure is (debit - credit) and a
  // refund reduces it. Taking the absolute value would make a refund look like
  // more spending.
  const expenseLines = grouped
    .map((g) => ({
      label: accountById.get(g.accountId)?.name ?? 'Expense',
      amountPaise: (g._sum.debitPaise ?? 0) - (g._sum.creditPaise ?? 0),
    }))
    .filter((l) => l.amountPaise !== 0)
    .sort((a, b) => b.amountPaise - a.amountPaise);

  const receivable = openInvoices.map((i) => i.grandTotalPaise - i.amountPaidPaise).filter((n) => n > 0);
  const payable = (suppliers ?? []).filter((s) => s.outstandingPaise > 0);

  const attention: AccountsDashboard['attention'] = [];

  for (const g of duplicates.slice(0, 3)) {
    attention.push({
      kind: 'bad',
      text: `${g.entries.length} entries of ${rupees(g.amountPaise)} close together - ${g.reason}`,
      href: '/transactions',
    });
  }

  if (unnamedFuel > 0) {
    attention.push({
      kind: 'warn',
      text: `${unnamedFuel} fuel ${unnamedFuel === 1 ? 'entry has' : 'entries have'} nobody named on them, so they explain nothing`,
      href: '/transactions',
    });
  }

  if (pendingVouchers > 0) {
    attention.push({
      kind: 'warn',
      text: `${pendingVouchers} expense ${pendingVouchers === 1 ? 'voucher is' : 'vouchers are'} waiting for approval`,
      href: '/transactions',
    });
  }

  if (staff.cards.owedToStaffPaise > 0) {
    attention.push({
      kind: 'warn',
      text: `${rupees(staff.cards.owedToStaffPaise)} of staff claims approved and not yet paid`,
      href: '/user/account',
    });
  }

  attention.push(lockedPeriod
    ? { kind: 'info', text: `The books are closed up to ${dayLabel(lockedPeriod.endDate)}`, href: '/settings/period-lock' }
    : { kind: 'info', text: 'No month has been closed yet - anything can still be posted into any period', href: '/settings/period-lock' });

  return {
    range,
    revenuePaise: gl.revenuePaise,
    expensesPaise: gl.expensesPaise,
    profitPaise: gl.profitPaise,
    empty: gl.empty,
    expenseLines,
    receivablePaise: receivable.reduce((n, v) => n + v, 0),
    receivableCount: receivable.length,
    payablePaise: payable.reduce((n, s) => n + s.outstandingPaise, 0),
    payableCount: payable.length,
    owedByStaffPaise: staff.cards.owedByStaffPaise,
    owedToStaffPaise: staff.cards.owedToStaffPaise,
    outputTaxPaise: invoices.reduce((n, i) => n + i.cgstPaise + i.sgstPaise + i.igstPaise, 0),
    inputTaxPaise: bills.reduce((n, b) => n + b.cgstPaise + b.sgstPaise + b.igstPaise, 0),
    attention,
  };
}
