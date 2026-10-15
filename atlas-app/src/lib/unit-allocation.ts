import type { UnitStatus } from './stock-units';

/**
 * The pure half of Rules 3 and 4 (3 Oct 2026).
 *
 * In `lib/` rather than `server/` because the order form needs `freeToSell` to
 * show "4 free of 7 on the shelf" as somebody types a quantity, and
 * `server/*.ts` is server-only. The database half is `server/unit-allocation`.
 */

/**
 * What becomes of a unit that leaves the shelf.
 *
 * Named by INTENT rather than by status, because the caller knows why stock is
 * moving and should not have to know the unit state machine. `none` is the
 * default for anything ambiguous - an invoice edit, a migration backfill - and
 * means "move the quantity, touch no unit". Guessing is worse than not binding:
 * a unit wrongly marked `lost` has to be found and corrected by hand.
 */
export type UnitDestination = 'customer' | 'supplier' | 'lost' | 'scrapped' | 'none';

export const DESTINATION_STATUS: Record<Exclude<UnitDestination, 'none'>, UnitStatus> = {
  customer: 'with_customer',
  supplier: 'with_supplier',
  lost: 'lost',
  scrapped: 'scrapped',
};

/**
 * Free to sell: on the shelf, less what is already promised.
 *
 * Floored at zero. A negative "free" figure is arithmetic, not information - a
 * salesperson needs to know they have nothing spare, and "-3 available" invites
 * them to work out whether that is a problem.
 */
export function freeToSell(onHand: number, promised: number): number {
  return Math.max(0, onHand - Math.max(0, promised));
}

/**
 * The line a salesperson reads before promising stock.
 *
 * Deliberately not an error and not a warning tone - most of the time it is
 * simply a fact. It only becomes a problem when they ask for more than is free,
 * and then it says so in the same sentence rather than in a separate alert they
 * have already dismissed.
 */
export function availabilityWords(a: {
  onHand: number; promised: number; unit: string; wanted?: number;
}): { text: string; short: boolean } {
  const free = freeToSell(a.onHand, a.promised);
  const u = a.unit || 'pcs';

  const base = a.promised > 0
    ? `${free} ${u} free to sell · ${a.onHand} on the shelf, ${a.promised} promised to other orders`
    : `${a.onHand} ${u} on the shelf`;

  if (a.wanted != null && a.wanted > free) {
    return {
      short: true,
      text: `${base}. This line asks for ${a.wanted} — ${a.wanted - free} more than is free.`,
    };
  }
  return { short: false, text: base };
}

/**
 * The note appended to a movement when identity could not be bound in full.
 *
 * On the movement rather than swallowed, because the stock ledger is the thing
 * an accountant reads when the shelf and the system disagree, and "we could not
 * say which items these were" belongs in that story. Returns null when there is
 * nothing to say, so a healthy dispatch carries no noise.
 */
export function shortfallNote(bound: number, short: number): string | null {
  if (short <= 0) return null;
  const total = bound + short;
  return `${short} of ${total} left with no serial on record `
    + '- this product needs a stock count (Inventory > Stock Checks).';
}
