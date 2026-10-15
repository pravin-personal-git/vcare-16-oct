import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, userInScope, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { moveUnit } from './stock-units';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { planRmaMove, rmaLateness, unitStatusFor, RMA_STATUS_LABEL, type RmaStatus } from '@/lib/rma';

/**
 * The replacement (RMA) tracker (Phase 6).
 *
 * The rules - what may follow what, what a move needs, when a case is late,
 * which unit status a move implies - are in lib/rma with tests. This file
 * reads and writes rows.
 *
 * AN ATTACHED UNIT MOVES WITH THE CASE, through `moveUnit` - the same function
 * the unit screen uses, so the unit's own transition table, its stock effect
 * and its history all apply. If the unit cannot make that move (sent to a
 * service centre that is not a supplier on file, so there is no party to hold
 * it), the case still moves and says so in its history: the case is the
 * record of where the item is, and refusing it would leave the chase
 * unrecorded.
 */

export class RmaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RmaError';
  }
}

const partyName = (p: { title?: string | null; firstName: string; lastName?: string | null; companyName?: string | null } | null) =>
  p ? (p.companyName?.trim() || [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim()) : null;
const PARTY = { select: { title: true, firstName: true, lastName: true, companyName: true } } as const;

export interface RmaRow {
  id: string;
  caseNo: string;
  legacyRef: string | null;
  status: string;
  productName: string;
  brandModel: string | null;
  qty: number;
  serialNo: string | null;
  stockUnitId: string | null;
  customerId: string | null;
  customerName: string | null;
  complaintNo: string | null;
  /** The supplier on file it went to, so "Sent to" opens them (G-37). */
  supplierId: string | null;
  goingTo: string | null;
  /**
   * True when the vendor is a party ON FILE rather than typed-in text
   * (7 Oct 2026). Vcare had 37 cases naming a vendor as free text and none
   * pointing at a supplier record, so there was nothing to ring, invoice or
   * chase. The screen marks the difference.
   */
  vendorOnFile: boolean;
  courier: string | null;
  docketNo: string | null;
  sentAt: Date | null;
  expectedBackAt: Date | null;
  receivedBackAt: Date | null;
  returnedToCustomerAt: Date | null;
  outcome: string | null;
  overdue: boolean;
  daysLate: number;
  parentCaseNo: string | null;
  createdAt: Date;
}

const ROW = {
  id: true, caseNo: true, legacyRef: true, status: true, productName: true, brandModel: true, qty: true,
  serialNo: true, stockUnitId: true, customerId: true, supplierId: true, supplierName: true, serviceCentre: true, courier: true,
  docketNo: true, sentAt: true, expectedBackAt: true, receivedBackAt: true, returnedToCustomerAt: true,
  outcome: true, createdAt: true,
  customer: PARTY, supplier: PARTY,
  complaint: { select: { id: true, complaintNo: true } },
  parentCase: { select: { caseNo: true } },
} as const;

type RowIn = Awaited<ReturnType<typeof db.replacementCase.findMany<{ select: typeof ROW }>>>[number];

function toRow(r: RowIn, now = new Date()): RmaRow {
  const late = rmaLateness(r, now);
  return {
    id: r.id, caseNo: r.caseNo, legacyRef: r.legacyRef, status: r.status, productName: r.productName,
    brandModel: r.brandModel, qty: r.qty, serialNo: r.serialNo, stockUnitId: r.stockUnitId,
    customerId: r.customerId, customerName: partyName(r.customer),
    complaintNo: r.complaint?.complaintNo ?? null,
    supplierId: r.supplierId,
    goingTo: [partyName(r.supplier) ?? r.supplierName, r.serviceCentre].filter(Boolean).join(' / ') || null,
    vendorOnFile: !!r.supplier,
    courier: r.courier, docketNo: r.docketNo, sentAt: r.sentAt, expectedBackAt: r.expectedBackAt,
    receivedBackAt: r.receivedBackAt, returnedToCustomerAt: r.returnedToCustomerAt, outcome: r.outcome,
    overdue: late.overdue, daysLate: late.daysLate, parentCaseNo: r.parentCase?.caseNo ?? null,
    createdAt: r.createdAt,
  };
}

export async function listRmaCases(scope: StoreScope): Promise<RmaRow[]> {
  const rows = await db.replacementCase.findMany({
    where: scopeWhere(scope), select: ROW, orderBy: { createdAt: 'desc' }, take: LIST_MAX_ROWS,
  });
  const now = new Date();
  return rows.map((r) => toRow(r, now));
}

export interface RmaDetail extends RmaRow {
  /** Its complaint, so the case links to it (G-27). */
  complaintId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  serviceCentre: string | null;
  replacementSerialNo: string | null;
  /** Where it was bought (serial = exact; else the product's last supplier). */
  origin: RmaOrigin | null;
  /** An old unit from a job's replacement - back from the supplier it goes into stock. */
  fromJob: boolean;
  creditNoteNo: string | null;
  creditAmountPaise: number | null;
  stockBookedAt: Date | null;
  childCases: { id: string; caseNo: string; status: string }[];
  events: { id: string; kind: string; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: Date; byName: string | null }[];
}

export async function getRmaCase(scope: StoreScope, id: string): Promise<RmaDetail> {
  const c = await db.replacementCase.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      ...ROW, storeId: true, supplierId: true, replacementSerialNo: true, productId: true, creditNoteNo: true, creditAmountPaise: true, stockBookedAt: true,
      jobOldUnits: { select: { id: true }, take: 1 },
      childCases: { select: { id: true, caseNo: true, status: true } },
      events: { orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, fromStatus: true, toStatus: true, note: true, createdAt: true, createdBy: true } },
    },
  });
  if (!c) throw new RmaError('That replacement case is not in your scope.');
  const users = await db.user.findMany({
    where: { ...userInScope(scope), id: { in: c.events.map((e) => e.createdBy).filter((x): x is string => !!x) } },
    select: { id: true, fullName: true },
  });
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  return {
    ...toRow(c),
    supplierId: c.supplierId, supplierName: c.supplierName, serviceCentre: c.serviceCentre,
    replacementSerialNo: c.replacementSerialNo, childCases: c.childCases,
    origin: await purchaseOrigin(c.storeId, c.stockUnitId, c.productId),
    fromJob: c.jobOldUnits.length > 0, creditNoteNo: c.creditNoteNo, creditAmountPaise: c.creditAmountPaise, stockBookedAt: c.stockBookedAt,
    complaintId: c.complaint?.id ?? null,
    events: c.events.map((e) => ({ ...e, byName: e.createdBy ? name.get(e.createdBy) ?? null : null })),
  };
}

export interface CreateRmaInput {
  productId: string | null;
  productName: string;
  brandModel: string | null;
  qty: number;
  serialNo: string | null;
  customerId: string | null;
  complaintNo: string | null;
  parentCaseId: string | null;
  note: string | null;
  /**
   * Opened from a complaint item at pickup (10 Oct 2026, stage 3): the case is
   * that item's supplier half, and its unit is the customer's own - attached
   * by id, not looked up by serial text.
   */
  complaintItemId?: string | null;
  stockUnitId?: string | null;
}

/**
 * Log a faulty item. It starts `open` - here, not yet sent - because the
 * sending is its own act with its own courier and docket.
 *
 * A serial that matches a unit on file attaches that unit, so the unit's
 * history shows the case and its status follows it.
 */
export async function createRmaCase(scope: StoreScope, input: CreateRmaInput, userId: string): Promise<{ id: string; caseNo: string }> {
  const storeId = scopeForWrite(scope);
  if (!input.productName.trim()) throw new RmaError('Say what item it is.');
  if (!Number.isInteger(input.qty) || input.qty < 1) throw new RmaError('The quantity must be at least 1.');

  if (input.productId) {
    const p = await db.product.findFirst({ where: { id: input.productId, storeId }, select: { id: true } });
    if (!p) throw new RmaError('That product is not in your scope.');
  }
  if (input.customerId) {
    const p = await db.party.findFirst({ where: { id: input.customerId, storeId }, select: { id: true } });
    if (!p) throw new RmaError('That customer is not in your scope.');
  }
  let complaintId: string | null = null;
  const complaintNo = input.complaintNo?.trim();
  if (complaintNo) {
    const c = await db.complaint.findFirst({
      where: { storeId, OR: [{ complaintNo: { equals: complaintNo, mode: 'insensitive' } }, { legacyRef: { equals: complaintNo, mode: 'insensitive' } }] },
      select: { id: true, customerId: true },
    });
    if (!c) throw new RmaError(`No complaint ${complaintNo} in this store.`);
    complaintId = c.id;
    input.customerId ??= c.customerId;
  }
  if (input.parentCaseId) {
    const parent = await db.replacementCase.findFirst({ where: { id: input.parentCaseId, storeId }, select: { id: true } });
    if (!parent) throw new RmaError('The earlier case is not in your scope.');
  }

  const serial = input.serialNo?.trim() || null;
  const unit = input.stockUnitId
    ? await db.stockUnit.findFirst({ where: { id: input.stockUnitId, storeId }, select: { id: true, productId: true } })
    : serial
    ? await db.stockUnit.findFirst({
      where: { storeId, serialNo: { equals: serial, mode: 'insensitive' }, ...(input.productId ? { productId: input.productId } : {}) },
      select: { id: true, productId: true },
    })
    : null;

  // Where it was bought: the unit's own purchase fills the supplier; without a
  // serial the product's last supplier is only suggested in the note.
  const origin = await purchaseOrigin(storeId, unit?.id ?? null, input.productId ?? unit?.productId ?? null);

  const caseNo = await allocateDocumentNumber(storeId, 'RMA');
  const created = await db.replacementCase.create({
    data: {
      storeId, caseNo, status: 'open',
      ...(origin?.exact ? { supplierId: origin.supplierId, supplierName: origin.supplierName } : {}),
      productId: input.productId ?? unit?.productId ?? null,
      productName: input.productName.trim(), brandModel: input.brandModel?.trim() || null,
      qty: input.qty, serialNo: serial, stockUnitId: unit?.id ?? null,
      customerId: input.customerId ?? null, complaintId, parentCaseId: input.parentCaseId ?? null,
      complaintItemId: input.complaintItemId ?? null,
      createdBy: userId,
      events: {
        create: {
          storeId, kind: 'status', toStatus: 'open', createdBy: userId,
          note: [input.note?.trim(), unit ? `Unit ${serial} attached.` : serial ? `No unit on file with serial ${serial}.` : null, origin ? originLine(origin) : null]
            .filter(Boolean).join(' ') || null,
        },
      },
    },
    select: { id: true, caseNo: true },
  });
  return created;
}

export interface MoveRmaInput {
  to: string;
  supplierId?: string | null;
  supplierName?: string | null;
  serviceCentre?: string | null;
  courier?: string | null;
  docketNo?: string | null;
  expectedBackAt?: Date | null;
  outcome?: string | null;
  replacementSerialNo?: string | null;
  note?: string | null;
  /** Outcome credit_note: the supplier's credit note number and amount (28 Sep 2026). */
  creditNoteNo?: string | null;
  creditAmountPaise?: number | null;
  /** Stage 5: the RMA receipt it came back on. */
  receiptId?: string | null;
  /** Stage 5: the new unit the supplier sent for the customer's. */
  replacementUnitId?: string | null;
  /** Stage 5, closed with nothing back: credit_note | written_reply, and the reply's reference. */
  closedOn?: 'credit_note' | 'written_reply' | null;
  supplierReplyRef?: string | null;
}

export async function moveRmaCase(scope: StoreScope, id: string, input: MoveRmaInput, userId: string): Promise<{ warning: string | null }> {
  const storeId = scopeForWrite(scope);
  const c = await db.replacementCase.findFirst({
    where: { id, storeId },
    select: {
      id: true, caseNo: true, status: true, supplierId: true, supplierName: true, serviceCentre: true, customerId: true, stockUnitId: true,
      productId: true, productName: true, qty: true, stockBookedAt: true, complaintId: true, complaintItemId: true, dispatchId: true, outcome: true,
      product: { select: { trackingMode: true } }, jobOldUnits: { select: { id: true }, take: 1 },
    },
  });
  if (!c) throw new RmaError('That replacement case is not in your scope.');
  const fromJob = c.jobOldUnits.length > 0;
  if (input.to === 'closed' && c.status === 'open' && !input.note?.trim()) throw new RmaError('Say why it is scrapped - e.g. burnt, not repairable.');
  // Closed at the supplier (stage 5): a written reply has to say something.
  if (input.to === 'closed' && c.status === 'sent' && input.outcome === 'scrapped' && !(input.note?.trim() || input.supplierReplyRef?.trim())) {
    throw new RmaError('Write what the supplier said, or their reference.');
  }
  // A credit note the books will carry: on a job's old unit, or on a customer's item (stage 5).
  const creditPosts = input.outcome === 'credit_note' && (fromJob || !!c.complaintItemId)
    && (input.to === 'received_back' || (input.to === 'closed' && c.status === 'sent'));
  if (creditPosts) {
    if (!(input.creditAmountPaise && input.creditAmountPaise > 0)) throw new RmaError('Enter the credit note amount.');
    if (!(input.supplierId ?? c.supplierId)) throw new RmaError('Choose the supplier on file who gave the credit note.');
  }
  if (input.to === 'received_back' && input.outcome === 'replaced' && fromJob && c.product?.trackingMode === 'serial' && !input.replacementSerialNo?.trim()) {
    throw new RmaError('Enter the new unit\'s serial number - it goes into stock.');
  }

  const supplierId = input.supplierId ?? c.supplierId;
  if (input.supplierId) {
    const s = await db.party.findFirst({ where: { id: input.supplierId, storeId }, select: { id: true } });
    if (!s) throw new RmaError('That supplier is not in your scope.');
  }
  const plan = planRmaMove({
    from: c.status, to: input.to, supplierId,
    supplierName: input.supplierName ?? c.supplierName,
    serviceCentre: input.serviceCentre ?? c.serviceCentre,
    outcome: input.outcome,
  });
  if (!plan.ok) throw new RmaError(plan.reason);

  // The attached unit, moved first through the unit screen's own rules.
  let warning: string | null = null;
  // A complaint item's unit is the customer's own (stage 3): it never lands in our stock.
  const customerOwned = !!c.complaintItemId;
  // A later move (handed back) carries no outcome of its own - the one recorded when it came back still decides.
  const target = c.stockUnitId ? unitStatusFor(input.to, input.outcome ?? c.outcome, { customerOwned, from: c.status }) : null;
  if (c.stockUnitId && target) {
    const unit = await db.stockUnit.findFirst({ where: { id: c.stockUnitId, storeId }, select: { status: true } });
    if (unit && unit.status !== target) {
      try {
        await moveUnit(scope, c.stockUnitId, {
          to: target,
          partyId: target === 'with_supplier' || target === 'supplier_kept' ? supplierId : target === 'with_customer' || target === 'in_repair' ? c.customerId : null,
          condition: input.outcome === 'refurbished_to_stock' || input.outcome === 'repaired' ? 'refurbished' : null,
          note: `Replacement case ${c.caseNo}`,
        }, userId);
      } catch (err) {
        warning = `The case moved, but its unit did not: ${(err as Error).message}`;
      }
    }
  }

  const now = new Date();
  await db.$transaction([
    db.replacementCase.update({
      where: { id: c.id },
      data: {
        status: input.to,
        ...(input.to === 'sent' ? {
          sentAt: now,
          supplierId: supplierId ?? null,
          supplierName: input.supplierName?.trim() || c.supplierName,
          serviceCentre: input.serviceCentre?.trim() || c.serviceCentre,
          courier: input.courier?.trim() || null,
          docketNo: input.docketNo?.trim() || null,
          expectedBackAt: input.expectedBackAt ?? null,
        } : {}),
        ...(input.to === 'received_back' ? {
          receivedBackAt: now, outcome: input.outcome, replacementSerialNo: input.replacementSerialNo?.trim() || null,
          receiptId: input.receiptId ?? null, replacementUnitId: input.replacementUnitId ?? null,
        } : {}),
        ...(input.outcome === 'credit_note' && (input.to === 'received_back' || input.to === 'closed') ? {
          creditNoteNo: input.creditNoteNo?.trim() || null, creditAmountPaise: input.creditAmountPaise ?? null,
          ...(input.supplierId ? { supplierId: input.supplierId } : {}),
        } : {}),
        ...(input.to === 'closed' && input.outcome ? { outcome: input.outcome } : {}),
        ...(input.to === 'closed' && c.status === 'sent' ? {
          closedOn: input.closedOn ?? (input.outcome === 'credit_note' ? 'credit_note' : 'written_reply'),
          supplierReplyRef: input.supplierReplyRef?.trim() || null,
        } : {}),
        ...(input.to === 'returned_to_customer' ? { returnedToCustomerAt: now } : {}),
      },
    }),
    db.replacementEvent.create({
      data: {
        storeId, caseId: c.id, kind: 'status', fromStatus: c.status, toStatus: input.to, createdBy: userId,
        note: [
          input.to === 'sent' && input.docketNo?.trim() ? `Docket ${input.docketNo.trim()}${input.courier?.trim() ? ` via ${input.courier.trim()}` : ''}.` : null,
          input.to === 'received_back' && input.replacementSerialNo?.trim() ? `Replacement serial ${input.replacementSerialNo.trim()}.` : null,
          input.to === 'closed' && input.outcome === 'scrapped' ? 'Scrapped.' : null,
          input.outcome === 'credit_note' && input.creditAmountPaise
            ? `Credit note ${input.creditNoteNo?.trim() || ''} for ₹${(input.creditAmountPaise / 100).toLocaleString('en-IN')}.` : null,
          input.to === 'closed' && c.status === 'sent' && input.outcome === 'scrapped'
            ? `Supplier's written reply${input.supplierReplyRef?.trim() ? ` ${input.supplierReplyRef.trim()}` : ''}: kept / scrapped by them.` : null,
          input.note?.trim() || null, warning,
        ].filter(Boolean).join(' ') || null,
      },
    }),
  ]);
  // Its box (stage 4): partly back, all back.
  if (c.dispatchId) {
    const { syncDispatchStatus } = await import('./supplier-dispatch');
    await syncDispatchStatus(c.dispatchId).catch(() => null);
  }
  // The complaint item follows its supplier case (stage 3): at the supplier,
  // back with us, handed back. A cancelled case puts it back to "picked up".
  if (c.complaintItemId) {
    // Closed at the supplier (stage 5): nothing physical came back, and what the
    // customer gets instead is the hand-over step's to decide.
    const itemStatus = input.to === 'closed' && c.status === 'sent'
      ? 'supplier_closed'
      : ({ sent: 'with_supplier', received_back: 'back', returned_to_customer: 'handed_back', cancelled: 'picked_up' } as Record<string, string>)[input.to];
    if (itemStatus) await db.complaintItem.update({ where: { id: c.complaintItemId }, data: { status: itemStatus } }).catch(() => null);
  }
  // A job's old unit coming back (28 Sep 2026): the customer already has a new
  // one from our stock, so what the supplier returns is OURS again.
  // A customer's item credited by the supplier (stage 5) posts the same credit;
  // nothing of theirs ever goes into our stock.
  if ((fromJob && input.to === 'received_back') || creditPosts) {
    const w = await bookJobUnitBack(scope, c, input, userId).catch((e: Error) => `Recorded, but the stock/accounts step failed: ${e.message}`);
    if (w) warning = [warning, w].filter(Boolean).join(' ');
  }
  return { warning };
}

type JobCase = {
  id: string; caseNo: string; productId: string | null; productName: string; qty: number; stockUnitId: string | null;
  stockBookedAt: Date | null; complaintId: string | null; supplierId: string | null; product: { trackingMode: string } | null;
};

/**
 * Replaced / repaired / refurbished: the unit goes into stock and the cost we
 * booked when the replacement was issued is recovered (Dr stock, Cr the job's
 * cost account). Credit note: the supplier's account is debited and the cost
 * reduced by that amount. Booked once per case (stockBookedAt).
 */
async function bookJobUnitBack(scope: StoreScope, c: JobCase, input: MoveRmaInput, userId: string): Promise<string | null> {
  const storeId = scopeForWrite(scope);
  if (c.stockBookedAt) return null;
  const outcome = input.outcome ?? '';
  const { postJournalEntry } = await import('./ledger');
  const { repairCostAccount } = await import('@/lib/service-revenue');
  const { resolveCoverageFor } = await import('./amc');
  const job = c.complaintId ? await db.complaint.findFirst({ where: { id: c.complaintId, storeId }, select: { customerId: true, productId: true } }) : null;
  const cover = job ? await resolveCoverageFor(scope, { customerId: job.customerId, productId: job.productId, onDate: new Date() }) : null;
  const costAccount = repairCostAccount(cover?.kind ?? 'warranty');

  if (outcome === 'credit_note') {
    const amount = input.creditAmountPaise ?? 0;
    const supplierId = input.supplierId ?? c.supplierId;
    if (amount <= 0 || !supplierId) return 'Credit note recorded without an amount or supplier - nothing posted to accounts.';
    await postJournalEntry(scope, {
      entryDate: new Date(), description: `Supplier credit note ${input.creditNoteNo?.trim() || ''} for ${c.productName} (${c.caseNo})`,
      sourceType: 'rma_credit', sourceId: c.id,
      lines: [{ accountCode: '2100', debitPaise: amount, partyId: supplierId }, { accountCode: costAccount, creditPaise: amount }],
    }, userId);
    await db.replacementCase.update({ where: { id: c.id }, data: { stockBookedAt: new Date() } });
    return null;
  }
  if (!['replaced', 'repaired', 'refurbished_to_stock'].includes(outcome) || !c.productId) return null;

  const serial = c.product?.trackingMode === 'serial';
  const origin = await purchaseOrigin(storeId, c.stockUnitId, c.productId);
  const { costsFor } = await import('./product-cost');
  const unitCost = origin?.unitCostPaise ?? (await costsFor(scope, [c.productId])).get(c.productId)?.unitCostPaise ?? 0;
  let booked = 0;
  await db.$transaction(async (tx) => {
    const { applyMovements } = await import('./stock');
    if (serial && outcome === 'replaced') {
      // The supplier's new unit, by its serial.
      const u = await tx.stockUnit.create({
        data: {
          storeId, productId: c.productId!, serialNo: input.replacementSerialNo!.trim(), status: 'in_stock', condition: 'new',
          unitCostPaise: unitCost, receivedAt: new Date(), createdBy: userId, note: `Supplier replacement on ${c.caseNo}`,
        },
      });
      await applyMovements(tx, storeId, userId, [{ productId: c.productId!, qty: 1, reason: 'rma_return', refType: 'ReplacementCase', refId: c.id, refNo: c.caseNo, stockUnitId: u.id }]);
      booked = 1;
    } else if (!serial) {
      await applyMovements(tx, storeId, userId, [{ productId: c.productId!, qty: c.qty, reason: 'rma_return', refType: 'ReplacementCase', refId: c.id, refNo: c.caseNo, note: `Back from the supplier (${outcome})` }]);
      booked = c.qty;
    } else {
      // A serial unit repaired: moveUnit (above) already put it back on the shelf.
      booked = c.stockUnitId ? 1 : 0;
    }
    await tx.replacementCase.update({ where: { id: c.id }, data: { stockBookedAt: new Date() } });
  });
  if (booked > 0 && unitCost > 0) {
    await postJournalEntry(scope, {
      entryDate: new Date(), description: `${c.productName} back in stock from ${c.caseNo} (${outcome}) - cost recovered`,
      sourceType: 'rma_recovery', sourceId: c.id,
      lines: [{ accountCode: '1200', debitPaise: unitCost * booked }, { accountCode: costAccount, creditPaise: unitCost * booked }],
    }, userId);
  }
  return serial && outcome !== 'replaced' && !c.stockUnitId ? 'No serial unit was attached, so nothing was added to stock - receive it on the unit screen.' : null;
}

export async function addRmaNote(scope: StoreScope, id: string, note: string, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!note.trim()) throw new RmaError('Write something first.');
  const c = await db.replacementCase.findFirst({ where: { id, storeId }, select: { id: true } });
  if (!c) throw new RmaError('That replacement case is not in your scope.');
  await db.replacementEvent.create({ data: { storeId, caseId: c.id, kind: 'note', note: note.trim(), createdBy: userId } });
}

export interface EditRmaInput {
  productName: string;
  brandModel: string | null;
  qty: number;
  serialNo: string | null;
  customerId: string | null;
  /**
   * THE VENDOR AS A RECORD, NOT AS TEXT (7 Oct 2026).
   *
   * This field was missing, and that was the hole behind Pravin's "vendor data
   * must be properly fixed". A case could be SENT with a supplier on file -
   * `moveRmaCase` has always taken one - but once sent, the only vendor field
   * anybody could edit was the free-text name. So a case that went out with a
   * typed name, or with no vendor at all, could never be corrected into
   * pointing at the real supplier. Vcare has 46 items at a vendor and 40 of
   * them name nobody; without this they would stay that way for ever.
   */
  supplierId: string | null;
  supplierName: string | null;
  serviceCentre: string | null;
  courier: string | null;
  docketNo: string | null;
  expectedBackAt: Date | null;
  replacementSerialNo: string | null;
}

const EDIT_LABEL: Record<keyof EditRmaInput, string> = {
  productName: 'Item', brandModel: 'Brand / model', qty: 'Quantity', serialNo: 'Serial', customerId: 'Customer',
  supplierId: 'Vendor on file', supplierName: 'Vendor (typed in)', serviceCentre: 'Service centre',
  courier: 'Courier', docketNo: 'Docket', expectedBackAt: 'Expected back', replacementSerialNo: 'New serial',
};

/**
 * Correct a case's details (health check SVC-3, decision 2 of 25 Sep 2026:
 * work records stay editable, with history). The status is not edited here -
 * that only moves through `moveRmaCase`, so the unit follows it. What changed
 * is written into the case's own history as one line, and the audit trail
 * keeps the full before/after.
 */
export async function updateRmaCase(scope: StoreScope, id: string, input: EditRmaInput, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const c = await db.replacementCase.findFirst({
    where: { id, storeId },
    select: {
      id: true, productName: true, brandModel: true, qty: true, serialNo: true, customerId: true,
      supplierId: true, supplierName: true,
      serviceCentre: true, courier: true, docketNo: true, expectedBackAt: true, replacementSerialNo: true, stockUnitId: true, productId: true,
    },
  });
  if (!c) throw new RmaError('That replacement case is not in your scope.');
  if (!input.productName.trim()) throw new RmaError('Say what item it is.');
  if (!Number.isInteger(input.qty) || input.qty < 1) throw new RmaError('The quantity must be at least 1.');
  if (input.customerId && input.customerId !== c.customerId) {
    const p = await db.party.findFirst({ where: { id: input.customerId, storeId }, select: { id: true } });
    if (!p) throw new RmaError('That customer is not in your scope.');
  }
  if (input.supplierId && input.supplierId !== c.supplierId) {
    const p = await db.party.findFirst({ where: { id: input.supplierId, storeId }, select: { id: true } });
    if (!p) throw new RmaError('That vendor is not in your scope.');
  }
  const t = (v: string | null) => v?.trim() || null;
  const next = {
    productName: input.productName.trim(), brandModel: t(input.brandModel), qty: input.qty, serialNo: t(input.serialNo),
    customerId: input.customerId || null,
    supplierId: input.supplierId || null,
    /*
      Picking a vendor on file CLEARS the typed-in name. Keeping both would
      leave the screen with two answers to "who has it" - the panel reads the
      party first, so the stale text would sit there contradicting it until
      somebody noticed. The old value is in the edit note and in the audit
      trail either way.
    */
    supplierName: input.supplierId ? null : t(input.supplierName),
    serviceCentre: t(input.serviceCentre),
    courier: t(input.courier), docketNo: t(input.docketNo), expectedBackAt: input.expectedBackAt,
    replacementSerialNo: t(input.replacementSerialNo),
  };
  const show = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null || v === '' ? 'blank' : String(v));
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => show(next[k]) !== show(c[k]));
  if (changed.length === 0) return;

  // A new serial re-attaches the unit on file, if there is one.
  let stockUnitId = c.stockUnitId;
  if (changed.includes('serialNo')) {
    const unit = next.serialNo
      ? await db.stockUnit.findFirst({
        where: { storeId, serialNo: { equals: next.serialNo, mode: 'insensitive' }, ...(c.productId ? { productId: c.productId } : {}) },
        select: { id: true },
      })
      : null;
    stockUnitId = unit?.id ?? null;
  }
  const note = 'Edited: ' + changed
    .map((k) => (k === 'customerId' ? EDIT_LABEL[k] : `${EDIT_LABEL[k]} ${show(c[k])} → ${show(next[k])}`))
    .join('; ');
  await db.$transaction([
    db.replacementCase.update({ where: { id: c.id }, data: { ...next, stockUnitId } }),
    db.replacementEvent.create({ data: { storeId, caseId: c.id, kind: 'note', note: note.slice(0, 1000), createdBy: userId } }),
  ]);
}

/** Counts for the KPI strip - over every case in scope, not the loaded page. */
/**
 * The items that are at a vendor right now - every one of them, whatever the
 * screen's date filter says (7 Oct 2026).
 *
 * Deliberately NOT filtered by the list's range. The oldest of these went out
 * in July 2025; a screen that defaults to today would hide exactly the cases
 * worth looking at, which is how 44 of them got to be a month or more overdue
 * without anybody noticing.
 */
export function stuckAtVendor(rows: RmaRow[], now = new Date()) {
  const days = (d: Date | null) => (d ? Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000)) : 0);
  return rows
    .filter((r) => r.status === 'sent')
    .map((r) => ({
      id: r.id, caseNo: r.caseNo, productName: r.productName, qty: r.qty,
      customerId: r.customerId, customerName: r.customerName, goingTo: r.goingTo, vendorOnFile: r.vendorOnFile,
      docketNo: r.docketNo, daysOut: days(r.sentAt), daysLate: r.daysLate,
    }));
}

export function summariseRma(rows: RmaRow[]): Record<string, number> {
  const out: Record<string, number> = { overdue: 0 };
  for (const r of rows) {
    out[r.status] = (out[r.status] ?? 0) + 1;
    if (r.overdue) out.overdue += 1;
  }
  return out;
}

export { RMA_STATUS_LABEL, type RmaStatus };

// ------------------------------------------------ original supplier (28 Sep 2026)

export interface RmaOrigin {
  /** True: this exact unit's purchase (by serial). False: the product's last purchase - a suggestion. */
  exact: boolean;
  supplierId: string;
  supplierName: string;
  supplierBillNo: string | null;
  grnNo: string;
  receivedDate: Date;
  unitCostPaise: number;
  /** The SUPPLIER's warranty to us, from the receipt line. */
  warrantyMonths: number | null;
  warrantyUntil: Date | null;
  underWarranty: boolean | null;
}

/**
 * Where an item was bought: by its serial (the unit's own receipt line - the
 * supplier, their bill number, the date and their warranty to us), or, with
 * no serial, the product's most recent receipt as a suggestion.
 */
export async function purchaseOrigin(storeId: string, stockUnitId: string | null, productId: string | null, now = new Date()): Promise<RmaOrigin | null> {
  const GRN = { select: { partyId: true, supplierName: true, supplierInvoiceNo: true, grnNo: true, receivedDate: true } } as const;
  let exact = false;
  let item: { unitCostPaise: number; warrantyMonths: number | null; grn: { partyId: string; supplierName: string; supplierInvoiceNo: string | null; grnNo: string; receivedDate: Date } } | null = null;
  if (stockUnitId) {
    const u = await db.stockUnit.findFirst({ where: { id: stockUnitId, storeId }, select: { grnItem: { select: { unitCostPaise: true, warrantyMonths: true, grn: GRN } } } });
    if (u?.grnItem) { item = u.grnItem; exact = true; }
  }
  if (!item && productId) {
    item = await db.goodsReceiptNoteItem.findFirst({
      where: { storeId, productId, grn: { status: 'posted' } },
      orderBy: { grn: { receivedDate: 'desc' } },
      select: { unitCostPaise: true, warrantyMonths: true, grn: GRN },
    });
  }
  if (!item) return null;
  const until = item.warrantyMonths ? new Date(item.grn.receivedDate.getTime()) : null;
  if (until && item.warrantyMonths) until.setMonth(until.getMonth() + item.warrantyMonths);
  return {
    exact, supplierId: item.grn.partyId, supplierName: item.grn.supplierName, supplierBillNo: item.grn.supplierInvoiceNo,
    grnNo: item.grn.grnNo, receivedDate: item.grn.receivedDate, unitCostPaise: item.unitCostPaise,
    warrantyMonths: item.warrantyMonths, warrantyUntil: until, underWarranty: until ? until.getTime() >= now.getTime() : null,
  };
}

export const originLine = (o: RmaOrigin) => {
  const d = (x: Date) => x.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
  return `${o.exact ? 'Bought from' : 'Last bought from'} ${o.supplierName}${o.supplierBillNo ? `, bill ${o.supplierBillNo}` : ''} (${o.grnNo}, ${d(o.receivedDate)})${
    o.warrantyUntil ? ` - supplier warranty ${o.underWarranty ? 'valid till' : 'ended'} ${d(o.warrantyUntil)}` : ''}.`;
};

// ------------------------------------------------ dead stock & scrap (28 Sep 2026)

export interface DeadStockRow {
  id: string; caseNo: string; productName: string; qty: number; serialNo: string | null; status: string;
  outcome: string | null; complaintNo: string | null; complaintId: string | null; fromJob: boolean;
  valuePaise: number; since: Date; reason: string | null;
}

/**
 * Items that are of no use: scrapped cases, and old units from jobs still
 * waiting for a decision (logged, never sent). Valued at what they cost us -
 * the unit's own cost, else the product's current cost.
 */
export async function deadStock(scope: StoreScope): Promise<{ waiting: DeadStockRow[]; scrapped: DeadStockRow[] }> {
  const rows = await db.replacementCase.findMany({
    where: { ...scopeWhere(scope), OR: [{ outcome: 'scrapped' }, { status: 'open', jobOldUnits: { some: {} } }] },
    select: {
      id: true, caseNo: true, productId: true, productName: true, qty: true, serialNo: true, status: true, outcome: true, createdAt: true,
      complaint: { select: { id: true, complaintNo: true } }, stockUnit: { select: { unitCostPaise: true } },
      jobOldUnits: { select: { id: true }, take: 1 },
      events: { where: { toStatus: 'closed' }, orderBy: { createdAt: 'desc' }, take: 1, select: { note: true, createdAt: true } },
    },
    orderBy: { createdAt: 'desc' }, take: LIST_MAX_ROWS,
  });
  const { costsFor } = await import('./product-cost');
  const costs = await costsFor(scope, [...new Set(rows.map((r) => r.productId).filter((x): x is string => !!x))]);
  const out = rows.map((r): DeadStockRow => ({
    id: r.id, caseNo: r.caseNo, productName: r.productName, qty: r.qty, serialNo: r.serialNo, status: r.status, outcome: r.outcome,
    complaintNo: r.complaint?.complaintNo ?? null, complaintId: r.complaint?.id ?? null, fromJob: r.jobOldUnits.length > 0,
    valuePaise: (r.stockUnit?.unitCostPaise ?? (r.productId ? costs.get(r.productId)?.unitCostPaise : 0) ?? 0) * r.qty,
    since: r.events[0]?.createdAt ?? r.createdAt, reason: r.events[0]?.note ?? null,
  }));
  return { waiting: out.filter((r) => r.outcome !== 'scrapped'), scrapped: out.filter((r) => r.outcome === 'scrapped') };
}
