/**
 * Which serials print under which invoice line (15 Oct 2026).
 *
 * A sold unit knows its invoice (`StockUnit.invoiceId`) and its product, not
 * its line, so the units are dealt out to the lines of the same product in
 * line order, up to each line's quantity. Anything left over (a line edited
 * down after the units were billed, or an old-system invoice whose quantities
 * were typed by hand) goes on that product's last line, so no serial sold on
 * the invoice is ever left off the paper.
 *
 * A job's bill (22 Oct 2026, Vcare): its lines carry no product - the parts
 * already left stock on the job's GDN, and a product on the line would take
 * them out again. Such a line takes the units of the product it is named
 * after, so the camera fitted on a complaint prints its serial on that bill
 * too. A unit whose product has a line of its own is never matched by name.
 */
export function serialsByLine(
  lines: { productId: string | null; qty: number; productName?: string | null }[],
  units: { productId: string; serialNo: string | null; productName?: string | null }[],
): string[][] {
  const byId = new Set(lines.map((l) => l.productId).filter((x): x is string => !!x));
  const name = (s: string | null | undefined) => (s ? `name:${s.trim().toLowerCase()}` : null);
  const lineKey = (l: (typeof lines)[number]) => l.productId ?? name(l.productName);
  const unitKey = (u: (typeof units)[number]) => (byId.has(u.productId) ? u.productId : name(u.productName) ?? u.productId);

  const pool = new Map<string, string[]>();
  for (const u of units) {
    if (!u.serialNo) continue;
    const k = unitKey(u);
    pool.set(k, [...(pool.get(k) ?? []), u.serialNo]);
  }
  const lastLine = new Map<string, number>();
  lines.forEach((l, n) => { const k = lineKey(l); if (k) lastLine.set(k, n); });

  return lines.map((l, n) => {
    const k = lineKey(l);
    if (!k) return [];
    const left = pool.get(k) ?? [];
    const take = lastLine.get(k) === n ? left.length : Math.max(0, Math.floor(l.qty));
    pool.set(k, left.slice(take));
    return left.slice(0, take);
  });
}
