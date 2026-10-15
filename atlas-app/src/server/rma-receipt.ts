import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { logActivity } from './complaints';
import { splitCharge, COURIER_PAID_BY, type CourierPaidBy } from '@/lib/supplier-dispatch';
import { isSupplierAnswer, SUPPLIER_ANSWER_LABEL, RMA_OUTCOME_LABEL, type RmaOutcome } from '@/lib/rma';

/**
 * WHAT COMES BACK FROM A SUPPLIER (10 Oct 2026, SERVICE-REPAIR-FLOW-SPEC stage 5).
 *
 * Three things happen while an item is away, and this file records each:
 *
 * 1. The supplier ANSWERS - will repair, sending a new one, credit note,
 *    cannot repair - often with a quote. A chargeable item's estimate is
 *    drafted from that quote plus the markup (the complaint page reads it).
 * 2. Something PHYSICAL comes back: received line by line on an RMA receipt
 *    (GRR) - repaired (same serial), a new serial (a unit is created for the
 *    customer here; its fresh warranty starts at hand-over), or back
 *    unrepaired. A box may come back in parts, so a dispatch can have several
 *    receipts. A return courier we paid is shared across the lines and posted
 *    like the outbound one.
 * 3. NOTHING comes back: the supplier's credit note or their written reply
 *    (kept it, scrapped it) closes the case with no receipt.
 *
 * Every case still moves through `moveRmaCase`, so its unit, its complaint
 * item and its box all follow - this file never sets a case status itself.
 */

export class RmaReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RmaReceiptError';
  }
}

const partyName = (p: { title?: string | null; firstName: string; lastName?: string | null; companyName?: string | null } | null) =>
  p ? (p.companyName?.trim() || [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim()) : null;
const PARTY = { select: { title: true, firstName: true, lastName: true, companyName: true } } as const;
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

// ------------------------------------------------------------ the supplier's answer

export interface SupplierAnswerInput {
  answer: string;
  /** Their charge, before GST; null when they do not charge (warranty) or have not said. */
  quotePaise: number | null;
  note: string | null;
}

export async function recordSupplierAnswer(scope: StoreScope, caseId: string, input: SupplierAnswerInput, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!isSupplierAnswer(input.answer)) throw new RmaReceiptError('Choose what the supplier said.');
  const quote = input.quotePaise === null ? null : Math.round(input.quotePaise);
  if (quote !== null && !(quote >= 0)) throw new RmaReceiptError('The quote cannot be negative.');
  const c = await db.replacementCase.findFirst({
    where: { id: caseId, storeId, deletedAt: null },
    select: { id: true, caseNo: true, status: true, productName: true, serialNo: true, complaintId: true },
  });
  if (!c) throw new RmaReceiptError('That case is not in this branch.');
  if (c.status !== 'sent') throw new RmaReceiptError('Only an item that is with the supplier can have their answer recorded.');
  const line = `Supplier: ${SUPPLIER_ANSWER_LABEL[input.answer]}${quote ? `, quote ${rupees(quote)}` : ''}${input.note?.trim() ? ` - ${input.note.trim()}` : ''}.`;
  await db.$transaction(async (tx) => {
    await tx.replacementCase.update({
      where: { id: c.id },
      data: { supplierAnswer: input.answer, supplierQuotePaise: quote || null, supplierAnswerNote: input.note?.trim() || null, supplierAnswerAt: new Date() },
    });
    await tx.replacementEvent.create({ data: { storeId, caseId: c.id, kind: 'note', note: line.slice(0, 1000), createdBy: userId } });
    // Staff see it on the complaint; the customer hears about it through the estimate, not this.
    if (c.complaintId) await logActivity(tx, c.complaintId, 'item_changed', userId, { body: `${c.productName}${c.serialNo ? ` (S/N ${c.serialNo})` : ''} - ${line}` });
  });
}

// ------------------------------------------------------------ receive

/** What came back on one line of a receipt. */
export const RECEIVE_RESULTS = ['repaired', 'replaced', 'returned_unrepaired'] as const;
export type ReceiveResult = (typeof RECEIVE_RESULTS)[number];

export interface ReceiveInput {
  lines: { caseId: string; result: string; newSerialNo?: string | null }[];
  courier: string | null;
  docketNo: string | null;
  courierChargePaise: number;
  courierPaidBy: string;
  note: string | null;
}

/**
 * Receive part or all of a box. Every line must be a case on this dispatch
 * that is still with the supplier. A new serial for a customer's item becomes
 * a unit of theirs, "in for repair" with us until it is handed over.
 */
export async function receiveFromSupplier(scope: StoreScope, dispatchId: string, input: ReceiveInput, userId: string): Promise<{ id: string; receiptNo: string; warnings: string[] }> {
  const storeId = scopeForWrite(scope);
  const d = await db.supplierDispatch.findFirst({
    where: { id: dispatchId, storeId, deletedAt: null },
    select: { id: true, dispatchNo: true, supplierId: true, supplierName: true, serviceCentre: true },
  });
  if (!d) throw new RmaReceiptError('That dispatch is not in this branch.');
  const lines = input.lines.filter((l) => l.result);
  if (!lines.length) throw new RmaReceiptError('Tick what came back.');
  if (new Set(lines.map((l) => l.caseId)).size !== lines.length) throw new RmaReceiptError('An item is on the receipt twice.');
  for (const l of lines) {
    if (!(RECEIVE_RESULTS as readonly string[]).includes(l.result)) throw new RmaReceiptError('Say what came back for each item.');
  }
  const cases = await db.replacementCase.findMany({
    where: { id: { in: lines.map((l) => l.caseId) }, storeId, dispatchId: d.id, deletedAt: null },
    select: {
      id: true, caseNo: true, status: true, productId: true, productName: true, customerId: true, complaintItemId: true, courierSharePaise: true,
      stockUnit: { select: { productId: true } },
      product: { select: { trackingMode: true } },
    },
  });
  if (cases.length !== lines.length) throw new RmaReceiptError('An item is not on this dispatch.');
  const byId = new Map(cases.map((c) => [c.id, c]));
  // Check everything before writing anything: a half-received box is worse than a refused one.
  for (const l of lines) {
    const c = byId.get(l.caseId)!;
    if (c.status !== 'sent') throw new RmaReceiptError(`${c.caseNo} is not with the supplier any more.`);
    if (l.result === 'replaced') {
      const serial = l.newSerialNo?.trim();
      const productId = c.stockUnit?.productId ?? c.productId;
      if (!serial && (c.stockUnit || c.product?.trackingMode === 'serial')) throw new RmaReceiptError(`${c.caseNo}: enter the new serial number the supplier sent.`);
      if (serial && productId && await db.stockUnit.findFirst({ where: { storeId, productId, serialNo: { equals: serial, mode: 'insensitive' } }, select: { id: true } })) {
        throw new RmaReceiptError(`${c.caseNo}: serial ${serial} is already on file.`);
      }
    }
  }
  const charge = Math.max(0, Math.round(input.courierChargePaise || 0));
  const paidBy: CourierPaidBy = (COURIER_PAID_BY as readonly string[]).includes(input.courierPaidBy) ? input.courierPaidBy as CourierPaidBy : 'none';
  const shares = splitCharge(charge, lines.map(() => null), 'equal');

  const receiptNo = await allocateDocumentNumber(storeId, 'GRR');
  const receipt = await db.rmaReceipt.create({
    data: {
      storeId, receiptNo, dispatchId: d.id, supplierId: d.supplierId, supplierName: d.supplierName ?? d.serviceCentre,
      courier: input.courier?.trim() || null, docketNo: input.docketNo?.trim() || null,
      courierChargePaise: charge, courierPaidBy: paidBy, note: input.note?.trim() || null, createdBy: userId,
    },
    select: { id: true },
  });

  const warnings: string[] = [];
  const { moveRmaCase } = await import('./rma');
  for (const [i, l] of lines.entries()) {
    const c = byId.get(l.caseId)!;
    const serial = l.newSerialNo?.trim() || null;
    let replacementUnitId: string | null = null;
    try {
      // The customer's new unit: theirs from the start, with us until hand-over.
      const productId = c.stockUnit?.productId ?? c.productId;
      if (l.result === 'replaced' && serial && c.complaintItemId && productId) {
        const u = await db.stockUnit.create({
          data: {
            storeId, productId, serialNo: serial, status: 'in_repair', condition: 'new', partyId: c.customerId,
            receivedAt: new Date(), createdBy: userId, note: `Supplier's replacement on ${c.caseNo} (${receiptNo}) - the customer's; warranty starts when it is handed over.`,
            events: { create: { storeId, eventType: 'received', toStatus: 'in_repair', partyId: c.customerId, refType: 'RmaReceipt', refId: receipt.id, refNo: receiptNo, note: `New serial from the supplier for ${c.caseNo}.`, createdBy: userId } },
          },
          select: { id: true },
        });
        replacementUnitId = u.id;
      }
      const r = await moveRmaCase(scope, c.id, {
        to: 'received_back', outcome: l.result, replacementSerialNo: serial, receiptId: receipt.id, replacementUnitId,
        note: `Received on ${receiptNo}: ${RMA_OUTCOME_LABEL[l.result as RmaOutcome]}${serial ? `, new serial ${serial}` : ''}.`,
      }, userId);
      if (r.warning) warnings.push(`${c.caseNo}: ${r.warning}`);
      if (shares[i] > 0) await db.replacementCase.update({ where: { id: c.id }, data: { courierSharePaise: (c.courierSharePaise ?? 0) + shares[i] } });
    } catch (e) {
      warnings.push(`${c.caseNo}: not received - ${(e as Error).message}`);
      if (replacementUnitId) await db.stockUnit.delete({ where: { id: replacementUnitId } }).catch(() => null);
    }
  }

  // The return courier, when we paid it: Freight & Delivery against cash or bank.
  if (charge > 0 && paidBy !== 'none') {
    try {
      const { postJournalEntry } = await import('./ledger');
      const je = await postJournalEntry(scope, {
        entryDate: new Date(), description: `Return courier for ${d.dispatchNo} on ${receiptNo}${input.courier?.trim() ? ` (${input.courier.trim()}${input.docketNo?.trim() ? ` ${input.docketNo.trim()}` : ''})` : ''}`,
        sourceType: 'rma_receipt', sourceId: receipt.id,
        lines: [{ accountCode: '5100', debitPaise: charge }, { accountCode: paidBy === 'cash' ? '1010' : '1020', creditPaise: charge }],
      }, userId);
      await db.rmaReceipt.update({ where: { id: receipt.id }, data: { journalEntryId: je.id } });
    } catch (e) {
      warnings.push(`The return courier was not posted to accounts: ${(e as Error).message}`);
    }
  }
  return { id: receipt.id, receiptNo, warnings };
}

// ------------------------------------------------------------ nothing came back

export interface CloseAtSupplierInput {
  kind: 'credit_note' | 'written_reply';
  creditNoteNo: string | null;
  creditAmountPaise: number | null;
  /** Their reference for a written reply (email subject, letter number). */
  replyRef: string | null;
  note: string | null;
}

/**
 * The supplier closed it and nothing physical comes back: a credit note
 * (their account is debited, through `moveRmaCase`) or a written reply that
 * they kept or scrapped it. The old unit ends "kept by supplier".
 */
export async function closeAtSupplier(scope: StoreScope, caseId: string, input: CloseAtSupplierInput, userId: string): Promise<{ warning: string | null }> {
  const storeId = scopeForWrite(scope);
  const c = await db.replacementCase.findFirst({ where: { id: caseId, storeId, deletedAt: null }, select: { id: true, status: true, supplierId: true } });
  if (!c) throw new RmaReceiptError('That case is not in this branch.');
  if (c.status !== 'sent') throw new RmaReceiptError('Only an item that is with the supplier can be closed this way.');
  if (input.kind === 'credit_note') {
    if (!(input.creditAmountPaise && input.creditAmountPaise > 0)) throw new RmaReceiptError('Enter the credit note amount.');
    if (!input.creditNoteNo?.trim()) throw new RmaReceiptError('Enter the supplier\'s credit note number.');
    if (!c.supplierId) throw new RmaReceiptError('A credit note needs the supplier on file - set the vendor on the case first.');
  } else if (!input.note?.trim() && !input.replyRef?.trim()) {
    throw new RmaReceiptError('Write what the supplier said, or their reference.');
  }
  const { moveRmaCase } = await import('./rma');
  return moveRmaCase(scope, c.id, {
    to: 'closed', outcome: input.kind === 'credit_note' ? 'credit_note' : 'scrapped', closedOn: input.kind,
    creditNoteNo: input.creditNoteNo, creditAmountPaise: input.creditAmountPaise,
    supplierReplyRef: input.replyRef, note: input.note,
  }, userId);
}

// ------------------------------------------------------------ read

export async function receiptDetail(scope: StoreScope, id: string) {
  const r = await db.rmaReceipt.findFirst({
    where: { id, ...scopeWhere(scope), deletedAt: null },
    include: {
      supplier: PARTY,
      dispatch: { select: { id: true, dispatchNo: true, supplierRmaNo: true, docketNo: true } },
      store: { select: { name: true, address: true, organization: { select: { name: true } } } },
      cases: {
        orderBy: { caseNo: 'asc' },
        select: {
          id: true, caseNo: true, productName: true, brandModel: true, serialNo: true, qty: true, outcome: true, replacementSerialNo: true, courierSharePaise: true,
          customer: PARTY, complaint: { select: { id: true, complaintNo: true } },
        },
      },
    },
  });
  if (!r) return null;
  const by = r.createdBy ? await db.user.findUnique({ where: { id: r.createdBy }, select: { fullName: true } }) : null;
  return {
    ...r, createdByName: by?.fullName ?? null, supplierLabel: partyName(r.supplier) ?? r.supplierName,
    cases: r.cases.map((c) => ({ ...c, customerName: partyName(c.customer) })),
  };
}

/** The receipts a dispatch came back on, newest first. */
export async function receiptsForDispatch(scope: StoreScope, dispatchId: string) {
  return db.rmaReceipt.findMany({
    where: { ...scopeWhere(scope), dispatchId, deletedAt: null },
    orderBy: { receivedAt: 'desc' },
    select: { id: true, receiptNo: true, receivedAt: true, courierChargePaise: true, _count: { select: { cases: true } } },
  });
}
