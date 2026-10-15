/**
 * Which serials print under which invoice line (15 Oct 2026).
 *
 * A sold unit knows its invoice (`StockUnit.invoiceId`) and its product, not
 * its line, so the units are dealt out to the lines of the same product in
 * line order, up to each line's quantity. Anything left over (a line edited
 * down after the units were billed, or an old-system invoice whose quantities
 * were typed by hand) goes on that product's last line, so no serial sold on
 * the invoice is ever left off the paper.
 */
export function serialsByLine(
  lines: { productId: string | null; qty: number }[],
  units: { productId: string; serialNo: string | null }[],
): string[][] {
  const pool = new Map<string, string[]>();
  for (const u of units) {
    if (!u.serialNo) continue;
    pool.set(u.productId, [...(pool.get(u.productId) ?? []), u.serialNo]);
  }
  const lastLine = new Map<string, number>();
  lines.forEach((l, n) => { if (l.productId) lastLine.set(l.productId, n); });

  return lines.map((l, n) => {
    if (!l.productId) return [];
    const left = pool.get(l.productId) ?? [];
    const take = lastLine.get(l.productId) === n ? left.length : Math.max(0, Math.floor(l.qty));
    pool.set(l.productId, left.slice(take));
    return left.slice(0, take);
  });
}
