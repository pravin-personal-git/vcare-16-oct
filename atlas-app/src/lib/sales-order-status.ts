/**
 * Sales order status.
 *
 * The original app shows ONE strip of 15 cards. Thirteen of them are fulfilment
 * states and two are payment states, and the UI merges them as though an order
 * could only be in one at a time. It cannot: an order is routinely `delivered`
 * and `partial_paid` simultaneously.
 *
 * So we keep two independent dimensions in the data model, and reassemble the
 * 15-card strip in the UI from both. The strip looks like the original; the
 * data underneath is correct.
 *
 * Pure - no database, no server-only marker. Both the browser and the server
 * import this, and the tests run it without a database.
 *
 * Spec: 05-sales-orders-invoices.md §1.2, §6.1
 */

export type FulfilmentStatus =
  | 'booked'
  | 'pending_approval'
  | 'confirmed'
  | 'packed'
  | 'dispatched'
  | 'shipped'
  | 'delivered'
  | 'damage_or_lost'
  | 'returned'
  | 'refunded'
  | 'hold'
  | 'failed'
  | 'void';

export type PaymentStatus = 'unpaid' | 'partial_paid' | 'paid';

/** The happy path, in order. Everything else is an exception branch. */
export const FULFILMENT_FLOW: FulfilmentStatus[] = [
  'booked',
  'pending_approval',
  'confirmed',
  'packed',
  'dispatched',
  'shipped',
  'delivered',
];

export const FULFILMENT_EXCEPTIONS: FulfilmentStatus[] = [
  'damage_or_lost',
  'returned',
  'refunded',
  'hold',
  'failed',
  'void',
];

export const ALL_FULFILMENT: FulfilmentStatus[] = [
  ...FULFILMENT_FLOW,
  ...FULFILMENT_EXCEPTIONS,
];

export const ALL_PAYMENT: PaymentStatus[] = ['unpaid', 'partial_paid', 'paid'];

export const FULFILMENT_LABEL: Record<FulfilmentStatus, string> = {
  booked: 'Order Booked',
  pending_approval: 'Pending Approval',
  confirmed: 'Confirmed',
  packed: 'Packed',
  dispatched: 'Dispatched',
  shipped: 'Shipped / In Transit',
  delivered: 'Delivered / Completed',
  damage_or_lost: 'Damage or Lost',
  returned: 'Returned',
  refunded: 'Refunded',
  hold: 'Hold',
  failed: 'Failed',
  void: 'Void',
};

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  partial_paid: 'Partial Paid',
  paid: 'Paid',
};

/**
 * States after which the order is finished, one way or another. Nothing may be
 * dispatched, invoiced or edited from here.
 */
const TERMINAL: FulfilmentStatus[] = ['refunded', 'failed', 'void'];

export function isTerminal(s: FulfilmentStatus): boolean {
  return TERMINAL.includes(s);
}

/**
 * Which fulfilment states may follow the current one.
 *
 * Forward along the happy path, one step at a time - you cannot ship something
 * that was never packed. Exception branches are reachable from anywhere that is
 * not already terminal, because reality is not a straight line: stock gets lost
 * between packing and dispatch, and a customer can cancel at any point.
 *
 * `hold` is the one state you come back from, so it remembers nothing and
 * returns to the start of the flow - the operator re-picks where to resume.
 */
export function nextFulfilment(current: FulfilmentStatus): FulfilmentStatus[] {
  if (isTerminal(current)) return [];

  if (current === 'hold') {
    return [...FULFILMENT_FLOW.filter((s) => s !== 'pending_approval'), 'void'];
  }

  const i = FULFILMENT_FLOW.indexOf(current);
  const forward = i >= 0 && i < FULFILMENT_FLOW.length - 1 ? [FULFILMENT_FLOW[i + 1]] : [];

  // `delivered` is the end of the happy path; from there only a return or a
  // damage claim makes sense, not a hold.
  const exceptions: FulfilmentStatus[] =
    current === 'delivered'
      ? ['damage_or_lost', 'returned', 'refunded']
      : current === 'returned'
        ? ['refunded', 'void']
        : current === 'damage_or_lost'
          ? ['refunded', 'returned', 'void']
          : ['hold', 'failed', 'void'];

  return [...forward, ...exceptions];
}

export function canTransition(from: FulfilmentStatus, to: FulfilmentStatus): boolean {
  return nextFulfilment(from).includes(to);
}

/**
 * Payment status is derived from money received, never set by hand. A user who
 * can type "paid" into a dropdown will eventually type it on an unpaid order.
 */
export function derivePaymentStatus(
  grandTotalPaise: number,
  amountPaidPaise: number,
): PaymentStatus {
  // A ₹0 order stays 'unpaid', deliberately. It reads oddly for a genuine free
  // replacement, but a zero total far more often means the order is unfinished
  // or wrongly discounted - and 'paid' would hide that, while 'unpaid' only
  // annoys someone into looking. Revisit if free replacements become a real
  // workflow; it needs its own state rather than borrowing 'paid'.
  if (amountPaidPaise <= 0) return 'unpaid';
  if (amountPaidPaise >= grandTotalPaise) return 'paid';
  return 'partial_paid';
}

/** An order may be invoiced once the goods have actually left. */
export function canInvoice(s: FulfilmentStatus): boolean {
  return ['dispatched', 'shipped', 'delivered'].includes(s);
}

/**
 * Editing an order that has been packed rewrites what the warehouse is already
 * acting on. Before that, it is still just paperwork.
 */
export function canEdit(s: FulfilmentStatus): boolean {
  return ['booked', 'pending_approval', 'confirmed', 'hold'].includes(s);
}

export interface OrderLike {
  fulfilmentStatus: FulfilmentStatus;
  paymentStatus: PaymentStatus;
  isInvoiced: boolean;
  grandTotalPaise: number;
}

/**
 * The 15-card strip, rebuilt from two dimensions.
 *
 * Cards 1–13 count fulfilment, cards 14–15 count payment, so the totals
 * deliberately do NOT sum to the row count - every order is counted twice, once
 * on each axis. That is the honest reading of a strip the original presents as
 * though it were one axis.
 */
export function countByStatus(rows: OrderLike[]) {
  const fulfilment = {} as Record<FulfilmentStatus, number>;
  for (const s of ALL_FULFILMENT) fulfilment[s] = 0;
  const payment = {} as Record<PaymentStatus, number>;
  for (const s of ALL_PAYMENT) payment[s] = 0;

  for (const r of rows) {
    if (fulfilment[r.fulfilmentStatus] !== undefined) fulfilment[r.fulfilmentStatus] += 1;
    if (payment[r.paymentStatus] !== undefined) payment[r.paymentStatus] += 1;
  }
  return { fulfilment, payment };
}

export type OrderFilter =
  | { axis: 'fulfilment'; value: FulfilmentStatus }
  | { axis: 'payment'; value: PaymentStatus }
  | { axis: 'invoice'; value: 'non_invoiced' };

/** Filter keys are `fulfilment:packed`, `payment:paid`, `invoice:non_invoiced`. */
export function parseFilter(key: string | null): OrderFilter | null {
  if (!key) return null;
  const [axis, value] = key.split(':');
  if (axis === 'fulfilment' && ALL_FULFILMENT.includes(value as FulfilmentStatus)) {
    return { axis: 'fulfilment', value: value as FulfilmentStatus };
  }
  if (axis === 'payment' && ALL_PAYMENT.includes(value as PaymentStatus)) {
    return { axis: 'payment', value: value as PaymentStatus };
  }
  if (axis === 'invoice' && value === 'non_invoiced') {
    return { axis: 'invoice', value: 'non_invoiced' };
  }
  return null;
}

export function matchesFilter(row: OrderLike, filter: OrderFilter | null): boolean {
  if (!filter) return true;
  if (filter.axis === 'fulfilment') return row.fulfilmentStatus === filter.value;
  if (filter.axis === 'payment') return row.paymentStatus === filter.value;
  return !row.isInvoiced;
}
