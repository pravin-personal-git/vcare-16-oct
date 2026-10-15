import 'server-only';
import { db } from '../db';
import { scopeWhere } from '../store-scope';
import { profitAndLoss } from '../reports';
import { getAccountsTab } from '../dashboard-tabs';
import { addDays, dayEnd, dayStart, intoBuckets, istDay } from '@/lib/dash/period';
import { inrC, inrFull, num } from '@/lib/dash/format';
import type { KpiData } from '@/lib/dash/types';
import { delta, groupSum, ledgerBalance, movers, partyName, rs, shortDate, sum, within, type DashCtx } from './common';
import { withRange } from './business';

export interface AccountsData {
  kpis: KpiData[];
  flow: { mIn: number[]; mOut: number[]; balance: number[] };
  cash: { label: string; value: number; href: string }[];
  pl: { sales: number; cost: number; gross: number; expenses: number; net: number; grossPct: number; netPct: number };
  recv: { label: string; value: number; key: string }[];
  pay: { label: string; value: number; key: string }[];
  debtors: { who: string; partyId: string | null; amt: number; days: number; last: string; phone: string | null }[];
  gst: { out: number; inp: number; net: number; r1Due: string; r1Days: number; r3Due: string; r3Days: number };
  heads: { label: string; value: number }[];
  upcoming: { day: string; w: string; s: string; a: number; ic: string; href: string }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function accountsDashboard(ctx: DashCtx): Promise<AccountsData> {
  const { scope, range, prev, buckets, now, today } = ctx;
  const w = scopeWhere(scope);

  const inOf = async (r: typeof range) => db.receipt.findMany({
    where: { ...w, status: 'received', receivedAt: within(r) },
    select: { id: true, receiptNo: true, receivedAt: true, amountPaise: true, party: { select: { companyName: true, firstName: true, lastName: true } } },
  });
  const supOf = async (r: typeof range) => db.supplierPayment.findMany({
    where: { ...w, status: 'paid', paidAt: within(r) },
    select: { id: true, paymentNo: true, paidAt: true, amountPaise: true, party: { select: { companyName: true, firstName: true, lastName: true } } },
  });
  const expOf = async (r: typeof range) => db.transaction.findMany({
    where: { ...w, txnType: 'expense', status: 'approved', txnDate: within(r) },
    select: { id: true, txnNo: true, txnDate: true, amountPaise: true, description: true },
  });

  const rec = await inOf(range); const sup = await supOf(range); const exp = await expOf(range);
  const recP = prev ? await inOf(prev) : null; const supP = prev ? await supOf(prev) : null; const expP = prev ? await expOf(prev) : null;

  const mIn = intoBuckets(buckets, rec, (r) => r.receivedAt, (r) => rs(r.amountPaise));
  const outRows = [
    ...sup.map((s) => ({ at: s.paidAt, p: s.amountPaise, who: partyName(s.party), doc: s.paymentNo, href: `/purchase/payments/${s.id}` })),
    ...exp.map((e) => ({ at: e.txnDate, p: e.amountPaise, who: e.description || 'Office expense', doc: e.txnNo, href: '/transactions' })),
  ];
  const mOut = intoBuckets(buckets, outRows, (r) => r.at, (r) => -rs(r.p));
  const tIn = sum(mIn); const tOut = -sum(mOut);
  const pIn = recP ? rs(sum(recP.map((r) => r.amountPaise))) : null;
  const pOut = supP && expP ? rs(sum(supP.map((r) => r.amountPaise)) + sum(expP.map((r) => r.amountPaise))) : null;

  // Cash & bank balance line, walked forward from the opening balance through
  // every ledger line on Cash (1010) and Bank (1020) in the period.
  const opening = await ledgerBalance(scope, ['1010', '1020'], dayStart(range.from));
  const accts = await db.account.findMany({ where: { code: { in: ['1010', '1020'] } }, select: { id: true } });
  const lines = accts.length ? await db.journalLine.findMany({
    where: { accountId: { in: accts.map((a) => a.id) }, journalEntry: { ...w, entryDate: within(range) } },
    select: { debitPaise: true, creditPaise: true, journalEntry: { select: { entryDate: true } } },
  }) : [];
  const net = intoBuckets(buckets, lines, (l) => l.journalEntry.entryDate, (l) => rs(l.debitPaise - l.creditPaise));
  let run = rs((opening.get('1010') ?? 0) + (opening.get('1020') ?? 0));
  const balance = net.map((v) => (run += v));
  const nowBal = await ledgerBalance(scope, ['1010', '1020']);
  const cash = [
    { label: 'Bank (all accounts)', value: rs(nowBal.get('1020') ?? 0), href: '/bank/summary' },
    { label: 'Cash in hand', value: rs(nowBal.get('1010') ?? 0), href: '/transactions' },
  ];

  const pnl = await profitAndLoss(scope, dayStart(range.from), dayEnd(range.to));
  const pnlP = prev ? await profitAndLoss(scope, dayStart(prev.from), dayEnd(prev.to)) : null;
  const sales = rs(pnl.netRevenuePaise);
  const tab = await getAccountsTab(scope, now);

  const recvTotal = rs(sum(tab.receivableAgeing.map((b) => b.paise)));
  const recvLate = rs(sum(tab.receivableAgeing.slice(2).map((b) => b.paise)));
  const payTotal = rs(sum(tab.payableAgeing.map((b) => b.paise)));
  const dueThisWeek = await db.purchaseBill.findMany({
    where: { ...w, lifecycle: 'received', dueDate: { lt: dayEnd(addDays(today, 7)) } },
    select: { grandTotalPaise: true, amountPaidPaise: true },
  });
  const due7 = rs(sum(dueThisWeek.map((b) => Math.max(0, b.grandTotalPaise - b.amountPaidPaise))));
  const gstNet = rs(pnl.netGstPaise);

  const [, m] = today.split('-').map(Number);
  const y = Number(today.slice(0, 4));
  const dueOn = (day: number) => {
    // The return for last month is due on `day` of this month; once that has
    // passed, the next one is due on `day` of next month.
    let dm = m; let dy = y;
    if (Number(today.slice(8)) > day) { dm = m + 1; if (dm > 12) { dm = 1; dy++; } }
    const d = `${dy}-${String(dm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const days = Math.round((dayStart(d).getTime() - dayStart(today).getTime()) / 86_400_000);
    return { label: `${day} ${MONTHS[dm - 1]}`, days };
  };
  const r1 = dueOn(11); const r3 = dueOn(20);

  const kpis: KpiData[] = [
    {
      id: 'a-in', label: 'Money in', value: inrC(tIn), d: delta(tIn, pIn), spark: mIn, sub: `${num(rec.length)} receipts`, ink: 'success',
      drill: {
        title: 'Money in', value: inrC(tIn), delta: delta(tIn, pIn), ink: 'success', chart: { label: 'Money in', data: mIn },
        moved: recP ? movers(groupSum(rec, (r) => partyName(r.party), (r) => r.amountPaise), groupSum(recP, (r) => partyName(r.party), (r) => r.amountPaise)) : undefined,
        cols: [{ k: 'doc', l: 'Receipt' }, { k: 'who', l: 'Party' }, { k: 'date', l: 'Date' }, { k: 'amt', l: 'Amount', num: true }],
        rows: [...rec].sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 6).map((r) => ({ doc: r.receiptNo, _href: `/receipts/${r.id}`, who: partyName(r.party), date: shortDate(r.receivedAt), amt: inrFull(rs(r.amountPaise)) })),
        rowsTotal: rec.length, route: withRange('/receipts', range),
      },
    },
    {
      id: 'a-out', label: 'Money out', value: inrC(tOut), d: delta(tOut, pOut), goodUp: false, spark: mOut.map((v) => -v), sub: 'suppliers and expenses',
      drill: {
        title: 'Money out', value: inrC(tOut), delta: delta(tOut, pOut), goodUp: false, chart: { label: 'Money out', data: mOut.map((v) => -v) },
        cols: [{ k: 'doc', l: 'Entry' }, { k: 'who', l: 'Paid to' }, { k: 'date', l: 'Date' }, { k: 'amt', l: 'Amount', num: true }],
        rows: [...outRows].sort((a, b) => b.p - a.p).slice(0, 6).map((r) => ({ doc: r.doc, _href: r.href, who: r.who, date: shortDate(r.at), amt: inrFull(rs(r.p)) })),
        rowsTotal: outRows.length, route: '/purchase/payments',
      },
    },
    {
      id: 'a-net', label: 'Net cash flow', value: inrC(tIn - tOut), d: delta(tIn - tOut, pIn !== null && pOut !== null ? pIn - pOut : null),
      sub: tIn >= tOut ? 'more came in than went out' : 'more went out than came in', ink: tIn >= tOut ? 'success' : 'danger',
      drill: {
        title: 'Net cash flow', value: inrC(tIn - tOut), ink: tIn >= tOut ? 'success' : 'danger',
        cols: [{ k: 'doc', l: 'Line' }, { k: 'amt', l: 'Amount', num: true }],
        rows: [{ doc: 'Money in', amt: inrFull(tIn) }, { doc: 'Paid to suppliers', amt: inrFull(-rs(sum(sup.map((s) => s.amountPaise)))) }, { doc: 'Office expenses', amt: inrFull(-rs(sum(exp.map((e) => e.amountPaise)))) }],
        route: '/bank/summary',
      },
    },
    {
      id: 'a-recv', label: 'Owed to you', value: inrC(recvTotal), d: null, goodUp: false, sub: `${inrC(recvLate)} over 30 days`, subTone: 'danger', ink: 'danger',
      drill: {
        title: 'Owed to you', value: inrC(recvTotal), ink: 'danger', goodUp: false,
        cols: [{ k: 'doc', l: 'Customer' }, { k: 'd', l: 'Oldest (days)', num: true }, { k: 'amt', l: 'Owed', num: true, ink: 'danger' }],
        rows: tab.topDebtors.slice(0, 6).map((d) => ({ doc: d.name, _href: d.partyId ? `/customers/${d.partyId}` : '/customers', d: d.oldestDays, amt: inrFull(rs(d.paise)) })),
        route: '/customer/account',
      },
    },
    {
      id: 'a-pay', label: 'You owe', value: inrC(payTotal), d: null, goodUp: false, sub: `${inrC(due7)} due this week`,
      drill: {
        title: 'You owe', value: inrC(payTotal), goodUp: false,
        cols: [{ k: 'doc', l: 'Supplier' }, { k: 'amt', l: 'Owed', num: true }],
        rows: tab.topCreditors.slice(0, 6).map((c) => ({ doc: c.name, _href: `/suppliers/${c.partyId}`, amt: inrFull(rs(c.paise)) })),
        route: '/purchase/payables',
      },
    },
    {
      id: 'a-gst', label: 'GST to pay', value: inrC(gstNet), d: delta(gstNet, pnlP ? rs(pnlP.netGstPaise) : null), goodUp: false,
      sub: `GSTR-3B due ${r3.label} · ${r3.days} day${r3.days === 1 ? '' : 's'}`, subTone: 'warning',
      drill: {
        title: 'GST to pay', value: inrC(gstNet), goodUp: false,
        cols: [{ k: 'doc', l: 'Line' }, { k: 'amt', l: 'Amount', num: true }],
        rows: [{ doc: 'Output tax (on sales)', amt: inrFull(rs(pnl.outputTaxPaise)) }, { doc: 'Input tax (on purchases)', amt: inrFull(-rs(pnl.inputTaxPaise)) }, { doc: 'Net to pay', amt: inrFull(gstNet) }],
        route: '/reports/gst',
      },
    },
  ];

  const ageKeys = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];
  const recv = tab.receivableAgeing.map((b, i) => ({ label: b.label, value: rs(b.paise), key: ageKeys[i] }));
  const pa = tab.payableAgeing;
  const pay = [
    { label: pa[0].label, value: rs(pa[0].paise), key: 'current' },
    { label: pa[1].label, value: rs(pa[1].paise), key: 'd1_30' },
    { label: pa[2].label, value: rs(pa[2].paise), key: 'd31_60' },
    { label: 'Over 60 days', value: rs((pa[3]?.paise ?? 0) + (pa[4]?.paise ?? 0)), key: 'd60_plus' },
  ];

  // Who owes most, with when they last paid and a number to ring.
  const ids = tab.topDebtors.map((d) => d.partyId).filter((x): x is string => !!x);
  const lastPaid = ids.length ? await db.receipt.groupBy({ by: ['partyId'], where: { ...w, partyId: { in: ids }, status: 'received' }, _max: { receivedAt: true } }) : [];
  const lastBy = new Map(lastPaid.map((l) => [l.partyId, l._max.receivedAt]));
  const phones = ids.length ? await db.party.findMany({ where: { id: { in: ids } }, select: { id: true, phone: true } }) : [];
  const phoneBy = new Map(phones.map((p) => [p.id, p.phone]));
  const debtors = tab.topDebtors.slice(0, 7).map((d) => {
    const lp = d.partyId ? lastBy.get(d.partyId) : null;
    return { who: d.name, partyId: d.partyId, amt: rs(d.paise), days: d.oldestDays, last: lp ? `paid ${shortDate(lp)}` : 'no payment yet', phone: d.partyId ? phoneBy.get(d.partyId) ?? null : null };
  });

  // Next 14 days of money going out.
  const end14 = addDays(today, 13);
  const bills = await db.purchaseBill.findMany({
    where: { ...w, lifecycle: 'received', dueDate: { gte: dayStart(today), lt: dayEnd(end14) } },
    select: { id: true, billNo: true, supplierName: true, dueDate: true, grandTotalPaise: true, amountPaidPaise: true },
    orderBy: { dueDate: 'asc' }, take: 12,
  });
  const upcoming: AccountsData['upcoming'] = bills
    .filter((b) => b.grandTotalPaise > b.amountPaidPaise)
    .map((b) => ({ day: istDay(b.dueDate), w: b.supplierName, s: `Bill ${b.billNo}`, a: rs(b.grandTotalPaise - b.amountPaidPaise), ic: 'truck', href: `/purchase/bills/${b.id}` }));
  if (r3.days >= 0 && r3.days <= 13 && gstNet > 0) upcoming.push({ day: addDays(today, r3.days), w: 'GSTR-3B', s: 'Net GST', a: gstNet, ic: 'gst', href: '/reports/gst' });
  const lastRun = await db.payrollRun.findFirst({ where: w, orderBy: { periodEnd: 'desc' }, select: { label: true, payslips: { select: { netPaise: true } } } });
  const firstNext = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const toFirst = Math.round((dayStart(firstNext).getTime() - dayStart(today).getTime()) / 86_400_000);
  if (lastRun && toFirst <= 13) upcoming.push({ day: firstNext, w: 'Salaries', s: `as ${lastRun.label}`, a: rs(sum(lastRun.payslips.map((p) => p.netPaise))), ic: 'users', href: '/hrm/payroll' });
  upcoming.sort((a, b) => a.day.localeCompare(b.day));

  return {
    kpis,
    flow: { mIn, mOut, balance },
    cash,
    pl: {
      sales, cost: rs(pnl.cogsPaise), gross: rs(pnl.grossProfitPaise), expenses: rs(pnl.expensesPaise), net: rs(pnl.indicativeNetPaise),
      grossPct: pnl.grossMarginPct, netPct: sales ? rs(pnl.indicativeNetPaise) / sales * 100 : 0,
    },
    recv, pay, debtors,
    gst: { out: rs(pnl.outputTaxPaise), inp: rs(pnl.inputTaxPaise), net: gstNet, r1Due: r1.label, r1Days: r1.days, r3Due: r3.label, r3Days: r3.days },
    heads: pnl.expenseLines.filter((l) => l.amountPaise > 0).sort((a, b) => b.amountPaise - a.amountPaise).map((l) => ({ label: l.label, value: rs(l.amountPaise) })),
    upcoming: upcoming.slice(0, 8),
  };
}
