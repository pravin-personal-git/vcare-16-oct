/**
 * Turning what was read into records you already have.
 *
 * A supplier invoice says "M/S PRAMA HIKVISION INDIA PVT. LTD."; the supplier
 * list says "Prama Hikvision India". A card says "Sahu Hardware & Sanitary";
 * the product list is full of near-identical camera names. Matching is by
 * GSTIN first - it is unique and printed on every tax invoice - then by name
 * with the legal noise stripped, and a product is only chosen when one match
 * is clearly better than the rest. When in doubt it picks nothing, and the
 * person picks from the dropdown as before.
 */

const NOISE = /\b(m\/?s|messrs|pvt|private|ltd|limited|llp|co|company|and|the|india|enterprises?|traders?)\b/g;

export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchSupplier<T extends { id: string; name: string; gstin: string | null }>(
  suppliers: T[],
  scan: { supplierGstin: string | null; supplierName: string | null },
): T | null {
  if (scan.supplierGstin) {
    const hit = suppliers.find((s) => s.gstin?.toUpperCase() === scan.supplierGstin);
    if (hit) return hit;
  }
  if (!scan.supplierName) return null;
  const want = normaliseName(scan.supplierName);
  if (want.length < 3) return null;
  const exact = suppliers.filter((s) => normaliseName(s.name) === want);
  if (exact.length === 1) return exact[0];
  const contains = suppliers.filter((s) => {
    const have = normaliseName(s.name);
    return have.length >= 3 && (have.includes(want) || want.includes(have));
  });
  return contains.length === 1 ? contains[0] : null;
}

const tokens = (s: string) =>
  new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length >= 2));

/**
 * The share of the scanned text's words that appear in the product name,
 * with model-number-like tokens (letters AND digits) counted double - "2MP"
 * and "DS2CE16D0T" say far more about which camera it is than "camera".
 */
export function productScore(scanned: string, productName: string): number {
  const a = tokens(scanned);
  const b = tokens(productName);
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0; let total = 0;
  for (const t of a) {
    const w = /\d/.test(t) && /[a-z]/.test(t) ? 2 : 1;
    total += w;
    if (b.has(t)) hit += w;
  }
  return hit / total;
}

export const PRODUCT_MATCH_MIN = 0.6;

export function matchProduct<T extends { id: string; name: string; code?: string | null }>(
  products: T[],
  scanned: string,
): T | null {
  const s = scanned.trim();
  if (!s) return null;
  const byCode = products.find((p) => p.code && p.code.toUpperCase() === s.toUpperCase());
  if (byCode) return byCode;
  let best: T | null = null; let bestScore = 0; let tie = false;
  for (const p of products) {
    const score = productScore(s, p.name);
    if (score > bestScore) { best = p; bestScore = score; tie = false; }
    else if (score === bestScore && score > 0) tie = true;
  }
  return best && !tie && bestScore >= PRODUCT_MATCH_MIN ? best : null;
}
