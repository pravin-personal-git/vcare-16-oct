/**
 * RECEIPT SAFETY (G1, Scan-to-Stock, 12 Oct 2026 - Pravin: "I received it, but
 * it only made a GRN and never reached inventory").
 *
 * A goods receipt line moves stock only when it names a catalogue product.
 * A line typed as text ("Not in catalogue") used to post quietly, the receipt
 * looked complete, and the shelf never moved. Decision (12 Oct, "go with your
 * recommendations"): BLOCK posting until every line is linked - on the
 * website and the phone, which share `receiveGoods`. Receipts created behind
 * a purchase bill are not this door (a bill may carry freight or a service
 * line), so the rule lives here and is called from the manual path only.
 *
 * Pure, so the wording and the counting are tested without a database.
 */

export interface SafetyLine {
  productId?: string | null;
  productName: string;
  qty: number;
  /** The product's tracking mode, when the line is linked. */
  trackingMode?: string | null;
  /** Serial products: serials scanned or typed. */
  serials?: number;
  /** Serial products: boxes with no readable serial (house tags). */
  noSerial?: number;
}

/** Why a receipt cannot post, or null when every line is linked. */
export function unlinkedLinesError(lines: readonly { productId?: string | null; productName: string }[]): string | null {
  const unlinked = lines.filter((l) => !l.productId && l.productName.trim());
  if (unlinked.length === 0) return null;
  const names = unlinked.slice(0, 3).map((l) => `"${l.productName.trim()}"`).join(', ')
    + (unlinked.length > 3 ? ` and ${unlinked.length - 3} more` : '');
  return `${names} ${unlinked.length === 1 ? 'is' : 'are'} not a product in Atlas yet, so `
    + `${unlinked.length === 1 ? 'it' : 'they'} would add no stock. `
    + 'Pick the product on the line, or create it, then post.';
}

/** What a receipt will put on the shelf - said before posting. */
export function receiptStockSummary(lines: readonly SafetyLine[]): {
  items: number; lines: number; serials: number; houseTags: number; notStocked: number; unlinked: number; text: string;
} {
  let items = 0; let linked = 0; let serials = 0; let houseTags = 0; let notStocked = 0; let unlinked = 0;
  for (const l of lines) {
    if (!l.productName.trim() || !(l.qty > 0)) continue;
    if (!l.productId) { unlinked++; continue; }
    if (l.trackingMode === 'none') { notStocked++; continue; }
    linked++;
    items += l.qty;
    if (l.trackingMode === 'serial') {
      serials += l.serials ?? 0;
      houseTags += l.noSerial ?? 0;
    }
  }
  const parts = [`This receipt will add ${items} item${items === 1 ? '' : 's'} to stock`
    + ` from ${linked} line${linked === 1 ? '' : 's'}`];
  if (serials || houseTags) {
    parts.push(`${serials} with the maker's serial${houseTags ? `, ${houseTags} getting a house tag` : ''}`);
  }
  if (notStocked) parts.push(`${notStocked} line${notStocked === 1 ? ' is a' : 's are'} not stocked (services)`);
  if (unlinked) parts.push(`${unlinked} line${unlinked === 1 ? '' : 's'} not linked to a product - posting is blocked`);
  return { items, lines: linked, serials, houseTags, notStocked, unlinked, text: `${parts.join('. ')}.` };
}
