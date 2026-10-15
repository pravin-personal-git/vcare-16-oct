/**
 * Product row shape and derived-metric rules.
 *
 * Deliberately free of `server-only` and of any database import: the list
 * screen is a client component and filters rows in the browser, while the page
 * computes the same summary on the server. One definition, both sides.
 *
 * Spec: 06-inventory.md §8
 */

export interface ProductRow {
  id: string;
  productCode: string;
  productName: string;
  categoryName: string | null;
  subCategoryName: string | null;
  brandName: string | null;
  sku: string | null;
  /**
   * The scannable code on the box (3 Oct 2026).
   *
   * The column has always existed and been editable, and was shown nowhere - so
   * a client could type barcodes in and never see them again, or check them.
   * Vcare have none yet (0 of 1,339), which is exactly why it has to be visible:
   * you cannot fill in a field you cannot see.
   */
  barcode: string | null;
  hsnCode: string | null;
  location: string | null;
  unit: string;
  mrpPaise: number;
  dlpPaise: number;
  currentQty: number;
  reorderLevel: number;
  isCombo: boolean;
  isInOffer: boolean;
  isActive: boolean;
  lastSoldAt: Date | null;

  /**
   * Warranty and the AMC offer, carried on the row so they show wherever a
   * product is listed rather than only on its own edit form.
   *
   * Optional because this type is also satisfied by lighter shapes built for
   * pickers; absent reads as "no warranty, no AMC offered".
   */
  warrantyMonths?: number | null;
  amcAvailable?: boolean;
  amcPricingMode?: string | null;
  amcDurationMonths?: number | null;
  amcAnnualPricePaise?: number | null;
  amcTerms?: string | null;
}

export const DEAD_STOCK_DAYS = 365;
export const NO_SALE_DAYS = 90;

export type ProductFilter =
  | 'in_offer' | 'combo' | 'low_stock' | 'out_of_stock' | 'negative_stock'
  | 'dead_stock' | 'no_sale';

/** Relative to the caller's `now` so the rules are deterministic and testable. */
const daysAgo = (n: number, now: Date) => new Date(now.getTime() - n * 86_400_000);

export function matchesFilter(p: ProductRow, f: ProductFilter, now = new Date()): boolean {
  switch (f) {
    case 'in_offer':     return p.isInOffer;
    case 'combo':        return p.isCombo;
    // `<= 0`, not `=== 0`. A product sitting at minus two is emphatically out
    // of stock, and the exact-zero test made the worst case the one the
    // summary could not see.
    case 'out_of_stock':   return p.currentQty <= 0;

    // Counted separately because it is a different problem with a different
    // fix. Out of stock means reorder. Negative means the books disagree with
    // the shelf - somebody dispatched goods the system did not know about, or
    // a receipt was never entered. Reordering does not fix that; counting does.
    case 'negative_stock': return p.currentQty < 0;

    case 'low_stock':    return p.currentQty > 0 && p.currentQty <= p.reorderLevel;
    case 'dead_stock':   return !p.lastSoldAt || p.lastSoldAt < daysAgo(DEAD_STOCK_DAYS, now);
    case 'no_sale':      return !p.lastSoldAt || p.lastSoldAt < daysAgo(NO_SALE_DAYS, now);
  }
}

export function summarise(
  rows: ProductRow[],
  now = new Date(),
): Record<ProductFilter, number> {
  const c = (f: ProductFilter) => rows.filter((r) => matchesFilter(r, f, now)).length;
  return {
    in_offer: c('in_offer'), combo: c('combo'), low_stock: c('low_stock'),
    out_of_stock: c('out_of_stock'), negative_stock: c('negative_stock'),
    dead_stock: c('dead_stock'), no_sale: c('no_sale'),
  };
}
