import { istWall } from './ist';

/**
 * WHEN STOCK GOES OUT OF DATE, AND WHEN TO SAY SO (2 Oct 2026).
 *
 * WHAT WAS THERE BEFORE: a column and nothing else. `StockLot.expiryDate` and
 * `GoodsReceiptNoteItem.expiryDate` have existed since batches did, are
 * captured at goods receipt, and were **never read again** by any screen,
 * report or alert. Nobody was ever told anything expired.
 *
 * WHY THIS IS NOT TIED TO BATCH TRACKING.
 *
 * `trackingMode = batch` answers "which lot did this item come from" - a recall
 * question, and real paperwork. Expiry answers "will this spoil on my shelf".
 * They are not the same client. A kirana store's milk expires and is counted by
 * quantity; a certified fastener is batch-tracked for an audit and never
 * expires. Forcing a corner shop into per-lot bookkeeping to get a reminder
 * about milk would be the wrong product.
 *
 * So `Product.tracksExpiry` is its own switch, and the date comes from
 * whichever record holds it:
 *
 *   batch product     -> the LOT's expiry, because lots differ
 *   anything else     -> the RECEIPT LINE's expiry, one date per delivery
 *
 * And where nobody typed a date, `Product.shelfLifeDays` derives it from the
 * day it was received. A shop that knows its bread keeps four days should not
 * have to type a date on every delivery.
 *
 * DAYS ARE COUNTED IN INDIA TIME. The server runs in UTC on Vercel, so
 * flooring to the server's midnight makes "expires today" flip at 05:30 IST -
 * the same class of bug the attendance module had (see lib/ist).
 */

/**
 * How much notice, when the product does not say.
 *
 * Ten days: long enough to discount it, move it to another branch or send it
 * back to the supplier, short enough that the list is things to act on this
 * week rather than a standing inventory.
 */
export const DEFAULT_WARN_DAYS = 10;

/** The warning window for one product, with the platform default behind it. */
export function warnDaysFor(productWarnDays: number | null | undefined): number {
  return productWarnDays != null && productWarnDays >= 0 ? productWarnDays : DEFAULT_WARN_DAYS;
}

/** India's calendar day for an instant, as `YYYY-MM-DD`. */
export function istDay(at: Date): string {
  const w = istWall(at);
  return `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')}`;
}

/**
 * Whole days from `from` to `to`, both read as India calendar days.
 *
 * 0 means it expires today, which is NOT expired - a pack dated the 30th is
 * good all day on the 30th, and telling a shopkeeper otherwise loses them a
 * sale they were entitled to make.
 */
export function daysUntil(to: Date, from: Date = new Date()): number {
  const day = (d: Date) => {
    const w = istWall(d);
    return Date.UTC(w.getFullYear(), w.getMonth(), w.getDate());
  };
  return Math.round((day(to) - day(from)) / 86_400_000);
}

export type ExpiryBand = 'expired' | 'expiring' | 'fine';

export interface ExpiryVerdict {
  daysLeft: number;
  band: ExpiryBand;
  /** One line a person can act on, with no jargon. */
  words: string;
}

export function expiryVerdict(
  expiryDate: Date,
  warnDays: number | null | undefined,
  now: Date = new Date(),
): ExpiryVerdict {
  const daysLeft = daysUntil(expiryDate, now);
  const window = warnDaysFor(warnDays);

  if (daysLeft < 0) {
    const n = -daysLeft;
    return {
      daysLeft,
      band: 'expired',
      words: `Expired ${n} day${n === 1 ? '' : 's'} ago - do not sell it`,
    };
  }
  if (daysLeft <= window) {
    return {
      daysLeft,
      band: 'expiring',
      words: daysLeft === 0
        ? 'Last day to sell it'
        : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left - sell it, move it or send it back`,
    };
  }
  return { daysLeft, band: 'fine', words: `${daysLeft} days left` };
}

/**
 * The expiry date to record for a delivery, when nobody typed one.
 *
 * Null when the product has no shelf life on file - a guessed date is worse
 * than no date, because a reminder fires on it and somebody throws away good
 * stock or keeps bad stock.
 */
export function deriveExpiry(
  receivedAt: Date,
  shelfLifeDays: number | null | undefined,
): Date | null {
  if (shelfLifeDays == null || shelfLifeDays <= 0) return null;
  return new Date(receivedAt.getTime() + shelfLifeDays * 86_400_000);
}
