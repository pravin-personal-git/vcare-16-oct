import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { applyMovements } from './stock';
import { postJournalEntry, reverseJournalEntry } from './ledger';
import type { LedgerLineInput } from '@/lib/ledger';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * Goods going back to a supplier - spec 06-inventory.md §2.2 / 10-accounts-
 * purchase.md §2.2 ("Mirrors Sales Return").
 *
 * The physical half only, same split as `SalesReturn`/`CreditNote`: stock
 * moves here, on dispatch; `issueDebitNote` below is the financial half,
 * reducing what's owed to the supplier. They can happen on different days,
 * which is the whole reason they're two documents and not one.
 */

export class PurchaseReturnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseReturnError';
  }
}

// --------------------------------------------------------------- reading

export interface BillLineForReturn {
  billItemId: string;
  productId: string | null;
  productName: string;
  productCode: string | null;
  hsnCode: string | null;
  qty: number;
  unitCostPaise: number;
  discountPct: number;
  taxRatePct: number;
  taxablePaise: number;
  returnedQty: number;
}

export interface BillForReturn {
  id: string;
  billNo: string;
  supplierBillNo: string;
  billDate: Date;
  lifecycle: string;
  supplierName: string;
  partyId: string;
  gstin: string | null;
  taxMode: string;
  lines: BillLineForReturn[];
}

async function returnedQtyByBillItem(
  scope: StoreScope, billItemIds: string[],
): Promise<Map<string, number>> {
  const rows = await db.purchaseReturnItem.groupBy({
    by: ['billItemId'],
    where: {
      billItemId: { in: billItemIds },
      return: { ...scopeWhere(scope), lifecycle: { not: 'cancelled' } },
    },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.billItemId, r._sum.qty ?? 0]));
}

export async function getBillForReturn(
  scope: StoreScope, billId: string,
): Promise<BillForReturn | null> {
  const bill = await db.purchaseBill.findFirst({
    where: { id: billId, ...scopeWhere(scope) },
    select: {
      id: true, billNo: true, supplierBillNo: true, billDate: true, lifecycle: true,
      supplierName: true, partyId: true, gstin: true, taxMode: true,
      items: {
        orderBy: { srNo: 'asc' },
        select: {
          id: true, productId: true, productName: true, productCode: true, hsnCode: true,
          qty: true, unitCostPaise: true, discountPct: true, taxRatePct: true, lineTotalPaise: true,
        },
      },
    },
  });
  if (!bill) return null;

  const returned = await returnedQtyByBillItem(scope, bill.items.map((i) => i.id));

  return {
    id: bill.id,
    billNo: bill.billNo,
    supplierBillNo: bill.supplierBillNo,
    billDate: bill.billDate,
    lifecycle: bill.lifecycle,
    supplierName: bill.supplierName,
    partyId: bill.partyId,
    gstin: bill.gstin,
    taxMode: bill.taxMode,
    lines: bill.items.map((i) => ({
      billItemId: i.id,
      productId: i.productId,
      productName: i.productName,
      productCode: i.productCode,
      hsnCode: i.hsnCode,
      qty: i.qty,
      unitCostPaise: i.unitCostPaise,
      discountPct: Number(i.discountPct),
      taxRatePct: Number(i.taxRatePct),
      taxablePaise: i.lineTotalPaise,
      returnedQty: returned.get(i.id) ?? 0,
    })),
  };
}

// --------------------------------------------------------------- creating

export interface ProposedReturnLine { billItemId: string; qty: number }

export interface CreateReturnInput {
  billId: string;
  lines: ProposedReturnLine[];
  reason: string;
  returnedAt?: Date | null;
  warehouseId?: string | null;
  notes?: string | null;
  /** Mark it dispatched immediately - stock leaves in the same step. */
  dispatchNow?: boolean;
}

export async function createPurchaseReturn(
  scope: StoreScope, input: CreateReturnInput, userId: string,
): Promise<{ id: string; returnNo: string; dispatched: boolean }> {
  const storeId = scopeForWrite(scope);

  const bill = await getBillForReturn(scope, input.billId);
  if (!bill) throw new PurchaseReturnError('Purchase bill not found in your scope.');
  if (bill.lifecycle !== 'received') {
    throw new PurchaseReturnError(
      bill.lifecycle === 'draft'
        ? `${bill.billNo} is still a draft. Receive it before returning against it.`
        : `${bill.billNo} has been cancelled, so nothing was received to return.`,
    );
  }
  if (input.lines.length === 0) throw new PurchaseReturnError('Add at least one line to return.');

  const byId = new Map(bill.lines.map((l) => [l.billItemId, l]));
  const merged = new Map<string, number>();
  for (const p of input.lines) {
    if (p.qty <= 0) continue;
    const line = byId.get(p.billItemId);
    if (!line) throw new PurchaseReturnError('That bill line was not found on this bill.');
    merged.set(p.billItemId, (merged.get(p.billItemId) ?? 0) + p.qty);
  }
  if (merged.size === 0) throw new PurchaseReturnError('Enter a quantity greater than zero on at least one line.');

  for (const [billItemId, qty] of merged) {
    const line = byId.get(billItemId)!;
    const left = line.qty - line.returnedQty;
    if (qty > left) {
      throw new PurchaseReturnError(
        `${line.productName}: only ${Math.max(0, left)} can still be returned.`,
      );
    }
  }

  const returnNo = await allocateDocumentNumber(storeId, 'PR', input.returnedAt ?? undefined);
  const dispatching = input.dispatchNow === true;

  const created = await db.$transaction(async (tx) => {
    // Re-check inside the transaction against rows this transaction can see -
    // same reasoning as every other cumulative cap in this codebase.
    const live = await tx.purchaseReturnItem.groupBy({
      by: ['billItemId'],
      where: {
        billItemId: { in: [...merged.keys()] },
        return: { storeId, lifecycle: { not: 'cancelled' } },
      },
      _sum: { qty: true },
    });
    const already = new Map(live.map((r) => [r.billItemId, r._sum.qty ?? 0]));

    for (const [billItemId, qty] of merged) {
      const line = byId.get(billItemId)!;
      const left = line.qty - (already.get(billItemId) ?? 0);
      if (qty > left) {
        throw new PurchaseReturnError(
          `${line.productName}: only ${Math.max(0, left)} can still be returned.`
          + ' Somebody else recorded a return while this one was open - reopen the bill and try again.',
        );
      }
    }

    const pr = await tx.purchaseReturn.create({
      data: {
        returnNo,
        storeId,
        billId: bill.id,
        partyId: bill.partyId,
        supplierName: bill.supplierName,
        gstin: bill.gstin,
        returnedAt: input.returnedAt ?? new Date(),
        lifecycle: dispatching ? 'dispatched' : 'draft',
        reason: input.reason,
        warehouseId: input.warehouseId ?? null,
        notes: input.notes ?? null,
        dispatchedAt: dispatching ? new Date() : null,
        dispatchedBy: dispatching ? userId : null,
        createdBy: userId,
        items: {
          create: [...merged].map(([billItemId, qty], idx) => {
            const line = byId.get(billItemId)!;
            return {
              srNo: idx + 1,
              billItemId,
              productId: line.productId,
              productName: line.productName,
              productCode: line.productCode,
              hsnCode: line.hsnCode,
              qty,
              unitCostPaise: line.unitCostPaise,
              discountPct: line.discountPct,
              taxRatePct: line.taxRatePct,
              billLineQty: line.qty,
              billLineTaxablePaise: line.taxablePaise,
            };
          }),
        },
      },
      include: { items: true },
    });

    if (dispatching) {
      const lines = pr.items.filter((i) => i.productId);
      if (lines.length > 0) {
        await applyMovements(tx, storeId, userId, lines.map((i) => ({
          productId: i.productId as string,
          qty: -i.qty,
          reason: 'return_out' as const,
          refType: 'PurchaseReturn',
          refId: pr.id,
          refNo: returnNo,
          // Rule 4: the serial units go back to the SUPPLIER, not to a customer.
          // Which ones matters here more than anywhere - a supplier's warranty
          // claim is answered with their own serial number.
          partyId: pr.partyId,
        })));
      }
    }

    return pr;
  });

  return { id: created.id, returnNo, dispatched: dispatching };
}

/**
 * Mark the goods physically dispatched. Separate from creation for the same
 * reason `receiveReturn` is separate on the sales side - a return can be
 * logged today and only actually leave with tomorrow's courier pickup.
 */
export async function dispatchPurchaseReturn(
  scope: StoreScope, id: string, userId: string,
): Promise<{ returnNo: string }> {
  const storeId = scopeForWrite(scope);

  const pr = await db.purchaseReturn.findFirst({
    where: { id, storeId },
    include: { items: true },
  });
  if (!pr) throw new PurchaseReturnError('Return not found in your scope.');
  if (pr.lifecycle === 'cancelled') throw new PurchaseReturnError(`${pr.returnNo} has been cancelled.`);
  if (pr.lifecycle === 'dispatched') throw new PurchaseReturnError(`${pr.returnNo} has already been dispatched.`);

  await db.$transaction(async (tx) => {
    const updated = await tx.purchaseReturn.updateMany({
      where: { id, storeId, lifecycle: 'draft' },
      data: { lifecycle: 'dispatched', dispatchedAt: new Date(), dispatchedBy: userId },
    });
    if (updated.count === 0) return;

    const lines = pr.items.filter((i) => i.productId);
    if (lines.length > 0) {
      await applyMovements(tx, storeId, userId, lines.map((i) => ({
        productId: i.productId as string,
        qty: -i.qty,
        reason: 'return_out' as const,
        refType: 'PurchaseReturn',
        refId: pr.id,
        refNo: pr.returnNo,
      })));
    }
  });

  return { returnNo: pr.returnNo };
}

export async function cancelPurchaseReturn(
  scope: StoreScope, id: string, reason: string, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new PurchaseReturnError('Say why this return is being cancelled.');

  const pr = await db.purchaseReturn.findFirst({
    where: { id, storeId },
    include: {
      items: true,
      debitNotes: { select: { debitNoteNo: true, lifecycle: true } },
    },
  });
  if (!pr) throw new PurchaseReturnError('Return not found in your scope.');

  const live = pr.debitNotes.filter((d) => d.lifecycle === 'issued');
  if (live.length > 0) {
    throw new PurchaseReturnError(
      `${live.map((d) => d.debitNoteNo).join(', ')} has been issued against this return.`
      + ' Cancel the debit note first - the goods and the money have to be withdrawn together.',
    );
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.purchaseReturn.updateMany({
      where: { id, storeId, lifecycle: { not: 'cancelled' } },
      data: { lifecycle: 'cancelled', cancelledAt: new Date(), cancelReason: reason.trim() },
    });
    if (updated.count === 0) return;

    // Only reverse what actually left. A draft never moved stock.
    if (pr.lifecycle === 'dispatched') {
      const lines = pr.items.filter((i) => i.productId);
      if (lines.length > 0) {
        await applyMovements(tx, storeId, userId, lines.map((i) => ({
          productId: i.productId as string,
          qty: i.qty,
          reason: 'return_out' as const,
          refType: 'PurchaseReturn',
          refId: pr.id,
          refNo: `${pr.returnNo} (cancelled)`,
        })));
      }
    }
  });
}

// ---------------------------------------------------------- debit notes

const CASH_LIKE_ACCOUNT = { CGST: '1310', SGST: '1320', IGST: '1330' } as const;

function debitNoteTotals(items: { qty: number; unitCostPaise: number; discountPct: number; taxRatePct: number }[]) {
  let taxableBasePaise = 0;
  let taxPaise = 0;
  for (const i of items) {
    const gross = i.qty * i.unitCostPaise;
    const taxable = Math.round(gross * (1 - i.discountPct / 100));
    taxableBasePaise += taxable;
    taxPaise += Math.round(taxable * (i.taxRatePct / 100));
  }
  return { taxableBasePaise, taxPaise };
}

export async function issueDebitNote(
  scope: StoreScope,
  input: { purchaseReturnId: string; reason: string; debitNoteDate?: Date | null },
  userId: string,
): Promise<{ id: string; debitNoteNo: string }> {
  const storeId = scopeForWrite(scope);
  if (!input.reason.trim()) throw new PurchaseReturnError('Say what this debit note is for.');

  const pr = await db.purchaseReturn.findFirst({
    where: { id: input.purchaseReturnId, storeId },
    include: { items: true, debitNotes: { select: { lifecycle: true } } },
  });
  if (!pr) throw new PurchaseReturnError('Return not found in your scope.');
  if (pr.lifecycle !== 'dispatched') {
    throw new PurchaseReturnError('Dispatch the return before issuing a debit note against it - the two must move together.');
  }
  if (pr.debitNotes.some((d) => d.lifecycle === 'issued')) {
    throw new PurchaseReturnError('A debit note has already been issued for this return.');
  }

  const bill = await db.purchaseBill.findFirstOrThrow({
    where: { id: pr.billId }, select: { taxMode: true },
  });
  const taxMode = bill.taxMode === 'IGST' ? 'IGST' : 'CGST_SGST';

  const { taxableBasePaise, taxPaise } = debitNoteTotals(
    pr.items.map((i) => ({
      qty: i.qty, unitCostPaise: i.unitCostPaise,
      discountPct: Number(i.discountPct), taxRatePct: Number(i.taxRatePct),
    })),
  );
  const cgstPaise = taxMode === 'CGST_SGST' ? Math.round(taxPaise / 2) : 0;
  const sgstPaise = taxMode === 'CGST_SGST' ? taxPaise - cgstPaise : 0;
  const igstPaise = taxMode === 'IGST' ? taxPaise : 0;
  const grandTotalPaise = taxableBasePaise + taxPaise;

  const debitNoteNo = await allocateDocumentNumber(storeId, 'DN', input.debitNoteDate ?? undefined);

  const dn = await db.supplierDebitNote.create({
    data: {
      debitNoteNo,
      storeId,
      billId: pr.billId,
      purchaseReturnId: pr.id,
      partyId: pr.partyId,
      supplierName: pr.supplierName,
      gstin: pr.gstin,
      debitNoteDate: input.debitNoteDate ?? new Date(),
      taxableBasePaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      grandTotalPaise,
      reason: input.reason.trim(),
      lifecycle: 'issued',
      issuedAt: new Date(),
      createdBy: userId,
    },
  });

  const lines: LedgerLineInput[] = [
    { accountCode: '2100', debitPaise: grandTotalPaise, partyId: pr.partyId ?? undefined, description: pr.supplierName },
    { accountCode: '1200', creditPaise: taxableBasePaise, description: pr.supplierName },
  ];
  if (cgstPaise > 0) lines.push({ accountCode: CASH_LIKE_ACCOUNT.CGST, creditPaise: cgstPaise });
  if (sgstPaise > 0) lines.push({ accountCode: CASH_LIKE_ACCOUNT.SGST, creditPaise: sgstPaise });
  if (igstPaise > 0) lines.push({ accountCode: CASH_LIKE_ACCOUNT.IGST, creditPaise: igstPaise });

  // Same reasoning as `createStaffTransaction`/`createTransaction`: the
  // posting needs this row's own id, so the create has to come first. If
  // posting fails, the debit note must not survive as an "issued" document
  // with no journal entry behind it.
  try {
    await postJournalEntry(scope, {
      entryDate: dn.debitNoteDate,
      description: `Debit note ${debitNoteNo} - ${pr.supplierName}`,
      sourceType: 'debit_note',
      sourceId: dn.id,
      lines,
    }, userId);
  } catch (e) {
    await db.supplierDebitNote.delete({ where: { id: dn.id } });
    throw e;
  }

  return { id: dn.id, debitNoteNo };
}

export async function cancelDebitNote(
  scope: StoreScope, id: string, reason: string, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new PurchaseReturnError('Say why this debit note is being cancelled.');

  const dn = await db.supplierDebitNote.findFirst({ where: { id, storeId } });
  if (!dn) throw new PurchaseReturnError('Debit note not found in your scope.');
  if (dn.lifecycle !== 'issued') throw new PurchaseReturnError('Only an issued debit note can be cancelled.');

  const entry = await db.journalEntry.findFirst({
    where: { ...scopeWhere(scope), sourceType: 'debit_note', sourceId: id, reversalOfId: null },
    select: { id: true },
  });

  await db.supplierDebitNote.update({
    where: { id },
    data: { lifecycle: 'cancelled', cancelledAt: new Date(), cancelReason: reason.trim() },
  });

  if (entry) await reverseJournalEntry(scope, entry.id, userId, reason.trim());
}

// ------------------------------------------------------------------- lists

export async function listPurchaseReturns(scope: StoreScope) {
  return db.purchaseReturn.findMany({
    where: scopeWhere(scope),
    select: {
      id: true, returnNo: true, supplierName: true, returnedAt: true, lifecycle: true,
      reason: true, billId: true,
      bill: { select: { billNo: true, supplierBillNo: true } },
      items: { select: { qty: true, unitCostPaise: true } },
      debitNotes: { select: { id: true, debitNoteNo: true, lifecycle: true, grandTotalPaise: true } },
    },
    orderBy: { returnedAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
}
