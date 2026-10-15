import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { settledByInvoice, syncSettledColumn } from './settlement';
import { RECEIVABLE_WHERE } from '@/lib/invoice-status';
import type { ReceiptMethod, ReceiptRow, ReceiptStatus } from '@/lib/receipt';
import {
  autoAllocate, netAllocated, outstandingOn, unallocatedPaise, validateAllocations,
  type AllocatableInvoice, type Allocation,
} from '@/lib/allocation';
import { postJournalEntry, reverseJournalEntry } from './ledger';
import type { LedgerLineInput } from '@/lib/ledger';

/** Where a receipt's money actually landed, by how it arrived. */
const DEBIT_ACCOUNT_FOR_METHOD: Record<ReceiptMethod, string> = {
  cash: '1010', upi: '1020', bank: '1020', cheque: '1020', card: '1020',
  tds: '1410', adjustment: '1420',
};

/**
 * Money in, and where it went.
 *
 * Replaces `recordPayment`, which hung every payment off exactly one invoice
 * and so could not record an advance, one cheque against several invoices,
 * money paid on account, or TDS deducted at source. See
 * 07-decisions/foundation-review-finance-inventory.md §2.
 *
 * WHAT AN INVOICE HAS BEEN PAID IS DERIVED
 *
 * `Invoice.amountPaidPaise` is no longer authoritative. The paid figure is the
 * sum of allocation rows whose receipt still stands, computed on read by
 * `paidByInvoice`. The stored column is left in place for one release so
 * anything still reading it keeps working, and is reconciled by
 * `reconcilePaidColumn` - but it is a cache, not the truth.
 *
 * This is the same decision, for the same reason, as `Party.currentBalancePaise`:
 * a stored running total needs every future code path to remember to update it,
 * and that promise was broken twice before anybody noticed.
 */

// Shared with the browser. See lib/receipt.ts for why these do not live here.
export type { ReceiptMethod, ReceiptStatus, ReceiptRow } from '@/lib/receipt';
export { CASH_METHODS, METHOD_LABEL, REFERENCE_LABEL } from '@/lib/receipt';

/** Only these count towards the balance. A bounced cheque settles nothing. */
export const LIVE_RECEIPT = { status: 'received' } as const;


/**
 * What each invoice has actually been paid, from the allocation rows.
 *
 * Batched by invoice id rather than queried per invoice, because every list
 * screen needs this for a page of invoices at once and the per-row version is
 * how a list becomes fifty round trips.
 */
export async function paidByInvoice(
  scope: StoreScope,
  invoiceIds: string[],
): Promise<Map<string, number>> {
  if (invoiceIds.length === 0) return new Map();

  const rows = await db.receiptAllocation.groupBy({
    by: ['invoiceId'],
    where: {
      ...scopeWhere(scope),
      invoiceId: { in: invoiceIds },
      // A reversed or bounced receipt settles nothing, so its allocations must
      // not count. Filtering here rather than deleting the rows keeps the
      // history of what was applied before it was taken back.
      receipt: { ...LIVE_RECEIPT },
    },
    _sum: { amountPaise: true },
  });

  return new Map(rows.map((r) => [r.invoiceId, r._sum.amountPaise ?? 0]));
}

/**
 * Every invoice this party could still pay against, oldest debt first.
 *
 * Measured against SETTLED, not paid. An invoice cleared by a credit note is
 * not open, and offering it here would let someone allocate a real payment to
 * an invoice that owes nothing - money that then sits misapplied while the
 * invoice it should have cleared goes to collections.
 */
export async function openInvoicesFor(
  scope: StoreScope,
  partyId: string,
): Promise<AllocatableInvoice[]> {
  const invoices = await db.invoice.findMany({
    where: { ...scopeWhere(scope), partyId, ...RECEIVABLE_WHERE },
    select: {
      id: true, invoiceNo: true, invoiceDate: true, dueDate: true, grandTotalPaise: true,
    },
    orderBy: { dueDate: 'asc' },
  });

  const settled = await settledByInvoice(scope, invoices.map((i) => i.id));

  return invoices
    .map((i) => ({ ...i, paidPaise: settled.get(i.id) ?? 0 }))
    .filter((i) => outstandingOn(i) > 0);
}

/** Money sitting on a party's account that has not been applied to anything. */
export async function unappliedCreditFor(scope: StoreScope, partyId: string): Promise<number> {
  const receipts = await db.receipt.findMany({
    where: { ...scopeWhere(scope), partyId, ...LIVE_RECEIPT },
    select: { amountPaise: true, allocations: { select: { amountPaise: true } } },
  });

  return receipts.reduce(
    (n, r) => n + (r.amountPaise - r.allocations.reduce((m, a) => m + a.amountPaise, 0)),
    0,
  );
}

export interface CreateReceiptInput {
  partyId: string;
  amountPaise: number;
  method: ReceiptMethod;
  receivedAt?: Date;
  reference?: string | null;
  note?: string | null;
  /**
   * Where to apply it. Omit to let it settle the oldest debts automatically;
   * pass an empty array to hold the whole amount on account as an advance.
   */
  allocations?: Allocation[];

  /**
   * What the money was collected AGAINST - not what it settles.
   *
   * An advance taken on site belongs to that challan, and one taken before any
   * work belongs to the order. Without this a receipt knows only the customer,
   * and nobody can answer "what has this site already paid?" a month later.
   * `allocations` above still decides what it settles; these only record where
   * it came from.
   */
  salesOrderId?: string | null;
  challanId?: string | null;
}

/**
 * Record money arriving, and apply it.
 *
 * The allocation is worked out and checked before the transaction opens, so a
 * bad split is refused without having written anything. Inside, the receipt and
 * its allocations are written together - a receipt whose allocations failed
 * would read as an unapplied advance, which is a different and untrue story.
 */
export async function createReceipt(
  scope: StoreScope,
  input: CreateReceiptInput,
  userId: string,
): Promise<{ id: string; receiptNo: string; unallocatedPaise: number }> {
  const storeId = scopeForWrite(scope);

  if (input.amountPaise <= 0) throw new Error('Enter an amount greater than zero.');

  const party = await db.party.findFirst({
    where: { id: input.partyId, ...scopeWhere(scope) },
    select: { id: true, title: true, firstName: true, lastName: true, companyName: true },
  });
  if (!party) throw new Error('Customer not found in your scope.');
  const partyName = party.companyName?.trim()
    || [party.title, party.firstName, party.lastName].filter(Boolean).join(' ').trim();

  const open = await openInvoicesFor(scope, input.partyId);

  const allocations = input.allocations ?? autoAllocate(input.amountPaise, open).allocations;

  const problems = validateAllocations(input.amountPaise, allocations, open);
  if (problems.length > 0) throw new Error(problems.join('\n'));

  const receiptNo = await allocateDocumentNumber(storeId, 'RCP', input.receivedAt);
  const merged = netAllocated(allocations);

  const receipt = await db.$transaction(async (tx) => {
    const r = await tx.receipt.create({
      data: {
        receiptNo,
        storeId,
        partyId: input.partyId,
        amountPaise: input.amountPaise,
        receivedAt: input.receivedAt ?? new Date(),
        method: input.method,
        reference: input.reference ?? null,
        note: input.note ?? null,
        salesOrderId: input.salesOrderId ?? null,
        challanId: input.challanId ?? null,
        recordedBy: userId,
      },
    });

    if (merged.size > 0) {
      await tx.receiptAllocation.createMany({
        data: [...merged].map(([invoiceId, amountPaise]) => ({
          receiptId: r.id,
          invoiceId,
          storeId,
          amountPaise,
          allocatedBy: userId,
        })),
      });
    }

    await syncPaidColumn(tx, storeId, [...merged.keys()]);
    return r;
  });

  // Debits whichever account the money actually landed in - Cash, Bank, or
  // (for tds/adjustment) a non-cash receivable - and credits Accounts
  // Receivable for this party. One line per party, not per invoice: AR is a
  // party-level balance in the ledger, and which invoices a receipt settles
  // is an allocation detail layered on top, not a fact the GL needs to know.
  const lines: LedgerLineInput[] = [
    { accountCode: DEBIT_ACCOUNT_FOR_METHOD[input.method], debitPaise: input.amountPaise, description: partyName },
    { accountCode: '1100', creditPaise: input.amountPaise, partyId: input.partyId, description: partyName },
  ];
  await postJournalEntry(scope, {
    entryDate: input.receivedAt ?? new Date(),
    description: `Receipt ${receiptNo} - ${partyName}`,
    sourceType: 'receipt',
    sourceId: receipt.id,
    lines,
  }, userId);

  return {
    id: receipt.id,
    receiptNo,
    unallocatedPaise: unallocatedPaise(input.amountPaise, allocations),
  };
}

/**
 * Apply money that was sitting unapplied on an existing receipt.
 *
 * Separate from creating it because that is how it happens: the cheque is
 * banked today and somebody decides which invoices it clears on Monday.
 */
export async function applyReceipt(
  scope: StoreScope,
  receiptId: string,
  allocations: Allocation[],
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);

  const receipt = await db.receipt.findFirst({
    where: { id: receiptId, ...scopeWhere(scope) },
    select: {
      id: true, receiptNo: true, partyId: true, amountPaise: true, status: true,
      allocations: { select: { amountPaise: true } },
    },
  });
  if (!receipt) throw new Error('Receipt not found in your scope.');
  if (receipt.status !== 'received') {
    throw new Error(
      `${receipt.receiptNo} has been ${receipt.status}. Money that was taken back cannot settle an invoice.`,
    );
  }

  const free = receipt.amountPaise - receipt.allocations.reduce((n, a) => n + a.amountPaise, 0);
  const open = await openInvoicesFor(scope, receipt.partyId);

  // Checked against what is still free on the receipt, not its full value -
  // otherwise money already applied elsewhere could be applied a second time.
  const problems = validateAllocations(free, allocations, open);
  if (problems.length > 0) throw new Error(problems.join('\n'));

  const merged = netAllocated(allocations);
  if (merged.size === 0) return;

  await db.$transaction(async (tx) => {
    await tx.receiptAllocation.createMany({
      data: [...merged].map(([invoiceId, amountPaise]) => ({
        receiptId, invoiceId, storeId, amountPaise, allocatedBy: userId,
      })),
    });
    await syncPaidColumn(tx, storeId, [...merged.keys()]);
  });
}

/**
 * Take money back off an invoice without deleting the record that it was there.
 *
 * Writes a negative row, the same shape as a stock correction. The original
 * allocation stays, so "applied in error on the 3rd, corrected on the 5th" is
 * still readable a year later - which is the whole point of a ledger.
 */
export async function unapplyAllocation(
  scope: StoreScope,
  receiptId: string,
  invoiceId: string,
  amountPaise: number,
  reason: string,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);

  if (!reason.trim()) throw new Error('Say why this is being taken back. It goes on the record.');
  if (amountPaise <= 0) throw new Error('Enter an amount greater than zero.');

  const rows = await db.receiptAllocation.findMany({
    where: { ...scopeWhere(scope), receiptId, invoiceId },
    select: { amountPaise: true },
  });
  const applied = rows.reduce((n, r) => n + r.amountPaise, 0);

  if (amountPaise > applied) {
    throw new Error(
      `Only ₹${(applied / 100).toLocaleString('en-IN')} of this receipt is applied to that invoice.`,
    );
  }

  await db.$transaction(async (tx) => {
    await tx.receiptAllocation.create({
      data: {
        receiptId, invoiceId, storeId,
        amountPaise: -amountPaise,
        reason: reason.trim(),
        allocatedBy: userId,
      },
    });
    await syncPaidColumn(tx, storeId, [invoiceId]);
  });
}

/**
 * A cheque bounced, or the money never really arrived.
 *
 * The receipt is marked, never deleted. Deleting would make the money look as
 * though it never came, and the bank charge that follows a bounce has to hang
 * off something. Allocations stay too - they stop counting because
 * `paidByInvoice` filters on the receipt's status, so every invoice this was
 * settling reopens by itself.
 */
export async function reverseReceipt(
  scope: StoreScope,
  receiptId: string,
  status: 'bounced' | 'reversed',
  reason: string,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);

  if (!reason.trim()) throw new Error('Say why this receipt is being reversed.');

  const receipt = await db.receipt.findFirst({
    where: { id: receiptId, ...scopeWhere(scope) },
    select: {
      id: true, receiptNo: true, status: true,
      allocations: { select: { invoiceId: true } },
    },
  });
  if (!receipt) throw new Error('Receipt not found in your scope.');
  if (receipt.status !== 'received') {
    throw new Error(`${receipt.receiptNo} is already marked ${receipt.status}.`);
  }

  // Reversed BEFORE the status flips - same reasoning as invoice
  // cancellation: if this throws, the receipt is still "received" with its
  // original entry standing, rather than "bounced"/"reversed" with the
  // money it brought in still sitting live in the ledger.
  const entry = await db.journalEntry.findFirst({
    where: { ...scopeWhere(scope), sourceType: 'receipt', sourceId: receiptId, reversalOfId: null },
    select: { id: true },
  });
  if (entry) {
    await reverseJournalEntry(scope, entry.id, userId, `Receipt ${receipt.receiptNo} marked ${status}: ${reason.trim()}`);
  }

  await db.$transaction(async (tx) => {
    await tx.receipt.updateMany({
      // Guarded on the status that was read, so two people reversing the same
      // receipt cannot both succeed and post two bank charges.
      where: { id: receiptId, storeId, status: 'received' },
      data: {
        status,
        reversedAt: new Date(),
        reversalReason: reason.trim(),
        reversedBy: userId,
      },
    });
    await syncPaidColumn(tx, storeId, [...new Set(receipt.allocations.map((a) => a.invoiceId))]);
  });
}

/**
 * Bring the cached `Invoice.amountPaidPaise` back in line.
 *
 * MOVED to server/settlement.ts, which is now the only place that writes this
 * column. It had to move the moment credit notes existed: this version summed
 * receipts alone, so issuing a credit note would have left the column showing
 * the invoice as still owed, and the next sync from a receipt would have
 * silently wiped the credit back out again.
 *
 * Kept as a thin alias so every call site here reads the same as it did, and
 * so no path can accidentally go back to summing only one of the two.
 */
const syncPaidColumn = syncSettledColumn;

/** Receipts for a store, or for one party. */
export async function listReceipts(
  scope: StoreScope,
  opts: { partyId?: string; from?: Date; to?: Date } = {},
): Promise<ReceiptRow[]> {
  const receipts = await db.receipt.findMany({
    where: {
      ...scopeWhere(scope),
      ...(opts.partyId ? { partyId: opts.partyId } : {}),
      ...(opts.from || opts.to
        ? { receivedAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
    },
    select: {
      id: true, receiptNo: true, partyId: true, amountPaise: true, receivedAt: true,
      method: true, reference: true, note: true, status: true, reversalReason: true,
      party: { select: { title: true, firstName: true, lastName: true, companyName: true } },
      allocations: {
        select: {
          invoiceId: true, amountPaise: true,
          invoice: { select: { invoiceNo: true } },
        },
      },
    },
    orderBy: { receivedAt: 'desc' },
  });

  return receipts.map((r) => {
    const allocated = r.allocations.reduce((n, a) => n + a.amountPaise, 0);
    const net = netAllocated(r.allocations.map((a) => ({ invoiceId: a.invoiceId, amountPaise: a.amountPaise })));
    const nameByInvoice = new Map(r.allocations.map((a) => [a.invoiceId, a.invoice.invoiceNo]));

    return {
      id: r.id,
      receiptNo: r.receiptNo,
      partyId: r.partyId,
      partyName: r.party.companyName
        ?? [r.party.title, r.party.firstName, r.party.lastName].filter(Boolean).join(' '),
      amountPaise: r.amountPaise,
      allocatedPaise: allocated,
      unallocatedPaise: r.amountPaise - allocated,
      receivedAt: r.receivedAt,
      method: r.method,
      reference: r.reference,
      note: r.note,
      status: r.status as ReceiptStatus,
      reversalReason: r.reversalReason,
      appliedTo: [...net].map(([invoiceId, amountPaise]) => ({
        invoiceId,
        invoiceNo: nameByInvoice.get(invoiceId) ?? '-',
        amountPaise,
      })),
    };
  });
}
