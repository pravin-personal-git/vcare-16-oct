/**
 * Invoice status.
 *
 * The spec lists seven statuses. Only three of them are decisions a person
 * makes; the other four are facts about money and dates:
 *
 *   STORED     draft · sent · cancelled          - someone chose this
 *   DERIVED    pending · partially_paid · paid · overdue
 *
 * Storing the derived ones would mean a column someone can set to `paid` on an
 * invoice nobody has paid, and an `overdue` flag that only becomes true when a
 * nightly job happens to run. Both are how a receivables report starts lying.
 *
 * So `lifecycle` holds the decision, and everything else is computed here from
 * the amount received and the due date.
 *
 * Pure - no database, no server-only marker. The browser and the server both
 * import this, and the tests run it without a database.
 *
 * Spec: 05-sales-orders-invoices.md §2.2
 */

import { daysBetween } from './expiry';

/** What a person can set. */
export type InvoiceLifecycle = 'draft' | 'sent' | 'cancelled';

/** What the screen shows. */
export type InvoiceStatus =
  | 'draft' | 'pending' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';

export const ALL_STATUSES: InvoiceStatus[] = [
  'draft', 'pending', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled',
];

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  sent: 'Sent',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

export interface InvoiceLike {
  lifecycle: InvoiceLifecycle;
  grandTotalPaise: number;
  amountPaidPaise: number;
  dueDate: Date;
}

/**
 * The single place invoice status is decided.
 *
 * Order of checks matters and is fixed here once:
 *
 *   1. cancelled  - beats everything. A cancelled invoice is not overdue,
 *                   however long it sits there.
 *   2. paid       - beats overdue. Paying late still means paid, and an
 *                   invoice that reads "overdue" after the money arrived is
 *                   the fastest way to lose a customer's trust.
 *   3. overdue    - past its due date with money still outstanding.
 *   4. partially_paid
 *   5. draft / sent / pending
 *
 * `pending` is what a sent-but-untouched invoice looks like in the original.
 * We map it to: issued, nothing received, not yet past due.
 */
export function invoiceStatus(inv: InvoiceLike, now = new Date()): InvoiceStatus {
  if (inv.lifecycle === 'cancelled') return 'cancelled';
  if (inv.lifecycle === 'draft') return 'draft';

  // Fully settled - including an overpayment, which is still settled.
  if (inv.grandTotalPaise > 0 && inv.amountPaidPaise >= inv.grandTotalPaise) return 'paid';

  // A zero-value invoice with nothing paid is not "paid". It is a document
  // someone should look at.
  if (inv.grandTotalPaise === 0) return 'pending';

  // Overdue from the DAY AFTER the due date (10 Oct 2026). A job invoice on
  // zero-day terms is due the moment it is issued; comparing instants made it
  // read "Overdue: 0 days" a second later, on the day the customer got it.
  if (daysOverdue(inv, now) > 0) return 'overdue';
  if (inv.amountPaidPaise > 0) return 'partially_paid';

  return 'pending';
}

export function amountDuePaise(inv: InvoiceLike): number {
  return Math.max(0, inv.grandTotalPaise - inv.amountPaidPaise);
}

/**
 * Days past due. Negative means still within terms, so the caller can render
 * "due in 6 days" from the same number.
 */
export function daysOverdue(inv: InvoiceLike, now = new Date()): number {
  // Calendar days in India (lib/expiry), so the due date itself is day 0 and
  // the next morning is day 1, whatever the hour it was issued.
  return daysBetween(inv.dueDate, now);
}

/** Ageing buckets, the convention every Indian receivables report uses. */
export type AgeBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export function ageBucket(inv: InvoiceLike, now = new Date()): AgeBucket {
  const d = daysOverdue(inv, now);
  if (d <= 0) return 'current';
  if (d <= 30) return '1-30';
  if (d <= 60) return '31-60';
  if (d <= 90) return '61-90';
  return '90+';
}

/**
 * Can this invoice still be edited?
 *
 * Once it has been sent it is a document in someone else's hands, and once any
 * money has arrived against it the figures are part of a reconciliation. Either
 * way, editing it silently rewrites what the customer agreed to - the correct
 * remedy is a credit note, which is a different document.
 */
export function canEdit(inv: InvoiceLike): boolean {
  return inv.lifecycle === 'draft' && inv.amountPaidPaise === 0;
}

/** A cancelled invoice, or one with money against it, cannot be cancelled. */
export function canCancel(inv: InvoiceLike): boolean {
  return inv.lifecycle !== 'cancelled' && inv.amountPaidPaise === 0;
}

export function canRecordPayment(inv: InvoiceLike): boolean {
  return (
    inv.lifecycle !== 'cancelled'
    && inv.lifecycle !== 'draft'
    && amountDuePaise(inv) > 0
  );
}

/** A draft has not been issued, so it can still be deleted outright. */
export function canDelete(inv: InvoiceLike): boolean {
  return inv.lifecycle === 'draft' && inv.amountPaidPaise === 0;
}

/**
 * Default payment terms in days.
 *
 * Zero means due on issue, which is the common case for a counter sale. A
 * customer's `creditLimitDays` overrides it when they have terms.
 */
export const DEFAULT_PAYMENT_TERMS_DAYS = 0;

export function dueDateFrom(
  invoiceDate: Date,
  termsDays = DEFAULT_PAYMENT_TERMS_DAYS,
): Date {
  return new Date(invoiceDate.getTime() + Math.max(0, termsDays) * 86_400_000);
}

export function countByStatus(rows: InvoiceLike[], now = new Date()) {
  const out = {} as Record<InvoiceStatus, number>;
  for (const s of ALL_STATUSES) out[s] = 0;
  for (const r of rows) out[invoiceStatus(r, now)] += 1;
  return out;
}

export function matchesStatus(
  row: InvoiceLike, status: string | null, now = new Date(),
): boolean {
  if (!status) return true;
  return invoiceStatus(row, now) === status;
}


/**
 * Which invoices are actually owed money.
 *
 * A draft has not been shown to anybody, so nothing is owed on it. A cancelled
 * one never was. Only 'sent' counts.
 *
 * Here because the rule had to be stated three times before it was written
 * down - in the customer balance, on the dashboard's Receivable tile, and on
 * the Invoices screen - and the second one got it wrong, reporting 68,882
 * against the list screen's 33,482 with one draft between them.
 */
export const RECEIVABLE_LIFECYCLE: InvoiceLifecycle = 'sent';

/** Prisma `where` fragment for the invoices a customer actually owes on. */
export const RECEIVABLE_WHERE = { lifecycle: RECEIVABLE_LIFECYCLE } as const;

export function isReceivable(lifecycle: string): boolean {
  return lifecycle === RECEIVABLE_LIFECYCLE;
}

/** What is still owed across a set of invoices. */
export function outstandingPaise(
  invoices: { lifecycle: string; grandTotalPaise: number; amountPaidPaise: number }[],
): number {
  return invoices
    .filter((i) => isReceivable(i.lifecycle))
    .reduce((n, i) => n + Math.max(0, i.grandTotalPaise - i.amountPaidPaise), 0);
}
