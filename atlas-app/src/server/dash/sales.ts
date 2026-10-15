import 'server-only';
import { db } from '../db';
import { scopeWhere, userInScope } from '../store-scope';
import { withReach } from '../sales-reach';
import { stageNamer } from '../order-stages';
import { listIncentives } from '../incentives';
import { countsAsRevenue } from '@/lib/revenue';
import { isExpired, type QuotationStatus } from '@/lib/quotation-totals';
import { dayEnd, dayStart, istDow, istHour, intoBuckets } from '@/lib/dash/period';
import { inrC, inrFull, num, pct } from '@/lib/dash/format';
import type { KpiData } from '@/lib/dash/types';
import { delta, groupSum, movers, proratedTarget, rs, shortDate, sum, within, daysSince, type DashCtx } from './common';
import { withRange } from './business';

export interface SalesData {
  kpis: KpiData[];
  funnel: { label: string; count: number; value: number; href: string; rows: { doc: string; who: string; st: string; _href: string }[] }[];
  pace: { daily: number[]; cum: number[]; target: number[] | null; total: number; targetTotal: number | null };
  people: { id: string; n: string; t: number; a: number; o: number; c: number | null; inc: number; rows: { doc: string; who: string; amt: string; _href: string }[] }[];
  sources: { label: string; value: number }[];
  leads: number;
  chase: { id: string; doc: string; who: string; by: string; age: string; amt: number; phone: string | null }[];
  chaseTotal: number;
  heat: number[][];
  heatBusiest: string | null;
}

const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

export async function salesDashboard(ctx: DashCtx): Promise<SalesData> {
  const { scope, range, prev, buckets, now } = ctx;
  const w = scopeWhere(scope);

  // Whose documents count here (B4 step 3) - a salesperson set to "only mine"
  // sees their own pipeline, not the branch's.
  const quotesOf = (r: typeof range) => db.quotation.findMany({
    where: withReach({ ...w, quotationDate: within(r) }, ctx.sales ?? null),
    select: { id: true, quotationNo: true, status: true, validUntil: true, grandTotalPaise: true, customerName: true, salespersonId: true, sentAt: true, convertedAt: true },
  });
  const ordersOf = (r: typeof range) => db.salesOrder.findMany({
    where: withReach({ ...w, orderDate: within(r) }, ctx.sales ?? null),
    select: { id: true, orderNo: true, orderDate: true, createdAt: true, grandTotalPaise: true, customerName: true, salespersonId: true, fulfilmentStatus: true },
  });
  const invOf = (r: typeof range) => db.invoice.findMany({
    where: withReach({ ...w, lifecycle: 'sent', invoiceDate: within(r) }, ctx.sales ?? null),
    select: { id: true, invoiceNo: true, invoiceDate: true, grandTotalPaise: true, amountPaidPaise: true, customerName: true },
  });

  const quotes = await quotesOf(range); const quotesP = prev ? await quotesOf(prev) : null;
  const ordersAll = await ordersOf(range); const ordersPAll = prev ? await ordersOf(prev) : null;
  const orders = ordersAll.filter((o) => countsAsRevenue(o.fulfilmentStatus));
  const ordersP = ordersPAll?.filter((o) => countsAsRevenue(o.fulfilmentStatus)) ?? null;
  const inv = await invOf(range); const invP = prev ? await invOf(prev) : null;

  const qStatus = (q: { status: string; validUntil: Date }) => (isExpired(q.validUntil, q.status as QuotationStatus, now) ? 'expired' : q.status);
  const sent = quotes.filter((q) => qStatus(q) !== 'draft');
  const sentP = quotesP?.filter((q) => qStatus(q) !== 'draft') ?? null;
  const converted = quotes.filter((q) => q.status === 'converted');
  const convertedP = quotesP?.filter((q) => q.status === 'converted') ?? null;
  const conv = sent.length ? converted.length / sent.length : null;
  const convP = sentP && sentP.length ? convertedP!.length / sentP.length : null;

  const oVal = rs(sum(orders.map((o) => o.grandTotalPaise)));
  const oValP = ordersP ? rs(sum(ordersP.map((o) => o.grandTotalPaise))) : null;
  const tSales = rs(sum(inv.map((i) => i.grandTotalPaise)));
  const tSalesP = invP ? rs(sum(invP.map((i) => i.grandTotalPaise))) : null;
  const avg = orders.length ? oVal / orders.length : 0;
  const avgP = ordersP && ordersP.length ? oValP! / ordersP.length : null;

  // Open quotations, as of today, not just this period.
  const openQ = await db.quotation.findMany({
    where: withReach({ ...w, closedAt: null, status: { in: ['draft', 'sent'] } }, ctx.sales ?? null),
    select: { id: true, quotationNo: true, status: true, validUntil: true, grandTotalPaise: true, customerName: true, phone: true, salespersonId: true, sentAt: true, quotationDate: true },
  });
  const live = openQ.filter((q) => qStatus(q) !== 'expired');
  const waiting = live.filter((q) => q.status === 'sent');

  const users = await db.user.findMany({ where: userInScope(scope), select: { id: true, fullName: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.fullName]));

  const qB = intoBuckets(buckets, sent, (q) => q.sentAt ?? null, () => 1);
  const oB = intoBuckets(buckets, orders, (o) => o.orderDate, (o) => rs(o.grandTotalPaise));
  const iB = intoBuckets(buckets, inv, (i) => i.invoiceDate, (i) => rs(i.grandTotalPaise));
  const docRow = (o: typeof orders[number]) => ({ doc: o.orderNo, _href: `/sales/orders/${o.id}`, who: o.customerName, by: o.salespersonId ? nameOf.get(o.salespersonId) ?? '—' : '—', amt: inrFull(rs(o.grandTotalPaise)) });
  const cols = [{ k: 'doc', l: 'Document' }, { k: 'who', l: 'Customer' }, { k: 'by', l: 'Salesperson' }, { k: 'amt', l: 'Value', num: true }];

  const kpis: KpiData[] = [
    {
      id: 's-q', label: 'Quotations sent', value: num(sent.length), d: delta(sent.length, sentP?.length ?? null), spark: qB, sub: `${inrC(rs(sum(sent.map((q) => q.grandTotalPaise))))} quoted`,
      drill: {
        title: 'Quotations sent', value: num(sent.length), delta: delta(sent.length, sentP?.length ?? null), chart: { label: 'Quotations', data: qB, type: 'bar', fmt: 'num' },
        cols, rows: [...sent].sort((a, b) => b.grandTotalPaise - a.grandTotalPaise).slice(0, 6).map((q) => ({ doc: q.quotationNo, _href: `/quotation/${q.id}`, who: q.customerName, by: q.salespersonId ? nameOf.get(q.salespersonId) ?? '—' : '—', amt: inrFull(rs(q.grandTotalPaise)) })),
        rowsTotal: sent.length, route: withRange('/quotation', range, { view: 'all' }),
      },
    },
    {
      id: 's-o', label: 'Orders booked', value: inrC(oVal), d: delta(oVal, oValP), spark: oB, sub: `${num(orders.length)} orders`,
      drill: {
        title: 'Orders booked', value: inrC(oVal), delta: delta(oVal, oValP), chart: { label: 'Orders', data: oB, type: 'bar' },
        moved: ordersP ? movers(groupSum(orders, (o) => o.customerName, (o) => o.grandTotalPaise), groupSum(ordersP, (o) => o.customerName, (o) => o.grandTotalPaise)) : undefined,
        cols, rows: [...orders].sort((a, b) => b.grandTotalPaise - a.grandTotalPaise).slice(0, 6).map(docRow), rowsTotal: orders.length, route: withRange('/sales/orders', range, { view: 'all' }),
      },
    },
    {
      id: 's-i', label: 'Invoiced', value: inrC(tSales), d: delta(tSales, tSalesP), spark: iB, sub: `${num(inv.length)} invoices`,
      drill: {
        title: 'Invoiced', value: inrC(tSales), delta: delta(tSales, tSalesP), chart: { label: 'Invoiced', data: iB, type: 'bar' },
        moved: invP ? movers(groupSum(inv, (i) => i.customerName, (i) => i.grandTotalPaise), groupSum(invP, (i) => i.customerName, (i) => i.grandTotalPaise)) : undefined,
        cols: [{ k: 'doc', l: 'Invoice' }, { k: 'who', l: 'Customer' }, { k: 'date', l: 'Date' }, { k: 'amt', l: 'Value', num: true }],
        rows: [...inv].sort((a, b) => b.grandTotalPaise - a.grandTotalPaise).slice(0, 6).map((i) => ({ doc: i.invoiceNo, _href: `/invoices/${i.id}`, who: i.customerName, date: shortDate(i.invoiceDate), amt: inrFull(rs(i.grandTotalPaise)) })),
        rowsTotal: inv.length, route: withRange('/invoices', range, { view: 'all' }),
      },
    },
    {
      id: 's-c', label: 'Quote → order', value: conv === null ? '—' : pct(conv, 0), d: conv === null ? null : delta(conv, convP), sub: `${num(converted.length)} of ${num(sent.length)} quotations`,
      drill: {
        title: 'Quote → order', value: conv === null ? '—' : pct(conv, 0),
        cols, rows: converted.slice(0, 6).map((q) => ({ doc: q.quotationNo, _href: `/quotation/${q.id}`, who: q.customerName, by: q.salespersonId ? nameOf.get(q.salespersonId) ?? '—' : '—', amt: inrFull(rs(q.grandTotalPaise)) })),
        rowsTitle: 'Converted in this period', route: '/quotation?card=converted',
      },
    },
    {
      id: 's-a', label: 'Average order', value: inrC(avg), d: delta(avg, avgP), sub: 'per sales order',
      drill: { title: 'Average order', value: inrC(avg), cols, rows: [...orders].sort((a, b) => b.grandTotalPaise - a.grandTotalPaise).slice(0, 6).map(docRow), rowsTitle: 'Biggest orders', route: withRange('/sales/orders', range, { view: 'all' }) },
    },
    {
      id: 's-open', label: 'Open quotations', value: inrC(rs(sum(live.map((q) => q.grandTotalPaise)))), d: null, sub: `${num(waiting.length)} waiting on the customer`, subTone: 'warning',
      drill: {
        title: 'Open quotations', value: inrC(rs(sum(live.map((q) => q.grandTotalPaise)))),
        cols, rows: [...live].sort((a, b) => b.grandTotalPaise - a.grandTotalPaise).slice(0, 6).map((q) => ({ doc: q.quotationNo, _href: `/quotation/${q.id}`, who: q.customerName, by: q.salespersonId ? nameOf.get(q.salespersonId) ?? '—' : '—', amt: inrFull(rs(q.grandTotalPaise)) })),
        rowsTotal: live.length, route: '/quotation?card=sent',
      },
    },
  ];

  // ---- funnel -----------------------------------------------------------------
  const leads = await db.lead.findMany({
    where: { ...w, createdAt: within(range) },
    select: { id: true, leadCode: true, firstName: true, lastName: true, businessName: true, potentialPaise: true, createdAt: true, source: { select: { name: true } } },
  });
  const paid = inv.filter((i) => i.amountPaidPaise >= i.grandTotalPaise && i.grandTotalPaise > 0);
  // The business's own stage names (G3, 11 Oct 2026).
  const orderStage = await stageNamer(scope);
  const funnel: SalesData['funnel'] = [
    { label: 'Leads', count: leads.length, value: rs(sum(leads.map((l) => l.potentialPaise))), href: '/crm/leads', rows: leads.slice(0, 5).map((l) => ({ doc: l.leadCode, _href: `/crm/leads?open=${l.id}`, who: l.businessName || [l.firstName, l.lastName].filter(Boolean).join(' '), st: `${daysSince(l.createdAt, now)} days` })) },
    { label: 'Quoted', count: sent.length, value: rs(sum(sent.map((q) => q.grandTotalPaise))), href: '/quotation?card=sent', rows: sent.filter((q) => q.status === 'sent').slice(0, 5).map((q) => ({ doc: q.quotationNo, _href: `/quotation/${q.id}`, who: q.customerName, st: q.sentAt ? `${daysSince(q.sentAt, now)} days` : '—' })) },
    { label: 'Ordered', count: orders.length, value: oVal, href: '/sales/orders', rows: orders.slice(0, 5).map((o) => ({ doc: o.orderNo, _href: `/sales/orders/${o.id}`, who: o.customerName, st: orderStage(o.fulfilmentStatus) })) },
    { label: 'Invoiced', count: inv.length, value: tSales, href: '/invoices', rows: inv.filter((i) => i.amountPaidPaise < i.grandTotalPaise).slice(0, 5).map((i) => ({ doc: i.invoiceNo, _href: `/invoices/${i.id}`, who: i.customerName, st: `${daysSince(i.invoiceDate, now)} days` })) },
    { label: 'Paid', count: paid.length, value: rs(sum(inv.map((i) => Math.min(i.amountPaidPaise, i.grandTotalPaise)))), href: '/invoices?card=all', rows: paid.slice(0, 5).map((i) => ({ doc: i.invoiceNo, _href: `/invoices/${i.id}`, who: i.customerName, st: 'paid' })) },
  ];

  // ---- pace against target ---------------------------------------------------
  const targets = await db.userTarget.findMany({
    where: { ...w, periodStart: { lte: dayEnd(range.to) }, periodEnd: { gte: dayStart(range.from) } },
    select: { userId: true, periodStart: true, periodEnd: true, targetPaise: true },
  });
  const targetTotal = targets.length ? rs(proratedTarget(targets, range)) : null;
  const cum: number[] = []; oB.reduce((a, v, i) => (cum[i] = a + v), 0);
  const tline = targetTotal === null ? null : buckets.map((_, i) => targetTotal * (i + 1) / buckets.length);

  // ---- salespeople ------------------------------------------------------------
  const incentives = await listIncentives(scope).catch(() => null);
  const ids = new Set<string>([...targets.map((t) => t.userId), ...orders.map((o) => o.salespersonId).filter((x): x is string => !!x)]);
  const people = [...ids].map((id) => {
    const mine = orders.filter((o) => o.salespersonId === id);
    const myQ = sent.filter((q) => q.salespersonId === id);
    const myConv = myQ.filter((q) => q.status === 'converted').length;
    const inc = incentives?.rows.filter((r) => r.salespersonId === id && r.quotationDate >= dayStart(range.from) && r.quotationDate < dayEnd(range.to)) ?? [];
    return {
      id, n: nameOf.get(id) ?? 'Unknown',
      t: rs(proratedTarget(targets.filter((t) => t.userId === id), range)),
      a: rs(sum(mine.map((o) => o.grandTotalPaise))),
      o: mine.length, c: myQ.length ? myConv / myQ.length : null,
      inc: rs(sum(inc.map((r) => r.incentivePaise))),
      rows: [...mine].sort((a, b) => b.grandTotalPaise - a.grandTotalPaise).slice(0, 5).map((o) => ({ doc: o.orderNo, _href: `/sales/orders/${o.id}`, who: o.customerName, amt: inrFull(rs(o.grandTotalPaise)) })),
    };
  }).sort((a, b) => (b.t ? b.a / b.t : 0) - (a.t ? a.a / a.t : 0) || b.a - a.a);

  // ---- lead sources -------------------------------------------------------------
  const bySource = groupSum(leads, (l) => l.source?.name ?? 'No source', () => 1);
  const sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));

  // ---- quotations to chase ---------------------------------------------------------
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const chaseAll = waiting.filter((q) => (q.sentAt ?? q.quotationDate).getTime() < weekAgo)
    .sort((a, b) => (a.sentAt ?? a.quotationDate).getTime() - (b.sentAt ?? b.quotationDate).getTime());
  const chase = chaseAll.slice(0, 6).map((q) => ({
    id: q.id, doc: q.quotationNo, who: q.customerName, by: q.salespersonId ? nameOf.get(q.salespersonId) ?? '—' : '—',
    age: `${daysSince(q.sentAt ?? q.quotationDate, now)} days`, amt: rs(q.grandTotalPaise), phone: q.phone || null,
  }));

  // ---- when orders come in -----------------------------------------------------------
  const heat = [1, 2, 3, 4, 5, 6, 0].map(() => HOURS.map(() => 0));
  for (const o of ordersAll) {
    const dow = istDow(o.createdAt); const h = istHour(o.createdAt);
    const r = (dow + 6) % 7; const c = HOURS.indexOf(Math.min(19, Math.max(10, h)));
    heat[r][c] += 1;
  }
  let best: [number, number, number] | null = null;
  heat.forEach((row, r) => row.forEach((v, c) => { if (v > 0 && (!best || v > best[2])) best = [r, c, v]; }));
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const b = best as [number, number, number] | null;
  const heatBusiest = b ? `${DAYS[b[0]]} ${HOURS[b[1]] > 12 ? HOURS[b[1]] - 12 : HOURS[b[1]]} ${HOURS[b[1]] >= 12 ? 'pm' : 'am'}` : null;

  return {
    kpis, funnel,
    pace: { daily: oB, cum, target: tline, total: cum[cum.length - 1] ?? 0, targetTotal },
    people, sources, leads: leads.length, chase, chaseTotal: chaseAll.length, heat, heatBusiest,
  };
}
