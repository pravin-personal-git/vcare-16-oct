import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { expiryVerdict, warnDaysFor, type ExpiryBand } from '@/lib/expiry-policy';

/**
 * THE TWO CHECKS NOBODY WAS RUNNING (2 Oct 2026).
 *
 * ## 1. The two stock ledgers, compared
 *
 * Atlas keeps stock twice, and until now never compared the answers.
 *
 *   Ledger A - QUANTITY. `StockMovement` + `ProductBalance`. Answers "how
 *   many". Every path writes to it: receipts, invoices, orders, returns,
 *   manufacturing, adjustments. It is reliable.
 *
 *   Ledger B - IDENTITY. `StockUnit` + `StockUnitEvent`. Answers "which one".
 *   Only goods receipt, job challans, RMA and the manual move-unit screen write
 *   to it.
 *
 * They were never reconciled. No report, no check, no test compared them. So
 * when they drifted, nothing said so - and they had drifted a long way: of 321
 * serial-tracked products, 91 disagreed with themselves, roughly 39,000 items
 * between them.
 *
 * This is Rule 5 of 09-documentation/03-specs/STOCK-IDENTITY-SPEC.md, and it is
 * the measurement that was missing. The 28% was invisible precisely because
 * nobody counted.
 *
 * Goods receipt now creates one unit per item received, so NEW drift cannot
 * start. This report is how the existing drift gets found and cleared, and how
 * anyone notices if a path nobody has thought of starts it again.
 *
 * ## 2. Stock about to go out of date
 *
 * `StockLot.expiryDate` and `GoodsReceiptNoteItem.expiryDate` were captured at
 * goods receipt and never read by anything. A client could enter an expiry date
 * on every delivery for a year and never once be told something had expired.
 *
 * Both checks live in one module because they are the same kind of thing: a
 * standing question about stock whose answer nobody was being given.
 */

/* ------------------------------------------------- the two ledgers compared */

export interface DivergentProduct {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  /** Ledger A: the shelf quantity, summed across warehouses. */
  shelfQty: number;
  /** Ledger B: units that say they are in stock. */
  unitsInStock: number;
  /** shelfQty minus unitsInStock. Positive = items with no number on them. */
  gap: number;
  /** Of this product's units, how many carry a number Atlas issued. */
  houseTagged: number;
  /** Units that left without the customer being recorded. */
  unnamedOut: number;
}

export interface LedgerCheck {
  /** Products set to serial tracking and active - the only ones this can apply to. */
  serialProducts: number;
  agreed: number;
  /** Worst first. */
  divergent: DivergentProduct[];
  /**
   * Items unaccounted for, counting both directions as a positive number.
   *
   * Both directions, because they are both wrong and neither is more wrong:
   * stock on the shelf nobody can name, and numbers on file for items that are
   * not there. Netting them off would report a tidy zero for a store that had
   * lost track of both.
   */
  itemsUnaccounted: number;
}

export async function ledgerCheck(scope: StoreScope): Promise<LedgerCheck> {
  const products = await db.product.findMany({
    where: {
      ...scopeWhere(scope), deletedAt: null,
      isActive: true, trackingMode: 'serial', kind: { not: 'service' },
    },
    select: {
      id: true, productCode: true, productName: true, unit: true,
      balances: { select: { currentQty: true } },
    },
    take: LIST_MAX_ROWS,
  });
  if (products.length === 0) {
    return { serialProducts: 0, agreed: 0, divergent: [], itemsUnaccounted: 0 };
  }

  const ids = products.map((p) => p.id);

  // Two grouped counts rather than a row per unit: a store with 2,775 units
  // would otherwise ship all of them to compare two numbers per product.
  const [byStatus, bySource, outUnnamed] = await Promise.all([
    db.stockUnit.groupBy({
      by: ['productId'],
      where: { ...scopeWhere(scope), deletedAt: null, productId: { in: ids }, status: 'in_stock' },
      _count: { _all: true },
    }),
    db.stockUnit.groupBy({
      by: ['productId'],
      where: {
        ...scopeWhere(scope), deletedAt: null,
        productId: { in: ids }, identitySource: 'house',
      },
      _count: { _all: true },
    }),
    db.stockUnit.groupBy({
      by: ['productId'],
      where: {
        ...scopeWhere(scope), deletedAt: null,
        productId: { in: ids }, status: 'with_customer', partyId: null,
      },
      _count: { _all: true },
    }),
  ]);

  const inStock = new Map(byStatus.map((g) => [g.productId, g._count._all]));
  const house = new Map(bySource.map((g) => [g.productId, g._count._all]));
  const unnamed = new Map(outUnnamed.map((g) => [g.productId, g._count._all]));

  const divergent: DivergentProduct[] = [];
  let agreed = 0;
  let itemsUnaccounted = 0;

  for (const p of products) {
    const shelfQty = p.balances.reduce((n, b) => n + b.currentQty, 0);
    const unitsInStock = inStock.get(p.id) ?? 0;
    const gap = shelfQty - unitsInStock;

    if (gap === 0) { agreed += 1; continue; }

    itemsUnaccounted += Math.abs(gap);
    divergent.push({
      productId: p.id,
      productCode: p.productCode,
      productName: p.productName,
      unit: p.unit,
      shelfQty,
      unitsInStock,
      gap,
      houseTagged: house.get(p.id) ?? 0,
      unnamedOut: unnamed.get(p.id) ?? 0,
    });
  }

  divergent.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

  return { serialProducts: products.length, agreed, divergent, itemsUnaccounted };
}

/* ------------------------------------------------------------------- expiry */

export interface ExpiryRow {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  /**
   * Where the date came from.
   *
   *   `lot`      a batch with its own expiry, which is exact
   *   `delivery` a receipt line's date for a product counted by quantity -
   *              true of that delivery, and NOT proof the stock is still here
   */
  source: 'lot' | 'delivery';
  /** The lot number, or the receipt number. */
  ref: string;
  refHref: string;
  expiryDate: Date;
  daysLeft: number;
  band: ExpiryBand;
  words: string;
  /** How many arrived on that delivery. Null for a lot, which tops up. */
  receivedQty: number | null;
  /** What the product has on the shelf today, across everything. */
  shelfQty: number;
}

export interface ExpiryCheck {
  /**
   * False when the platform owner has not switched this on for the tenant, in
   * which case nothing below is loaded at all.
   */
  enabled: boolean;
  /** How many products are marked as expiring. Zero is the usual answer. */
  trackedProducts: number;
  expired: ExpiryRow[];
  expiring: ExpiryRow[];
  /**
   * Products marked as expiring that have no date anywhere - the reminder
   * cannot fire for them, and that is worth saying rather than hiding.
   */
  noDates: { productId: string; productCode: string; productName: string }[];
}

export async function expiryCheck(
  scope: StoreScope, enabled: boolean, now: Date = new Date(),
): Promise<ExpiryCheck> {
  if (!enabled) {
    return { enabled: false, trackedProducts: 0, expired: [], expiring: [], noDates: [] };
  }

  const products = await db.product.findMany({
    where: {
      ...scopeWhere(scope), deletedAt: null,
      isActive: true, tracksExpiry: true, kind: { not: 'service' },
    },
    select: {
      id: true, productCode: true, productName: true, unit: true,
      trackingMode: true, expiryWarnDays: true,
      balances: { select: { currentQty: true } },
    },
    take: LIST_MAX_ROWS,
  });
  if (products.length === 0) {
    return { enabled: true, trackedProducts: 0, expired: [], expiring: [], noDates: [] };
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  const shelf = new Map(products.map((p) => [p.id, p.balances.reduce((n, b) => n + b.currentQty, 0)]));
  const ids = products.map((p) => p.id);

  const [lots, lines] = await Promise.all([
    db.stockLot.findMany({
      where: {
        ...scopeWhere(scope), deletedAt: null,
        productId: { in: ids }, expiryDate: { not: null },
      },
      select: { id: true, productId: true, lotNo: true, expiryDate: true },
      take: LIST_MAX_ROWS,
    }),
    /**
     * Receipt lines for anything NOT batch-tracked.
     *
     * A batch product's truth is its lot; reading its receipt lines as well
     * would list the same stock twice. For everything else the receipt line is
     * the only record of when that delivery goes off.
     */
    db.goodsReceiptNoteItem.findMany({
      where: {
        ...scopeWhere(scope), deletedAt: null,
        productId: { in: ids.filter((id) => byId.get(id)!.trackingMode !== 'batch') },
        expiryDate: { not: null },
        grn: { status: 'posted' },
      },
      select: {
        id: true, productId: true, qty: true, expiryDate: true,
        grn: { select: { id: true, grnNo: true } },
      },
      take: LIST_MAX_ROWS,
    }),
  ]);

  const rows: ExpiryRow[] = [];

  const push = (
    productId: string, source: 'lot' | 'delivery', ref: string, refHref: string,
    expiryDate: Date, receivedQty: number | null,
  ) => {
    const p = byId.get(productId);
    if (!p) return;
    const shelfQty = shelf.get(productId) ?? 0;
    /**
     * Nothing on the shelf, nothing to warn about.
     *
     * This is the one filter that keeps the list actionable. Every delivery
     * ever received carries an expiry date; a shop open three years would
     * otherwise see hundreds of rows for stock that sold long ago.
     */
    if (shelfQty <= 0) return;

    const v = expiryVerdict(expiryDate, p.expiryWarnDays, now);
    if (v.band === 'fine') return;

    rows.push({
      productId, productCode: p.productCode, productName: p.productName, unit: p.unit,
      source, ref, refHref, expiryDate,
      daysLeft: v.daysLeft, band: v.band, words: v.words,
      receivedQty, shelfQty,
    });
  };

  for (const l of lots) {
    push(l.productId, 'lot', l.lotNo, `/stock-units?q=${encodeURIComponent(l.lotNo)}`, l.expiryDate!, null);
  }
  for (const g of lines) {
    if (!g.productId) continue;
    push(
      g.productId, 'delivery', g.grn.grnNo,
      `/goods-receipt/${g.grn.id}`,
      g.expiryDate!, g.qty,
    );
  }

  // Soonest first in both lists: the top row is always the one to act on.
  const bySoonest = (a: ExpiryRow, b: ExpiryRow) => a.daysLeft - b.daysLeft;

  const withDates = new Set(rows.map((r) => r.productId));
  const noDates = products
    .filter((p) => !withDates.has(p.id) && (shelf.get(p.id) ?? 0) > 0)
    .filter((p) => !lots.some((l) => l.productId === p.id))
    .filter((p) => !lines.some((g) => g.productId === p.id))
    .map((p) => ({ productId: p.id, productCode: p.productCode, productName: p.productName }));

  return {
    enabled: true,
    trackedProducts: products.length,
    expired: rows.filter((r) => r.band === 'expired').sort(bySoonest),
    expiring: rows.filter((r) => r.band === 'expiring').sort(bySoonest),
    noDates,
  };
}

/* --------------------------------------------------------------- both at once */

export interface StockHealth {
  ledger: LedgerCheck;
  expiry: ExpiryCheck;
  /** The platform default, shown so the number in the copy is never hard-coded twice. */
  defaultWarnDays: number;
}

export async function stockHealth(
  scope: StoreScope, features: Set<string>, now: Date = new Date(),
): Promise<StockHealth> {
  const [ledger, expiry] = await Promise.all([
    ledgerCheck(scope),
    expiryCheck(scope, features.has('expiry'), now),
  ]);
  return { ledger, expiry, defaultWarnDays: warnDaysFor(null) };
}
