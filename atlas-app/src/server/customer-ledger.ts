import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { RECEIVABLE_WHERE } from '@/lib/invoice-status';
import { runBalance } from '@/lib/ledger-lines';
import { METHOD_LABEL } from '@/lib/receipt';
import { daysBetween } from '@/lib/expiry';

/**
 * A customer's account, one line per thing that moved money.
 *
 * This answers the question a trading business asks more than any other:
 * *"Isne kitna dena hai, aur kyun?"* - how much do they owe, and what for. The
 * balance on the Customers screen answers the first half; only a ledger answers
 * the second, and the second is what settles an argument.
 *
 * WHAT COUNTS AS A LINE
 *
 * An issued invoice is a debit - they now owe that much. A payment is a credit.
 * Nothing else moves the balance today; credit notes and opening balances will
 * be lines here too when those exist, which is why the row carries a `kind`
 * rather than being two lists stitched together.
 *
 * A draft invoice is NOT a line. Nobody has been shown it, so nothing is owed,
 * and putting it in the ledger would mean the running balance disagreed with
 * the figure on every other screen.
 *
 * A cancelled invoice is not a line either - but if it was cancelled *after*
 * being issued, that is a real event a customer may ask about, so it is
 * returned separately rather than silently dropped.
 *
 * DERIVED, ALWAYS
 *
 * There is no stored ledger table. Each line is read from the document that
 * caused it, so cancelling an invoice corrects the account the moment you look.
 * A stored ledger would need every future code path to remember to append to
 * it, which is the promise that broke `Party.currentBalancePaise`.
 *
 * Spec: 11-accounts.md §4 (A115)
 */

export type LedgerKind = 'invoice' | 'payment';

export interface LedgerLine {
  id: string;
  at: Date;
  kind: LedgerKind;
  /** INV-BR001-2026-0004, or the payment's reference. */
  ref: string;
  description: string;
  /** Increases what they owe. Zero on a credit line. */
  debitPaise: number;
  /** Reduces what they owe. Zero on a debit line. */
  creditPaise: number;
  /** What they owed after this line. */
  balancePaise: number;
  /** Set on invoice lines, so the row can link to the document. */
  invoiceId: string | null;
  /** Set on payment lines - the receipt's own page (G-28). */
  receiptId: string | null;
  method: string | null;
}

export interface CustomerLedger {
  party: {
    id: string;
    partyCode: string;
    name: string;
    company: string | null;
    phone: string;
    email: string | null;
    gstin: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    creditLimitPaise: number;
    creditLimitDays: number;
  };
  /** Balance carried into the window, from everything before `from`. */
  openingPaise: number;
  lines: LedgerLine[];
  closingPaise: number;
  totals: { debitPaise: number; creditPaise: number };
  /**
   * Money received that is not applied to any invoice.
   *
   * Already inside `closingPaise` - a receipt credits the account whether or
   * not anybody has decided which bill it clears. Reported separately because
   * "you owe ₹40,000" and "you owe ₹60,000 but ₹20,000 of yours is sitting
   * here unapplied" are the same balance and a different conversation.
   */
  onAccountPaise: number;
  /** Issued and then cancelled - not balance-affecting, but people ask. */
  cancelled: { id: string; invoiceNo: string; at: Date; grandTotalPaise: number }[];
  /** Bounced or reversed - settled nothing, but the customer will ask. */
  failedReceipts: { id: string; receiptNo: string; at: Date; amountPaise: number; reason: string | null }[];
  /** The oldest unpaid invoice, which is what "overdue" actually means. */
  oldestUnpaid: { id: string; invoiceNo: string; dueDate: Date; duePaise: number; daysOverdue: number } | null;
  from: Date | null;
  to: Date | null;
}


export async function getCustomerLedger(
  scope: StoreScope,
  partyId: string,
  opts: { from?: Date; to?: Date } = {},
): Promise<CustomerLedger | null> {
  const party = await db.party.findFirst({
    where: { id: partyId, ...scopeWhere(scope) },
    select: {
      id: true, partyCode: true, title: true, firstName: true, lastName: true,
      companyName: true, phoneCc: true, phone: true, email: true, gstin: true,
      addressLine1: true, city: true, state: true,
      creditLimitPaise: true, creditLimitDays: true,
    },
  });
  if (!party) return null;

  // Everything, then split by date in memory. The alternative is two queries
  // per source with overlapping ranges to compute the opening balance, and a
  // customer's whole history is a few hundred rows at worst.
  const [invoices, receipts] = await db.$transaction([
    db.invoice.findMany({
      where: { ...scopeWhere(scope), partyId },
      select: {
        id: true, invoiceNo: true, invoiceDate: true, dueDate: true,
        grandTotalPaise: true, amountPaidPaise: true, lifecycle: true,
        poNumber: true, updatedAt: true,
      },
      orderBy: { invoiceDate: 'asc' },
    }),
    // Receipts, not allocations. A credit line is money the customer handed
    // over - one line per payment, as they remember it. Which invoices it
    // settled is a separate question, answered in the description rather than
    // by splitting one cheque into three ledger lines nobody recognises.
    //
    // Bounced and reversed receipts are excluded here and surfaced separately,
    // for the same reason a cancelled invoice is: it happened, but it settles
    // nothing, and a ledger line that moves the balance would be wrong.
    db.receipt.findMany({
      where: { ...scopeWhere(scope), partyId, status: 'received' },
      select: {
        id: true, receiptNo: true, amountPaise: true, receivedAt: true,
        method: true, reference: true, note: true,
        allocations: {
          select: { amountPaise: true, invoice: { select: { id: true, invoiceNo: true } } },
        },
      },
      orderBy: { receivedAt: 'asc' },
    }),
  ]);

  const issued = invoices.filter((i) => i.lifecycle === RECEIVABLE_WHERE.lifecycle);

  // A bounced cheque is the second thing a customer disputes, after the
  // balance itself. Fetched separately rather than filtered out of the query
  // above, so the ledger lines cannot accidentally include one.
  const failed = await db.receipt.findMany({
    where: { ...scopeWhere(scope), partyId, status: { in: ['bounced', 'reversed'] } },
    select: {
      id: true, receiptNo: true, amountPaise: true, receivedAt: true,
      reversedAt: true, reversalReason: true,
    },
    orderBy: { receivedAt: 'asc' },
  });

  const all: Omit<LedgerLine, 'balancePaise'>[] = [
    ...issued.map((i) => ({
      id: `inv-${i.id}`,
      at: i.invoiceDate,
      kind: 'invoice' as const,
      ref: i.invoiceNo,
      description: i.poNumber ? `Invoice · PO ${i.poNumber}` : 'Invoice',
      debitPaise: i.grandTotalPaise,
      creditPaise: 0,
      invoiceId: i.id,
      receiptId: null,
      method: null,
    })),
    ...receipts.map((r) => {
      const applied = r.allocations.reduce((n, a) => n + a.amountPaise, 0);
      const free = r.amountPaise - applied;
      const against = r.allocations
        .filter((a) => a.amountPaise > 0)
        .map((a) => a.invoice.invoiceNo);

      return {
        id: `rcp-${r.id}`,
        at: r.receivedAt,
        kind: 'payment' as const,
        ref: r.reference ?? r.receiptNo,
        description: [
          `Payment · ${METHOD_LABEL[r.method] ?? r.method}`,
          against.length > 0 ? `against ${against.join(', ')}` : null,
          // Named on the line itself. Money on account is the single most
          // common thing a customer rings up about, and burying it in a
          // summary at the bottom is how it gets forgotten and asked for
          // twice.
          free > 0 ? `₹${(free / 100).toLocaleString('en-IN')} on account` : null,
          r.note,
        ].filter(Boolean).join(' - '),
        debitPaise: 0,
        creditPaise: r.amountPaise,
        // Only when the whole receipt went to one invoice. Linking a split
        // cheque to just one of the invoices it paid would send people to the
        // wrong document.
        invoiceId: r.allocations.length === 1 ? r.allocations[0].invoice.id : null,
        receiptId: r.id,
        method: r.method,
      };
    }),
  ];

  const from = opts.from ?? null;
  const to = opts.to ?? null;

  // Ordering, the opening balance and the running total all come from the
  // shared, tested function. Restating them here is exactly how the dashboard
  // and the Customers screen ended up disagreeing about the same money.
  const { openingPaise, rows, closingPaise } = runBalance(all, from, to);
  const lines: LedgerLine[] = rows.map((r) => ({ ...r.line, balancePaise: r.balancePaise }));
  const running = closingPaise;

  const now = new Date();
  const unpaid = issued
    .filter((i) => i.grandTotalPaise > i.amountPaidPaise)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];

  return {
    party: {
      id: party.id,
      partyCode: party.partyCode,
      name: [party.title, party.firstName, party.lastName].filter(Boolean).join(' '),
      company: party.companyName,
      phone: `${party.phoneCc ?? '+91'} ${party.phone}`,
      email: party.email,
      gstin: party.gstin,
      address: party.addressLine1,
      city: party.city,
      state: party.state,
      creditLimitPaise: party.creditLimitPaise,
      creditLimitDays: party.creditLimitDays,
    },
    openingPaise,
    lines,
    closingPaise: running,
    totals: {
      debitPaise: lines.reduce((n, l) => n + l.debitPaise, 0),
      creditPaise: lines.reduce((n, l) => n + l.creditPaise, 0),
    },
    onAccountPaise: receipts.reduce(
      (n, r) => n + (r.amountPaise - r.allocations.reduce((m, a) => m + a.amountPaise, 0)),
      0,
    ),
    cancelled: invoices
      .filter((i) => i.lifecycle === 'cancelled')
      .map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, at: i.updatedAt, grandTotalPaise: i.grandTotalPaise })),
    failedReceipts: failed.map((r) => ({
      id: r.id,
      receiptNo: r.receiptNo,
      at: r.reversedAt ?? r.receivedAt,
      amountPaise: r.amountPaise,
      reason: r.reversalReason,
    })),
    // Overdue from the day after it fell due, in India's calendar days (10 Oct 2026).
    oldestUnpaid: unpaid && daysBetween(unpaid.dueDate, now) > 0
      ? {
        id: unpaid.id,
        invoiceNo: unpaid.invoiceNo,
        dueDate: unpaid.dueDate,
        duePaise: unpaid.grandTotalPaise - unpaid.amountPaidPaise,
        daysOverdue: daysBetween(unpaid.dueDate, now),
      }
      : null,
    from,
    to,
  };
}
