import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { cleanTrackingUrl, dispatchStatusFor, splitCharge, COURIER_PAID_BY, type CourierPaidBy } from '@/lib/supplier-dispatch';

/**
 * SUPPLIER DISPATCH (10 Oct 2026, SERVICE-REPAIR-FLOW-SPEC stage 4).
 *
 * The office ticks the supplier cases waiting to go - from any complaints -
 * and makes one dispatch: one box, one supplier, one courier and docket, one
 * delivery challan. Every case on it is then "sent" through `moveRmaCase`, the
 * same move the Replacements screen makes, so each unit and each complaint
 * item moves with it. The courier charge is shared across the cases and, when
 * we paid it, posted as Freight & Delivery against cash or bank.
 *
 * The rules (sharing the charge, the box's state, the tracking link) are in
 * lib/supplier-dispatch with tests; this file reads and writes.
 */

export class DispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DispatchError';
  }
}

const partyName = (p: { title?: string | null; firstName: string; lastName?: string | null; companyName?: string | null } | null) =>
  p ? (p.companyName?.trim() || [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim()) : null;
const PARTY = { select: { title: true, firstName: true, lastName: true, companyName: true } } as const;

export interface ReadyCase {
  id: string; caseNo: string; productName: string; serialNo: string | null;
  customerId: string | null; customerName: string | null; complaintId: string | null; complaintNo: string | null;
  supplierId: string | null; supplierName: string | null; createdAt: Date; valuePaise: number | null;
}

/** Cases logged and waiting to go, not yet on any dispatch - grouped by the screen per supplier. */
export async function readyToSend(scope: StoreScope): Promise<ReadyCase[]> {
  const rows = await db.replacementCase.findMany({
    where: { ...scopeWhere(scope), status: 'open', dispatchId: null, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    take: LIST_MAX_ROWS,
    select: {
      id: true, caseNo: true, productName: true, serialNo: true, createdAt: true, supplierId: true, supplierName: true, customerId: true,
      customer: PARTY, supplier: PARTY, complaint: { select: { id: true, complaintNo: true } },
      stockUnit: { select: { unitCostPaise: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, caseNo: r.caseNo, productName: r.productName, serialNo: r.serialNo,
    customerId: r.customerId, customerName: partyName(r.customer), complaintId: r.complaint?.id ?? null, complaintNo: r.complaint?.complaintNo ?? null,
    supplierId: r.supplierId, supplierName: partyName(r.supplier) ?? r.supplierName, createdAt: r.createdAt,
    valuePaise: r.stockUnit?.unitCostPaise ?? null,
  }));
}

export interface DispatchRow {
  id: string; dispatchNo: string; status: string; supplierName: string | null; serviceCentre: string | null;
  courier: string | null; docketNo: string | null; trackingUrl: string | null; courierChargePaise: number;
  sentAt: Date; expectedBackAt: Date | null; cases: number; back: number;
}

/** Dispatches still out, then the ones that came back in the last 30 days. */
export async function listDispatches(scope: StoreScope): Promise<DispatchRow[]> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db.supplierDispatch.findMany({
    where: { ...scopeWhere(scope), deletedAt: null, OR: [{ status: { in: ['sent', 'part_back'] } }, { updatedAt: { gte: since } }] },
    orderBy: { sentAt: 'desc' },
    take: LIST_MAX_ROWS,
    select: {
      id: true, dispatchNo: true, status: true, supplierName: true, serviceCentre: true, courier: true, docketNo: true, trackingUrl: true,
      courierChargePaise: true, sentAt: true, expectedBackAt: true, supplier: PARTY, cases: { select: { status: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, dispatchNo: r.dispatchNo, status: r.status, supplierName: partyName(r.supplier) ?? r.supplierName, serviceCentre: r.serviceCentre,
    courier: r.courier, docketNo: r.docketNo, trackingUrl: r.trackingUrl, courierChargePaise: r.courierChargePaise,
    sentAt: r.sentAt, expectedBackAt: r.expectedBackAt, cases: r.cases.length,
    back: r.cases.filter((c) => !['sent', 'open', 'cancelled'].includes(c.status)).length,
  }));
}

/**
 * Complaint items the supplier is done with, waiting to go to the customer on
 * the complaint's Hand back (stage 6): back with us, or kept by the supplier
 * and to be replaced from stock.
 */
export async function backToHandOver(scope: StoreScope) {
  const rows = await db.replacementCase.findMany({
    where: { ...scopeWhere(scope), complaintItem: { status: { in: ['back', 'supplier_closed'] } }, status: { not: 'cancelled' }, deletedAt: null },
    orderBy: { receivedBackAt: 'asc' },
    take: LIST_MAX_ROWS,
    select: { id: true, caseNo: true, productName: true, serialNo: true, outcome: true, replacementSerialNo: true, receivedBackAt: true, customer: PARTY, complaint: { select: { id: true, complaintNo: true } } },
  });
  return rows.map((r) => ({
    id: r.id, caseNo: r.caseNo, productName: r.productName, serialNo: r.replacementSerialNo ?? r.serialNo, outcome: r.outcome,
    receivedBackAt: r.receivedBackAt, customerName: partyName(r.customer), complaintId: r.complaint?.id ?? null, complaintNo: r.complaint?.complaintNo ?? null,
  }));
}

export async function dispatchDetail(scope: StoreScope, id: string) {
  const d = await db.supplierDispatch.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      supplier: { select: { title: true, firstName: true, lastName: true, companyName: true, phone: true, addressLine1: true, city: true, state: true, gstin: true } },
      store: { select: { name: true, address: true, organization: { select: { name: true } } } },
      receipts: { where: { deletedAt: null }, orderBy: { receivedAt: 'desc' }, select: { id: true, receiptNo: true, receivedAt: true, courierChargePaise: true, _count: { select: { cases: true } } } },
      cases: {
        orderBy: { caseNo: 'asc' },
        select: {
          id: true, caseNo: true, status: true, productName: true, brandModel: true, serialNo: true, qty: true, outcome: true, customerId: true,
          replacementSerialNo: true, courierSharePaise: true, creditNoteNo: true, creditAmountPaise: true,
          supplierId: true, supplierAnswer: true, supplierQuotePaise: true, supplierAnswerNote: true, closedOn: true, supplierReplyRef: true,
          receipt: { select: { id: true, receiptNo: true } },
          customer: PARTY, complaint: { select: { id: true, complaintNo: true } }, stockUnit: { select: { unitCostPaise: true } },
        },
      },
    },
  });
  if (!d) return null;
  const by = d.createdBy ? await db.user.findUnique({ where: { id: d.createdBy }, select: { fullName: true } }) : null;
  return { ...d, createdByName: by?.fullName ?? null, supplierLabel: partyName(d.supplier) ?? d.supplierName };
}

export interface CreateDispatchInput {
  caseIds: string[];
  supplierId: string | null;
  supplierName: string | null;
  serviceCentre: string | null;
  supplierRmaNo: string | null;
  courier: string | null;
  docketNo: string | null;
  trackingUrl: string | null;
  courierChargePaise: number;
  courierPaidBy: string;
  chargeSplit: 'equal' | 'value';
  boxes: number | null;
  weightKg: number | null;
  expectedBackAt: Date | null;
  note: string | null;
}

/**
 * Make the dispatch and send every case on it. The cases go through
 * `moveRmaCase` one by one AFTER the dispatch exists: a case that refuses to
 * move (its unit is somewhere unexpected) is reported, not fatal - the box
 * did leave.
 */
export async function createDispatch(scope: StoreScope, input: CreateDispatchInput, userId: string): Promise<{ id: string; dispatchNo: string; warnings: string[] }> {
  const storeId = scopeForWrite(scope);
  const ids = [...new Set(input.caseIds)];
  if (!ids.length) throw new DispatchError('Tick the cases going in this box.');
  if (!input.supplierId && !input.supplierName?.trim() && !input.serviceCentre?.trim()) throw new DispatchError('Say where the box is going - a supplier or a service centre.');
  if (input.supplierId) {
    const s = await db.party.findFirst({ where: { id: input.supplierId, storeId }, select: { id: true } });
    if (!s) throw new DispatchError('That supplier is not in this branch.');
  }
  const charge = Math.max(0, Math.round(input.courierChargePaise || 0));
  const paidBy: CourierPaidBy = (COURIER_PAID_BY as readonly string[]).includes(input.courierPaidBy) ? input.courierPaidBy as CourierPaidBy : 'none';
  const tracking = cleanTrackingUrl(input.trackingUrl);
  if (input.trackingUrl?.trim() && !tracking) throw new DispatchError('The tracking link must be a web address starting with https://');

  const cases = await db.replacementCase.findMany({
    where: { id: { in: ids }, storeId, deletedAt: null },
    select: { id: true, caseNo: true, status: true, dispatchId: true, stockUnit: { select: { unitCostPaise: true } } },
  });
  if (cases.length !== ids.length) throw new DispatchError('A case is not in this branch.');
  const bad = cases.find((c) => c.status !== 'open' || c.dispatchId);
  if (bad) throw new DispatchError(`${bad.caseNo} has already gone - only cases still waiting can go in a box.`);

  const ordered = ids.map((id) => cases.find((c) => c.id === id)!);
  const shares = splitCharge(charge, ordered.map((c) => c.stockUnit?.unitCostPaise ?? null), input.chargeSplit === 'value' ? 'value' : 'equal');
  const dispatchNo = await allocateDocumentNumber(storeId, 'DSP');

  const d = await db.$transaction(async (tx) => {
    const created = await tx.supplierDispatch.create({
      data: {
        storeId, dispatchNo, supplierId: input.supplierId || null, supplierName: input.supplierName?.trim() || null,
        serviceCentre: input.serviceCentre?.trim() || null, supplierRmaNo: input.supplierRmaNo?.trim() || null,
        courier: input.courier?.trim() || null, docketNo: input.docketNo?.trim() || null, trackingUrl: tracking,
        courierChargePaise: charge, courierPaidBy: paidBy, chargeSplit: input.chargeSplit === 'value' ? 'value' : 'equal',
        boxes: input.boxes && input.boxes > 0 ? Math.round(input.boxes) : null,
        weightKg: input.weightKg && input.weightKg > 0 ? input.weightKg : null,
        expectedBackAt: input.expectedBackAt, note: input.note?.trim() || null, createdBy: userId,
      },
      select: { id: true },
    });
    for (const [i, c] of ordered.entries()) {
      await tx.replacementCase.update({ where: { id: c.id }, data: { dispatchId: created.id, courierSharePaise: shares[i] } });
    }
    return created;
  });

  const warnings: string[] = [];
  const { moveRmaCase } = await import('./rma');
  for (const c of ordered) {
    try {
      const r = await moveRmaCase(scope, c.id, {
        to: 'sent', supplierId: input.supplierId || null, supplierName: input.supplierName?.trim() || null,
        serviceCentre: input.serviceCentre?.trim() || null, courier: input.courier?.trim() || null,
        docketNo: input.docketNo?.trim() || null, expectedBackAt: input.expectedBackAt,
        note: `Sent on ${dispatchNo}${input.supplierRmaNo?.trim() ? `, supplier RMA ${input.supplierRmaNo.trim()}` : ''}.`,
      }, userId);
      if (r.warning) warnings.push(`${c.caseNo}: ${r.warning}`);
    } catch (e) {
      warnings.push(`${c.caseNo}: not sent - ${(e as Error).message}`);
    }
  }

  // The courier, when we paid it: Freight & Delivery against cash or bank.
  if (charge > 0 && paidBy !== 'none') {
    try {
      const { postJournalEntry } = await import('./ledger');
      const je = await postJournalEntry(scope, {
        entryDate: new Date(), description: `Courier for supplier dispatch ${dispatchNo}${input.courier?.trim() ? ` (${input.courier.trim()}${input.docketNo?.trim() ? ` ${input.docketNo.trim()}` : ''})` : ''}`,
        sourceType: 'supplier_dispatch', sourceId: d.id,
        lines: [{ accountCode: '5100', debitPaise: charge }, { accountCode: paidBy === 'cash' ? '1010' : '1020', creditPaise: charge }],
      }, userId);
      await db.supplierDispatch.update({ where: { id: d.id }, data: { journalEntryId: je.id } });
    } catch (e) {
      warnings.push(`The courier charge was not posted to accounts: ${(e as Error).message}`);
    }
  }
  await syncDispatchStatus(d.id);
  return { id: d.id, dispatchNo, warnings };
}

/** Keep the box's state in step with its cases - called whenever one of them moves. */
export async function syncDispatchStatus(dispatchId: string): Promise<void> {
  const d = await db.supplierDispatch.findUnique({ where: { id: dispatchId }, select: { status: true, cases: { select: { status: true } } } });
  if (!d) return;
  const next = dispatchStatusFor(d.cases.map((c) => c.status));
  if (next !== d.status) await db.supplierDispatch.update({ where: { id: dispatchId }, data: { status: next } });
}
