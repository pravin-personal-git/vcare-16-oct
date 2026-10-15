import 'server-only';
import type { AppContext } from './context';
import { listProducts, summarise } from './products';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { matchesFilter, type ProductFilter, type ProductRow } from '@/lib/product-metrics';

/**
 * Products, filtered - shared by the screen and its export (F1).
 * A catalogue has no meaningful date, so no date filter (an approved F1
 * exception, see F1-UI-AUDIT). ?card= a KPI card, ?status=inactive,
 * ?category= / ?brand= by name. Sorting by cost or margin needs the costing
 * pass, which the page runs on top of these rows.
 */

type Sp = Record<string, string | undefined>;

export const PRODUCT_GRID: PageOptions<ProductRow> = {
  // `barcode` and `sku` included so scanning into the search box finds the row.
  search: (r) => [r.productName, r.productCode, r.barcode, r.sku, r.categoryName, r.subCategoryName, r.brandName, r.hsnCode, r.location],
  sort: {
    productCode: (r) => r.productCode, productName: (r) => r.productName,
    amc: (r) => (r.amcAvailable ? (r.amcPricingMode ?? 'yes') : ''),
    categoryName: (r) => r.categoryName, subCategoryName: (r) => r.subCategoryName, brandName: (r) => r.brandName,
    barcode: (r) => r.barcode ?? '',
    hsnCode: (r) => r.hsnCode, location: (r) => r.location, dlp: (r) => r.dlpPaise, mrp: (r) => r.mrpPaise,
    currentQty: (r) => r.currentQty,
  },
};

export async function productsList(ctx: AppContext, sp: Sp) {
  const all = await listProducts(ctx.scope);
  const summary = summarise(all);
  const card = sp.card && sp.card in summary ? (sp.card as ProductFilter) : null;
  const inactive = sp.status === 'inactive';
  const category = sp.category?.trim() || null;
  const brand = sp.brand?.trim() || null;
  const filtered = all.filter((r) => r.isActive === !inactive && (!card || matchesFilter(r, card))
    && (!category || r.categoryName === category) && (!brand || r.brandName === brand));
  const rows = searchAndSort(filtered, parseGridQuery(sp), PRODUCT_GRID);
  return { rows, all, summary, card, inactive, category, brand };
}
