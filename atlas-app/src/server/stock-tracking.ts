import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { planKindChange, planModeChange, type TrackingSubject } from '@/lib/stock-tracking';

/**
 * Setting how each product is tracked - in bulk, because nobody sets 1,325
 * products one at a time.
 *
 * The rules (a service is never stocked; nothing stops being tracked while it
 * has stock) are in lib/stock-tracking and apply identically to one product or
 * a thousand. A bulk change is applied product by product and reports each
 * refusal by name rather than failing the lot: "1,190 changed, 3 refused, here
 * is why" is a result somebody can act on; "the change failed" is not.
 */

export interface TrackingRow {
  id: string;
  productCode: string;
  productName: string;
  categoryId: string | null;
  categoryName: string | null;
  kind: string;
  trackingMode: string;
  hsnCode: string | null;
  sacCode: string | null;
  onHand: number;
  unitsOnShelf: number;
  isActive: boolean;
}

export async function listTrackingRows(scope: StoreScope): Promise<TrackingRow[]> {
  const [products, shelf] = await Promise.all([
    db.product.findMany({
      where: scopeWhere(scope),
      select: {
        id: true, productCode: true, productName: true, categoryId: true, kind: true,
        trackingMode: true, hsnCode: true, sacCode: true, isActive: true,
        category: { select: { name: true } },
        balances: { select: { currentQty: true } },
      },
      orderBy: { productName: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    db.stockUnit.groupBy({
      by: ['productId'],
      where: { ...scopeWhere(scope), status: { in: ['in_stock', 'reserved'] } },
      _count: { _all: true },
    }),
  ]);
  const units = new Map(shelf.map((s) => [s.productId, s._count._all]));

  return products.map((p) => ({
    id: p.id,
    productCode: p.productCode,
    productName: p.productName,
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? null,
    kind: p.kind,
    trackingMode: p.trackingMode,
    hsnCode: p.hsnCode,
    sacCode: p.sacCode,
    onHand: p.balances.reduce((n, b) => n + b.currentQty, 0),
    unitsOnShelf: units.get(p.id) ?? 0,
    isActive: p.isActive,
  }));
}

export type TrackingChange =
  | { type: 'mode'; to: string }
  | { type: 'kind'; to: string };

export interface TrackingChangeResult {
  changed: number;
  unchanged: number;
  refused: { productName: string; reason: string }[];
  warnings: string[];
}

export async function applyTrackingChange(
  scope: StoreScope,
  productIds: string[],
  change: TrackingChange,
): Promise<TrackingChangeResult> {
  const storeId = scopeForWrite(scope);
  if (productIds.length === 0) return { changed: 0, unchanged: 0, refused: [], warnings: [] };

  const [products, shelf] = await Promise.all([
    db.product.findMany({
      where: { storeId, id: { in: productIds } },
      select: {
        id: true, productName: true, kind: true, trackingMode: true,
        balances: { select: { currentQty: true } },
      },
    }),
    db.stockUnit.groupBy({
      by: ['productId'],
      where: { storeId, productId: { in: productIds }, status: { in: ['in_stock', 'reserved'] } },
      _count: { _all: true },
    }),
  ]);
  const units = new Map(shelf.map((s) => [s.productId, s._count._all]));

  const result: TrackingChangeResult = { changed: 0, unchanged: 0, refused: [], warnings: [] };
  const patches: { id: string; kind: string; trackingMode: string }[] = [];

  for (const p of products) {
    const subject: TrackingSubject = {
      productName: p.productName,
      kind: p.kind,
      trackingMode: p.trackingMode,
      onHand: p.balances.reduce((n, b) => n + b.currentQty, 0),
      unitsOnShelf: units.get(p.id) ?? 0,
    };
    const plan = change.type === 'mode' ? planModeChange(subject, change.to) : planKindChange(subject, change.to);
    if (!plan.ok) { result.refused.push({ productName: p.productName, reason: plan.reason }); continue; }
    if (plan.warning) result.warnings.push(plan.warning);
    if (plan.kind === p.kind && plan.trackingMode === p.trackingMode) { result.unchanged += 1; continue; }
    patches.push({ id: p.id, kind: plan.kind, trackingMode: plan.trackingMode });
  }

  // Grouped by target so a thousand-product change is a handful of statements,
  // not a thousand - the pooler here runs at connection_limit=1.
  const groups = new Map<string, string[]>();
  for (const x of patches) {
    const key = `${x.kind}|${x.trackingMode}`;
    groups.set(key, [...(groups.get(key) ?? []), x.id]);
  }
  await db.$transaction([...groups.entries()].map(([key, ids]) => {
    const [kind, trackingMode] = key.split('|');
    return db.product.updateMany({ where: { storeId, id: { in: ids } }, data: { kind, trackingMode } });
  }));

  result.changed = patches.length;
  return result;
}
