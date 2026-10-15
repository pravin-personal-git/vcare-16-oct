import 'server-only';
import { istYearMonth } from '@/lib/attendance-day';
import { istDayStart } from '@/lib/date-ranges';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { supplierBalances } from './purchases';
import { stockReport } from './stock-report';
import { stockHealth } from './stock-health';
import { profitAndLoss } from './reports';
import { attendanceMonth } from './attendance';
import { getPayrollSummary, type PayrollSummary } from './payroll';
import { ageBucket, type AgeBucket } from '@/lib/purchase';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * The Accounts, Stock and HR dashboards.
 *
 * EVERY FIGURE COMES FROM THE FUNCTION THE DETAIL SCREEN USES.
 *
 * Not from a faster query that computes the same thing a slightly different
 * way. That shortcut is how a dashboard ends up disagreeing with the screen a
 * user clicks through to - which happened here already: the old dashboard read
 * `Party.payablePaise` while the Payables screen derived from bills, and valued
 * stock at selling price while the Stock screen valued it at cost.
 *
 * Two screens disagreeing is worse than one being missing. The user cannot tell
 * which is wrong, so they stop trusting both - and then everything near them.
 *
 * EVERY NUMBER CARRIES A ROUTE.
 *
 * A figure nobody can check is a figure nobody believes. Each card knows the
 * screen that lists the records behind it, so "why is that 4.2 lakh?" is one
 * click rather than a conversation.
 */

export interface DrillCard {
  label: string;
  /** Already formatted - rupees, a count, whatever reads right. */
  value: string;
  sub?: string;
  /** Where to go to see the rows this was computed from. */
  route: string;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

// ------------------------------------------------------------------ accounts

export interface AccountsTabData {
  cards: DrillCard[];
  receivableAgeing: { bucket: AgeBucket; label: string; paise: number }[];
  payableAgeing: { bucket: AgeBucket; label: string; paise: number }[];
  topDebtors: { partyId: string | null; name: string; paise: number; oldestDays: number }[];
  topCreditors: { partyId: string; name: string; paise: number }[];
  gst: { outputPaise: number; inputPaise: number; netPaise: number };
  monthCashInPaise: number;
  monthCashOutPaise: number;
}

const BUCKETS: AgeBucket[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];
const BUCKET_LABEL: Record<AgeBucket, string> = {
  current: 'Not yet due',
  d1_30: '1–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90_plus: 'Over 90 days',
};

const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;

export async function getAccountsTab(
  scope: StoreScope,
  now = new Date(),
): Promise<AccountsTabData> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [openInvoices, suppliers, pnl, receipts, payments] = await Promise.all([
    db.invoice.findMany({
      where: { ...scopeWhere(scope), lifecycle: 'sent' },
      select: {
        id: true, partyId: true, customerName: true, dueDate: true,
        grandTotalPaise: true, amountPaidPaise: true,
      },
      take: LIST_MAX_ROWS,
    }),
    supplierBalances(scope),
    profitAndLoss(scope, monthStart, now),
    db.receipt.aggregate({
      where: { ...scopeWhere(scope), status: 'received', receivedAt: { gte: monthStart, lte: now } },
      _sum: { amountPaise: true },
    }),
    db.supplierPayment.aggregate({
      where: { ...scopeWhere(scope), status: 'paid', paidAt: { gte: monthStart, lte: now } },
      _sum: { amountPaise: true },
    }),
  ]);

  const owing = openInvoices
    .map((i) => ({ ...i, owed: Math.max(0, i.grandTotalPaise - i.amountPaidPaise) }))
    .filter((i) => i.owed > 0);

  const receivableTotal = owing.reduce((n, i) => n + i.owed, 0);
  const payableTotal = suppliers.reduce((n, s) => n + s.outstandingPaise, 0);

  const rAge = new Map<AgeBucket, number>(BUCKETS.map((b) => [b, 0]));
  for (const i of owing) {
    const b = ageBucket(i.dueDate, now);
    rAge.set(b, (rAge.get(b) ?? 0) + i.owed);
  }

  const pAge = new Map<AgeBucket, number>(BUCKETS.map((b) => [b, 0]));
  for (const s of suppliers) {
    if (s.outstandingPaise <= 0) continue;
    const b = s.oldestDueDate ? ageBucket(s.oldestDueDate, now) : 'current';
    pAge.set(b, (pAge.get(b) ?? 0) + s.outstandingPaise);
  }

  // Grouped by customer, because a debtor is a person you ring - not an
  // invoice. Somebody with four small overdue invoices is one phone call.
  const byCustomer = new Map<string, { partyId: string | null; paise: number; oldest: Date }>();
  for (const i of owing) {
    const cur = byCustomer.get(i.customerName);
    if (cur) {
      cur.paise += i.owed;
      if (i.dueDate < cur.oldest) cur.oldest = i.dueDate;
    } else {
      byCustomer.set(i.customerName, { partyId: i.partyId, paise: i.owed, oldest: i.dueDate });
    }
  }

  const overdue = BUCKETS.slice(1).reduce((n, b) => n + (rAge.get(b) ?? 0), 0);
  const cashIn = receipts._sum?.amountPaise ?? 0;
  const cashOut = payments._sum?.amountPaise ?? 0;

  return {
    cards: [
      {
        label: 'Owed to you', value: rupees(receivableTotal),
        sub: `${owing.length} open invoices`,
        route: '/invoices', tone: receivableTotal > 0 ? 'warning' : 'success',
      },
      {
        label: 'Overdue', value: rupees(overdue),
        sub: overdue > 0 ? 'past the due date' : 'nothing late',
        route: '/invoices', tone: overdue > 0 ? 'danger' : 'success',
      },
      {
        label: 'You owe', value: rupees(payableTotal),
        sub: `${suppliers.filter((s) => s.outstandingPaise > 0).length} suppliers`,
        route: '/purchase/payables', tone: payableTotal > 0 ? 'warning' : 'success',
      },
      {
        label: 'Net position', value: rupees(receivableTotal - payableTotal),
        sub: receivableTotal >= payableTotal ? 'owed more than you owe' : 'you owe more',
        route: '/reports/profit-loss',
        tone: receivableTotal >= payableTotal ? 'success' : 'danger',
      },
      {
        label: 'Received this month', value: rupees(cashIn),
        sub: 'money in', route: '/receipts', tone: 'success',
      },
      {
        label: 'Paid this month', value: rupees(cashOut),
        sub: 'money out', route: '/purchase/payables', tone: 'info',
      },
      {
        label: pnl.netGstPaise >= 0 ? 'GST payable' : 'GST reclaimable',
        value: rupees(Math.abs(pnl.netGstPaise)),
        sub: 'this month, output less input',
        route: '/reports/profit-loss',
        tone: pnl.netGstPaise > 0 ? 'warning' : 'info',
      },
      {
        label: 'Gross margin',
        value: `${pnl.grossMarginPct}%`,
        sub: 'this month, indicative',
        route: '/reports/profit-loss',
        tone: pnl.grossMarginPct > 0 ? 'success' : 'danger',
      },
    ],

    receivableAgeing: BUCKETS.map((b) => ({
      bucket: b, label: BUCKET_LABEL[b], paise: rAge.get(b) ?? 0,
    })),
    payableAgeing: BUCKETS.map((b) => ({
      bucket: b, label: BUCKET_LABEL[b], paise: pAge.get(b) ?? 0,
    })),

    topDebtors: [...byCustomer.entries()]
      .map(([name, v]) => ({
        partyId: v.partyId,
        name,
        paise: v.paise,
        oldestDays: Math.max(
          0, Math.floor((now.getTime() - v.oldest.getTime()) / 86_400_000),
        ),
      }))
      .sort((a, b) => b.paise - a.paise)
      .slice(0, 8),

    topCreditors: suppliers
      .filter((s) => s.outstandingPaise > 0)
      .slice(0, 8)
      .map((s) => ({ partyId: s.partyId, name: s.supplierName, paise: s.outstandingPaise })),

    gst: {
      outputPaise: pnl.outputTaxPaise,
      inputPaise: pnl.inputTaxPaise,
      netPaise: pnl.netGstPaise,
    },
    monthCashInPaise: cashIn,
    monthCashOutPaise: cashOut,
  };
}

// --------------------------------------------------------------------- stock

export interface StockTabData {
  cards: DrillCard[];
  reorder: { productId: string; name: string; code: string; qty: number; reorderLevel: number }[];
  topValue: { productId: string; name: string; qty: number; valuePaise: number }[];
  problems: { productId: string; name: string; code: string; issue: string }[];
  method: string;
}

export async function getStockTab(
  scope: StoreScope, features: Set<string> = new Set(),
): Promise<StockTabData> {
  /**
   * The two checks nobody was running, on the tab people already open.
   *
   * A report nobody knows exists is a report nobody reads. These two numbers
   * were invisible before 2 Oct 2026 - 91 products disagreed with themselves
   * and no screen said so - so they belong beside the counts that are already
   * here, each clicking through to the detail.
   */
  const [report, health] = await Promise.all([
    stockReport(scope),
    stockHealth(scope, features),
  ]);

  const expiryCards: DrillCard[] = health.expiry.enabled
    ? [
      {
        label: 'Expired, still on shelf', value: String(health.expiry.expired.length),
        sub: health.expiry.expired.length > 0 ? 'do not sell these' : 'none',
        route: '/reports/stock-health',
        tone: health.expiry.expired.length > 0 ? 'danger' : 'success',
      },
      {
        label: 'Going off soon', value: String(health.expiry.expiring.length),
        sub: health.expiry.expiring.length > 0 ? 'sell, move or return' : 'none',
        route: '/reports/stock-health',
        tone: health.expiry.expiring.length > 0 ? 'warning' : 'success',
      },
    ]
    : [];

  return {
    method: report.method,
    cards: [
      {
        label: 'Stock value', value: rupees(report.totalValuePaise),
        sub: `${report.productsHeld} products held`,
        route: '/reports/product-stock', tone: 'info',
      },
      {
        label: 'Need reordering', value: String(report.reorderCount),
        sub: report.reorderCount > 0 ? 'at or below level' : 'nothing low',
        route: '/reports/product-stock',
        tone: report.reorderCount > 0 ? 'warning' : 'success',
      },
      {
        label: 'Out of stock', value: String(report.outOfStockCount),
        sub: 'nothing on the shelf',
        route: '/reports/product-stock',
        tone: report.outOfStockCount > 0 ? 'warning' : 'success',
      },
      {
        label: 'No cost on record', value: String(report.unpricedCount),
        // Named as an effect, not a state. "12 products unpriced" is ignorable;
        // "value understated" is the thing the owner actually cares about.
        sub: report.unpricedCount > 0 ? 'stock value understated' : 'all priced',
        route: '/purchase/bills',
        tone: report.unpricedCount > 0 ? 'danger' : 'success',
      },
      {
        label: 'Negative stock', value: String(report.negativeCount),
        sub: report.negativeCount > 0 ? 'always a data error' : 'none',
        route: '/reports/product-stock',
        tone: report.negativeCount > 0 ? 'danger' : 'success',
      },
      {
        label: 'No reorder level', value: String(report.noReorderLevelCount),
        sub: 'cannot raise an alert',
        route: '/products',
        tone: report.noReorderLevelCount > 0 ? 'warning' : 'success',
      },
      {
        // Named as an effect rather than as a state, the same way "No cost on
        // record" is: "91 products diverged" is ignorable, "39,000 items we
        // cannot account for" is not.
        label: 'Items unaccounted for', value: String(health.ledger.itemsUnaccounted),
        sub: health.ledger.itemsUnaccounted > 0
          ? `across ${health.ledger.divergent.length} products`
          : 'shelf matches the records',
        route: '/reports/stock-health',
        tone: health.ledger.itemsUnaccounted > 0 ? 'danger' : 'success',
      },
      ...expiryCards,
    ],

    reorder: report.rows
      .filter((r) => r.needsReorder)
      .sort((a, b) => a.qty - b.qty)
      .slice(0, 10)
      .map((r) => ({
        productId: r.productId, name: r.productName,
        code: r.productCode, qty: r.qty, reorderLevel: r.reorderLevel,
      })),

    topValue: report.rows
      .filter((r) => r.valuePaise > 0)
      .sort((a, b) => b.valuePaise - a.valuePaise)
      .slice(0, 8)
      .map((r) => ({
        productId: r.productId, name: r.productName,
        qty: r.qty, valuePaise: r.valuePaise,
      })),

    // Both kinds of broken row in one list, because they need the same action -
    // somebody has to go and look at that product.
    problems: [
      ...report.rows.filter((r) => r.negative).map((r) => ({
        productId: r.productId, name: r.productName, code: r.productCode,
        issue: `Negative stock (${r.qty})`,
      })),
      ...report.rows.filter((r) => r.qty > 0 && !r.costKnown).map((r) => ({
        productId: r.productId, name: r.productName, code: r.productCode,
        issue: `${r.qty} units held with no cost`,
      })),
    ].slice(0, 12),
  };
}

// ------------------------------------------------------------------------ HR

export interface HrTabData {
  cards: DrillCard[];
  payroll: PayrollSummary;
  staff: {
    userId: string;
    name: string;
    present: number;
    absent: number;
    leave: number;
    late: number;
    workingDays: number;
    calls: number;
  }[];
  needsAttention: { userId: string; name: string; issue: string }[];
  pendingRequests: number;
}

export async function getHrTab(scope: StoreScope, now = new Date()): Promise<HrTabData> {
  const { year, month: monthIndex } = istYearMonth(now);
  const month = await attendanceMonth(scope, year, monthIndex, now);
  // This month's calls from the 1st at midnight India time, the same month the grid shows.
  const monthStart = istDayStart(month.dates[0])!;

  const [calls, payroll] = await Promise.all([
    db.callLog.groupBy({
      by: ['userId'],
      where: { ...scopeWhere(scope), startedAt: { gte: monthStart, lte: now } },
      _count: { _all: true },
    }),
    getPayrollSummary(scope),
  ]);
  const callBy = new Map(calls.map((c) => [c.userId, c._count._all]));

  const staff = month.rows.map((r) => ({
    userId: r.userId,
    name: r.userName,
    present: r.totals.present + r.totals.late,
    absent: r.totals.absent,
    leave: r.totals.leave,
    late: r.totals.late,
    workingDays: r.totals.workingDays,
    calls: callBy.get(r.userId) ?? 0,
  }));

  /**
   * Rows a manager should look at today.
   *
   * Deliberately NOT a ranking of who is worst. A list ordered by absences
   * reads as a league table of bad employees, and the figures behind it are
   * only as good as whether a phone was reporting - which is exactly what the
   * first check here is about.
   */
  const needsAttention: { userId: string; name: string; issue: string }[] = [];
  for (const r of month.rows) {
    const unclosed = r.days.filter((d) => d.status === 'unmarked').length;
    if (r.totals.absent >= 3) {
      needsAttention.push({
        userId: r.userId, name: r.userName,
        issue: `${r.totals.absent} days with no shift started`,
      });
    }
    if (unclosed >= 3) {
      needsAttention.push({
        userId: r.userId, name: r.userName,
        issue: `${unclosed} days not marked - check the phone is reporting`,
      });
    }
    if ((callBy.get(r.userId) ?? 0) === 0 && r.totals.present > 0) {
      needsAttention.push({
        userId: r.userId, name: r.userName,
        issue: 'Worked this month but made no calls',
      });
    }
  }

  const totalPresent = staff.reduce((n, s) => n + s.present, 0);
  const totalAbsent = staff.reduce((n, s) => n + s.absent, 0);
  const totalCalls = staff.reduce((n, s) => n + s.calls, 0);

  return {
    cards: [
      {
        label: 'On shift now', value: String(month.today.present + month.today.late),
        sub: `of ${month.rows.length} staff`,
        route: '/attendance/grid', tone: 'success',
      },
      {
        label: 'Not marked today', value: String(month.today.unmarked),
        sub: month.today.unmarked > 0 ? 'no shift started' : 'all accounted for',
        route: '/attendance/grid',
        tone: month.today.unmarked > 0 ? 'warning' : 'success',
      },
      {
        label: 'On leave / WFH', value: String(month.today.onLeave + month.today.wfh),
        sub: 'approved', route: '/attendance/grid', tone: 'info',
      },
      {
        label: 'Awaiting approval', value: String(month.pendingRequests),
        sub: month.pendingRequests > 0 ? 'leave requests' : 'nothing waiting',
        route: '/attendance/grid',
        tone: month.pendingRequests > 0 ? 'warning' : 'success',
      },
      {
        label: 'Days worked', value: String(totalPresent),
        sub: 'this month, all staff',
        route: '/attendance/grid', tone: 'default',
      },
      {
        label: 'Absences', value: String(totalAbsent),
        sub: 'this month', route: '/attendance/grid',
        tone: totalAbsent > 0 ? 'warning' : 'success',
      },
      {
        label: 'Calls made', value: totalCalls.toLocaleString('en-IN'),
        sub: 'this month', route: '/call-logs', tone: 'info',
      },
      {
        label: 'Staff with phones', value: String(month.rows.length),
        sub: 'reporting attendance',
        route: '/settings/call-devices', tone: 'default',
      },
    ],
    payroll,
    staff: staff.sort((a, b) => b.present - a.present),
    needsAttention: needsAttention.slice(0, 10),
    pendingRequests: month.pendingRequests,
  };
}
