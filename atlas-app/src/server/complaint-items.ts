import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { ComplaintError, logActivity, listCustomerPurchases } from './complaints';
import { raiseApproval, openApprovalRequest, decideApprovalStep, HierarchyError } from './hierarchy';
import { resolveSplitCover, warrantyUntil, type CoverageContract, type SplitCover } from '@/lib/amc-coverage';
import { warrantyStart } from '@/lib/stock-units';
import type { Prisma } from '@prisma/client';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * THE ITEMS ON A COMPLAINT (10 Oct 2026, SERVICE-REPAIR-FLOW-SPEC stage 2).
 *
 * A complaint can now name several items - "the ICU camera and the NVR" - each
 * the exact serial we sold, a product we sold without a serial, or something
 * the customer bought elsewhere ("not our product"). Each item carries its own
 * cover (lib/amc-coverage `resolveSplitCover`), and its own warranty void,
 * asked for with a reason and a photo and decided by a manager through the
 * approval engine (type `warranty_void`), the same way a job challan is.
 */

export const MAX_ITEMS = 20;

export interface ComplaintItemInput {
  /** A serialised unit we sold to this customer. */
  stockUnitId?: string | null;
  /** A product we sold, when there is no unit. */
  productId?: string | null;
  /** False for "not our product". */
  ours: boolean;
  /** Brand / model, for an item we did not sell. Ignored otherwise. */
  equipmentName?: string | null;
  serialNo?: string | null;
  problem?: string | null;
}

/** One line of "what does this customer have" on the complaint form. */
export interface EquipmentOption {
  key: string;
  stockUnitId: string | null;
  productId: string;
  name: string;
  code: string | null;
  serialNo: string | null;
  invoiceNo: string | null;
  installedOn: Date | null;
  warrantyUntil: Date | null;
  amcUntil: Date | null;
  labourFree: boolean;
  partsFree: boolean;
}

async function contractsFor(scope: StoreScope, customerId: string): Promise<CoverageContract[]> {
  const rows = await db.amcContract.findMany({
    where: { ...scopeWhere(scope), customerId, status: 'active' },
    select: { id: true, contractNo: true, startDate: true, endDate: true, status: true, coverageTerms: true, items: { select: { productId: true } } },
  });
  return rows.map((c) => ({
    id: c.id, contractNo: c.contractNo, startDate: c.startDate, endDate: c.endDate, status: c.status,
    productIds: c.items.map((i) => i.productId).filter((x): x is string => !!x), terms: c.coverageTerms,
  }));
}

async function basisOf(scope: StoreScope): Promise<string> {
  if (scope.kind === 'all') return 'invoice';
  const s = await db.store.findUnique({ where: { id: scope.storeId }, select: { warrantyStartsOn: true } });
  return s?.warrantyStartsOn ?? 'invoice';
}

const UNIT_SELECT = {
  id: true, serialNo: true, productId: true, warrantyMonths: true, warrantyFrom: true,
  product: { select: { productName: true, productCode: true, warrantyMonths: true } },
  invoice: { select: { invoiceNo: true, invoiceDate: true } },
  challanItems: { where: { challan: { completedAt: { not: null } } }, select: { challan: { select: { completedAt: true } } }, take: 1 },
} satisfies Prisma.StockUnitSelect;
type UnitRow = Prisma.StockUnitGetPayload<{ select: typeof UNIT_SELECT }>;

function unitEquipment(u: UnitRow, basis: string) {
  const installedOn = u.challanItems[0]?.challan.completedAt ?? null;
  const soldOn = warrantyStart({ basis, invoiceDate: u.invoice?.invoiceDate ?? null, installDate: installedOn, restartedOn: u.warrantyFrom });
  return { installedOn, equipment: { productId: u.productId, soldOn, warrantyMonths: u.warrantyMonths ?? u.product.warrantyMonths } };
}

/**
 * Everything this customer has from us: each serialised unit they hold, then
 * the products they bought without a serial. Serials first - they are the
 * exact answer; a product line is the best guess when there is no serial.
 */
export async function listCustomerEquipment(scope: StoreScope, customerId: string, onDate = new Date()): Promise<EquipmentOption[]> {
  const [units, purchases, contracts, basis] = await Promise.all([
    db.stockUnit.findMany({
      where: { ...scopeWhere(scope), partyId: customerId, status: 'with_customer', deletedAt: null },
      orderBy: { receivedAt: 'desc' },
      take: LIST_MAX_ROWS,
      select: UNIT_SELECT,
    }),
    listCustomerPurchases(scope, customerId),
    contractsFor(scope, customerId),
    basisOf(scope),
  ]);
  const out: EquipmentOption[] = [];
  const unitProducts = new Set<string>();
  for (const u of units) {
    unitProducts.add(u.productId);
    const { installedOn, equipment } = unitEquipment(u, basis);
    const cover = resolveSplitCover({ contracts, equipment, onDate });
    out.push({
      key: `u:${u.id}`, stockUnitId: u.id, productId: u.productId, name: u.product.productName, code: u.product.productCode,
      serialNo: u.serialNo, invoiceNo: u.invoice?.invoiceNo ?? null, installedOn,
      warrantyUntil: warrantyUntil(equipment), amcUntil: cover.labour.until,
      labourFree: cover.labour.free, partsFree: cover.parts.free,
    });
  }
  for (const p of purchases) {
    if (unitProducts.has(p.productId)) continue;
    out.push({
      key: `p:${p.productId}`, stockUnitId: null, productId: p.productId, name: p.productName, code: p.productCode,
      serialNo: null, invoiceNo: null, installedOn: null, warrantyUntil: null, amcUntil: null, labourFree: false, partsFree: false,
    });
  }
  return out;
}

/**
 * Check and shape the items for a new complaint. Run BEFORE the transaction:
 * a unit must be one this customer holds in this branch, a product must be in
 * this branch, and an item we did not sell must at least say what it is.
 */
export async function prepareItems(
  storeId: string, customerId: string, items: ComplaintItemInput[],
): Promise<Prisma.ComplaintItemCreateManyComplaintInput[]> {
  if (items.length > MAX_ITEMS) throw new ComplaintError(`At most ${MAX_ITEMS} items on one complaint.`);
  const out: Prisma.ComplaintItemCreateManyComplaintInput[] = [];
  const seen = new Set<string>();
  for (const [i, it] of items.entries()) {
    const problem = it.problem?.trim() || null;
    if (it.ours && it.stockUnitId) {
      if (seen.has(it.stockUnitId)) throw new ComplaintError('The same serial is on the complaint twice.');
      seen.add(it.stockUnitId);
      const u = await db.stockUnit.findFirst({
        where: { id: it.stockUnitId, storeId, partyId: customerId },
        select: { id: true, serialNo: true, productId: true, product: { select: { productName: true } } },
      });
      if (!u) throw new ComplaintError('That serial is not one this customer holds in this branch.');
      out.push({ storeId, srNo: i + 1, ours: true, stockUnitId: u.id, productId: u.productId, equipmentName: u.product.productName, serialNo: u.serialNo, problem });
    } else if (it.ours && it.productId) {
      const p = await db.product.findFirst({ where: { id: it.productId, storeId }, select: { id: true, productName: true } });
      if (!p) throw new ComplaintError('That product is not in this branch.');
      out.push({ storeId, srNo: i + 1, ours: true, productId: p.id, equipmentName: p.productName, serialNo: it.serialNo?.trim() || null, problem });
    } else if (!it.ours) {
      const name = it.equipmentName?.trim();
      if (!name) throw new ComplaintError('Say what the item is - brand and model - for one we did not sell.');
      out.push({ storeId, srNo: i + 1, ours: false, equipmentName: name.slice(0, 200), serialNo: it.serialNo?.trim() || null, problem });
    } else {
      throw new ComplaintError('Pick the serial or product, or mark the item as not ours.');
    }
  }
  return out;
}

export interface ComplaintItemView {
  id: string; srNo: number; ours: boolean; stockUnitId: string | null; productId: string | null;
  equipmentName: string; serialNo: string | null; problem: string | null; status: string; cancelReason: string | null;
  voidStatus: string | null; voidReason: string | null; voidPhotoId: string | null; voidDecisionNote: string | null;
  invoice: { id: string; invoiceNo: string } | null;
  /** The pickup receipt it left the site on (stage 3). */
  pickup: { id: string; pickupNo: string } | null;
  /** The GDN it went back to the customer on (stage 6). */
  handback: { id: string; gdnNo: string } | null;
  cover: SplitCover;
  /**
   * Its supplier case, the latest one (stage 5): where it went, what the
   * supplier said and quoted, what came back and on which receipt.
   */
  rma: {
    id: string; caseNo: string; status: string; outcome: string | null; supplierAnswer: string | null; supplierQuotePaise: number | null;
    replacementSerialNo: string | null; creditNoteNo: string | null; closedOn: string | null; courierSharePaise: number | null;
    dispatch: { id: string; dispatchNo: string } | null; receipt: { id: string; receiptNo: string } | null;
  } | null;
}

/** The items on one complaint, each with its own cover on the complaint's date. */
export async function complaintItems(scope: StoreScope, complaint: { id: string; customerId: string; createdAt: Date }): Promise<ComplaintItemView[]> {
  const rows = await db.complaintItem.findMany({
    where: { ...scopeWhere(scope), complaintId: complaint.id, deletedAt: null },
    orderBy: { srNo: 'asc' },
    include: {
      stockUnit: { select: { ...UNIT_SELECT, invoice: { select: { id: true, invoiceNo: true, invoiceDate: true } } } },
      product: { select: { warrantyMonths: true } },
      pickup: { select: { id: true, pickupNo: true } },
      handbackIssue: { select: { id: true, gdnNo: true } },
      replacementCases: {
        where: { deletedAt: null, status: { not: 'cancelled' } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true, caseNo: true, status: true, outcome: true, supplierAnswer: true, supplierQuotePaise: true,
          replacementSerialNo: true, creditNoteNo: true, closedOn: true, courierSharePaise: true,
          dispatch: { select: { id: true, dispatchNo: true } }, receipt: { select: { id: true, receiptNo: true } },
        },
      },
    },
  });
  if (!rows.length) return [];
  const [contracts, basis] = await Promise.all([contractsFor(scope, complaint.customerId), basisOf(scope)]);
  // The latest sale of a product, for an item with no unit - the same guess the single-product complaint made.
  const productSales = new Map<string, Date | null>();
  for (const r of rows) {
    if (r.stockUnitId || !r.productId || productSales.has(r.productId)) continue;
    const line = await db.invoiceItem.findFirst({
      where: { productId: r.productId, invoice: { ...scopeWhere(scope), partyId: complaint.customerId, lifecycle: { not: 'draft' } } },
      orderBy: { invoice: { invoiceDate: 'desc' } },
      select: { invoice: { select: { invoiceDate: true } } },
    });
    productSales.set(r.productId, line?.invoice.invoiceDate ?? null);
  }
  return rows.map((r) => {
    const warrantyVoid = r.voidStatus === 'approved' ? { reason: r.voidReason ?? 'voided' } : null;
    let cover: SplitCover;
    if (r.stockUnit) {
      cover = resolveSplitCover({ contracts, equipment: unitEquipment(r.stockUnit, basis).equipment, onDate: complaint.createdAt, warrantyVoid });
    } else if (r.ours && r.productId) {
      cover = resolveSplitCover({ contracts, equipment: { productId: r.productId, soldOn: productSales.get(r.productId) ?? null, warrantyMonths: r.product?.warrantyMonths ?? null }, onDate: complaint.createdAt, warrantyVoid });
    } else {
      // Not ours: a site-wide AMC still sends the technician free; no warranty from us.
      const c = resolveSplitCover({ contracts, equipment: { productId: null, soldOn: null, warrantyMonths: null }, onDate: complaint.createdAt });
      cover = { ...c, parts: { free: false, reason: 'Not sold by us - no warranty from us.', until: null, voided: false } };
    }
    return {
      id: r.id, srNo: r.srNo, ours: r.ours, stockUnitId: r.stockUnitId, productId: r.productId,
      equipmentName: r.equipmentName, serialNo: r.serialNo, problem: r.problem, status: r.status, cancelReason: r.cancelReason,
      voidStatus: r.voidStatus, voidReason: r.voidReason, voidPhotoId: r.voidPhotoId, voidDecisionNote: r.voidDecisionNote,
      invoice: r.stockUnit?.invoice ? { id: r.stockUnit.invoice.id, invoiceNo: r.stockUnit.invoice.invoiceNo } : null,
      pickup: r.pickup ? { id: r.pickup.id, pickupNo: r.pickup.pickupNo } : null,
      handback: r.handbackIssue,
      cover,
      rma: r.replacementCases[0] ?? null,
    };
  });
}

/** Add one item to a complaint already raised. */
export async function addComplaintItem(scope: StoreScope, complaintId: string, input: ComplaintItemInput, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const c = await db.complaint.findFirst({ where: { id: complaintId, storeId }, select: { id: true, customerId: true, status: true, productId: true } });
  if (!c) throw new ComplaintError('That complaint is not in your scope.');
  if (['closed', 'cancelled'].includes(c.status)) throw new ComplaintError('This complaint is finished - raise a new one.');
  const count = await db.complaintItem.count({ where: { storeId, complaintId, deletedAt: null } });
  const [row] = await prepareItems(storeId, c.customerId, [input]);
  if (row.stockUnitId && await db.complaintItem.findFirst({ where: { storeId, complaintId, stockUnitId: row.stockUnitId, status: { not: 'cancelled' } }, select: { id: true } })) {
    throw new ComplaintError('That serial is already on this complaint.');
  }
  await db.$transaction(async (tx) => {
    await tx.complaintItem.create({ data: { ...row, srNo: count + 1, complaintId, createdBy: userId } });
    // The first item names the complaint's equipment, for lists and old screens.
    if (!c.productId && row.productId) await tx.complaint.update({ where: { id: complaintId }, data: { productId: row.productId } });
    await logActivity(tx, complaintId, 'item_changed', userId, { body: `Item added: ${row.equipmentName}${row.serialNo ? ` (S/N ${row.serialNo})` : ''}${row.ours ? '' : ' - not ours'}.` });
  });
}

/** Take an item off - kept, marked cancelled with the reason (nothing is deleted). */
export async function cancelComplaintItem(scope: StoreScope, itemId: string, reason: string, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const why = reason.trim();
  if (!why) throw new ComplaintError('Say why the item is taken off.');
  const it = await db.complaintItem.findFirst({ where: { id: itemId, storeId }, select: { id: true, complaintId: true, status: true, equipmentName: true } });
  if (!it) throw new ComplaintError('That item is not in your scope.');
  if (it.status !== 'open') throw new ComplaintError('Only an item nothing has happened to yet can be taken off.');
  await db.$transaction(async (tx) => {
    await tx.complaintItem.update({ where: { id: it.id }, data: { status: 'cancelled', cancelReason: why } });
    await logActivity(tx, it.complaintId, 'item_changed', userId, { body: `Item taken off: ${it.equipmentName}. Reason: ${why}` });
  });
}

/**
 * Ask a manager to void an item's warranty. A reason and one of the job's
 * photos are required - "it got wet" without a picture is an argument later.
 */
export async function requestWarrantyVoid(scope: StoreScope, itemId: string, input: { reason: string; photoId: string }, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const why = input.reason.trim();
  if (!why) throw new ComplaintError('Say why the warranty is void - lightning, water, physical damage, a broken seal.');
  const it = await db.complaintItem.findFirst({ where: { id: itemId, storeId }, select: { id: true, complaintId: true, ours: true, status: true, voidStatus: true, equipmentName: true } });
  if (!it) throw new ComplaintError('That item is not in your scope.');
  if (!it.ours) throw new ComplaintError('We give no warranty on an item we did not sell - there is nothing to void.');
  if (it.status === 'cancelled') throw new ComplaintError('That item was taken off the complaint.');
  if (it.voidStatus === 'requested') throw new ComplaintError('A void is already waiting for a decision.');
  if (it.voidStatus === 'approved') throw new ComplaintError('The warranty on this item is already void.');
  // Only a running warranty can be voided - one already over has nothing to take away.
  const job = await db.complaint.findFirst({ where: { id: it.complaintId, storeId }, select: { id: true, customerId: true, createdAt: true } });
  const mine = job ? (await complaintItems(scope, job)).find((x) => x.id === it.id) : null;
  if (!mine?.cover.parts.free) throw new ComplaintError(`There is no running warranty on ${it.equipmentName} to void - the part is already charged.`);
  const photo = await db.documentAttachment.findFirst({ where: { id: input.photoId, storeId, docType: 'complaint', docId: it.complaintId }, select: { id: true } });
  if (!photo) throw new ComplaintError('Attach a photo to the job first, then pick it here.');
  await db.$transaction(async (tx) => {
    await tx.complaintItem.update({
      where: { id: it.id },
      data: { voidStatus: 'requested', voidReason: why.slice(0, 500), voidPhotoId: photo.id, voidRequestedBy: userId, voidRequestedAt: new Date(), voidDecidedBy: null, voidDecidedAt: null, voidDecisionNote: null },
    });
    await logActivity(tx, it.complaintId, 'item_changed', userId, { body: `Warranty void asked for ${it.equipmentName}: ${why} - waiting for a manager.` });
  });
  await raiseApproval(scope, 'warranty_void', it.id, userId);
}

/** The manager's decision - through the engine when a rule routes it, directly otherwise. */
export async function decideWarrantyVoid(
  scope: StoreScope, itemId: string, decision: 'approved' | 'rejected', userId: string, note?: string | null,
): Promise<void> {
  const it = await db.complaintItem.findFirst({ where: { id: itemId, ...scopeWhere(scope) }, select: { id: true, complaintId: true, voidStatus: true, equipmentName: true, voidReason: true } });
  if (!it) throw new ComplaintError('That item is not in your scope.');
  if (it.voidStatus !== 'requested') throw new ComplaintError('There is no void waiting on that item.');
  if (decision === 'rejected' && !note?.trim()) throw new ComplaintError('Say why the void is refused.');
  const open = await openApprovalRequest(scope, 'warranty_void', it.id);
  let final: 'approved' | 'rejected' = decision;
  if (open) {
    let s;
    try { s = await decideApprovalStep(scope, open.id, decision, userId, note?.trim() || null); } catch (e) {
      if (e instanceof HierarchyError) throw new ComplaintError(e.message);
      throw e;
    }
    if (s.final === null) return;
    final = s.final === 'APPROVED' ? 'approved' : 'rejected';
  }
  await db.$transaction(async (tx) => {
    await tx.complaintItem.update({ where: { id: it.id }, data: { voidStatus: final, voidDecidedBy: userId, voidDecidedAt: new Date(), voidDecisionNote: note?.trim() || null } });
    await logActivity(tx, it.complaintId, 'item_changed', userId, {
      body: final === 'approved'
        ? `Warranty void approved for ${it.equipmentName} (${it.voidReason}) - the part is now charged to the customer.`
        : `Warranty void refused for ${it.equipmentName}: ${note?.trim() || '-'}`,
    });
  });
}


export { jobCoverFromItems } from '@/lib/complaint-items';

/**
 * PICK UP FOR REPAIR (10 Oct 2026, stage 3). Vcare's way: nothing is swapped
 * from stock - the customer's own items leave the site on one pickup receipt
 * (PKP), each serial goes "in for repair" (with us, still theirs, still on its
 * invoice), and each item gets its supplier case, opened and waiting to be
 * sent. The customer's link shows the pickup.
 */
export async function pickUpItems(
  scope: StoreScope, complaintId: string,
  input: { itemIds: string[]; handedOverBy: string | null; note: string | null },
  userId: string,
): Promise<{ pickupNo: string; caseNos: string[]; warnings: string[] }> {
  const storeId = scopeForWrite(scope);
  const job = await db.complaint.findFirst({ where: { id: complaintId, storeId }, select: { id: true, complaintNo: true, customerId: true, status: true } });
  if (!job) throw new ComplaintError('That complaint is not in your scope.');
  if (['closed', 'cancelled'].includes(job.status)) throw new ComplaintError('This complaint is finished.');
  const ids = [...new Set(input.itemIds)];
  if (!ids.length) throw new ComplaintError('Tick the items being taken.');
  const items = await db.complaintItem.findMany({
    where: { id: { in: ids }, storeId, complaintId, deletedAt: null },
    select: { id: true, status: true, ours: true, stockUnitId: true, productId: true, equipmentName: true, serialNo: true },
  });
  if (items.length !== ids.length) throw new ComplaintError('An item is not on this complaint.');
  const notOpen = items.find((i) => i.status !== 'open');
  if (notOpen) throw new ComplaintError(`${notOpen.equipmentName} is already ${notOpen.status.replace(/_/g, ' ')}.`);

  const { allocateDocumentNumber } = await import('./allocate-document-number');
  const pickupNo = await allocateDocumentNumber(storeId, 'PKP');
  const who = input.handedOverBy?.trim() || null;
  await db.$transaction(async (tx) => {
    const p = await tx.itemPickup.create({
      data: { storeId, complaintId, pickupNo, pickedUpBy: userId, handedOverBy: who, note: input.note?.trim() || null },
      select: { id: true },
    });
    await tx.complaintItem.updateMany({ where: { id: { in: ids }, storeId }, data: { status: 'picked_up', pickupId: p.id } });
    await logActivity(tx, complaintId, 'pickup', userId, {
      body: `Taken for repair on ${pickupNo}: ${items.map((i) => i.equipmentName + (i.serialNo ? ` (${i.serialNo})` : '')).join(', ')}${who ? ` - handed over by ${who}` : ''}.`,
      visibleToPortal: true,
    });
  });

  // The units and the supplier cases, outside the transaction: each goes
  // through its own module's rules, and one refusing must not undo the receipt.
  const { moveUnit } = await import('./stock-units');
  const { createRmaCase } = await import('./rma');
  const warnings: string[] = [];
  const caseNos: string[] = [];
  for (const it of items) {
    if (it.stockUnitId) {
      const u = await db.stockUnit.findFirst({ where: { id: it.stockUnitId, storeId }, select: { status: true } });
      if (u?.status === 'with_customer') {
        await moveUnit(scope, it.stockUnitId, { to: 'in_repair', partyId: job.customerId, note: `Taken for repair on ${pickupNo} (${job.complaintNo})` }, userId)
          .catch((e: Error) => { warnings.push(`${it.equipmentName}: the unit did not move - ${e.message}`); });
      } else if (u) {
        warnings.push(`${it.equipmentName}: the unit is "${u.status.replace(/_/g, ' ')}" on file, not with the customer - left as it is.`);
      }
    }
    try {
      const c = await createRmaCase(scope, {
        productId: it.productId, productName: it.equipmentName, brandModel: it.ours ? null : it.equipmentName, qty: 1,
        serialNo: it.serialNo, customerId: job.customerId, complaintNo: job.complaintNo, parentCaseId: null,
        note: `Taken from the customer on ${pickupNo}.`, complaintItemId: it.id, stockUnitId: it.stockUnitId,
      }, userId);
      caseNos.push(c.caseNo);
    } catch (e) {
      warnings.push(`${it.equipmentName}: no supplier case opened - ${(e as Error).message}`);
    }
  }
  if (warnings.length) await logActivity(db, complaintId, 'item_changed', userId, { body: `Pickup ${pickupNo}: ${warnings.join(' ')}` });
  return { pickupNo, caseNos, warnings };
}
