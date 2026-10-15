import 'server-only';
import { db } from '../db';
import { scopeWhere } from '../store-scope';
import { supplierBalances } from '../purchases';
import { profitAndLoss } from '../reports';
import { attendanceMonth } from '../attendance';
import { getJobSettings } from '../job-settings';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { invoiceStatus, daysOverdue, type InvoiceLifecycle } from '@/lib/invoice-status';
import { countsAsRevenue } from '@/lib/revenue';
import { slaChecks, SLA_START } from '@/lib/job-sla';
import { istYearMonth } from '@/lib/attendance-day';
import { addDays, dayEnd, dayStart, intoBuckets, monthEnd, monthStart, type Range } from '@/lib/dash/period';
import { inrC, inrFull, num, pct } from '@/lib/dash/format';
import type { DashAction, KpiData } from '@/lib/dash/types';
import {
  ago, delta, groupSum, ledgerBalance, movers, partyName, pendingApprovals, proratedTarget, rs, shortDate, storeNames, sum, within, daysSince,
  type DashCtx,
} from './common';

const DONE = ['resolved', 'closed', 'cancelled'];

export interface NeedRow {
  label: string; sub: string; count: number; amt?: string;
  t: 'danger' | 'warning' | 'info' | 'success'; i: string; href: string;
  rows: { doc: string; who: string; age: string; amt: string; _href?: string }[];
  actions?: DashAction[];
}

export interface BusinessData {
  kpis: KpiData[];
  trend: { sales: number[]; coll: number[]; exp: number[]; prevSales: number[] | null; tSales: number; tColl: number; tExp: number };
  needs: NeedRow[];
  target: { mtd: number; target: number; pace: number; perDay: number } | null;
  team: { head: number; onTime: number; late: number; leave: number; notIn: number };
  service: { open: number; missed: number; avgClose: string; rating: string };
  branches: { label: string; value: number; storeId: string }[] | null;
  cash: { label: string; value: number }[];
  topCustomers: { label: string; value: number; extra: string; partyId: string | null; rows: { doc: string; date: string; st: string; amt: string; _href: string }[] }[];
  topProducts: { label: string; value: number; extra: string; productId: string | null }[];
  feed: { i: string; t: string; s: string; a: string; c: string; w: string; href: string }[];
}

/** Sales = issued invoices on their invoice date - the P&L's own rule. */
async function invoicesIn(ctx: DashCtx, r: Range) {
  return db.invoice.findMany({
    where: { ...scopeWhere(ctx.scope), lifecycle: 'sent', invoiceDate: within(r) },
    select: { id: true, invoiceNo: true, invoiceDate: true, customerName: true, partyId: true, grandTotalPaise: true, amountPaidPaise: true, dueDate: true, lifecycle: true, storeId: true },
  });
}
async function receiptsIn(ctx: DashCtx, r: Range) {
  return db.receipt.findMany({
    where: { ...scopeWhere(ctx.scope), status: 'received', receivedAt: within(r) },
    select: { id: true, receiptNo: true, receivedAt: true, amountPaise: true, partyId: true, party: { select: { companyName: true, firstName: true, lastName: true } } },
  });
}
async function expensesIn(ctx: DashCtx, r: Range) {
  return db.transaction.findMany({
    where: { ...scopeWhere(ctx.scope), txnType: 'expense', status: 'approved', txnDate: within(r) },
    select: { id: true, txnNo: true, txnDate: true, amountPaise: true, description: true, categoryAccountCode: true },
  });
}

export async function businessDashboard(ctx: DashCtx): Promise<BusinessData> {
  const { scope, range, prev, buckets, now } = ctx;
  const w = scopeWhere(scope);

  const inv = await invoicesIn(ctx, range);
  const invPrev = prev ? await invoicesIn(ctx, prev) : null;
  const rec = await receiptsIn(ctx, range);
  const recPrev = prev ? await receiptsIn(ctx, prev) : null;
  const exp = await expensesIn(ctx, range);
  const pnl = await profitAndLoss(scope, dayStart(range.from), dayEnd(range.to));
  const pnlPrev = prev ? await profitAndLoss(scope, dayStart(prev.from), dayEnd(prev.to)) : null;

  const sales = intoBuckets(buckets, inv, (i) => i.invoiceDate, (i) => rs(i.grandTotalPaise));
  const coll = intoBuckets(buckets, rec, (r) => r.receivedAt, (r) => rs(r.amountPaise));
  const expB = intoBuckets(buckets, exp, (e) => e.txnDate, (e) => rs(e.amountPaise));
  const tSales = sum(sales); const tColl = sum(coll); const tExp = sum(expB);
  const pSales = invPrev ? rs(sum(invPrev.map((i) => i.grandTotalPaise))) : null;
  const pColl = recPrev ? rs(sum(recPrev.map((r) => r.amountPaise))) : null;

  // The comparison drawn on the same axis: the previous period cut into as
  // many buckets as this one, position by position.
  let prevSales: number[] | null = null;
  if (prev && invPrev) {
    const n = rangeDays(prev); const step = n / buckets.length;
    prevSales = buckets.map((_, i) => {
      const s = dayStart(addDays(prev.from, Math.floor(i * step))).getTime();
      const e = dayEnd(addDays(prev.from, Math.max(Math.floor(i * step), Math.floor((i + 1) * step) - 1))).getTime();
      if (buckets[0]?.hour !== undefined) {
        // One day against one day: the same hour yesterday / last year.
        return rs(sum(invPrev.filter((x) => new Date(x.invoiceDate.getTime() + 330 * 60_000).getUTCHours() === buckets[i].hour).map((x) => x.grandTotalPaise)));
      }
      return rs(sum(invPrev.filter((x) => x.invoiceDate.getTime() >= s && x.invoiceDate.getTime() < e).map((x) => x.grandTotalPaise)));
    });
  }

  // ---- owed to you, today -------------------------------------------------
  const open = await db.invoice.findMany({
    where: { ...w, lifecycle: 'sent' },
    select: { id: true, invoiceNo: true, customerName: true, partyId: true, grandTotalPaise: true, amountPaidPaise: true, dueDate: true, lifecycle: true, invoiceDate: true },
  });
  const owing = open.map((i) => ({ ...i, owed: Math.max(0, i.grandTotalPaise - i.amountPaidPaise) })).filter((i) => i.owed > 0);
  const overdue = owing.filter((i) => invoiceStatus({ lifecycle: i.lifecycle as InvoiceLifecycle, grandTotalPaise: i.grandTotalPaise, amountPaidPaise: i.amountPaidPaise, dueDate: i.dueDate }, now) === 'overdue');
  const owedTotal = rs(sum(owing.map((i) => i.owed)));
  const overdueTotal = rs(sum(overdue.map((i) => i.owed)));
  const debtors = groupSum(owing, (i) => i.customerName, (i) => i.owed);
  const oldestOverdue = [...overdue].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];

  // ---- you owe ---------------------------------------------------------------
  const suppliers = await supplierBalances(scope);
  const payable = rs(sum(suppliers.map((s) => Math.max(0, s.outstandingPaise))));
  const dueSoonBills = await db.purchaseBill.findMany({
    where: { ...w, lifecycle: 'received', dueDate: { lt: dayEnd(addDays(ctx.today, 7)) } },
    select: { grandTotalPaise: true, amountPaidPaise: true },
  });
  const due7 = rs(sum(dueSoonBills.map((b) => Math.max(0, b.grandTotalPaise - b.amountPaidPaise))));

  // ---- cash & bank -----------------------------------------------------------
  const bal = await ledgerBalance(scope, ['1010', '1020']);
  const cashHand = rs(bal.get('1010') ?? 0); const bank = rs(bal.get('1020') ?? 0);
  const cashNow = cashHand + bank;
  const balAtPrev = await ledgerBalance(scope, ['1010', '1020'], dayStart(range.from));
  const cashBefore = rs((balAtPrev.get('1010') ?? 0) + (balAtPrev.get('1020') ?? 0));
  const bankAccounts = await db.bankAccount.count({ where: { ...w, isActive: true } });

  const gp = rs(pnl.grossProfitPaise);
  const salesRows = [...inv].sort((a, b) => b.grandTotalPaise - a.grandTotalPaise).slice(0, 6)
    .map((i) => ({ doc: i.invoiceNo, _href: `/invoices/${i.id}`, who: i.customerName, date: shortDate(i.invoiceDate), amt: inrFull(rs(i.grandTotalPaise)) }));
  const docCols = [{ k: 'doc', l: 'Document' }, { k: 'who', l: 'Customer' }, { k: 'date', l: 'Date' }, { k: 'amt', l: 'Amount', num: true }];
  const q = (path: string, extra: Record<string, string> = {}) => withRange(path, range, extra);

  const kpis: KpiData[] = [
    {
      id: 'b-sales', label: 'Sales', icon: 'trend', value: inrC(tSales), d: delta(tSales, pSales), spark: sales,
      sub: `${num(inv.length)} invoices · avg ${inrC(inv.length ? tSales / inv.length : 0)}`,
      drill: {
        title: 'Sales', value: inrC(tSales), delta: delta(tSales, pSales), chart: { label: 'Sales', data: sales, type: 'area' },
        moved: invPrev ? movers(groupSum(inv, (i) => i.customerName, (i) => i.grandTotalPaise), groupSum(invPrev, (i) => i.customerName, (i) => i.grandTotalPaise)) : undefined,
        rowsTitle: 'Biggest invoices', rowsTotal: inv.length, cols: docCols, rows: salesRows, route: q('/invoices', { view: 'all' }),
      },
    },
    {
      id: 'b-coll', label: 'Money in', icon: 'rupee', value: inrC(tColl), d: delta(tColl, pColl), spark: coll, ink: 'success',
      sub: tSales ? `${pct(tColl / tSales, 0)} of sales collected` : `${num(rec.length)} receipts`,
      drill: {
        title: 'Money in', value: inrC(tColl), delta: delta(tColl, pColl), ink: 'success', chart: { label: 'Money in', data: coll, type: 'area' },
        moved: recPrev ? movers(groupSum(rec, (r) => partyName(r.party), (r) => r.amountPaise), groupSum(recPrev, (r) => partyName(r.party), (r) => r.amountPaise)) : undefined,
        rowsTitle: 'Receipts', rowsTotal: rec.length, cols: docCols,
        rows: [...rec].sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 6).map((r) => ({ doc: r.receiptNo, _href: `/receipts/${r.id}`, who: partyName(r.party), date: shortDate(r.receivedAt), amt: inrFull(rs(r.amountPaise)) })),
        route: q('/receipts'),
        actions: [{ label: 'Record payment', kind: 'money', icon: 'rupee', href: '/receipts?pay=1' }],
      },
    },
    {
      id: 'b-gp', label: 'Gross profit', icon: 'sparkle', value: inrC(gp), d: delta(gp, pnlPrev ? rs(pnlPrev.grossProfitPaise) : null),
      spark: sales.map((v) => v * (pnl.grossMarginPct / 100)),
      sub: `margin ${pnl.grossMarginPct.toFixed(1)}%`,
      drill: {
        title: 'Gross profit', value: inrC(gp), delta: delta(gp, pnlPrev ? rs(pnlPrev.grossProfitPaise) : null),
        moved: pnlPrev ? [
          { label: 'Sales (net of returns)', v: rs(pnl.netRevenuePaise - pnlPrev.netRevenuePaise) },
          { label: 'Cost of goods sold', v: -rs(pnl.cogsPaise - pnlPrev.cogsPaise) },
        ] : undefined,
        rowsTitle: 'How it is worked out', cols: [{ k: 'doc', l: 'Line' }, { k: 'amt', l: 'Amount', num: true }],
        rows: [
          { doc: 'Sales (net of returns)', amt: inrFull(rs(pnl.netRevenuePaise)) },
          { doc: 'Cost of goods sold', amt: inrFull(-rs(pnl.cogsPaise)) },
          { doc: 'Gross profit', amt: inrFull(gp) },
        ],
        note: pnl.productsWithoutCost > 0 ? `${pnl.productsWithoutCost} products sold in this period have no cost yet, so cost is understated until a purchase price is entered.` : 'Cost is what the goods sold cost you, by the costing method set in Settings › System.',
        route: q('/reports/profit-loss'),
      },
    },
    {
      id: 'b-owed', label: 'Owed to you', icon: 'inbox', value: inrC(owedTotal), d: null, goodUp: false, ink: 'danger',
      sub: `${inrC(overdueTotal)} overdue · ${num(debtors.size)} customers`, subTone: 'danger',
      drill: {
        title: 'Owed to you', value: inrC(owedTotal), ink: 'danger', goodUp: false,
        rowsTitle: 'Who owes most', rowsTotal: debtors.size,
        cols: [{ k: 'doc', l: 'Customer' }, { k: 'n', l: 'Invoices', num: true }, { k: 'age', l: 'Oldest due' }, { k: 'amt', l: 'Owed', num: true, ink: 'danger' }],
        rows: [...debtors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, p]) => {
          const theirs = owing.filter((i) => i.customerName === name);
          const oldest = theirs.reduce((m, i) => (i.dueDate < m ? i.dueDate : m), theirs[0].dueDate);
          const pid = theirs.find((i) => i.partyId)?.partyId;
          return { doc: name, _href: pid ? `/customers/${pid}` : '/customers', n: theirs.length, age: `${Math.max(0, daysOverdue({ dueDate: oldest } as never, now))} days`, amt: inrFull(rs(p)) };
        }),
        route: '/invoices?card=overdue',
        actions: [{ label: 'Send WhatsApp reminders', icon: 'whatsapp', toast: 'Arrives with WhatsApp Business (phase W1): it will send the approved payment-reminder template to every customer here.' }],
      },
    },
    {
      id: 'b-pay', label: 'You owe suppliers', icon: 'truck', value: inrC(payable), d: null, goodUp: false,
      sub: `${inrC(due7)} due in 7 days`,
      drill: {
        title: 'You owe suppliers', value: inrC(payable), goodUp: false, rowsTitle: 'Who you owe most', rowsTotal: suppliers.filter((s) => s.outstandingPaise > 0).length,
        cols: [{ k: 'doc', l: 'Supplier' }, { k: 'n', l: 'Bills', num: true }, { k: 'age', l: 'Oldest due' }, { k: 'amt', l: 'Owed', num: true }],
        rows: suppliers.filter((s) => s.outstandingPaise > 0).sort((a, b) => b.outstandingPaise - a.outstandingPaise).slice(0, 6)
          .map((s) => ({ doc: s.supplierName, _href: `/suppliers/${s.partyId}`, n: s.billCount, age: s.oldestDueDate ? shortDate(s.oldestDueDate) : '—', amt: inrFull(rs(s.outstandingPaise)) })),
        route: '/purchase/payables',
      },
    },
    {
      id: 'b-cash', label: 'Cash & bank', icon: 'bank', value: inrC(cashNow), d: delta(cashNow, cashBefore),
      // Overdrawn reads red, never as a healthy figure (Impeccable review, 13 Oct 2026).
      ...(cashNow < 0 ? { ink: 'danger' as const } : {}),
      sub: `${num(bankAccounts)} bank account${bankAccounts === 1 ? '' : 's'} · cash in hand ${inrC(cashHand)}`,
      drill: {
        title: 'Cash & bank', value: inrC(cashNow), delta: delta(cashNow, cashBefore), sub: `vs ${inrC(cashBefore)} at the start of the period`,
        rowsTitle: 'Balances today', cols: [{ k: 'doc', l: 'Account' }, { k: 'amt', l: 'Balance', num: true }],
        rows: [{ doc: 'Bank (all accounts)', _href: '/bank/summary', amt: inrFull(bank) }, { doc: 'Cash in hand', amt: inrFull(cashHand) }],
        note: 'From the ledger: every receipt, payment, expense and transfer posts to Cash (1010) or Bank (1020).',
        route: '/bank/summary',
      },
    },
  ];

  // ---- needs you today -----------------------------------------------------
  const inbox = await pendingApprovals(scope);
  const byType = groupSum(inbox, (i) => i.typeLabel.toLowerCase(), () => 1);
  const visitsToday = await db.serviceVisit.findMany({
    where: { ...w, scheduledAt: { gte: dayStart(ctx.today), lt: now }, status: 'scheduled', checkedInAt: null, completedAt: null },
    select: { id: true, scheduledAt: true, technician: { select: { fullName: true } }, complaint: { select: { id: true, complaintNo: true, customer: { select: { companyName: true, firstName: true, lastName: true } } } } },
    orderBy: { scheduledAt: 'asc' },
  });
  const toBill = await db.complaint.findMany({
    where: { ...w, billingStatus: 'to_invoice' },
    select: { id: true, complaintNo: true, closedAt: true, resolvedAt: true, customer: { select: { companyName: true, firstName: true, lastName: true } } },
    orderBy: { updatedAt: 'asc' }, take: LIST_MAX_ROWS,
  });
  // Below re-order level, straight from the balances - the full stock report
  // (costs, serials) is the Stock dashboard's job and cost seconds here.
  const lowBal = await db.productBalance.findMany({
    where: { product: { ...w, isActive: true }, reorderLevel: { gt: 0 } },
    select: { productId: true, currentQty: true, reorderLevel: true, product: { select: { productName: true, productCode: true } } },
  });
  const reorder = lowBal.filter((b) => b.currentQty <= b.reorderLevel)
    .map((b) => ({ productId: b.productId, productName: b.product.productName, productCode: b.product.productCode, qty: b.currentQty, reorderLevel: b.reorderLevel }));
  const amcSoon = await db.amcContract.findMany({
    where: { ...w, status: 'active', endDate: { gte: dayStart(ctx.today), lt: dayEnd(addDays(ctx.today, 30)) } },
    select: { id: true, contractNo: true, endDate: true, amountPaise: true, customer: { select: { companyName: true, firstName: true, lastName: true } } },
    orderBy: { endDate: 'asc' },
  });
  const leaves = await db.leaveRequest.findMany({
    where: { ...w, status: 'pending' },
    select: { id: true, fromDate: true, toDate: true, kind: true, createdAt: true, user: { select: { fullName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const leaveDays = (l: { fromDate: Date; toDate: Date }) => Math.round((l.toDate.getTime() - l.fromDate.getTime()) / 86_400_000) + 1;

  const typeSummary = [...byType.entries()].map(([t, n]) => `${n} ${t}`).join(' · ');
  const needs: NeedRow[] = [
    {
      label: 'Approvals waiting for you', sub: typeSummary || 'Nothing is waiting', count: inbox.length, t: 'warning', i: 'check', href: '/my/reminders?tab=waiting',
      rows: inbox.slice(0, 6).map((a) => ({ doc: a.title, _href: a.href, who: a.requesterName, age: `${daysSince(a.since, now)} days`, amt: a.amountPaise ? inrFull(rs(a.amountPaise)) : '—' })),
      actions: inbox.length ? [{ label: 'Open My Desk', kind: 'success', icon: 'check', href: '/my/reminders?tab=waiting' }] : [],
    },
    {
      label: 'Invoices past due', sub: oldestOverdue ? `Oldest: ${oldestOverdue.customerName}, ${daysOverdue(oldestOverdue as never, now)} days` : 'None past due', count: overdue.length, amt: overdue.length ? inrC(overdueTotal) : undefined,
      t: 'danger', i: 'receipt', href: '/invoices?card=overdue',
      rows: [...overdue].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()).slice(0, 6).map((i) => ({ doc: i.invoiceNo, _href: `/invoices/${i.id}`, who: i.customerName, age: `${daysOverdue(i as never, now)} days`, amt: inrFull(rs(i.owed)) })),
      actions: overdue.length ? [{ label: 'Remind all on WhatsApp', icon: 'whatsapp', toast: 'Arrives with WhatsApp Business (phase W1).' }] : [],
    },
    {
      label: 'Service visits missed today', sub: visitsToday.length ? [...new Set(visitsToday.map((v) => v.technician.fullName))].join(' · ') : 'Every visit so far has started', count: visitsToday.length,
      t: 'danger', i: 'wrench', href: '/services/visits',
      rows: visitsToday.slice(0, 6).map((v) => ({ doc: v.complaint?.complaintNo ?? 'Visit', _href: v.complaint ? `/services/complaints/${v.complaint.id}` : '/services/visits', who: v.complaint ? partyName(v.complaint.customer) : v.technician.fullName, age: `booked ${timeOf(v.scheduledAt)}`, amt: v.technician.fullName })),
    },
    {
      label: 'Jobs done but not billed', sub: 'Chargeable jobs with no invoice yet', count: toBill.length,
      t: 'warning', i: 'file', href: '/services/complaints?card=resolved',
      rows: toBill.slice(0, 6).map((c) => ({ doc: c.complaintNo, _href: `/services/complaints/${c.id}`, who: partyName(c.customer), age: c.resolvedAt ? `${daysSince(c.resolvedAt, now)} days` : '—', amt: '—' })),
    },
    {
      label: 'Items to re-order', sub: reorder.length ? `${reorder.slice(0, 2).map((r) => r.productName).join(', ')}${reorder.length > 2 ? `, +${reorder.length - 2}` : ''}` : 'Nothing below its re-order level', count: reorder.length,
      t: 'info', i: 'box', href: '/reports/product-stock',
      rows: reorder.slice(0, 6).map((r) => ({ doc: r.productName, _href: `/product-journey?product=${r.productId}`, who: r.productCode, age: `${num(r.qty)} in stock`, amt: `re-order at ${num(r.reorderLevel)}` })),
      actions: reorder.length ? [{ label: 'Make PO for these', icon: 'cart', act: 'make-po', payload: reorder.map((r) => r.productId) }] : [],
    },
    {
      label: 'AMCs ending in 30 days', sub: 'Renewal value at stake', count: amcSoon.length, amt: amcSoon.length ? inrC(rs(sum(amcSoon.map((a) => a.amountPaise)))) : undefined,
      t: 'info', i: 'shield', href: '/services/amc?filter=active',
      rows: amcSoon.slice(0, 6).map((a) => ({ doc: a.contractNo, _href: `/services/amc?open=${a.id}`, who: partyName(a.customer), age: `ends ${shortDate(a.endDate)}`, amt: inrFull(rs(a.amountPaise)) })),
    },
    {
      label: 'Leave requests', sub: leaves.length ? `${leaves[0].user.fullName} (${leaveDays(leaves[0])} day${leaveDays(leaves[0]) === 1 ? '' : 's'})${leaves.length > 1 ? `, +${leaves.length - 1}` : ''}` : 'None waiting', count: leaves.length,
      t: 'info', i: 'calendar', href: '/my/reminders?tab=waiting',
      rows: leaves.slice(0, 6).map((l) => ({ doc: l.kind === 'leave' ? 'Leave' : l.kind.toUpperCase(), who: l.user.fullName, age: `${shortDate(l.fromDate)} – ${shortDate(l.toDate)}`, amt: `${leaveDays(l)} d` })),
    },
  ];

  // ---- this month's target ---------------------------------------------------
  const mFrom = monthStart(ctx.today); const mTo = monthEnd(ctx.today);
  const monthRange = { from: mFrom, to: ctx.today, label: '' };
  const targets = await db.userTarget.findMany({
    where: { ...w, periodStart: { lte: dayEnd(mTo) }, periodEnd: { gte: dayStart(mFrom) } },
    select: { periodStart: true, periodEnd: true, targetPaise: true },
  });
  const monthTarget = rs(proratedTarget(targets, { from: mFrom, to: mTo, label: '' }));
  const monthOrders = await db.salesOrder.findMany({
    where: { ...w, orderDate: within(monthRange) },
    select: { grandTotalPaise: true, fulfilmentStatus: true },
  });
  const mtd = rs(sum(monthOrders.filter((o) => countsAsRevenue(o.fulfilmentStatus)).map((o) => o.grandTotalPaise)));
  const dayOfMonth = Number(ctx.today.slice(8)); const monthDays = Number(mTo.slice(8));
  const target = monthTarget > 0 ? {
    mtd, target: monthTarget, pace: mtd / dayOfMonth * monthDays,
    perDay: Math.max(0, (monthTarget - mtd) / Math.max(1, monthDays - dayOfMonth)),
  } : null;

  // ---- team today ------------------------------------------------------------
  const { year, month } = istYearMonth(now);
  const att = await attendanceMonth(scope, year, month, now).catch(() => null);
  const head = att?.rows.length ?? 0;
  const t = att?.today;
  const team = {
    head,
    onTime: (t?.present ?? 0) + (t?.wfh ?? 0) + (t?.halfDay ?? 0),
    late: t?.late ?? 0,
    leave: t?.onLeave ?? 0,
    notIn: t?.unmarked ?? 0,
  };

  // ---- service pulse -------------------------------------------------------------
  const openJobs = await db.complaint.findMany({
    where: { ...w, status: { notIn: DONE } },
    select: { storeId: true, status: true, priority: true, createdAt: true, assignedAt: true, onSiteSince: true, timeOnSiteSec: true, legacyRef: true, visits: { where: { checkedInAt: { not: null } }, select: { id: true }, take: 1 } },
  });
  const settingsByStore = new Map<string, Awaited<ReturnType<typeof getJobSettings>>>();
  let missed = 0;
  for (const j of openJobs) {
    if (j.legacyRef || j.createdAt < SLA_START) continue;
    if (!settingsByStore.has(j.storeId)) settingsByStore.set(j.storeId, await getJobSettings(j.storeId));
    const checks = slaChecks({ status: j.status, priority: j.priority, createdAt: j.createdAt, assignedAt: j.assignedAt, arrived: !!j.onSiteSince || j.timeOnSiteSec > 0 || j.visits.length > 0 }, settingsByStore.get(j.storeId)!.sla, now);
    if (checks.some((c) => c.state === 'missed')) missed++;
  }
  const closedIn = await db.complaint.findMany({
    where: { ...w, closedAt: within(range) },
    select: { createdAt: true, closedAt: true },
  });
  const avgClose = closedIn.length ? sum(closedIn.map((c) => (c.closedAt!.getTime() - c.createdAt.getTime()) / 86_400_000)) / closedIn.length : null;
  const rated = await db.complaint.aggregate({ where: { ...w, ratedAt: within(range), ratingStars: { not: null } }, _avg: { ratingStars: true }, _count: true });

  // ---- branches / cash -------------------------------------------------------------
  let branches: BusinessData['branches'] = null;
  if (scope.kind === 'all' && scope.storeIds.length > 1) {
    const names = await storeNames(scope);
    const by = groupSum(inv, (i) => i.storeId, (i) => i.grandTotalPaise);
    branches = scope.storeIds.map((id) => ({ label: names.get(id) ?? 'Branch', value: rs(by.get(id) ?? 0), storeId: id })).sort((a, b) => b.value - a.value);
  }

  // ---- top customers / products ------------------------------------------------------
  const custMap = new Map<string, { p: number; n: number; partyId: string | null; rows: typeof inv }>();
  for (const i of inv) {
    const c = custMap.get(i.customerName) ?? { p: 0, n: 0, partyId: i.partyId, rows: [] };
    c.p += i.grandTotalPaise; c.n += 1; c.rows.push(i); custMap.set(i.customerName, c);
  }
  const topCustomers = [...custMap.entries()].sort((a, b) => b[1].p - a[1].p).slice(0, 6).map(([label, c]) => ({
    label, value: rs(c.p), extra: `${c.n} inv`, partyId: c.partyId,
    rows: c.rows.slice(0, 6).map((i) => ({
      doc: i.invoiceNo, _href: `/invoices/${i.id}`, date: shortDate(i.invoiceDate),
      st: i.amountPaidPaise >= i.grandTotalPaise ? 'Paid' : invoiceStatus({ lifecycle: i.lifecycle as InvoiceLifecycle, grandTotalPaise: i.grandTotalPaise, amountPaidPaise: i.amountPaidPaise, dueDate: i.dueDate }, now) === 'overdue' ? 'Overdue' : 'Due',
      amt: inrFull(rs(i.grandTotalPaise)),
    })),
  }));
  const items = inv.length ? await db.invoiceItem.findMany({
    where: { invoiceId: { in: inv.map((i) => i.id) }, invoice: scopeWhere(scope) },
    select: { productId: true, productName: true, qty: true, lineTotalPaise: true },
  }) : [];
  const prodMap = new Map<string, { p: number; q: number; id: string | null }>();
  for (const it of items) {
    const c = prodMap.get(it.productName) ?? { p: 0, q: 0, id: it.productId };
    c.p += it.lineTotalPaise; c.q += Number(it.qty); prodMap.set(it.productName, c);
  }
  const topProducts = [...prodMap.entries()].sort((a, b) => b[1].p - a[1].p).slice(0, 6)
    .map(([label, c]) => ({ label, value: rs(c.p), extra: `${num(c.q)} pcs`, productId: c.id }));

  return {
    kpis,
    trend: { sales, coll, exp: expB, prevSales, tSales, tColl, tExp },
    needs,
    target,
    team,
    service: {
      open: openJobs.length, missed,
      avgClose: avgClose === null ? '—' : avgClose.toFixed(1),
      rating: rated._avg.ratingStars ? `${rated._avg.ratingStars.toFixed(1)} ★` : '—',
    },
    branches,
    cash: [{ label: 'Bank (all accounts)', value: bank }, { label: 'Cash in hand', value: cashHand }],
    topCustomers,
    topProducts,
    feed: await feedOf(ctx),
  };
}

function rangeDays(r: Range) { return Math.round((dayEnd(r.to).getTime() - dayStart(r.from).getTime()) / 86_400_000); }
function timeOf(d: Date) {
  const x = new Date(d.getTime() + 330 * 60_000); const h = x.getUTCHours(); const m = x.getUTCMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

/** The list a number opens, narrowed to the same dates. */
export function withRange(path: string, r: Range, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({ ...extra, range: 'custom', from: r.from, to: r.to });
  return `${path}?${p.toString()}`;
}

/** The latest documents across the business, newest first. */
async function feedOf(ctx: DashCtx): Promise<BusinessData['feed']> {
  const w = scopeWhere(ctx.scope); const now = ctx.now;
  const [rec, inv, jobs, orders, grns, leads] = await Promise.all([
    db.receipt.findMany({ where: { ...w, status: 'received' }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, receiptNo: true, amountPaise: true, createdAt: true, party: { select: { companyName: true, firstName: true, lastName: true } } } }),
    db.invoice.findMany({ where: { ...w, lifecycle: 'sent' }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, invoiceNo: true, grandTotalPaise: true, createdAt: true, customerName: true } }),
    db.complaint.findMany({ where: { ...w, closedAt: { not: null } }, orderBy: { closedAt: 'desc' }, take: 6, select: { id: true, complaintNo: true, closedAt: true, ratingStars: true, customer: { select: { companyName: true, firstName: true, lastName: true } }, assignedTechnician: { select: { fullName: true } } } }),
    db.salesOrder.findMany({ where: w, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, orderNo: true, grandTotalPaise: true, createdAt: true, customerName: true } }),
    db.goodsReceiptNote.findMany({ where: w, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, grnNo: true, createdAt: true, party: { select: { companyName: true, firstName: true, lastName: true } } } }),
    db.lead.findMany({ where: w, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, firstName: true, lastName: true, businessName: true, requirement: true, createdAt: true, source: { select: { name: true } } } }),
  ]);
  type F = BusinessData['feed'][number] & { at: Date };
  const all: F[] = [
    ...rec.map((r) => ({ at: r.createdAt, i: 'receipt', t: 'Payment received', s: `${partyName(r.party)} · ${r.receiptNo}`, a: `+ ${inrFull(rs(r.amountPaise))}`, c: 'text-success', w: '', href: `/receipts/${r.id}` })),
    ...inv.map((r) => ({ at: r.createdAt, i: 'file', t: 'Invoice raised', s: `${r.customerName} · ${r.invoiceNo}`, a: inrFull(rs(r.grandTotalPaise)), c: '', w: '', href: `/invoices/${r.id}` })),
    ...jobs.map((r) => ({ at: r.closedAt!, i: 'wrench', t: `Job closed${r.ratingStars ? ` ★${r.ratingStars}` : ''}`, s: `${partyName(r.customer)} · ${r.complaintNo}${r.assignedTechnician ? ` · ${r.assignedTechnician.fullName.split(' ')[0]}` : ''}`, a: '', c: '', w: '', href: `/services/complaints/${r.id}` })),
    ...orders.map((r) => ({ at: r.createdAt, i: 'cart', t: 'Order booked', s: `${r.customerName} · ${r.orderNo}`, a: inrFull(rs(r.grandTotalPaise)), c: '', w: '', href: `/sales/orders/${r.id}` })),
    ...grns.map((r) => ({ at: r.createdAt, i: 'truck', t: 'Goods received', s: `${partyName(r.party)} · ${r.grnNo}`, a: '', c: '', w: '', href: `/goods-receipt/${r.id}` })),
    ...leads.map((r) => ({ at: r.createdAt, i: 'user', t: 'New lead', s: `${r.source?.name ?? 'Lead'} · ${r.requirement ? `“${r.requirement.slice(0, 40)}”` : (r.businessName || [r.firstName, r.lastName].filter(Boolean).join(' '))}`, a: '', c: '', w: '', href: `/crm/leads?open=${r.id}` })),
  ];
  return all.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 6).map(({ at, ...f }) => ({ ...f, w: ago(at, now) }));
}

