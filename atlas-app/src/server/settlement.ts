import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';

/**
 * What settles an invoice.
 *
 * An invoice stops being owed for two quite different reasons, and conflating
 * them is a mistake with consequences in both directions:
 *
 *   - MONEY ARRIVED - a receipt. Cash, UPI, a cheque, TDS.
 *   - CREDIT WAS GIVEN - a credit note. Goods came back, or an allowance was
 *     agreed. No money moved at all.
 *
 * Both reduce what the customer owes, identically. Neither is the other:
 *
 *   "What did this customer PAY us" must exclude credit notes, or a bank
 *   reconciliation will not balance and a collections report will chase people
 *   who owe nothing.
 *
 *   "What is this invoice STILL OWED" must include them, or a customer who
 *   returned half an order keeps receiving reminders for the half they sent
 *   back - the single most reliable way to lose an account.
 *
 * So there are two functions and one cached column, and this file owns all
 * three. `paidByInvoice` (receipts.ts) answers the first question and is
 * deliberately left alone. `settledByInvoice` answers the second. Anything
 * deciding whether an invoice is open, overdue, or receivable wants the second.
 *
 * WHY THE COLUMN STILL EXISTS
 *
 * `Invoice.amountPaidPaise` is a cache, not the truth, exactly as it was before
 * credit notes existed. It is kept in step inside the same transaction as every
 * allocation change by `syncSettledColumn`. Its name is now slightly wrong -
 * it holds settled, not paid - and renaming it is a migration on a live table
 * for a cosmetic gain, so the name is left and documented instead.
 *
 * Spec: _archive/roadmap/NEXT-SPRINT.md weeks 2–4
 */

/** Only a live receipt settles anything. A bounced cheque settles nothing. */
const LIVE_RECEIPT = { status: 'received' } as const;

/**
 * Only an ISSUED credit note settles anything.
 *
 * A draft is somebody typing, and a cancelled one is a document that was
 * withdrawn - the invoice it was settling must reopen by itself when that
 * happens, which it does because this filter is applied on read rather than by
 * deleting the allocation rows.
 */
const LIVE_CREDIT_NOTE = { lifecycle: 'issued' } as const;

async function sumAllocations(
  scope: StoreScope,
  invoiceIds: string[],
): Promise<{ paid: Map<string, number>; credited: Map<string, number> }> {
  if (invoiceIds.length === 0) return { paid: new Map(), credited: new Map() };

  // One batch rather than two awaits. With `connection_limit=1` two separate
  // awaits are two round trips to another region, on a path every invoice list
  // and every customer statement goes through.
  // `orderBy` is not decoration. Prisma's `groupBy` requires it inside the
  // array form of `$transaction`, and grouping is unordered without it, so two
  // calls could return the same rows in different orders - harmless here, since
  // both results go straight into a Map, but free to make deterministic.
  const [receipts, credits] = await db.$transaction([
    db.receiptAllocation.groupBy({
      by: ['invoiceId'],
      where: { ...scopeWhere(scope), invoiceId: { in: invoiceIds }, receipt: LIVE_RECEIPT },
      _sum: { amountPaise: true },
      orderBy: { invoiceId: 'asc' },
    }),
    db.creditNoteAllocation.groupBy({
      by: ['invoiceId'],
      where: { ...scopeWhere(scope), invoiceId: { in: invoiceIds }, creditNote: LIVE_CREDIT_NOTE },
      _sum: { amountPaise: true },
      orderBy: { invoiceId: 'asc' },
    }),
  ]);

  // `_sum` is optional on a groupBy result inside `$transaction([…])`, and the
  // optional chain is not defensive noise: without it a group with no matching
  // rows would throw at runtime on a page that is only reading totals.
  return {
    paid: new Map(receipts.map((r) => [r.invoiceId, r._sum?.amountPaise ?? 0])),
    credited: new Map(credits.map((r) => [r.invoiceId, r._sum?.amountPaise ?? 0])),
  };
}

/** Money received against each invoice, and credit given, kept apart. */
export async function settlementByInvoice(
  scope: StoreScope,
  invoiceIds: string[],
): Promise<Map<string, { paidPaise: number; creditedPaise: number; settledPaise: number }>> {
  const { paid, credited } = await sumAllocations(scope, invoiceIds);

  const out = new Map<string, { paidPaise: number; creditedPaise: number; settledPaise: number }>();
  for (const id of invoiceIds) {
    const p = paid.get(id) ?? 0;
    const c = credited.get(id) ?? 0;
    out.set(id, { paidPaise: p, creditedPaise: c, settledPaise: p + c });
  }
  return out;
}

/** Total settled - paid plus credited. What "still owed" is measured against. */
export async function settledByInvoice(
  scope: StoreScope,
  invoiceIds: string[],
): Promise<Map<string, number>> {
  const full = await settlementByInvoice(scope, invoiceIds);
  return new Map([...full].map(([id, v]) => [id, v.settledPaise]));
}

/** Credit given against each invoice, on its own. */
export async function creditedByInvoice(
  scope: StoreScope,
  invoiceIds: string[],
): Promise<Map<string, number>> {
  const { credited } = await sumAllocations(scope, invoiceIds);
  return credited;
}

/**
 * Bring the cached column back in line, inside the caller's transaction.
 *
 * Called by every path that changes a receipt allocation, a credit note
 * allocation, or the lifecycle of either. Missing one is how the cache and the
 * rows drift, which is the failure this whole design is arranged against - so
 * it takes the transaction client rather than opening its own, and cannot be
 * called from outside a transaction by accident.
 */
export async function syncSettledColumn(
  tx: Prisma.TransactionClient,
  storeId: string,
  invoiceIds: string[],
): Promise<void> {
  const ids = [...new Set(invoiceIds)];
  if (ids.length === 0) return;

  const [receipts, credits] = await Promise.all([
    tx.receiptAllocation.groupBy({
      by: ['invoiceId'],
      where: { storeId, invoiceId: { in: ids }, receipt: LIVE_RECEIPT },
      _sum: { amountPaise: true },
    }),
    tx.creditNoteAllocation.groupBy({
      by: ['invoiceId'],
      where: { storeId, invoiceId: { in: ids }, creditNote: LIVE_CREDIT_NOTE },
      _sum: { amountPaise: true },
    }),
  ]);

  const total = new Map<string, number>();
  for (const r of receipts) total.set(r.invoiceId, r._sum.amountPaise ?? 0);
  for (const c of credits) {
    total.set(c.invoiceId, (total.get(c.invoiceId) ?? 0) + (c._sum.amountPaise ?? 0));
  }

  for (const id of ids) {
    await tx.invoice.updateMany({
      where: { id, storeId },
      data: { amountPaidPaise: total.get(id) ?? 0 },
    });
  }
}
