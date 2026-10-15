import { addMonths, daysBetween } from './expiry';
import { DEAD_STOCK_DAYS } from './product-metrics';

/**
 * THE LIFE OF ONE PHYSICAL UNIT - its states, what may follow what, and what
 * each move does to the stock count.
 *
 * Written the way lib/amc-status and installation-challans write theirs: a
 * transition table, pure, tested. In lib/ because the unit screen needs the
 * labels and the allowed next states, and server/*.ts is server-only.
 *
 * NOTHING HERE IS SPECIFIC TO A TRADE. A camera, a generator and a laptop all
 * sit on a shelf, go out to a customer, go back to a supplier and get
 * scrapped. What differs by trade lives in custom fields, not here.
 */

export const UNIT_STATUSES = [
  'in_stock', 'reserved', 'with_customer', 'with_supplier', 'scrapped', 'lost',
  // With us for repair, still the customer's (10 Oct 2026, repair flow stage 3).
  'in_repair',
  // The supplier kept it - sent a new serial or a credit note instead (stage 5).
  'supplier_kept',
] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  in_stock: 'In stock',
  reserved: 'Reserved',
  with_customer: 'With customer',
  with_supplier: 'Away with supplier',
  scrapped: 'Scrapped',
  lost: 'Lost',
  in_repair: "In for repair (customer's)",
  supplier_kept: 'Kept by supplier',
};

export const UNIT_STATUS_TONE: Record<UnitStatus, 'success' | 'info' | 'brand' | 'warning' | 'neutral' | 'danger'> = {
  in_stock: 'success',
  reserved: 'info',
  with_customer: 'brand',
  with_supplier: 'warning',
  scrapped: 'neutral',
  lost: 'danger',
  in_repair: 'info',
  supplier_kept: 'neutral',
};

export function isUnitStatus(v: unknown): v is UnitStatus {
  return typeof v === 'string' && (UNIT_STATUSES as readonly string[]).includes(v);
}

export const UNIT_CONDITIONS = ['new', 'refurbished'] as const;
export type UnitCondition = (typeof UNIT_CONDITIONS)[number];
export const UNIT_CONDITION_LABEL: Record<UnitCondition, string> = {
  new: 'New',
  refurbished: 'Refurbished',
};

/**
 * THE SHELF. A unit in one of these states is physically ours and counts
 * toward stock on hand. Reserved still counts: it is on the shelf, promised
 * but not yet gone, which is exactly how `ProductBalance.reservedQty` already
 * reads.
 */
export const ON_SHELF: readonly UnitStatus[] = ['in_stock', 'reserved'];
export const isOnShelf = (s: string) => (ON_SHELF as readonly string[]).includes(s);

/**
 * What may follow what.
 *
 * - `with_customer -> in_stock` is a return. `with_customer -> with_supplier`
 *   is a faulty unit collected from site and sent straight back for repair.
 * - `with_supplier -> in_stock` is the unit coming back, repaired or replaced;
 *   the caller may mark it refurbished on the way.
 * - `lost -> in_stock` is allowed: things get found, and refusing it would
 *   leave a found camera with nowhere honest to go.
 * - `scrapped` is the one terminal state. Un-scrapping erases why.
 */
export const UNIT_TRANSITIONS: Record<UnitStatus, UnitStatus[]> = {
  in_stock: ['reserved', 'with_customer', 'with_supplier', 'scrapped', 'lost'],
  reserved: ['in_stock', 'with_customer', 'lost'],
  with_customer: ['in_stock', 'with_supplier', 'scrapped', 'lost', 'in_repair'],
  with_supplier: ['in_stock', 'with_customer', 'scrapped', 'lost', 'in_repair', 'supplier_kept'],
  scrapped: [],
  lost: ['in_stock'],
  /**
   * IN FOR REPAIR (10 Oct 2026): picked up from the customer's site, with us,
   * still theirs. Not on the shelf - it is not stock we can sell - and it keeps
   * the invoice it was sold on, which `with_customer -> in_stock` used to
   * clear, losing the customer's proof of purchase on every repair. Out to the
   * supplier and back again, then handed back to the customer.
   */
  in_repair: ['with_customer', 'with_supplier', 'lost'],
  /**
   * KEPT BY THE SUPPLIER (10 Oct 2026, stage 5): they sent a new serial or a
   * credit note and kept the old unit, or wrote that they scrapped it. Not
   * ours, not the customer's any more - the end of its story, like scrapped.
   */
  supplier_kept: [],
};

/** Which kind of party must be named for a unit to be in this state. */
export const HOLDER_FOR: Partial<Record<UnitStatus, 'customer' | 'supplier'>> = {
  with_customer: 'customer',
  in_repair: 'customer',
  with_supplier: 'supplier',
};

export type TransitionPlan =
  | {
    ok: true;
    /**
     * What this move does to stock on hand: -1 leaving the shelf, +1 coming
     * back to it, 0 moving between two shelf states or two off-shelf states.
     * The caller writes exactly this as a movement, so the quantity ledger and
     * the unit table cannot disagree about a unit that moved.
     */
    stockDelta: -1 | 0 | 1;
    /** The holder the unit should carry afterwards - null means "ours". */
    partyId: string | null;
  }
  | { ok: false; reason: string };

export function planUnitTransition(input: {
  from: string;
  to: string;
  /** The customer or supplier it is going to, when the new state needs one. */
  partyId?: string | null;
  /**
   * True when a DOCUMENT has already moved the stock for this unit - an
   * invoice takes goods off the shelf the moment it is created. Linking the
   * unit to that invoice records which unit it was; deducting again would
   * count one camera leaving twice. The stock effect is then 0, and the
   * document's own movement is the one on the ledger.
   */
  stockAlreadyMoved?: boolean;
}): TransitionPlan {
  const { from, to } = input;
  if (!isUnitStatus(from)) return { ok: false, reason: `Unknown current status "${from}".` };
  if (!isUnitStatus(to)) return { ok: false, reason: `Unknown status "${to}".` };
  if (from === to) return { ok: false, reason: `It is already ${UNIT_STATUS_LABEL[to].toLowerCase()}.` };

  if (!UNIT_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      reason: from === 'scrapped'
        ? 'A scrapped unit stays scrapped.'
        : `A unit cannot go from ${UNIT_STATUS_LABEL[from].toLowerCase()} to ${UNIT_STATUS_LABEL[to].toLowerCase()}.`,
    };
  }

  const holder = HOLDER_FOR[to];
  const partyId = input.partyId?.trim() || null;
  if (holder && !partyId) {
    return { ok: false, reason: `Say which ${holder} it is going to.` };
  }

  const was = isOnShelf(from);
  const will = isOnShelf(to);
  const stockDelta: -1 | 0 | 1 = was === will || input.stockAlreadyMoved ? 0 : will ? 1 : -1;

  return { ok: true, stockDelta, partyId: holder ? partyId : null };
}

/**
 * WHEN THE CUSTOMER'S WARRANTY ON A UNIT STARTS.
 *
 * The store chooses the basis (`Store.warrantyStartsOn`). If the chosen date
 * is missing - a unit installed from an old challan with no invoice linked,
 * or one sold over the counter and never installed - the other date is used
 * rather than reporting no warranty at all, because "we cannot tell when it
 * started" is not the same as "it has none". Both missing means not sold.
 */
export function warrantyStart(input: {
  basis: string;
  invoiceDate: Date | null;
  installDate: Date | null;
  /**
   * A fresh warranty (10 Oct 2026, repair flow stage 6): the day a supplier's
   * new serial, or a unit from our stock given in place of one the supplier
   * kept, was handed over. It wins over both dates - decision 4.
   */
  restartedOn?: Date | null;
}): Date | null {
  const { basis, invoiceDate, installDate } = input;
  if (input.restartedOn) return input.restartedOn;
  if (basis === 'install') return installDate ?? invoiceDate;
  return invoiceDate ?? installDate;
}

/**
 * The SUPPLIER'S warranty - can we send it back. From the day it arrived,
 * using the same clamped month arithmetic as every other expiry here.
 */
export function supplierWarrantyUntil(receivedAt: Date, months: number | null): Date | null {
  if (months === null || months <= 0) return null;
  return addMonths(receivedAt, months);
}

/* ------------------------------------------------------------------- pools */

/**
 * The views over the unit table. Views, not tables: a unit is in a pool
 * because of what it is, and moving it is changing its status - there is no
 * second place for it to be.
 */
export const UNIT_POOLS = [
  'in_stock', 'refurbished', 'dead_stock', 'awaiting_serial', 'with_supplier', 'with_customer', 'in_repair',
] as const;
export type UnitPool = (typeof UNIT_POOLS)[number];

export const UNIT_POOL_LABEL: Record<UnitPool, string> = {
  in_stock: 'In stock',
  refurbished: 'Refurbished on the shelf',
  dead_stock: 'Dead stock',
  awaiting_serial: 'Serial to follow',
  with_supplier: 'Away with supplier',
  with_customer: 'With customers',
  in_repair: 'In for repair',
};

export interface PoolSubject {
  status: string;
  condition: string;
  serialNo: string | null;
  receivedAt: Date;
}

/**
 * Dead stock reuses `DEAD_STOCK_DAYS` from lib/product-metrics rather than
 * picking its own number, so "dead" means the same thing on the products list
 * and here. For a unit it is measured from arrival: a camera on the shelf for
 * a year has not sold in a year, whatever its siblings did.
 */
export function inPool(u: PoolSubject, pool: UnitPool, now: Date = new Date()): boolean {
  switch (pool) {
    case 'in_stock': return isOnShelf(u.status);
    case 'refurbished': return isOnShelf(u.status) && u.condition === 'refurbished';
    case 'dead_stock': return isOnShelf(u.status) && daysBetween(u.receivedAt, now) >= DEAD_STOCK_DAYS;
    case 'awaiting_serial': return !u.serialNo && u.status !== 'scrapped';
    case 'with_supplier': return u.status === 'with_supplier';
    case 'with_customer': return u.status === 'with_customer';
    case 'in_repair': return u.status === 'in_repair';
  }
}

export function countPools(units: PoolSubject[], now: Date = new Date()): Record<UnitPool, number> {
  const out = Object.fromEntries(UNIT_POOLS.map((p) => [p, 0])) as Record<UnitPool, number>;
  for (const u of units) for (const p of UNIT_POOLS) if (inPool(u, p, now)) out[p] += 1;
  return out;
}

/* ------------------------------------------------------------ reconciliation */

/**
 * Does the quantity ledger agree with the unit table, for a serial product?
 *
 * They are two views of one shelf, and they can legitimately disagree - a
 * "count only" receipt adds quantity with no units, by design. So this does
 * not correct anything. It says which way the gap runs and what closes it,
 * because the two fixes are different: more on hand than units means serials
 * to record; more units than on hand means a movement was never written.
 */
export function reconcileSerialStock(onHand: number, unitsOnShelf: number): {
  matches: boolean;
  difference: number;
  message: string | null;
} {
  const difference = onHand - unitsOnShelf;
  if (difference === 0) return { matches: true, difference, message: null };
  if (difference > 0) {
    return {
      matches: false,
      difference,
      message: `${difference} on hand with no unit record. Receive their serials, or add them as placeholders.`,
    };
  }
  return {
    matches: false,
    difference,
    message: `${-difference} more units on the shelf than the stock count says. `
      + 'A movement is missing - check recent dispatches, or count the shelf.',
  };
}

/** Customer-warranty months for a unit: its own override, else the product's. */
export function unitWarrantyMonths(unitMonths: number | null, productMonths: number | null): number | null {
  return unitMonths ?? productMonths;
}
