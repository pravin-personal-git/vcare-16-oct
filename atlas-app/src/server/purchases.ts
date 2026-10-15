import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { resolveTaxMode } from './gst';
import { receiveDirectlyForBill, cancelGrn } from './goods-receipt';
import {
  allocateOldestFirst,
  billStatus,
  computeBillTotals,
  landedUnitCostPaise,
  outstandingPaise,
  type BillLineInput,
  type BillStatus,
} from '@/lib/purchase';
import { postJournalEntry, reverseJournalEntry } from './ledger';
import type { LedgerLineInput } from '@/lib/ledger';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/** Where a supplier payment's money actually left from, by how it was sent. */
const DEBIT_METHOD_TO_CREDIT_ACCOUNT: Record<PayInput['method'], string> = {
  cash: '1010', bank: '1020', upi: '1020', cheque: '1020', adjustment: '1430',
};

/**
 * Purchases - supplier bills, and the money that settles them.
 *
 * THE MIRROR OF SALES, ON PURPOSE.
 *
 * A bill is shaped like an invoice, a supplier payment like a receipt, and
 * `syncBillPaidColumn` does for bills what `syncSettledColumn` does for
 * invoices. Somebody who has understood one side should not have to learn a
 * second set of rules for the other.
 *
 * WHAT POSTING A BILL DOES, ALL AT ONCE
 *
 * Moving a bill from `draft` to `received` does three things in one
 * transaction: stock goes in, a payable comes into existence, and the cost
 * history gains a row for every product on it. They land together because a
 * half-posted bill is worse than an unposted one - stock that arrived with no
 * payable is free goods, and a payable with no stock is a mystery.
 */

export class PurchaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseError';
  }
}

/** Only a live payment settles anything. A bounced cheque settles nothing. */
const LIVE_PAYMENT = { status: 'paid' } as const;

/**
 * What to call a party on a document.
 *
 * `Party` has no single name column - it carries a title, a first name, a last
 * name and, separately, a company name. Suppliers are usually companies and
 * customers usually people, so the company name wins when there is one.
 *
 * Snapshotted onto the bill at creation, like every other document in this
 * product: a supplier who renames their firm next year must not silently
 * rename themselves on bills that were already filed.
 */
function partyDisplayName(p: {
  title?: string | null;
  firstName: string;
  lastName?: string | null;
  companyName?: string | null;
}): string {
  if (p.companyName?.trim()) return p.companyName.trim();
  return [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim();
}

// ------------------------------------------------------------- settlement

/**
 * What has actually been paid against each bill.
 *
 * The truth, as opposed to `PurchaseBill.amountPaidPaise`, which is a cache of
 * this. Everything that decides whether a bill is open reads this or the column
 * kept in step with it - never the column on its own after a write.
 */
export async function paidByBill(
  scope: StoreScope,
  billIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (billIds.length === 0) return out;

  const rows = await db.supplierPaymentAllocation.groupBy({
    by: ['billId'],
    where: {
      ...scopeWhere(scope),
      billId: { in: billIds },
      payment: LIVE_PAYMENT,
    },
    _sum: { amountPaise: true },
  });

  for (const r of rows) out.set(r.billId, r._sum?.amountPaise ?? 0);
  return out;
}

/**
 * Rewrite the cached paid column for the given bills.
 *
 * THE ONLY WRITER OF `PurchaseBill.amountPaidPaise`. Called inside the same
 * transaction as every allocation change, so the cache cannot drift from the
 * allocations even for the duration of one request.
 */
async function syncBillPaidColumn(
  tx: Prisma.TransactionClient,
  storeId: string,
  billIds: string[],
): Promise<void> {
  if (billIds.length === 0) return;

  const sums = await tx.supplierPaymentAllocation.groupBy({
    by: ['billId'],
    where: { storeId, billId: { in: billIds }, payment: LIVE_PAYMENT },
    _sum: { amountPaise: true },
  });

  const paid = new Map(sums.map((s) => [s.billId, s._sum?.amountPaise ?? 0]));

  for (const billId of billIds) {
    await tx.purchaseBill.update({
      where: { id: billId },
      data: { amountPaidPaise: paid.get(billId) ?? 0 },
    });
  }
}

// ------------------------------------------------------------------ bills

export interface BillLineDraft extends BillLineInput {
  productId?: string | null;
  productName: string;
  productCode?: string | null;
  hsnCode?: string | null;
}

export interface CreateBillInput {
  partyId: string;
  /** The supplier's own number. Required - see the note on the model. */
  supplierBillNo: string;
  billDate: Date;
  dueDate: Date;
  freightPaise?: number;
  notes?: string | null;
  lines: BillLineDraft[];
  /** Post it immediately rather than leaving a draft. */
  post?: boolean;
}

export async function createBill(
  scope: StoreScope,
  input: CreateBillInput,
  userId: string,
): Promise<{ id: string; billNo: string; awaitingApproval: boolean }> {
  const storeId = scopeForWrite(scope);

  if (input.lines.length === 0) throw new PurchaseError('A bill needs at least one line.');
  if (!input.supplierBillNo.trim()) {
    throw new PurchaseError("Enter the supplier's own bill number. It is what goes on the GST return.");
  }
  if (input.lines.some((l) => !l.productName.trim())) {
    throw new PurchaseError('Every line needs a description.');
  }
  if (input.lines.some((l) => l.qty <= 0)) {
    throw new PurchaseError('Quantity must be more than zero on every line.');
  }

  const party = await db.party.findFirst({
    where: { id: input.partyId, ...scopeWhere(scope) },
    select: {
      id: true, title: true, firstName: true, lastName: true, companyName: true,
      gstin: true, state: true, isSupplier: true,
    },
  });
  if (!party) throw new PurchaseError('Supplier not found in your scope.');

  const supplierName = partyDisplayName(party);

  // A duplicate is caught by the unique index either way. Checking first turns
  // a database constraint error into a sentence naming the bill, which is the
  // difference between a user fixing it and a user filing a support ticket.
  const dup = await db.purchaseBill.findFirst({
    where: {
      ...scopeWhere(scope),
      partyId: input.partyId,
      supplierBillNo: input.supplierBillNo.trim(),
    },
    select: { billNo: true },
  });
  if (dup) {
    throw new PurchaseError(
      `${supplierName} bill ${input.supplierBillNo.trim()} is already entered as ${dup.billNo}.`,
    );
  }

  const store = await db.store.findUniqueOrThrow({
    where: { id: storeId }, select: { stateId: true },
  });
  // The SUPPLIER's state decides whether this is IGST or CGST+SGST - same
  // journey the sales side makes, in the opposite direction.
  const taxMode = resolveTaxMode(store.stateId ?? '', party.state);

  const totals = computeBillTotals(input.lines, input.freightPaise ?? 0, taxMode);
  const billNo = await allocateDocumentNumber(storeId, 'PB', input.billDate);

  const bill = await db.$transaction(async (tx) => {
    const created = await tx.purchaseBill.create({
      data: {
        storeId,
        billNo,
        supplierBillNo: input.supplierBillNo.trim(),
        partyId: party.id,
        supplierName,
        gstin: party.gstin,
        stateId: party.state,
        billDate: input.billDate,
        dueDate: input.dueDate,
        lifecycle: 'draft',
        freightPaise: input.freightPaise ?? 0,
        subtotalPaise: totals.subtotalPaise,
        itemDiscountPaise: totals.itemDiscountPaise,
        taxableBasePaise: totals.taxableBasePaise,
        cgstPaise: totals.cgstPaise,
        sgstPaise: totals.sgstPaise,
        igstPaise: totals.igstPaise,
        grandTotalPaise: totals.grandTotalPaise,
        taxMode,
        notes: input.notes ?? null,
        createdBy: userId,
      },
    });

    await tx.purchaseBillItem.createMany({
      data: input.lines.map((l, i) => ({
        storeId,
        billId: created.id,
        srNo: i + 1,
        productId: l.productId ?? null,
        productName: l.productName.trim(),
        productCode: l.productCode ?? null,
        hsnCode: l.hsnCode ?? null,
        qty: l.qty,
        unitCostPaise: l.unitCostPaise,
        discountPct: l.discountPct,
        taxRatePct: l.taxRatePct,
        lineDiscountPaise: totals.lines[i].lineDiscountPaise,
        lineTotalPaise: totals.lines[i].taxablePaise,
        movedStock: false,
      })),
    });

    // A supplier who was only ever a customer becomes both. Silently, because
    // making somebody tick a box before they can enter a bill is friction that
    // teaches nothing.
    if (!party.isSupplier) {
      await tx.party.update({ where: { id: party.id }, data: { isSupplier: true } });
    }

    return created;
  });

  const posted = input.post ? await postBill(scope, bill.id, userId) : null;

  return { id: bill.id, billNo, awaitingApproval: posted?.awaitingApproval ?? false };
}

/**
 * Post a draft bill - through the approval rules (5 Oct 2026).
 *
 * - A request is already open: pressing Post is that person's approval, with
 *   the same checks as Waiting on me. The last level posts it.
 * - A rule says it needs approval: it stays a draft (no stock in, nothing owed
 *   to the supplier yet) and the approvers are asked.
 * - Otherwise it is posted now, as before.
 */
export async function postBill(
  scope: StoreScope,
  billId: string,
  userId: string,
): Promise<{ awaitingApproval: boolean }> {
  const storeId = scopeForWrite(scope);
  const bill = await db.purchaseBill.findFirst({
    where: { id: billId, ...scopeWhere(scope) },
    select: { lifecycle: true, grandTotalPaise: true },
  });
  if (!bill) throw new PurchaseError('Bill not found in your scope.');

  if (bill.lifecycle === 'draft') {
    const { openApprovalRequest } = await import('./hierarchy');
    if (await openApprovalRequest(scope, 'purchase_bill', billId)) {
      const { gateDecision } = await import('./approval-handlers');
      const final = await gateDecision(scope, 'purchase_bill', billId, 'approved', userId, null, false);
      if (!final) return { awaitingApproval: true };
      await postApprovedBill(scope, billId, userId);
      return { awaitingApproval: false };
    }
    const { approvalNeeded, requestApproval } = await import('./approvals');
    if (await approvalNeeded(storeId, 'purchase_bill', userId, bill.grandTotalPaise)) {
      await requestApproval(storeId, { type: 'purchase_bill', entityId: billId, requesterId: userId });
      return { awaitingApproval: true };
    }
  }
  await postApprovedBill(scope, billId, userId);
  return { awaitingApproval: false };
}

/**
 * Move a draft bill to `received`: stock in, payable live, cost recorded.
 * Called once nothing stands in the way: no rule, or the approval is complete.
 *
 * All three inside one transaction. See the note at the top of this file for
 * why a half-posted bill must not be possible.
 */
export async function postApprovedBill(
  scope: StoreScope,
  billId: string,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);

  const bill = await db.purchaseBill.findFirst({
    where: { id: billId, ...scopeWhere(scope) },
    select: {
      id: true, billNo: true, lifecycle: true, partyId: true, billDate: true,
      supplierBillNo: true, freightPaise: true, taxMode: true, supplierName: true,
      items: {
        select: {
          id: true, productId: true, productName: true, productCode: true,
          qty: true, unitCostPaise: true,
          discountPct: true, taxRatePct: true, lineTotalPaise: true, srNo: true,
          product: { select: { id: true, kind: true } },
        },
        orderBy: { srNo: 'asc' },
      },
    },
  });

  if (!bill) throw new PurchaseError('Bill not found in your scope.');
  if (bill.lifecycle === 'received') return; // idempotent - a double click is not an error
  if (bill.lifecycle === 'cancelled') {
    throw new PurchaseError(`${bill.billNo} was cancelled and cannot be posted.`);
  }

  // Recomputed rather than read back from the columns. The stored totals are a
  // snapshot from when the draft was written; if a line was edited since, the
  // freight apportionment has moved and the cost history would record a figure
  // that no longer matches the bill.
  const totals = computeBillTotals(
    bill.items.map((i) => ({
      qty: i.qty,
      unitCostPaise: i.unitCostPaise,
      discountPct: Number(i.discountPct),
      taxRatePct: Number(i.taxRatePct),
    })),
    bill.freightPaise,
    bill.taxMode === 'CGST_SGST' ? 'CGST_SGST' : 'IGST',
  );

  // Posted BEFORE stock moves and the lifecycle flips to 'received' - the
  // riskiest step (a locked period, most likely) first, so a failure here
  // leaves the bill a draft with nothing else touched, rather than
  // "received" with stock on the shelf and no ledger entry behind it.
  //
  // Guarded against a retry after the transaction below fails partway
  // through: the bill's lifecycle is still 'draft' at that point (the
  // early-return above only catches an ALREADY-received bill), so a second
  // call would reach this point again - check for an existing entry first,
  // same as `postInvoiceJournal`.
  const alreadyPosted = await db.journalEntry.findFirst({
    where: { ...scopeWhere(scope), sourceType: 'purchase_bill', sourceId: bill.id },
    select: { id: true },
  });

  // A stock line debits Inventory (an asset - it only becomes an expense
  // through cost of goods sold when it actually sells); a non-stock line
  // debits Other Operating Expenses directly, since nothing about it is
  // ever going to move through inventory. Split by the same `isStock` test
  // the stock-movement loop below uses.
  let inventoryPaise = 0;
  let expensePaise = 0;
  bill.items.forEach((item, i) => {
    const isStock = item.productId != null && item.product?.kind !== 'service';
    const landed = totals.lines[i].taxablePaise + totals.lines[i].freightSharePaise;
    if (isStock) inventoryPaise += landed; else expensePaise += landed;
  });

  const journalLines: LedgerLineInput[] = [];
  if (inventoryPaise > 0) journalLines.push({ accountCode: '1200', debitPaise: inventoryPaise });
  if (expensePaise > 0) journalLines.push({ accountCode: '5900', debitPaise: expensePaise });
  if (totals.cgstPaise > 0) journalLines.push({ accountCode: '1310', debitPaise: totals.cgstPaise });
  if (totals.sgstPaise > 0) journalLines.push({ accountCode: '1320', debitPaise: totals.sgstPaise });
  if (totals.igstPaise > 0) journalLines.push({ accountCode: '1330', debitPaise: totals.igstPaise });
  journalLines.push({
    accountCode: '2100', creditPaise: totals.grandTotalPaise, partyId: bill.partyId,
    description: bill.supplierName,
  });

  if (!alreadyPosted) {
    await postJournalEntry(scope, {
      entryDate: bill.billDate,
      description: `Purchase bill ${bill.billNo} - ${bill.supplierName}`,
      sourceType: 'purchase_bill',
      sourceId: bill.id,
      lines: journalLines,
    }, userId);
  }

  // Cost history and `movedStock` stay here - both are about the BILL's own
  // record of what it paid and which of its lines were stock, independent of
  // RULE 2. What moved out is the quantity change itself, to the receipt
  // below: `movedStock` on a line still means "this line's goods physically
  // arrived," it just no longer means "this call moved them."
  const grnLines: { productId: string; productName: string; productCode: string | null; qty: number; unitCostPaise: number }[] = [];
  const costRows: Prisma.ProductPurchasePriceCreateManyInput[] = [];

  for (let i = 0; i < bill.items.length; i++) {
    const item = bill.items[i];
    // Services do not move stock. `Product.kind` is the authority; a line
    // with no product at all is a one-off expense and moves nothing either.
    const isStock = item.productId != null && item.product?.kind !== 'service';
    if (!isStock || !item.productId) continue;

    const landedUnit = landedUnitCostPaise(
      totals.lines[i].taxablePaise,
      totals.lines[i].freightSharePaise,
      item.qty,
    );

    grnLines.push({
      productId: item.productId, productName: item.productName, productCode: item.productCode,
      qty: item.qty, unitCostPaise: landedUnit,
    });

    costRows.push({
      storeId,
      productId: item.productId,
      unitCostPaise: landedUnit,
      qty: item.qty,
      purchasedAt: bill.billDate,
      supplierId: bill.partyId,
      reference: `${bill.billNo} · ${bill.supplierBillNo}`,
      // `bill`, not `manual`. A cost written from a supplier's document is
      // evidence; one typed into the product screen is a recollection, and a
      // valuation should be able to tell them apart.
      source: 'bill',
      createdBy: userId,
    });
  }

  // RULE 2: the quantity movement is a receipt, not this function. "Non-PO
  // purchase creates a linked Direct Receipt automatically" - this bill has
  // no PO of its own (bills aren't raised from a PO yet), so every stock
  // line on it gets exactly that. Done BEFORE the bill's own lifecycle flips
  // to 'received', same "riskiest step first" ordering as the ledger post
  // above, and guarded the same way: a retry after the transaction below
  // fails partway through must not create a second receipt for goods
  // already received once.
  const alreadyReceived = await db.goodsReceiptNote.findFirst({
    where: { ...scopeWhere(scope), sourceBillId: bill.id },
    select: { id: true },
  });
  if (!alreadyReceived) {
    await receiveDirectlyForBill(scope, {
      billId: bill.id,
      billNo: bill.billNo,
      partyId: bill.partyId,
      supplierName: bill.supplierName,
      receivedDate: bill.billDate,
      lines: grnLines,
    }, userId);
  }

  await db.$transaction(async (tx) => {
    if (costRows.length > 0) {
      await tx.productPurchasePrice.createMany({ data: costRows });
    }
    for (const item of bill.items) {
      const isStock = item.productId != null && item.product?.kind !== 'service';
      if (!isStock) continue;
      await tx.purchaseBillItem.update({ where: { id: item.id }, data: { movedStock: true } });
    }

    await tx.purchaseBill.update({
      where: { id: bill.id },
      data: { lifecycle: 'received' },
    });
  });
}

/**
 * Cancel a posted bill: stock back out, payable gone.
 *
 * Refused once any payment has been allocated to it. Unwinding money that has
 * left the bank is not a cancellation - the payment has to be reversed first,
 * deliberately and by somebody who knows why.
 */
export async function cancelBill(
  scope: StoreScope,
  billId: string,
  reason: string,
  userId: string,
): Promise<void> {
  scopeForWrite(scope); // throws in All Company mode - writes always target exactly one store
  if (!reason.trim()) throw new PurchaseError('Say why this bill is being cancelled.');

  const bill = await db.purchaseBill.findFirst({
    where: { id: billId, ...scopeWhere(scope) },
    select: { id: true, billNo: true, lifecycle: true },
  });
  if (!bill) throw new PurchaseError('Bill not found in your scope.');
  if (bill.lifecycle === 'cancelled') return;

  const paid = (await paidByBill(scope, [bill.id])).get(bill.id) ?? 0;
  if (paid > 0) {
    throw new PurchaseError(
      `${bill.billNo} has payments against it. Reverse those first - cancelling a bill `
      + 'that has been paid would leave the money unaccounted for.',
    );
  }

  // Reversed BEFORE stock goes back and the lifecycle flips - same ordering
  // as everywhere else in this file: a failure here leaves the bill
  // "received" with its entry intact, rather than "cancelled" with the
  // payable and inventory debit still standing. A draft bill was never
  // posted, so there is nothing to find and nothing to reverse.
  const entry = await db.journalEntry.findFirst({
    where: { ...scopeWhere(scope), sourceType: 'purchase_bill', sourceId: bill.id, reversalOfId: null },
    select: { id: true },
  });
  if (entry) {
    await reverseJournalEntry(scope, entry.id, userId, `Purchase bill ${bill.billNo} cancelled: ${reason.trim()}`);
  }

  // RULE 2: stock goes back out through the receipt that brought it in, not
  // through this function directly. A bill with no stock lines, or one
  // cancelled while still a draft, never had one - `cancelGrn` on a
  // not-found id would be a bug, so this only runs when there is one.
  const grn = await db.goodsReceiptNote.findFirst({
    where: { ...scopeWhere(scope), sourceBillId: bill.id },
    select: { id: true },
  });
  if (grn) {
    await cancelGrn(scope, grn.id, userId, `Bill ${bill.billNo} cancelled: ${reason.trim()}`);
  }

  // Cost history rows are NOT deleted. What a thing cost on the day it was
  // bought is a historical fact, and a cancelled bill does not unmake it -
  // deleting them would silently change every past valuation.
  await db.purchaseBill.update({
    where: { id: bill.id },
    data: {
      lifecycle: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: reason.trim(),
    },
  });
}

// --------------------------------------------------------------- payments

export interface PayInput {
  partyId: string;
  amountPaise: number;
  method: 'cash' | 'bank' | 'upi' | 'cheque' | 'adjustment';
  paidAt?: Date;
  reference?: string | null;
  note?: string | null;
  /**
   * Which bills to settle. Omit to clear the oldest first; pass an empty array
   * to hold the whole amount as an advance against nothing yet.
   */
  allocations?: { billId: string; amountPaise: number }[];
}

/** Bills this supplier is still owed money on, oldest first. */
export async function openBillsFor(scope: StoreScope, partyId: string) {
  const bills = await db.purchaseBill.findMany({
    where: { ...scopeWhere(scope), partyId, lifecycle: 'received' },
    select: {
      id: true, billNo: true, supplierBillNo: true, billDate: true, dueDate: true,
      grandTotalPaise: true, amountPaidPaise: true,
    },
    orderBy: { billDate: 'asc' },
    take: LIST_MAX_ROWS,
  });

  return bills
    .map((b) => ({
      id: b.id,
      billNo: b.billNo,
      supplierBillNo: b.supplierBillNo,
      billDate: b.billDate,
      dueDate: b.dueDate,
      grandTotalPaise: b.grandTotalPaise,
      paidPaise: b.amountPaidPaise,
      outstandingPaise: outstandingPaise({
        id: b.id, grandTotalPaise: b.grandTotalPaise, paidPaise: b.amountPaidPaise,
      }),
    }))
    .filter((b) => b.outstandingPaise > 0);
}

export async function paySupplier(
  scope: StoreScope,
  input: PayInput,
  userId: string,
): Promise<{ id: string; paymentNo: string; unallocatedPaise: number }> {
  const storeId = scopeForWrite(scope);

  if (input.amountPaise <= 0) throw new PurchaseError('Enter an amount greater than zero.');

  const party = await db.party.findFirst({
    where: { id: input.partyId, ...scopeWhere(scope) },
    select: { id: true, title: true, firstName: true, lastName: true, companyName: true },
  });
  if (!party) throw new PurchaseError('Supplier not found in your scope.');
  const partyName = party.companyName?.trim()
    || [party.title, party.firstName, party.lastName].filter(Boolean).join(' ').trim();

  const open = await openBillsFor(scope, input.partyId);

  const allocations = input.allocations
    ?? allocateOldestFirst(
      open.map((b) => ({ id: b.id, grandTotalPaise: b.grandTotalPaise, paidPaise: b.paidPaise })),
      input.amountPaise,
    ).allocations;

  // Checked before the transaction opens, so a bad split is refused without
  // anything having been written.
  let allocated = 0;
  for (const a of allocations) {
    if (a.amountPaise <= 0) throw new PurchaseError('An allocation must be more than zero.');
    const bill = open.find((b) => b.id === a.billId);
    if (!bill) {
      throw new PurchaseError('One of the bills is not open, or belongs to another supplier.');
    }
    if (a.amountPaise > bill.outstandingPaise) {
      throw new PurchaseError(
        `${bill.billNo} only has ${(bill.outstandingPaise / 100).toFixed(2)} outstanding.`,
      );
    }
    allocated += a.amountPaise;
  }
  if (allocated > input.amountPaise) {
    throw new PurchaseError('The allocations add up to more than the payment.');
  }

  const paymentNo = await allocateDocumentNumber(storeId, 'PMT', input.paidAt);

  const payment = await db.$transaction(async (tx) => {
    const p = await tx.supplierPayment.create({
      data: {
        storeId,
        paymentNo,
        partyId: input.partyId,
        amountPaise: input.amountPaise,
        paidAt: input.paidAt ?? new Date(),
        method: input.method,
        reference: input.reference ?? null,
        note: input.note ?? null,
        recordedBy: userId,
      },
    });

    if (allocations.length > 0) {
      await tx.supplierPaymentAllocation.createMany({
        data: allocations.map((a) => ({
          storeId,
          paymentId: p.id,
          billId: a.billId,
          amountPaise: a.amountPaise,
        })),
      });
      await syncBillPaidColumn(tx, storeId, allocations.map((a) => a.billId));
    }

    return p;
  });

  // Debits Accounts Payable for this party - the mirror of a receipt
  // crediting Accounts Receivable - and credits wherever the money actually
  // left from. One line per party regardless of which bills it settles, for
  // the same reason a receipt is: which bills a payment clears is an
  // allocation detail, not a fact the GL needs.
  const lines: LedgerLineInput[] = [
    { accountCode: '2100', debitPaise: input.amountPaise, partyId: input.partyId, description: partyName },
    { accountCode: DEBIT_METHOD_TO_CREDIT_ACCOUNT[input.method], creditPaise: input.amountPaise, description: partyName },
  ];
  await postJournalEntry(scope, {
    entryDate: input.paidAt ?? new Date(),
    description: `Payment ${paymentNo} - ${partyName}`,
    sourceType: 'supplier_payment',
    sourceId: payment.id,
    lines,
  }, userId);

  return {
    id: payment.id,
    paymentNo,
    unallocatedPaise: input.amountPaise - allocated,
  };
}

/**
 * A payment that failed - a bounced cheque, a reversed transfer.
 *
 * The row stays and the allocations stay. Settlement filters on status when it
 * reads, so every bill it was paying reopens by itself. Deleting would lose the
 * fact that a payment was attempted and failed, which is exactly the thing
 * somebody will need when the supplier rings.
 */
export async function reversePayment(
  scope: StoreScope,
  paymentId: string,
  reason: string,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new PurchaseError('Say why this payment is being reversed.');

  const payment = await db.supplierPayment.findFirst({
    where: { id: paymentId, ...scopeWhere(scope) },
    select: {
      id: true, status: true, paymentNo: true,
      allocations: { select: { billId: true } },
    },
  });
  if (!payment) throw new PurchaseError('Payment not found in your scope.');
  if (payment.status === 'reversed') return;

  const entry = await db.journalEntry.findFirst({
    where: { ...scopeWhere(scope), sourceType: 'supplier_payment', sourceId: payment.id, reversalOfId: null },
    select: { id: true },
  });
  if (entry) {
    await reverseJournalEntry(scope, entry.id, userId, `Payment ${payment.paymentNo} reversed: ${reason.trim()}`);
  }

  await db.$transaction(async (tx) => {
    await tx.supplierPayment.update({
      where: { id: payment.id },
      data: {
        status: 'reversed',
        reversedAt: new Date(),
        reversalReason: reason.trim(),
        reversedBy: userId,
      },
    });

    await syncBillPaidColumn(tx, storeId, payment.allocations.map((a) => a.billId));
  });
}

// ------------------------------------------------------------------ reads

export interface BillRow {
  id: string;
  billNo: string;
  supplierBillNo: string;
  partyId: string;
  supplierName: string;
  billDate: Date;
  dueDate: Date;
  lifecycle: string;
  grandTotalPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  status: BillStatus;
  lineCount: number;
}

export async function listBills(
  scope: StoreScope,
  opts: { from?: Date; to?: Date; partyId?: string; take?: number } = {},
): Promise<BillRow[]> {
  const rows = await db.purchaseBill.findMany({
    where: {
      ...scopeWhere(scope),
      ...(opts.from || opts.to
        ? { billDate: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
      ...(opts.partyId ? { partyId: opts.partyId } : {}),
    },
    select: {
      id: true, billNo: true, supplierBillNo: true, partyId: true, supplierName: true,
      billDate: true, dueDate: true, lifecycle: true,
      grandTotalPaise: true, amountPaidPaise: true,
      _count: { select: { items: true } },
    },
    orderBy: { billDate: 'desc' },
    take: opts.take ?? 500,
  });

  const now = new Date();

  return rows.map((b) => ({
    id: b.id,
    billNo: b.billNo,
    supplierBillNo: b.supplierBillNo,
    partyId: b.partyId,
    supplierName: b.supplierName,
    billDate: b.billDate,
    dueDate: b.dueDate,
    lifecycle: b.lifecycle,
    grandTotalPaise: b.grandTotalPaise,
    paidPaise: b.amountPaidPaise,
    outstandingPaise: outstandingPaise({
      id: b.id, grandTotalPaise: b.grandTotalPaise, paidPaise: b.amountPaidPaise,
    }),
    // Derived on every read. Never stored: a bill becomes overdue while nobody
    // is looking at it, and no write happens at that moment to update a column.
    status: billStatus(
      {
        id: b.id,
        grandTotalPaise: b.grandTotalPaise,
        paidPaise: b.amountPaidPaise,
        lifecycle: b.lifecycle,
        dueDate: b.dueDate,
      },
      now,
    ),
    lineCount: b._count.items,
  }));
}

export async function getBill(scope: StoreScope, billId: string) {
  const bill = await db.purchaseBill.findFirst({
    where: { id: billId, ...scopeWhere(scope) },
    include: {
      items: { orderBy: { srNo: 'asc' } },
      allocations: {
        include: {
          payment: {
            select: {
              id: true, paymentNo: true, paidAt: true, method: true,
              reference: true, status: true,
            },
          },
        },
      },
    },
  });
  if (!bill) throw new PurchaseError('Bill not found in your scope.');
  return bill;
}

export interface SupplierBalanceRow {
  partyId: string;
  supplierName: string;
  billCount: number;
  billedPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  oldestDueDate: Date | null;
}

/**
 * What is owed, per supplier. The payables ledger.
 *
 * Drafts are excluded: a bill nobody has posted is somebody typing, and
 * counting it as a liability would overstate what the business owes.
 */
export async function supplierBalances(scope: StoreScope): Promise<SupplierBalanceRow[]> {
  const bills = await db.purchaseBill.findMany({
    where: { ...scopeWhere(scope), lifecycle: 'received' },
    select: {
      partyId: true, supplierName: true, dueDate: true,
      grandTotalPaise: true, amountPaidPaise: true,
    },
    take: LIST_MAX_ROWS,
  });

  const byParty = new Map<string, SupplierBalanceRow>();

  for (const b of bills) {
    const row = byParty.get(b.partyId) ?? {
      partyId: b.partyId,
      supplierName: b.supplierName,
      billCount: 0,
      billedPaise: 0,
      paidPaise: 0,
      outstandingPaise: 0,
      oldestDueDate: null,
    };

    const owed = outstandingPaise({
      id: b.partyId, grandTotalPaise: b.grandTotalPaise, paidPaise: b.amountPaidPaise,
    });

    row.billCount += 1;
    row.billedPaise += b.grandTotalPaise;
    row.paidPaise += b.amountPaidPaise;
    row.outstandingPaise += owed;

    // Only bills still owed set the oldest due date. A paid bill from 2024 is
    // not the thing a supplier is chasing.
    if (owed > 0 && (!row.oldestDueDate || b.dueDate < row.oldestDueDate)) {
      row.oldestDueDate = b.dueDate;
    }

    byParty.set(b.partyId, row);
  }

  return [...byParty.values()]
    .filter((r) => r.outstandingPaise > 0 || r.billCount > 0)
    .sort((a, b) => b.outstandingPaise - a.outstandingPaise);
}

export interface PaymentRow {
  id: string;
  paymentNo: string;
  partyId: string;
  supplierName: string;
  amountPaise: number;
  paidAt: Date;
  method: string;
  reference: string | null;
  status: string;
  /** How much of it was put against bills. The rest sits as an advance. */
  allocatedPaise: number;
}

export async function listPayments(
  scope: StoreScope,
  opts: { partyId?: string; take?: number } = {},
): Promise<PaymentRow[]> {
  const rows = await db.supplierPayment.findMany({
    where: {
      ...scopeWhere(scope),
      ...(opts.partyId ? { partyId: opts.partyId } : {}),
    },
    select: {
      id: true, paymentNo: true, partyId: true, amountPaise: true, paidAt: true,
      method: true, reference: true, status: true,
      party: {
        select: { title: true, firstName: true, lastName: true, companyName: true },
      },
      allocations: { select: { amountPaise: true } },
    },
    orderBy: { paidAt: 'desc' },
    take: opts.take ?? 300,
  });

  return rows.map((p) => ({
    id: p.id,
    paymentNo: p.paymentNo,
    partyId: p.partyId,
    // Read live from the party rather than snapshotted. A payment is a bank
    // transaction, not a document handed to anybody - nobody holds a copy that
    // could disagree, so the current name is the useful one.
    supplierName: partyDisplayName(p.party),
    amountPaise: p.amountPaise,
    paidAt: p.paidAt,
    method: p.method,
    reference: p.reference,
    status: p.status,
    allocatedPaise: p.allocations.reduce((n, a) => n + a.amountPaise, 0),
  }));
}
