import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { nextProductCode } from './products';
import { isTrackingMode, type TrackingMode } from '@/lib/stock-tracking';
import { assertBarcodeFree, ScanProductError } from './product-barcode';

export { ScanProductError, barcodeTakenBy, assertBarcodeFree, duplicateBarcodes } from './product-barcode';

/**
 * A NEW PRODUCT FROM A SCAN, AND ONE BARCODE PER PRODUCT
 * (Scan-to-Stock G2/G5 and G8, 12 Oct 2026).
 *
 * G2: an unknown barcode becomes a product in one short form - name,
 * category, tracking, unit, prices optional - opened from the header scanner,
 * the receipt line, the product form and the phone. Decision (12 Oct): anyone
 * who may create products may do it; the selling price may be left blank, and
 * the product then shows "price missing" on the products list.
 *
 * G8: a barcode names ONE product across the whole business (decision 12 Oct:
 * refuse within the business, not only the branch). Before this, a barcode
 * typed on two products made a scan land on whichever the database returned
 * first.
 */

/** Categories, and the tracking each one's products mostly use - the form's suggestion. */
export async function scanProductOptions(scope: StoreScope) {
  const [categories, modes] = await Promise.all([
    db.category.findMany({
      where: { ...scopeWhere(scope), isActive: true },
      select: { id: true, name: true, parentId: true },
      orderBy: { name: 'asc' },
    }),
    db.product.groupBy({
      by: ['categoryId', 'trackingMode'],
      where: { ...scopeWhere(scope), categoryId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const best = new Map<string, { mode: string; n: number }>();
  for (const m of modes) {
    const cur = best.get(m.categoryId!);
    if (!cur || m._count._all > cur.n) best.set(m.categoryId!, { mode: m.trackingMode, n: m._count._all });
  }
  return {
    categories: categories.filter((c) => !c.parentId).map((c) => ({
      id: c.id, name: c.name, suggestedTracking: (best.get(c.id)?.mode ?? 'quantity') as TrackingMode,
    })),
  };
}

export interface ScanProductInput {
  productName: string;
  barcode: string | null;
  categoryId: string | null;
  trackingMode: string;
  unit: string;
  /** Rupees as paise; null = not known yet. */
  costPaise: number | null;
  /** Selling price (MRP); null = "price missing". */
  sellPaise: number | null;
  taxRatePct: number;
  hsnCode: string | null;
}

/** Create the product. Refuses a barcode another product in the business already has. */
export async function createProductFromScan(scope: StoreScope, input: ScanProductInput) {
  const storeId = scopeForWrite(scope);
  const name = input.productName.trim();
  if (!name) throw new ScanProductError('Give the product a name.');
  if (!isTrackingMode(input.trackingMode)) throw new ScanProductError('Choose how its stock is tracked.');
  if (![0, 5, 12, 18, 28].includes(input.taxRatePct)) throw new ScanProductError('GST must be 0, 5, 12, 18 or 28%.');
  const barcode = input.barcode?.trim() || null;
  await assertBarcodeFree(scope, barcode);
  if (input.categoryId) {
    const cat = await db.category.findFirst({ where: { id: input.categoryId, ...scopeWhere(scope) }, select: { id: true } });
    if (!cat) throw new ScanProductError('That category is not in this store.');
  }

  const productCode = await nextProductCode(storeId, input.categoryId);
  const sell = input.sellPaise ?? 0;
  return db.product.create({
    data: {
      storeId,
      productCode,
      productName: name,
      categoryId: input.categoryId,
      barcode,
      hsnCode: input.hsnCode?.trim() || null,
      unit: input.unit.trim() || 'pcs',
      trackingMode: input.trackingMode,
      isRateEditable: true,
      prices: {
        create: {
          mrpPaise: sell, dlpPaise: sell, retailPaise: sell, wholesalePaise: sell,
          costPaise: input.costPaise ?? 0, taxRatePct: input.taxRatePct,
        },
      },
      balances: { create: { openingQty: 0, currentQty: 0, reorderLevel: 0 } },
    },
    select: { id: true, productCode: true, productName: true, trackingMode: true, barcode: true, storeId: true },
  });
}
