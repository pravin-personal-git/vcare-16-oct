/**
 * What the Stock on Hand search box matches (4 Oct 2026).
 *
 * The box said "Product, code or barcode" and a comment above the match said
 * "Barcode first", but the barcode was never in the text being searched - and
 * of the serials only the first twelve were - so a scanned barcode found
 * nothing. Kept here, apart from the screen, so a test can hold it to its word.
 */
export interface StockSearchable {
  productName: string;
  productCode: string;
  categoryName: string | null;
  subCategoryName: string | null;
  brandName: string | null;
  unit: string | null;
  barcode: string | null;
  sku: string | null;
  serials: string[];
}

export function stockMatches(r: StockSearchable, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    r.barcode, r.sku, r.productName, r.productCode, r.categoryName, r.subCategoryName, r.brandName, r.unit, ...r.serials,
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}
