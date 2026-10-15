/**
 * How much stock moves when a document's lines are edited.
 *
 * This is the part of "edit an issued invoice" that quietly goes wrong. The
 * invoice already took stock out when it was raised. Editing it must move only
 * the *difference* - moving the new quantity again would double-count, and
 * moving nothing leaves the shelf disagreeing with the books forever.
 *
 * Worked through, because the sign is easy to get backwards:
 *
 *   Sold 3, now selling 5  → 2 more left the shelf  → movement −2
 *   Sold 5, now selling 3  → 2 came back            → movement +2
 *   Line removed entirely  → all of it came back    → movement +old
 *   Line added             → it leaves now          → movement −new
 *
 * So: movement = oldQty − newQty. Positive puts stock back.
 *
 * Free-text lines carry no productId and hold no stock, so they are skipped -
 * not silently, but because there is genuinely nothing to move.
 */

export interface StockLine {
  productId: string | null;
  productName: string;
  qty: number;
}

export interface StockDelta {
  productId: string;
  productName: string;
  /** Signed. Positive returns stock, negative takes more out. */
  qty: number;
  oldQty: number;
  newQty: number;
}

/**
 * The movements needed to take a document from `before` to `after`.
 *
 * Products whose quantity did not change are left out entirely. Writing a
 * zero-quantity movement would fill the ledger with rows that say nothing
 * happened, and the ledger's whole value is that every row means something.
 */
export function stockDelta(before: StockLine[], after: StockLine[]): StockDelta[] {
  const oldQty = new Map<string, number>();
  const newQty = new Map<string, number>();
  const names = new Map<string, string>();

  // Summed per product, not per line. The same product can appear twice on one
  // invoice - two sizes billed separately, or a line added by mistake - and
  // treating those as separate products would move stock twice.
  for (const l of before) {
    if (!l.productId) continue;
    oldQty.set(l.productId, (oldQty.get(l.productId) ?? 0) + l.qty);
    names.set(l.productId, l.productName);
  }
  for (const l of after) {
    if (!l.productId) continue;
    newQty.set(l.productId, (newQty.get(l.productId) ?? 0) + l.qty);
    names.set(l.productId, l.productName);
  }

  const out: StockDelta[] = [];
  for (const productId of new Set([...oldQty.keys(), ...newQty.keys()])) {
    const o = oldQty.get(productId) ?? 0;
    const n = newQty.get(productId) ?? 0;
    if (o === n) continue;
    out.push({
      productId,
      productName: names.get(productId) ?? 'Unknown',
      qty: o - n,
      oldQty: o,
      newQty: n,
    });
  }
  return out;
}

/**
 * A plain-language summary of what an edit changed, for the revision record.
 *
 * Stored as text rather than a diff structure, because the thing anybody
 * actually wants six months later is a sentence they can read - "qty on
 * CRMS-LEVEL 0 went from 3 to 5" - not a JSON blob they have to interpret.
 */
export function describeChanges(
  before: { lines: StockLine[]; grandTotalPaise: number },
  after: { lines: StockLine[]; grandTotalPaise: number },
): string[] {
  const notes: string[] = [];

  for (const d of stockDelta(before.lines, after.lines)) {
    if (d.oldQty === 0) notes.push(`Added ${d.productName} × ${d.newQty}`);
    else if (d.newQty === 0) notes.push(`Removed ${d.productName} (was × ${d.oldQty})`);
    else notes.push(`${d.productName}: qty ${d.oldQty} → ${d.newQty}`);
  }

  // Lines with no product still matter to the customer even though they hold
  // no stock, so they are counted rather than ignored.
  const freeBefore = before.lines.filter((l) => !l.productId).length;
  const freeAfter = after.lines.filter((l) => !l.productId).length;
  if (freeBefore !== freeAfter) {
    notes.push(`Free-text lines: ${freeBefore} → ${freeAfter}`);
  }

  if (before.grandTotalPaise !== after.grandTotalPaise) {
    const diff = after.grandTotalPaise - before.grandTotalPaise;
    notes.push(
      `Total ${diff > 0 ? 'up' : 'down'} by ₹${Math.abs(diff / 100).toLocaleString('en-IN')}`
      + ` (₹${(before.grandTotalPaise / 100).toLocaleString('en-IN')}`
      + ` → ₹${(after.grandTotalPaise / 100).toLocaleString('en-IN')})`,
    );
  }

  // An edit that changed only a rate or a discount leaves no line-level note,
  // and "nothing changed" would be a lie on the history screen.
  if (notes.length === 0) notes.push('Details changed with no effect on quantities or total');

  return notes;
}
