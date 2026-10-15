import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import {
  AVERAGE_WINDOW,
  computeMargin,
  resolveUnitCost,
  valueStock,
  type CostMethod,
  type CostResult,
  type Valuation,
} from '@/lib/costing';

/**
 * Product cost, from what we actually paid.
 *
 * The calculation itself lives in `lib/costing.ts` and is tested without a
 * database. This file is only the reading and writing around it.
 *
 * THE ONE PERFORMANCE RULE HERE
 *
 * Cost is needed for a whole page of products at once, never for one. On a
 * pooled connection at `connection_limit=1`, a per-product lookup on a
 * hundred-row list is a hundred sequential round trips and a timeout - the same
 * mistake `paidByInvoice` was written to avoid. So the public read is
 * `costsFor(scope, productIds)`, batched, and there is deliberately no
 * `costFor(oneProduct)` to reach for by accident.
 */

/** How many purchases to pull per product. Enough for the widest method. */
const HISTORY_DEPTH = AVERAGE_WINDOW;

export async function getCostMethod(scope: StoreScope): Promise<CostMethod> {
  if (scope.kind === 'all') {
    // Branches may cost differently, so there is no single honest answer for
    // All Company. The safest default, and the screens say the figure is
    // per-branch.
    return 'last_purchase';
  }
  const store = await db.store.findUnique({
    where: { id: scope.storeId },
    select: { costMethod: true },
  });
  return (store?.costMethod as CostMethod) ?? 'last_purchase';
}

export async function setCostMethod(scope: StoreScope, method: CostMethod) {
  const storeId = scopeForWrite(scope);
  await db.store.update({ where: { id: storeId }, data: { costMethod: method } });
}

/**
 * Unit cost for many products at once.
 *
 * Two queries regardless of how many products are asked about: one for the
 * purchase history, one for the standard cost that acts as the fallback.
 */
export async function costsFor(
  scope: StoreScope,
  productIds: string[],
  method?: CostMethod,
): Promise<Map<string, CostResult>> {
  const out = new Map<string, CostResult>();
  if (productIds.length === 0) return out;

  const resolved = method ?? (await getCostMethod(scope));

  const [history, prices] = await Promise.all([
    db.productPurchasePrice.findMany({
      where: { ...scopeWhere(scope), productId: { in: productIds } },
      orderBy: { purchasedAt: 'desc' },
      select: { productId: true, unitCostPaise: true, purchasedAt: true },
    }),
    db.productPrice.findMany({
      where: { productId: { in: productIds }, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
      select: { productId: true, costPaise: true },
    }),
  ]);

  const byProduct = new Map<string, { unitCostPaise: number; purchasedAt: Date }[]>();
  for (const row of history) {
    const list = byProduct.get(row.productId) ?? [];
    // Already sorted newest-first by the query; keep only what the widest
    // method needs so a product with 400 purchases does not carry 400 rows
    // through the calculation.
    if (list.length < HISTORY_DEPTH) {
      list.push({ unitCostPaise: row.unitCostPaise, purchasedAt: row.purchasedAt });
    }
    byProduct.set(row.productId, list);
  }

  const standard = new Map<string, number>();
  for (const p of prices) {
    if (!standard.has(p.productId)) standard.set(p.productId, p.costPaise);
  }

  for (const id of productIds) {
    out.set(id, resolveUnitCost(resolved, byProduct.get(id) ?? [], standard.get(id) ?? 0));
  }

  return out;
}

export interface RecordPurchaseInput {
  productId: string;
  unitCostPaise: number;
  qty: number;
  purchasedAt?: Date;
  supplierId?: string | null;
  reference?: string | null;
  note?: string | null;
}

export class CostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostError';
  }
}

/**
 * Record what a product was bought for.
 *
 * Append-only, and there is no edit or delete. The history *is* the valuation
 * basis, so changing a past row retrospectively moves a profit figure that has
 * already been reported and possibly acted on. A wrong entry is corrected by
 * recording the right one - which is the same reasoning as the stock ledger.
 *
 * `source: 'manual'` marks it as somebody's recollection rather than evidence.
 * When the Purchase module lands, a GRN will write rows here with
 * `source: 'grn'` and the two can be told apart in a valuation.
 */
export async function recordPurchasePrice(
  scope: StoreScope,
  userId: string,
  input: RecordPurchaseInput,
) {
  const storeId = scopeForWrite(scope);

  if (input.unitCostPaise <= 0) {
    throw new CostError('Enter what one unit cost, excluding tax.');
  }
  if (input.qty <= 0) {
    throw new CostError('Quantity must be at least 1.');
  }
  if (input.purchasedAt && input.purchasedAt.getTime() > Date.now() + 86_400_000) {
    throw new CostError('That date is in the future.');
  }

  const product = await db.product.findFirst({
    where: { id: input.productId, ...scopeWhere(scope) },
    select: { id: true, productName: true, productCode: true },
  });
  if (!product) throw new CostError('Product not found in this store.');

  return db.$transaction(async (tx) => {
    const row = await tx.productPurchasePrice.create({
      data: {
        storeId,
        productId: product.id,
        unitCostPaise: input.unitCostPaise,
        qty: input.qty,
        purchasedAt: input.purchasedAt ?? new Date(),
        supplierId: input.supplierId ?? null,
        reference: input.reference?.trim() || null,
        note: input.note?.trim() || null,
        source: 'manual',
        createdBy: userId,
      },
    });

    // Audit inside the same transaction, unlike most of this codebase. A cost
    // entry moves every margin and the stock valuation, so a record of it that
    // can fail independently of the write is not worth having.
    await tx.activityLog.create({
      data: {
        storeId,
        userId,
        activityType: 'Create',
        entityType: 'PurchasePrice',
        entityId: row.id,
        description:
          `Purchase price recorded for ${product.productName} (${product.productCode}): `
          + `₹${(input.unitCostPaise / 100).toFixed(2)} × ${input.qty}`,
      },
    });

    return row;
  });
}

export interface PurchaseHistoryRow {
  id: string;
  unitCostPaise: number;
  qty: number;
  purchasedAt: Date;
  reference: string | null;
  note: string | null;
  source: string;
}

/** Full history for one product, for the drawer behind the cost figure. */
export async function purchaseHistory(
  scope: StoreScope,
  productId: string,
  limit = 20,
): Promise<PurchaseHistoryRow[]> {
  return db.productPurchasePrice.findMany({
    where: { ...scopeWhere(scope), productId },
    orderBy: { purchasedAt: 'desc' },
    take: limit,
    select: {
      id: true, unitCostPaise: true, qty: true, purchasedAt: true,
      reference: true, note: true, source: true,
    },
  });
}

export interface StockValuation extends Valuation {
  method: CostMethod;
  /** Products that hold stock at all - services are excluded throughout. */
  productsCounted: number;
}

/**
 * What the stock on hand is worth.
 *
 * Services are excluded entirely: they have no stock and valuing them would
 * inflate the figure with quantities that do not exist.
 *
 * Products whose cost is unknown are **counted, not valued** - see
 * `valueStock`. A valuation that silently treats unpriced stock as worthless
 * understates the balance sheet and gives no hint it has done so.
 */
export async function stockValuation(scope: StoreScope): Promise<StockValuation> {
  const method = await getCostMethod(scope);

  const products = await db.product.findMany({
    where: { ...scopeWhere(scope), isActive: true, kind: { not: 'service' } },
    select: { id: true, balances: { select: { currentQty: true } } },
  });

  const ids = products.map((p) => p.id);
  const costs = await costsFor(scope, ids, method);

  const lines = products.map((p) => {
    const cost = costs.get(p.id);
    return {
      qty: p.balances.reduce((sum, b) => sum + b.currentQty, 0),
      unitCostPaise: cost?.unitCostPaise ?? 0,
      costKnown: (cost?.basis ?? 'none') !== 'none',
    };
  });

  return { ...valueStock(lines), method, productsCounted: products.length };
}

/**
 * Cost and margin for a set of products, ready for a grid.
 *
 * Margin is against the DLP - the dealer list price, which is what the product
 * actually transacts at. Comparing cost to MRP would flatter every line, since
 * MRP is a printed ceiling almost nothing sells at.
 */
export async function costAndMarginFor(
  scope: StoreScope,
  products: { id: string; dlpPaise: number }[],
) {
  const costs = await costsFor(scope, products.map((p) => p.id));

  return new Map(
    products.map((p) => {
      const cost = costs.get(p.id) ?? { unitCostPaise: 0, basis: 'none' as const, samples: 0 };
      return [p.id, { cost, margin: computeMargin(p.dlpPaise, cost.unitCostPaise) }];
    }),
  );
}
