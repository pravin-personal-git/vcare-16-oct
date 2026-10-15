import 'server-only';
import { db } from '../db';
import { scopeWhere } from '../store-scope';
import { stockReport } from '../stock-report';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { listVans } from '../van-stock';
import { addDays, dayStart, daysBetween, intoBuckets } from '@/lib/dash/period';
import { inrC, inrFull, num } from '@/lib/dash/format';
import type { KpiData } from '@/lib/dash/types';
import { rs, sum, within, daysSince, type DashCtx } from './common';

/** Movements that are stock leaving the business - sold or used up. */
const OUT = ['dispatch', 'counter_sale', 'job_issue', 'repair_replacement', 'production_consume', 'return_out', 'van_shortfall'];
/** Movements that are stock arriving. */
const IN = ['receipt', 'return_in', 'production_output', 'rma_return'];

export interface StockData {
  kpis: KpiData[];
  flow: { inward: number[]; outward: number[]; value: number[] };
  cats: { label: string; value: number }[];
  total: number;
  reorder: { id: string; p: string; have: number; lvl: number; sold: number; sup: string; supId: string | null }[];
  ageing: { label: string; value: number; key: string }[];
  fast: { label: string; value: number; id: string }[];
  units: { van: number; repair: number; supplier: number; reserved: number };
  method: string;
}

export async function stockDashboard(ctx: DashCtx): Promise<StockData> {
  const { scope, range, buckets, now, today } = ctx;
  const w = scopeWhere(scope);
  const report = await stockReport(scope);
  const costOf = new Map(report.rows.map((r) => [r.productId, r.unitCostPaise]));
  const nameOf = new Map(report.rows.map((r) => [r.productId, r.productName]));
  const val = rs(report.totalValuePaise);

  // ---- in / out / value over the period --------------------------------------
  const moves = await db.stockMovement.findMany({
    where: { ...w, createdAt: within(range), reason: { in: [...IN, ...OUT] } },
    select: { productId: true, qty: true, reason: true, createdAt: true },
  });
  const v = (m: typeof moves[number]) => rs(Math.abs(m.qty) * (costOf.get(m.productId) ?? 0));
  const inward = intoBuckets(buckets, moves.filter((m) => m.qty > 0), (m) => m.createdAt, v);
  const outward = intoBuckets(buckets, moves.filter((m) => m.qty < 0), (m) => m.createdAt, v);
  // Walk back from today's value: each bucket ends at the value after it.
  const after = await db.stockMovement.findMany({
    where: { ...w, createdAt: { gte: dayStart(addDays(range.to, 1)) }, reason: { in: [...IN, ...OUT, 'adjustment'] } },
    select: { productId: true, qty: true },
  });
  let run = val - sum(after.map((m) => rs(m.qty * (costOf.get(m.productId) ?? 0))));
  const value: number[] = new Array(buckets.length).fill(0);
  for (let i = buckets.length - 1; i >= 0; i--) { value[i] = Math.max(0, run); run = run - inward[i] + outward[i]; }

  // ---- the tiles -------------------------------------------------------------
  const low = report.rows.filter((r) => r.needsReorder && r.qty > 0);
  const out = report.rows.filter((r) => r.qty <= 0 && r.reorderLevel > 0);
  const balances = await db.productBalance.findMany({
    where: { product: { ...w, isActive: true }, currentQty: { gt: 0 } },
    select: { productId: true, lastSoldAt: true },
  });
  const cutoff = now.getTime() - 90 * 86_400_000;
  const lastSold = new Map<string, Date | null>();
  for (const b of balances) {
    const cur = lastSold.get(b.productId);
    if (cur === undefined || (b.lastSoldAt && (!cur || b.lastSoldAt > cur))) lastSold.set(b.productId, b.lastSoldAt);
  }
  const dead = report.rows.filter((r) => r.qty > 0 && lastSold.has(r.productId) && (!lastSold.get(r.productId) || lastSold.get(r.productId)!.getTime() < cutoff));
  const deadVal = rs(sum(dead.map((r) => r.valuePaise)));
  const days = daysBetween(range.from, range.to);
  const perDay = sum(outward) / days;
  const cover = perDay > 0 ? Math.round(val / perDay) : null;

  const unitCounts = await db.stockUnit.groupBy({ by: ['status'], where: { ...w, status: { in: ['in_repair', 'with_supplier', 'reserved'] } }, _count: { _all: true } });
  const uc = new Map(unitCounts.map((u) => [u.status, u._count._all]));
  const vans = await listVans(scope).catch(() => []);
  const units = { van: sum(vans.map((x) => Math.max(0, x.itemCount))), repair: uc.get('in_repair') ?? 0, supplier: uc.get('with_supplier') ?? 0, reserved: uc.get('reserved') ?? 0 };

  const prodCols = [{ k: 'p', l: 'Product' }, { k: 'q', l: 'Qty', num: true }, { k: 'v', l: 'Value', num: true }];
  const prodRow = (r: typeof report.rows[number]) => ({ p: r.productName, _href: `/product-journey?product=${r.productId}`, q: num(r.qty), v: inrFull(rs(r.valuePaise)) });

  const kpis: KpiData[] = [
    {
      id: 'k-val', label: 'Stock value', value: inrC(val), d: value[0] ? (val - value[0]) / Math.abs(value[0]) : null, spark: value, sparkTone: 'brand', sub: `at ${report.method.replace(/_/g, ' ')} cost`,
      drill: { title: 'Stock value', value: inrC(val), chart: { label: 'Value on hand', data: value, type: 'area' }, cols: prodCols, rows: [...report.rows].sort((a, b) => b.valuePaise - a.valuePaise).slice(0, 6).map(prodRow), rowsTitle: 'Most money sitting', route: '/reports/product-stock' },
    },
    {
      id: 'k-low', label: 'Running low', value: num(low.length), d: null, goodUp: false, sub: 'below re-order level', subTone: 'warning',
      drill: { title: 'Running low', value: num(low.length), goodUp: false, cols: [{ k: 'p', l: 'Product' }, { k: 'q', l: 'In stock', num: true }, { k: 'v', l: 'Re-order at', num: true }], rows: low.slice(0, 8).map((r) => ({ p: r.productName, _href: `/product-journey?product=${r.productId}`, q: num(r.qty), v: num(r.reorderLevel) })), route: '/reports/product-stock', actions: low.length ? [{ label: 'Make PO for all', icon: 'cart', act: 'make-po', payload: low.map((r) => r.productId) }] : [] },
    },
    {
      id: 'k-out', label: 'Out of stock', value: num(out.length), d: null, goodUp: false, sub: 'with a re-order level set', subTone: 'danger',
      drill: { title: 'Out of stock', value: num(out.length), goodUp: false, cols: prodCols, rows: out.slice(0, 8).map(prodRow), route: '/reports/product-stock', actions: out.length ? [{ label: 'Make PO for all', icon: 'cart', act: 'make-po', payload: out.map((r) => r.productId) }] : [] },
    },
    {
      id: 'k-dead', label: 'Not moving', value: inrC(deadVal), d: null, goodUp: false, sub: `${num(dead.length)} items · no sale in 90 days`,
      drill: { title: 'Not moving', value: inrC(deadVal), goodUp: false, cols: prodCols, rows: [...dead].sort((a, b) => b.valuePaise - a.valuePaise).slice(0, 8).map(prodRow), route: '/goods-dispatch/dead-stock', actions: [{ label: 'Make a clearance offer', icon: 'tag', href: '/catalogue' }] },
    },
    {
      id: 'k-cover', label: 'Days of cover', value: cover === null ? '—' : `${num(cover)} d`, d: null, sub: 'at the current selling speed',
      drill: { title: 'Days of cover', value: cover === null ? '—' : `${num(cover)} days`, note: `Stock value ${inrC(val)} ÷ stock used per day in this period (${inrC(perDay)}).`, route: '/reports/stock-health' },
    },
    {
      id: 'k-serial', label: 'Serial units out', value: num(units.van + units.repair + units.supplier), d: null, sub: 'with technicians, in repair, at suppliers',
      drill: { title: 'Serial units out', cols: [{ k: 'p', l: 'Where' }, { k: 'q', l: 'Units', num: true }], rows: [{ p: 'With technicians (van stock)', _href: '/van-stock', q: num(units.van) }, { p: 'In repair (customer’s)', _href: '/stock-units', q: num(units.repair) }, { p: 'At suppliers (RMA)', _href: '/services/dispatch', q: num(units.supplier) }], route: '/stock-units' },
    },
  ];

  // ---- categories --------------------------------------------------------------
  const byCat = new Map<string, number>();
  for (const r of report.rows) if (r.valuePaise > 0) byCat.set(r.categoryName ?? 'Uncategorised', (byCat.get(r.categoryName ?? 'Uncategorised') ?? 0) + r.valuePaise);
  const catsAll = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const cats = catsAll.slice(0, 6).map(([label, p]) => ({ label, value: rs(p) }));
  if (catsAll.length > 6) cats.push({ label: 'Other', value: rs(sum(catsAll.slice(6).map((c) => c[1]))) });

  // ---- re-order list -------------------------------------------------------------
  const need = report.rows.filter((r) => r.needsReorder).slice(0, 10);
  const since30 = dayStart(addDays(today, -29));
  const sold30 = need.length ? await db.stockMovement.groupBy({ by: ['productId'], where: { ...w, productId: { in: need.map((r) => r.productId) }, reason: { in: OUT }, createdAt: { gte: since30 } }, _sum: { qty: true } }) : [];
  const soldBy = new Map(sold30.map((s) => [s.productId, Math.abs(s._sum.qty ?? 0)]));
  const lastBills = need.length ? await db.purchaseBillItem.findMany({
    where: { productId: { in: need.map((r) => r.productId) }, bill: { ...w, lifecycle: 'received' } },
    orderBy: { bill: { billDate: 'desc' } },
    select: { productId: true, bill: { select: { supplierName: true, partyId: true } } },
    take: LIST_MAX_ROWS,
  }) : [];
  const supBy = new Map<string, { name: string; id: string }>();
  for (const b of lastBills) if (b.productId && !supBy.has(b.productId)) supBy.set(b.productId, { name: b.bill.supplierName, id: b.bill.partyId });
  const reorder = need.map((r) => ({ id: r.productId, p: r.productName, have: r.qty, lvl: r.reorderLevel, sold: soldBy.get(r.productId) ?? 0, sup: supBy.get(r.productId)?.name ?? '—', supId: supBy.get(r.productId)?.id ?? null }));

  // ---- how old the stock is (first in, first out) ----------------------------------
  const inStock = report.rows.filter((r) => r.qty > 0);
  const receipts = inStock.length ? await db.stockMovement.findMany({
    where: { ...w, productId: { in: inStock.map((r) => r.productId) }, qty: { gt: 0 }, reason: { in: ['receipt', 'opening', 'production_output', 'migration_opening'] } },
    orderBy: { createdAt: 'desc' }, select: { productId: true, qty: true, createdAt: true },
  }) : [];
  const recBy = new Map<string, { qty: number; at: Date }[]>();
  for (const m of receipts) { const a = recBy.get(m.productId) ?? []; a.push({ qty: m.qty, at: m.createdAt }); recBy.set(m.productId, a); }
  const bands = [0, 0, 0, 0];
  const band = (dd: number) => (dd <= 30 ? 0 : dd <= 90 ? 1 : dd <= 180 ? 2 : 3);
  for (const r of inStock) {
    let left = r.qty; const unit = rs(r.unitCostPaise);
    for (const lot of recBy.get(r.productId) ?? []) {
      if (left <= 0) break;
      const take = Math.min(left, lot.qty); left -= take;
      bands[band(daysSince(lot.at, now))] += take * unit;
    }
    if (left > 0) bands[3] += left * unit;
  }
  const ageing = [['0–30 days', 'a'], ['31–90 days', 'b'], ['91–180 days', 'c'], ['Over 180 days', 'd']].map(([label, key], i) => ({ label, key, value: Math.round(bands[i]) }));

  // ---- fast movers -------------------------------------------------------------------
  const outBy = new Map<string, { q: number; name: string }>();
  for (const m of moves) if (m.qty < 0 && ['dispatch', 'counter_sale', 'job_issue'].includes(m.reason)) {
    const c = outBy.get(m.productId) ?? { q: 0, name: nameOf.get(m.productId) ?? 'Product' }; c.q += -m.qty; outBy.set(m.productId, c);
  }
  const fast = [...outBy.entries()].sort((a, b) => b[1].q - a[1].q).slice(0, 4).map(([id, c]) => ({ id, label: c.name, value: c.q }));

  return { kpis, flow: { inward, outward, value }, cats, total: val, reorder, ageing, fast, units, method: report.method };
}
