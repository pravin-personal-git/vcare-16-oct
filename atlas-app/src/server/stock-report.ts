import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { costsFor, getCostMethod } from './product-cost';
import type { CostMethod } from '@/lib/costing';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * What is on the shelf, what it is worth, and what is about to run out.
 *
 * The three questions a stock report exists to answer, in that order. Anything
 * else on the screen is decoration.
 *
 * WHY UNKNOWN COST IS COUNTED SEPARATELY RATHER THAN TREATED AS ZERO.
 *
 * A product with no purchase history and no standard cost genuinely has an
 * unknown value. Treating it as worth nothing understates the total and gives
 * no hint it has done so - the figure just quietly reads low, and somebody
 * plans against it. So those rows are valued at zero AND counted, and the
 * screen says how many there are.
 */

export interface StockRow {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  qty: number;
  unitCostPaise: number;
  /** qty × unit cost. Zero when the cost is unknown. */
  valuePaise: number;
  costKnown: boolean;
  /** Negative stock always means a data error - see below. */
  negative: boolean;
  categoryName: string | null;
  subCategoryName: string | null;
  brandName: string | null;
  /**
   * The product's own barcode and SKU (4 Oct 2026). The search box has said
   * "Product, code or barcode" since the 4 Oct review, but these were never
   * read, so typing a barcode found nothing.
   */
  barcode: string | null;
  sku: string | null;
  /** serial | batch | quantity | none - how this product is counted. */
  trackingMode: string;
  /**
   * Serial-tracked products only: how many units are on the shelf, and the
   * first few of their numbers.
   *
   * A CCTV business asks "where is barcode FW8318016" far more often than it
   * asks anything else of this screen, and until 4 Oct 2026 the page could not
   * answer it at all. `serialSample` feeds the row and the page search; the
   * full list lives on the product.
   */
  serialCount: number;
  serialSample: string[];
  /** Every serial on the shelf, for the search. The sample alone missed the 13th. */
  serials: string[];
  /** Zero means nobody has set one, so no reorder alert is possible. */
  reorderLevel: number;
  /** At or below the reorder level, with a level actually set. */
  needsReorder: boolean;
}

export interface StockReport {
  method: CostMethod;
  rows: StockRow[];
  totalValuePaise: number;
  productsHeld: number;
  /** Rows with stock but no cost. Their value is missing from the total. */
  unpricedCount: number;
  unpricedQty: number;
  /** Rows below zero. Always a mistake, never a legitimate state. */
  negativeCount: number;
  outOfStockCount: number;
  /** At or below their reorder level. The list somebody acts on today. */
  reorderCount: number;
  /** Products with no reorder level set - no alert is possible for these. */
  noReorderLevelCount: number;
}

export async function stockReport(scope: StoreScope): Promise<StockReport> {
  const method = await getCostMethod(scope);

  const products = await db.product.findMany({
    where: {
      ...scopeWhere(scope),
      isActive: true,
      // Services hold nothing. Including them would pad the report with rows
      // whose quantity is meaningless and whose value is always zero.
      kind: { not: 'service' },
    },
    select: {
      id: true, productCode: true, productName: true, unit: true, trackingMode: true, barcode: true, sku: true,
      balances: { select: { currentQty: true, reorderLevel: true } },
      category: { select: { name: true } },
      subCategory: { select: { name: true } },
      brand: { select: { name: true } },
    },
    orderBy: { productName: 'asc' },
    take: LIST_MAX_ROWS,
  });

  const costs = await costsFor(scope, products.map((p) => p.id), method);

  // Serials for the products that actually carry them. One query for the lot,
  // not one per row: Vcare hold 2,775 units across 1,325 products.
  const serialRows = await db.stockUnit.findMany({
    where: { ...scopeWhere(scope), deletedAt: null, status: 'in_stock', serialNo: { not: null } },
    select: { productId: true, serialNo: true },
    orderBy: { receivedAt: 'asc' },
  });
  const serials = new Map<string, string[]>();
  for (const u of serialRows) {
    if (!u.serialNo) continue;
    const list = serials.get(u.productId);
    if (list) list.push(u.serialNo);
    else serials.set(u.productId, [u.serialNo]);
  }

  const rows: StockRow[] = products.map((p) => {
    // Summed across warehouses. Most tenants never split by warehouse, and one
    // that does still wants a single "how many do I own" figure here.
    const qty = p.balances.reduce((n, b) => n + b.currentQty, 0);
    const cost = costs.get(p.id);
    const costKnown = (cost?.basis ?? 'none') !== 'none';
    const unitCostPaise = cost?.unitCostPaise ?? 0;

    // The HIGHEST reorder level across warehouses, not the sum. Levels are a
    // threshold per location; adding them together would produce a number that
    // means nothing and would fire alerts far too early.
    const reorderLevel = p.balances.reduce((n, b) => Math.max(n, b.reorderLevel), 0);

    return {
      productId: p.id,
      productCode: p.productCode,
      productName: p.productName,
      unit: p.unit,
      qty,
      unitCostPaise,
      // A negative quantity multiplied by a cost produces a negative value,
      // which would silently reduce the total. Clamped, and flagged instead.
      valuePaise: costKnown && qty > 0 ? qty * unitCostPaise : 0,
      costKnown,
      negative: qty < 0,
      categoryName: p.category?.name ?? null,
      subCategoryName: p.subCategory?.name ?? null,
      brandName: p.brand?.name ?? null,
      barcode: p.barcode,
      sku: p.sku,
      trackingMode: p.trackingMode,
      serialCount: serials.get(p.id)?.length ?? 0,
      // Enough to recognise a unit in the row and to search by; the product's
      // own page lists every one.
      serialSample: (serials.get(p.id) ?? []).slice(0, 12),
      serials: serials.get(p.id) ?? [],
      reorderLevel,
      // A level of zero means nobody set one - not "reorder when you hit zero".
      // Alerting on those would flag every out-of-stock product every day and
      // train people to ignore the whole column.
      needsReorder: reorderLevel > 0 && qty <= reorderLevel,
    };
  });

  const held = rows.filter((r) => r.qty > 0);
  const unpriced = held.filter((r) => !r.costKnown);

  return {
    method,
    rows,
    totalValuePaise: rows.reduce((n, r) => n + r.valuePaise, 0),
    productsHeld: held.length,
    unpricedCount: unpriced.length,
    unpricedQty: unpriced.reduce((n, r) => n + r.qty, 0),
    negativeCount: rows.filter((r) => r.negative).length,
    outOfStockCount: rows.filter((r) => r.qty === 0).length,
    reorderCount: rows.filter((r) => r.needsReorder).length,
    noReorderLevelCount: rows.filter((r) => r.reorderLevel === 0).length,
  };
}
