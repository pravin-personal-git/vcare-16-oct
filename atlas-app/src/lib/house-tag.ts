import { istWall } from './ist';

/**
 * HOUSE TAGS - a number for an item the vendor never numbered (2 Oct 2026).
 *
 * THE PROBLEM THIS CLOSES.
 *
 * Goods receipt accepted FEWER serials than it received. `postGrn` refused
 * more serials than the quantity (`units.length > item.qty`) and never once
 * checked for too few. So: receive ten cameras, type three serials, and the
 * quantity ledger gains ten while the identity ledger gains three. Seven items
 * are on the shelf that Atlas cannot name, and nothing anywhere notices.
 *
 * Measured on the development database before this: of 321 serial-tracked
 * products, 91 - 28% - had a shelf quantity that disagreed with their unit
 * count, about 39,000 items between them.
 *
 * Rule 1 of 09-documentation/03-specs/STOCK-IDENTITY-SPEC.md: every item of a
 * serial-tracked product gets a unit AT INTAKE, with no exceptions. Where the
 * vendor printed a serial, that is the identity. Where they did not, Atlas
 * issues one of these and the clerk sticks the printed label on.
 *
 * WHY THIS FORMAT - `{PRODUCT_CODE}-{YYMM}-{SEQ}`, e.g. `SWT-D005-2610-0007`.
 *
 * It is readable off a label by a person, it sorts by age, and the product code
 * in front means somebody holding the item can tell what it is without looking
 * it up. The month rather than the full date keeps it short while still
 * grouping a delivery, and `SEQ` restarts each month so the number never grows
 * unbounded over the years.
 *
 * WHY NOT THE DOCUMENT-NUMBERING SERVICE.
 *
 * `allocateDocumentNumber` issues `{TYPE}-{BRANCH}-{FY}-{SEQ}` from a
 * per-store, per-financial-year row in `DocumentSequence`. A per-PRODUCT
 * sequence through it would mean one sequence row per product per year -
 * thousands of rows for a catalogue of 1,339 - and a tag reading
 * `HT-BR001-2026-0007`, which tells the person holding the camera nothing
 * about which camera it is.
 *
 * So the sequence is derived from what that product already carries this month
 * (`nextSequence` below), inside the posting transaction. The real guarantee is
 * the database: `StockUnit` is unique on `(storeId, productId, serialNo)`, so
 * two clerks receiving the same product in the same instant cannot both commit
 * the same tag - the second transaction fails the index and rolls back whole.
 * That is the correct trade for a path where two people receive the same
 * product at the same moment perhaps never, and where a wrong answer would be
 * two physical items sharing one number.
 */

/** Width of the sequence. Four digits is 9,999 house tags of one product a month. */
const PAD = 4;

/** `SWT-D005-2610-`, in India time - a delivery booked at 23:00 IST is that day. */
export function housePrefix(productCode: string, at: Date): string {
  const w = istWall(at);
  const yy = String(w.getFullYear() % 100).padStart(2, '0');
  const mm = String(w.getMonth() + 1).padStart(2, '0');
  return `${productCode.trim().toUpperCase()}-${yy}${mm}-`;
}

/** True when `serial` looks like one of our tags for this product and month. */
export function isHouseTag(serial: string | null | undefined, prefix: string): boolean {
  if (!serial) return false;
  const rest = serial.toUpperCase().startsWith(prefix) ? serial.slice(prefix.length) : null;
  return rest !== null && /^\d+$/.test(rest);
}

/**
 * The next sequence to issue, given every serial that product already holds.
 *
 * Reads the HIGHEST existing number rather than counting rows, because a unit
 * can be deleted - a cancelled receipt removes its units - and counting would
 * then re-issue a number that may be printed on a label somewhere. Numbers are
 * never reused; a gap in the sequence is not a problem, a duplicate is.
 *
 * Serials that are not our tags are ignored, which is the point: a product can
 * hold vendor serials and house tags side by side, which is exactly what a
 * delivery of ten cameras with three serials printed on them produces.
 */
export function nextSequence(existingSerials: readonly (string | null)[], prefix: string): number {
  let max = 0;
  for (const s of existingSerials) {
    if (!isHouseTag(s, prefix)) continue;
    const n = Number(s!.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * `count` tags for one product, continuing from what it already holds.
 *
 * Returns them in order, so the labels come off the printer in the order the
 * clerk puts them on the boxes.
 */
export function houseTags(
  productCode: string,
  at: Date,
  count: number,
  existingSerials: readonly (string | null)[] = [],
): string[] {
  if (count <= 0) return [];
  const prefix = housePrefix(productCode, at);
  const start = nextSequence(existingSerials, prefix);
  return Array.from({ length: count }, (_, i) => `${prefix}${String(start + i).padStart(PAD, '0')}`);
}

/**
 * Decide an identity for every item on a receipt line.
 *
 * `typed` is one entry per item the CALLER accounted for, in the order the
 * clerk entered them. Two different things can be in it, and the difference
 * matters:
 *
 *   a string  the serial printed on that item          -> `vendor`
 *   null      "this item's serial is to follow"        -> `vendor`, left blank
 *
 * And then there are the items the caller did not account for at all - a line
 * received count-only, or a receipt this app created for itself behind a
 * supplier bill. Those are slots past the end of `typed`, and THOSE are the
 * ones that get a house tag. That is the whole of Rule 1: an item nobody
 * named still gets a record, instead of silently not existing.
 *
 * The distinction is deliberate. "Serials to follow" means the vendor's number
 * is on the box and will be typed in; printing our own label over it would
 * create two numbers for one item. "No serials" means there is nothing to
 * read, now or later, so Atlas supplies the number.
 *
 * Positions are preserved: the clerk typed the third serial against the third
 * box, and a function that appended instead would quietly reassign them.
 */
export function completeLineSerials(input: {
  productCode: string;
  qty: number;
  typed: readonly (string | null)[];
  at: Date;
  existingSerials?: readonly (string | null)[];
}): { serialNo: string | null; identitySource: 'vendor' | 'house' }[] {
  const { productCode, qty, typed, at } = input;
  const total = Math.max(0, qty);
  const accounted = Math.min(typed.length, total);

  const kept: (string | null)[] = Array.from({ length: accounted }, (_, i) => {
    const v = typed[i];
    const trimmed = typeof v === 'string' ? v.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
  });

  const tags = houseTags(productCode, at, total - accounted, [
    ...(input.existingSerials ?? []),
    // What was typed on THIS line counts as existing too: a clerk who happens
    // to type a number matching our tag format must not have it issued again.
    ...kept,
  ]);

  return [
    ...kept.map((serialNo) => ({ serialNo, identitySource: 'vendor' as const })),
    ...tags.map((serialNo) => ({ serialNo, identitySource: 'house' as const })),
  ];
}
