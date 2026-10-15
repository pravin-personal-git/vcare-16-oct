import { daysBetween } from './expiry';

/**
 * THE REPLACEMENT (RMA) TRACKER - statuses, what may follow what, and when a
 * case is late.
 *
 * "Where is my camera?" is the commonest chase in a trade that sends faulty
 * items back to a supplier or a service centre. A case follows the item out
 * and back: open (logged, still here) -> sent -> received back -> returned to
 * the customer -> closed. Pure, in lib/, so the screen and the server share
 * one rule and the tests state it directly.
 *
 * Nothing here is specific to any trade - a laptop, a generator part and a
 * DVR all go out to a service centre and come back.
 */

export const RMA_STATUSES = ['open', 'sent', 'received_back', 'returned_to_customer', 'closed', 'cancelled'] as const;
export type RmaStatus = (typeof RMA_STATUSES)[number];

export const RMA_STATUS_LABEL: Record<RmaStatus, string> = {
  open: 'Logged - not sent yet',
  sent: 'Sent for repair / replacement',
  received_back: 'Back in the office',
  returned_to_customer: 'Returned to customer',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const RMA_STATUS_TONE: Record<RmaStatus, 'neutral' | 'warning' | 'info' | 'success' | 'danger'> = {
  open: 'neutral',
  sent: 'warning',
  received_back: 'info',
  returned_to_customer: 'success',
  closed: 'success',
  cancelled: 'neutral',
};

export function isRmaStatus(v: unknown): v is RmaStatus {
  return typeof v === 'string' && (RMA_STATUSES as readonly string[]).includes(v);
}

/**
 * What may follow what.
 *
 * - `received_back -> sent` is a second trip: it came back still faulty and
 *   goes out again on the SAME case. A genuinely new fault on a unit already
 *   returned to the customer is a new case chained with `parentCaseId`.
 * - `received_back -> closed` covers an item that never goes back to a
 *   customer - refurbished into stock, or scrapped.
 * - `open -> closed` is "Scrap now": an old unit that is of no use, never
 *   sent anywhere (28 Sep 2026) - only with the outcome `scrapped`.
 * - `sent -> closed` is the supplier closing it with nothing coming back -
 *   their credit note or a written reply that they kept or scrapped it
 *   (10 Oct 2026, repair flow stage 5) - only with one of those outcomes.
 * - `cancelled` and `closed` are terminal.
 */
export const RMA_TRANSITIONS: Record<RmaStatus, RmaStatus[]> = {
  open: ['sent', 'closed', 'cancelled'],
  sent: ['received_back', 'closed', 'cancelled'],
  received_back: ['sent', 'returned_to_customer', 'closed'],
  returned_to_customer: ['closed'],
  closed: [],
  cancelled: [],
};

export const RMA_OUTCOMES = ['repaired', 'replaced', 'refurbished_to_stock', 'scrapped', 'credit_note', 'returned_unrepaired'] as const;
export type RmaOutcome = (typeof RMA_OUTCOMES)[number];

export const RMA_OUTCOME_LABEL: Record<RmaOutcome, string> = {
  repaired: 'Repaired',
  replaced: 'Replaced with a new unit',
  refurbished_to_stock: 'Kept as refurbished stock',
  scrapped: 'Scrapped',
  credit_note: 'Supplier gave a credit note',
  returned_unrepaired: 'Came back not repaired',
};

/** Outcomes that close a case straight from "sent" - nothing came back. */
export const CLOSED_AT_SUPPLIER: readonly RmaOutcome[] = ['credit_note', 'scrapped'];

/**
 * THE SUPPLIER'S ANSWER (stage 5), recorded while the item is still with
 * them: what they will do, and their quote when they charge for it.
 */
export const SUPPLIER_ANSWERS = ['repair', 'replace', 'credit', 'cannot_repair'] as const;
export type SupplierAnswer = (typeof SUPPLIER_ANSWERS)[number];
export const SUPPLIER_ANSWER_LABEL: Record<SupplierAnswer, string> = {
  repair: 'Will repair it',
  replace: 'Sending a new one',
  credit: 'Giving a credit note',
  cannot_repair: 'Cannot repair it',
};
export const isSupplierAnswer = (v: unknown): v is SupplierAnswer => typeof v === 'string' && (SUPPLIER_ANSWERS as readonly string[]).includes(v);

/**
 * What the customer is asked to pay for a repair the warranty does not
 * cover (decision 5, 10 Oct 2026): the supplier's charge plus the business's
 * markup, before GST. Whole paise, rounded half up.
 */
export function repairPricePaise(supplierQuotePaise: number, markupPct: number): number {
  if (!(supplierQuotePaise > 0)) return 0;
  return Math.round(supplierQuotePaise * (1 + Math.max(0, markupPct) / 100));
}

export interface RmaMove {
  from: string;
  to: string;
  /** Where it goes, required when sending. */
  supplierId?: string | null;
  supplierName?: string | null;
  serviceCentre?: string | null;
  /** Required when the item comes back: what happened to it. */
  outcome?: string | null;
}

export type RmaPlan = { ok: true } | { ok: false; reason: string };

/**
 * Whether a move is allowed, and whether it carries what it needs.
 *
 * Sending needs somewhere to send it - a supplier on file, a free-text
 * supplier name, or a service centre - because "sent, to nobody" is the one
 * answer that makes the case untraceable. Coming back needs an outcome, since
 * "what happened to it" is the question the customer asks next.
 */
export function planRmaMove(m: RmaMove): RmaPlan {
  if (!isRmaStatus(m.from)) return { ok: false, reason: `Unknown status "${m.from}".` };
  if (!isRmaStatus(m.to)) return { ok: false, reason: `Unknown status "${m.to}".` };
  if (m.from === m.to) return { ok: false, reason: 'It is already at that step.' };
  if (!RMA_TRANSITIONS[m.from].includes(m.to)) {
    return {
      ok: false,
      reason: RMA_TRANSITIONS[m.from].length === 0
        ? `A ${RMA_STATUS_LABEL[m.from].toLowerCase()} case cannot change.`
        : `A case cannot go from "${RMA_STATUS_LABEL[m.from]}" to "${RMA_STATUS_LABEL[m.to]}".`,
    };
  }
  if (m.to === 'sent' && !(m.supplierId || m.supplierName?.trim() || m.serviceCentre?.trim())) {
    return { ok: false, reason: 'Say where it is going - a supplier or a service centre.' };
  }
  if (m.from === 'open' && m.to === 'closed' && m.outcome !== 'scrapped') {
    return { ok: false, reason: 'A case that was never sent can only be closed by scrapping it.' };
  }
  if (m.from === 'sent' && m.to === 'closed' && !(CLOSED_AT_SUPPLIER as readonly (string | null | undefined)[]).includes(m.outcome)) {
    return { ok: false, reason: 'With nothing back, a case closes only on the supplier\'s credit note or their written reply.' };
  }
  if (m.to === 'received_back') {
    if (!m.outcome) return { ok: false, reason: 'Say what happened to it - repaired, replaced, scrapped…' };
    if (!(RMA_OUTCOMES as readonly string[]).includes(m.outcome)) return { ok: false, reason: `Unknown outcome "${m.outcome}".` };
  }
  return { ok: true };
}

/**
 * How late a case is. Only a case that is OUT counts - once it is back, the
 * clock that matters is the customer's, not the supplier's.
 *
 * Whole days from midnight, via lib/expiry, so an item due back today is not
 * late until tomorrow.
 */
export function rmaLateness(c: {
  status: string;
  expectedBackAt: Date | null;
}, now: Date = new Date()): { overdue: boolean; daysLate: number } {
  if (c.status !== 'sent' || !c.expectedBackAt) return { overdue: false, daysLate: 0 };
  const late = daysBetween(c.expectedBackAt, now);
  return { overdue: late > 0, daysLate: Math.max(0, late) };
}

/**
 * The unit status a case move implies, for a case with a serialised unit
 * attached. Null means "leave the unit alone".
 *
 * Out to the supplier: `with_supplier`. Back and refurbished into stock, or
 * repaired and waiting: `in_stock`. Returned to the customer: `with_customer`.
 * Scrapped: `scrapped`. The unit screen's own transition table still decides
 * whether that move is legal - this only says which one the case wants.
 */
export function unitStatusFor(to: string, outcome?: string | null, opts: { customerOwned?: boolean; from?: string } = {}): string | null {
  if (to === 'sent') return 'with_supplier';
  // Closed at the supplier (stage 5): they kept it, whoever it belonged to.
  if (opts.from === 'sent' && to === 'closed') return 'supplier_kept';
  /**
   * THE CUSTOMER'S OWN UNIT (10 Oct 2026, repair flow stage 3): picked up from
   * their site on a complaint item, never ours. Back from the supplier it is
   * "in for repair" again - not our stock - and on hand-over it is theirs.
   * Replaced or credited: the supplier kept it (stage 5 creates the new
   * serial). Before this, a repaired customer unit landed in our stock.
   */
  if (opts.customerOwned) {
    if (to === 'received_back') return outcome === 'scrapped' ? 'scrapped' : outcome === 'replaced' || outcome === 'credit_note' ? 'supplier_kept' : 'in_repair';
    // Handed back (stage 6): their own unit, unless the supplier kept it and
    // sent a new one - that new unit is moved by the hand-back itself.
    if (to === 'returned_to_customer') return outcome === 'replaced' || outcome === 'credit_note' ? null : 'with_customer';
    if (to === 'closed') return outcome === 'scrapped' ? 'scrapped' : null;
    return null;
  }
  if (to === 'closed') return outcome === 'scrapped' ? 'scrapped' : null;
  // Replaced or credited: the supplier kept the old unit - it is not ours again.
  if (to === 'received_back') return outcome === 'scrapped' ? 'scrapped' : outcome === 'replaced' || outcome === 'credit_note' ? null : 'in_stock';
  if (to === 'returned_to_customer') return 'with_customer';
  return null;
}
