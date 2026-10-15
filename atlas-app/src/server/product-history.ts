import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { FEED_MAX_ROWS, LIST_MAX_ROWS } from '@/lib/list-limits';
import { daysUntil } from '@/lib/expiry-policy';

/**
 * A product's whole life, at two levels (2 Oct 2026).
 *
 * WHY THIS REPLACED THE FIRST ATTEMPT.
 *
 * The first version asked for a serial number and nothing else. The data says
 * that was the wrong door: of 2,775 serial units on record, **none** is linked
 * to a sale invoice, and 1,215 say "with a customer" without naming one. A
 * serial-only page therefore looks broken on real data through no fault of the
 * client - the chain it tries to draw does not exist yet.
 *
 * It also conflated two different questions. `SWT-D005` is a PRODUCT CODE -
 * the catalogue code for a model, shared by every unit of it. A serial
 * identifies one physical item. People type whichever is printed on the thing
 * in front of them, and should not have to know which one Atlas calls it.
 *
 * So: the MODEL level first, which is complete for every product today, with
 * the individual units underneath where they exist. A kirana store that tracks
 * nothing per-item gets the same page, and gets it complete.
 *
 * NOTHING HERE INVENTS CERTAINTY. Where a chain breaks - a unit gone out with
 * no customer recorded, a cost never entered - it is reported as unknown
 * rather than as zero, and the page says so in words. "Margin ₹0" is a claim
 * about the business; "we do not know" is not.
 */

export interface PurchaseRow {
  grnId: string;
  grnNo: string;
  at: Date;
  supplierName: string;
  qty: number;
  unitCostPaise: number | null;
  supplierInvoiceNo: string | null;
}

export interface SaleRow {
  invoiceId: string;
  invoiceNo: string;
  at: Date;
  customerName: string;
  qty: number;
  lineTotalPaise: number;
  /** Still to collect on that invoice as a whole, not on this line. */
  owedPaise: number;
}

/**
 * EVERYTHING ELSE THAT MOVED IT (10 Oct 2026, live test of 9 Oct): stock used
 * on a job or given in place of a kept unit (GDN), back from a job or a
 * supplier, returns, adjustments - and, with no stock moving at all, the
 * repair loop of a customer's own unit: taken for repair, sent to the
 * supplier, back, kept by them, a new serial, handed back. Before this the
 * trail showed only the GRN and the sale, so it read "sold 4" while 8 had gone.
 * Receipts and sales stay where they were (purchases / sales), so nothing is
 * counted twice; `dispatch` is the goods half of a sale already shown.
 */
export interface MoveRow {
  key: string;
  at: Date;
  title: string;
  /** Signed. Zero for a repair step - the item moved, our stock did not. */
  qty: number;
  serialNo: string | null;
  docNo: string | null;
  docHref: string | null;
  detail: string | null;
  repair: boolean;
}

const MOVE_REASONS = ['job_issue', 'job_return', 'rma_return', 'return_in', 'return_out', 'adjustment', 'van_issue', 'van_return', 'van_shortfall'] as const;
const MOVE_TITLE: Record<string, (qty: number) => string> = {
  job_issue: () => 'Used on a job',
  job_return: () => 'Back from a job, unused',
  rma_return: () => 'Back from the supplier into stock',
  return_in: () => 'Returned by the customer',
  return_out: () => 'Returned to the supplier',
  adjustment: (q) => (q < 0 ? 'Stock adjusted down' : 'Stock adjusted up'),
  van_issue: () => 'Loaded on a van',
  van_return: () => 'Back off a van',
  van_shortfall: () => 'Missing from a van',
};

/** A customer unit's repair loop, read off its status history. */
function repairStep(from: string | null, to: string | null, refType: string | null): string | null {
  if (refType === 'RmaReceipt' && to === 'in_repair') return 'New serial from the supplier (the customer\'s)';
  if (to === 'in_repair' && from === 'with_customer') return 'Taken from the customer for repair';
  if (to === 'with_supplier') return 'Sent to the supplier';
  if (to === 'in_repair' && from === 'with_supplier') return 'Back from the supplier';
  if (to === 'supplier_kept') return 'Kept by the supplier';
  if (to === 'with_customer' && from === 'in_repair') return 'Handed back to the customer';
  return null;
}

export interface UnitRow {
  id: string;
  serialNo: string | null;
  status: string;
  condition: string;
  receivedAt: Date;
  /** Null when the unit went out without anybody recording who took it. */
  holderName: string | null;
  invoiceNo: string | null;
  unitCostPaise: number | null;
}

export interface LotRow {
  id: string;
  lotNo: string;
  receivedAt: Date;
  mfgDate: Date | null;
  expiryDate: Date | null;
  unitCostPaise: number | null;
  /** Days until it expires. Negative means it already has. Null = no date. */
  daysLeft: number | null;
}

export interface ProductHistory {
  productId: string;
  productName: string;
  productCode: string;
  trackingMode: string;
  unitLabel: string;

  stock: { onHandQty: number; valuePaise: number | null };

  money: {
    boughtQty: number;
    boughtPaise: number | null;
    soldQty: number;
    soldPaise: number;
    /** Net quantity used on field jobs (GDNs), which is not a sale line. */
    jobQty: number;
    /** What the sold quantity cost us. Null when any receipt has no cost. */
    costOfSoldPaise: number | null;
    marginPaise: number | null;
    /** Outstanding across every invoice this product appears on. */
    theyOwePaise: number;
  };

  purchases: PurchaseRow[];
  sales: SaleRow[];
  /** Every other movement and the repair steps (10 Oct 2026). */
  moves: MoveRow[];

  /** Serial-tracked only. */
  units: UnitRow[];
  /** Batch-tracked only. */
  lots: LotRow[];

  /**
   * What Atlas cannot answer for this product, in plain words.
   *
   * Shown on the page rather than left as a silent gap. Somebody reading a
   * trail has to know which parts of it are complete, or they will trust a
   * hole as if it were a fact.
   */
  gaps: string[];
}

export interface ProductHit {
  id: string;
  productName: string;
  productCode: string;
  /** Shown so a scanned code can be checked against what came back. */
  barcode: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
  trackingMode: string;
  /** Set when this product was reached through one of its units' serials. */
  matchedSerial: string | null;
}

/**
 * Find products by code, name, barcode, SKU - or by a unit's serial.
 *
 * One box for all of them, because the person at the counter is reading a
 * label and does not know which field Atlas stores it in. A serial resolves to
 * its product, so the serial path still lands somewhere useful even for a
 * product whose unit chain is incomplete.
 */
export async function findProducts(scope: StoreScope, query: string): Promise<ProductHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const [direct, bySerial] = await Promise.all([
    db.product.findMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        OR: [
          { productCode: { contains: q, mode: 'insensitive' } },
          { productName: { contains: q, mode: 'insensitive' } },
          { barcode: { contains: q, mode: 'insensitive' } },
          { sku: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 50,
      orderBy: { productName: 'asc' },
      select: {
        id: true, productName: true, productCode: true, barcode: true, trackingMode: true,
        category: { select: { name: true } },
        subCategory: { select: { name: true } },
      },
    }),
    db.stockUnit.findMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        OR: [
          { serialNo: { contains: q, mode: 'insensitive' } },
          { legacyRef: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 50,
      select: {
        serialNo: true,
        product: {
          select: {
            id: true, productName: true, productCode: true, barcode: true, trackingMode: true,
            category: { select: { name: true } },
            subCategory: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const shape = (p: {
    id: string; productName: string; productCode: string; barcode: string | null;
    trackingMode: string;
    category: { name: string } | null;
    subCategory: { name: string } | null;
  }) => ({
    id: p.id,
    productName: p.productName,
    productCode: p.productCode,
    barcode: p.barcode,
    trackingMode: p.trackingMode,
    categoryName: p.category?.name ?? null,
    subCategoryName: p.subCategory?.name ?? null,
  });

  const out: ProductHit[] = direct.map((p) => ({ ...shape(p), matchedSerial: null }));
  const seen = new Set(out.map((p) => p.id));
  for (const u of bySerial) {
    if (seen.has(u.product.id)) continue;
    seen.add(u.product.id);
    out.push({ ...shape(u.product), matchedSerial: u.serialNo });
  }
  return out;
}

/** 0 is not a cost. A supplier line priced at nothing means nobody typed one. */
const costOrNull = (p: number | null | undefined) => (p && p > 0 ? p : null);

export async function productHistory(
  scope: StoreScope, productId: string,
): Promise<ProductHistory | null> {
  const product = await db.product.findFirst({
    where: { id: productId, ...scopeWhere(scope), deletedAt: null },
    select: {
      id: true, productName: true, productCode: true,
      trackingMode: true, unit: true,
    },
  });
  if (!product) return null;

  const [balances, grnItems, invoiceItems, units, lots] = await Promise.all([
    // No storeId of its own - the product is already scoped, so its balances are.
    db.productBalance.findMany({ where: { productId }, select: { currentQty: true } }),

    db.goodsReceiptNoteItem.findMany({
      // Only posted receipts moved stock, so only those are purchases.
      where: { productId, ...scopeWhere(scope), deletedAt: null, grn: { status: 'posted' } },
      take: FEED_MAX_ROWS,
      select: {
        qty: true, unitCostPaise: true,
        grn: {
          select: {
            id: true, grnNo: true, receivedDate: true,
            supplierName: true, supplierInvoiceNo: true,
          },
        },
      },
    }),

    db.invoiceItem.findMany({
      where: {
        productId, deletedAt: null,
        invoice: { ...scopeWhere(scope), deletedAt: null, lifecycle: { not: 'cancelled' } },
      },
      take: FEED_MAX_ROWS,
      select: {
        qty: true, lineTotalPaise: true,
        invoice: {
          select: {
            id: true, invoiceNo: true, invoiceDate: true, customerName: true,
            grandTotalPaise: true, amountPaidPaise: true,
          },
        },
      },
    }),

    // Every product's units, not only `serial` products' (15 Oct 2026): 314 Vcare
    // products carry 1,963 migrated serials while still set to `quantity`, and
    // gating on the setting hid every one of them here.
    product.trackingMode !== 'none'
      ? db.stockUnit.findMany({
        where: { productId, ...scopeWhere(scope), deletedAt: null },
        take: LIST_MAX_ROWS,
        orderBy: { receivedAt: 'desc' },
        select: {
          id: true, serialNo: true, status: true, condition: true,
          receivedAt: true, unitCostPaise: true,
          party: { select: { companyName: true, firstName: true, lastName: true } },
          invoice: { select: { invoiceNo: true } },
        },
      })
      : Promise.resolve([]),

    product.trackingMode === 'batch'
      ? db.stockLot.findMany({
        where: { productId, ...scopeWhere(scope), deletedAt: null },
        take: LIST_MAX_ROWS,
        orderBy: { receivedAt: 'desc' },
        select: {
          id: true, lotNo: true, receivedAt: true, mfgDate: true,
          expiryDate: true, unitCostPaise: true,
        },
      })
      : Promise.resolve([]),
  ]);

  const [movements, unitSteps] = await Promise.all([
    db.stockMovement.findMany({
      where: { productId, ...scopeWhere(scope), deletedAt: null, reason: { in: [...MOVE_REASONS] } },
      take: FEED_MAX_ROWS, orderBy: { createdAt: 'desc' },
      select: { id: true, qty: true, reason: true, refType: true, refId: true, refNo: true, note: true, createdAt: true, stockUnit: { select: { serialNo: true } } },
    }),
    // Any product with units - migrated data has units on products not (yet) set to serial.
    db.stockUnitEvent.findMany({
        where: {
          ...scopeWhere(scope), unit: { productId },
          OR: [{ toStatus: { in: ['in_repair', 'with_supplier', 'supplier_kept'] } }, { fromStatus: 'in_repair', toStatus: 'with_customer' }],
        },
        take: FEED_MAX_ROWS, orderBy: { createdAt: 'desc' },
        select: { id: true, fromStatus: true, toStatus: true, refType: true, refId: true, refNo: true, note: true, createdAt: true, unit: { select: { serialNo: true } } },
      }),
  ]);
  const docLink = (refType: string | null, refId: string | null, refNo: string | null) => {
    if (refType === 'MaterialIssue' && refNo) return `/goods-dispatch/complaint-gdns?gdn=${encodeURIComponent(refNo)}#gdn-${encodeURIComponent(refNo)}`;
    if (refType === 'RmaReceipt' && refId) return `/services/dispatch/receipts/${refId}`;
    if (refType === 'ReplacementCase' && refNo) return `/services/replacements?q=${encodeURIComponent(refNo)}`;
    return null;
  };
  const moves: MoveRow[] = [
    ...movements.map((m) => ({
      key: `m-${m.id}`, at: m.createdAt, title: (MOVE_TITLE[m.reason] ?? (() => m.reason))(m.qty), qty: m.qty,
      serialNo: m.stockUnit?.serialNo ?? null, docNo: m.refNo, docHref: docLink(m.refType, m.refId, m.refNo), detail: m.note, repair: false,
    })),
    ...unitSteps.flatMap((e) => {
      const title = repairStep(e.fromStatus, e.toStatus, e.refType);
      return title ? [{
        key: `e-${e.id}`, at: e.createdAt, title, qty: 0, serialNo: e.unit.serialNo,
        docNo: e.refNo, docHref: docLink(e.refType, e.refId, e.refNo), detail: e.note, repair: true,
      }] : [];
    }),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const jobQty = -movements.filter((m) => m.reason === 'job_issue' || m.reason === 'job_return').reduce((n, m) => n + m.qty, 0);

  const purchases: PurchaseRow[] = grnItems
    .map((g) => ({
      grnId: g.grn.id,
      grnNo: g.grn.grnNo,
      at: g.grn.receivedDate,
      supplierName: g.grn.supplierName,
      qty: g.qty,
      unitCostPaise: costOrNull(g.unitCostPaise),
      supplierInvoiceNo: g.grn.supplierInvoiceNo,
    }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const sales: SaleRow[] = invoiceItems
    .map((i) => ({
      invoiceId: i.invoice.id,
      invoiceNo: i.invoice.invoiceNo,
      at: i.invoice.invoiceDate,
      customerName: i.invoice.customerName || 'Walk-in',
      qty: i.qty,
      lineTotalPaise: i.lineTotalPaise,
      owedPaise: Math.max(0, i.invoice.grandTotalPaise - i.invoice.amountPaidPaise),
    }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const boughtQty = purchases.reduce((n, p) => n + p.qty, 0);
  const costKnown = purchases.length > 0 && purchases.every((p) => p.unitCostPaise !== null);
  const boughtPaise = costKnown
    ? purchases.reduce((n, p) => n + p.qty * (p.unitCostPaise ?? 0), 0)
    : null;

  const soldQty = sales.reduce((n, s) => n + s.qty, 0);
  const soldPaise = sales.reduce((n, s) => n + s.lineTotalPaise, 0);

  /**
   * Margin is revenue minus the cost OF WHAT WAS SOLD - not minus everything
   * ever bought. The difference is the stock still on the shelf, and ignoring
   * it reports a loss on every product mid-month.
   *
   * Weighted average cost, which is the convention the rest of Atlas values
   * stock at. Per-unit actual cost is only possible for serial-tracked stock,
   * and only once Gap 2 is closed and units carry their sale.
   */
  const avgCostPaise = costKnown && boughtQty > 0 ? (boughtPaise ?? 0) / boughtQty : null;
  const costOfSoldPaise = avgCostPaise !== null && soldQty > 0
    ? Math.round(avgCostPaise * soldQty)
    : null;
  const marginPaise = costOfSoldPaise !== null ? soldPaise - costOfSoldPaise : null;

  // One invoice can carry several lines of this product; count what it owes once.
  const owedOnce = new Map<string, number>();
  for (const s of sales) owedOnce.set(s.invoiceId, s.owedPaise);
  const theyOwePaise = [...owedOnce.values()].reduce((n, v) => n + v, 0);

  const onHandQty = balances.reduce((n, b) => n + b.currentQty, 0);

  const now = Date.now();
  const lotRows: LotRow[] = lots.map((l) => ({
    id: l.id,
    lotNo: l.lotNo,
    receivedAt: l.receivedAt,
    mfgDate: l.mfgDate,
    expiryDate: l.expiryDate,
    unitCostPaise: costOrNull(l.unitCostPaise),
    // Whole India days, the same count the expiry list uses (9 Oct 2026) - the
    // raw instant difference read "0 days" for most of the day before expiry.
    daysLeft: l.expiryDate ? daysUntil(l.expiryDate, new Date(now)) : null,
  }));

  const holderOf = (p: { companyName: string | null; firstName: string | null; lastName: string | null } | null) =>
    (p ? (p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' ') || null) : null);

  const unitRows: UnitRow[] = units.map((u) => ({
    id: u.id,
    serialNo: u.serialNo,
    status: u.status,
    condition: u.condition,
    receivedAt: u.receivedAt,
    holderName: holderOf(u.party),
    invoiceNo: u.invoice?.invoiceNo ?? null,
    unitCostPaise: costOrNull(u.unitCostPaise),
  }));

  // ---- what we cannot answer, said plainly ------------------------------
  const gaps: string[] = [];

  if (purchases.length === 0 && onHandQty !== 0) {
    gaps.push(
      'No purchase receipt behind this stock. It came in as an opening balance '
      + 'or was adjusted in by hand, so there is no supplier or cost to show.',
    );
  }
  if (purchases.length > 0 && !costKnown) {
    gaps.push(
      'At least one receipt has no cost against it, so the margin cannot be '
      + 'worked out. Open the receipt and enter the supplier’s price.',
    );
  }
  if (product.trackingMode === 'serial') {
    const inStockUnits = unitRows.filter((u) => u.status === 'in_stock').length;
    const unnamed = unitRows.filter((u) => u.status === 'with_customer' && !u.holderName).length;
    if (unnamed > 0) {
      gaps.push(
        `${unnamed} unit${unnamed === 1 ? '' : 's'} left the store without the customer `
        + 'being recorded. Those came in with migrated data, before Atlas held the sale.',
      );
    }
    const short = onHandQty - inStockUnits;
    if (short > 0) {
      gaps.push(
        `The shelf says ${onHandQty} ${product.unit} but only ${inStockUnits} carry a serial. `
        + `${short} need labelling or a stock count.`,
      );
    } else if (short < 0) {
      gaps.push(
        `${-short} unit${short === -1 ? '' : 's'} carry a serial and say they are in stock, `
        + `but the shelf quantity is only ${onHandQty}. One of the two is wrong.`,
      );
    }
  }
  if (product.trackingMode === 'batch' && lotRows.length === 0 && onHandQty !== 0) {
    gaps.push(
      'This product is set to batch tracking but has no batches recorded, so '
      + 'nothing can be traced to a lot or an expiry date.',
    );
  }

  return {
    productId: product.id,
    productName: product.productName,
    productCode: product.productCode,
    trackingMode: product.trackingMode,
    unitLabel: product.unit,
    stock: {
      onHandQty,
      valuePaise: avgCostPaise !== null ? Math.round(avgCostPaise * onHandQty) : null,
    },
    money: { boughtQty, boughtPaise, soldQty, soldPaise, jobQty, costOfSoldPaise, marginPaise, theyOwePaise },
    purchases,
    sales,
    moves,
    units: unitRows,
    lots: lotRows,
    gaps,
  };
}

/* ------------------------------------------------------------------ browse */

export interface BrowseProduct {
  id: string;
  productCode: string;
  productName: string;
  barcode: string | null;
  categoryId: string | null;
  subCategoryId: string | null;
  trackingMode: string;
}

export interface BrowseCatalogue {
  products: BrowseProduct[];
  categories: { id: string; name: string }[];
  subCategories: { id: string; name: string; parentId: string | null }[];
}

/**
 * The whole catalogue, for picking a product instead of typing its code.
 *
 * The screen used to offer one text box and nothing else, so looking at six
 * products meant knowing six codes by heart or fetching them from another tab.
 * That is fine for a technician holding the item and reading its label - which
 * is what the box is for - and useless for anyone working through a category.
 *
 * Loaded once with the page rather than searched per keystroke. 1,339 products
 * at roughly 120 bytes is well under a quarter of a megabyte, and it makes the
 * filtering instant and offline-tolerant; a query per keystroke against a pooler
 * running one statement at a time would be slower and far less pleasant.
 */
export async function browseCatalogue(scope: StoreScope): Promise<BrowseCatalogue> {
  const [products, categories] = await Promise.all([
    db.product.findMany({
      where: { ...scopeWhere(scope), deletedAt: null, isActive: true },
      orderBy: { productName: 'asc' },
      take: LIST_MAX_ROWS,
      select: {
        id: true, productCode: true, productName: true, barcode: true,
        categoryId: true, subCategoryId: true, trackingMode: true,
      },
    }),
    db.category.findMany({
      where: { ...scopeWhere(scope), deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, parentId: true },
    }),
  ]);

  return {
    products,
    // A top-level category has no parent; everything else is a sub-category of
    // one. Split here so the screen does not have to know the rule.
    categories: categories.filter((c) => !c.parentId).map((c) => ({ id: c.id, name: c.name })),
    subCategories: categories.filter((c) => c.parentId),
  };
}
