import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { resolveTaxMode } from './gst';
import { computeBillTotals, type BillLineInput } from '@/lib/purchase';
import { canEdit, canCancel, canTransition, type PurchaseOrderStatus } from '@/lib/purchase-order-status';

/**
 * Purchase orders - the mirror of Sales Orders, pointed at a supplier.
 *
 * Paperwork only. Nothing here writes a `StockMovement` or a payable - those
 * only become real once goods are actually received, which today happens on
 * `PurchaseBill.postBill` and will eventually happen on a GRN specific to a
 * PO. A purchase order is an intent, the same way a sales order is a promise
 * before dispatch (see `sales-orders.ts`'s note on the same idea).
 *
 * Totals arithmetic is reused from `computeBillTotals` in `@/lib/purchase`
 * with freight fixed at zero - a PO carries no freight charge of its own, so
 * this is the same GST split a bill uses on its product lines, nothing more.
 */

export class PurchaseOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseOrderError';
  }
}

/**
 * What to call a party on a document. Duplicated from `purchases.ts` rather
 * than shared - eight lines, and importing across two purchase-adjacent
 * modules for this alone is not worth the coupling.
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

export interface PoLineDraft extends BillLineInput {
  productId?: string | null;
  productName: string;
  productCode?: string | null;
}

export interface PurchaseOrderInput {
  partyId: string;
  orderDate: Date;
  expectedDeliveryDate?: Date | null;
  notes?: string | null;
  lines: PoLineDraft[];
}

function validate(input: PurchaseOrderInput) {
  if (input.lines.length === 0) throw new PurchaseOrderError('A purchase order needs at least one line.');
  if (input.lines.some((l) => !l.productName.trim())) {
    throw new PurchaseOrderError('Every line needs a description.');
  }
  if (input.lines.some((l) => l.qty <= 0)) {
    throw new PurchaseOrderError('Quantity must be more than zero on every line.');
  }
}

export async function createPurchaseOrder(
  scope: StoreScope,
  input: PurchaseOrderInput,
  userId: string,
): Promise<{ id: string; orderNo: string }> {
  const storeId = scopeForWrite(scope);
  validate(input);

  const party = await db.party.findFirst({
    where: { id: input.partyId, ...scopeWhere(scope) },
    select: { id: true, title: true, firstName: true, lastName: true, companyName: true, gstin: true, state: true, isSupplier: true },
  });
  if (!party) throw new PurchaseOrderError('Supplier not found in your scope.');

  const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { stateId: true } });
  const taxMode = resolveTaxMode(store.stateId ?? '', party.state);
  const totals = computeBillTotals(input.lines, 0, taxMode);
  const orderNo = await allocateDocumentNumber(storeId, 'PO', input.orderDate);

  const order = await db.$transaction(async (tx) => {
    const created = await tx.purchaseOrder.create({
      data: {
        storeId,
        orderNo,
        partyId: party.id,
        supplierName: partyDisplayName(party),
        gstin: party.gstin,
        stateId: party.state,
        orderDate: input.orderDate,
        expectedDeliveryDate: input.expectedDeliveryDate ?? null,
        status: 'draft',
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

    await tx.purchaseOrderItem.createMany({
      data: input.lines.map((l, i) => ({
        storeId,
        purchaseOrderId: created.id,
        srNo: i + 1,
        productId: l.productId ?? null,
        productName: l.productName.trim(),
        productCode: l.productCode ?? null,
        qty: l.qty,
        unitCostPaise: l.unitCostPaise,
        discountPct: l.discountPct,
        taxRatePct: l.taxRatePct,
        lineDiscountPaise: totals.lines[i].lineDiscountPaise,
        lineTotalPaise: totals.lines[i].taxablePaise,
      })),
    });

    // Same silent promotion `createBill` does - a party ordered from is a
    // supplier, whether or not anybody ticked the box.
    if (!party.isSupplier) {
      await tx.party.update({ where: { id: party.id }, data: { isSupplier: true } });
    }

    return created;
  });

  return { id: order.id, orderNo };
}

export async function updatePurchaseOrder(
  scope: StoreScope,
  id: string,
  input: PurchaseOrderInput,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  validate(input);

  const existing = await db.purchaseOrder.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!existing) throw new PurchaseOrderError('Purchase order not found in your scope.');
  if (!canEdit(existing.status as PurchaseOrderStatus)) {
    throw new PurchaseOrderError(`A ${existing.status.replace('_', ' ')} purchase order can no longer be edited.`);
  }

  const party = await db.party.findFirst({
    where: { id: input.partyId, ...scopeWhere(scope) },
    select: { id: true, title: true, firstName: true, lastName: true, companyName: true, gstin: true, state: true },
  });
  if (!party) throw new PurchaseOrderError('Supplier not found in your scope.');

  const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { stateId: true } });
  const taxMode = resolveTaxMode(store.stateId ?? '', party.state);
  const totals = computeBillTotals(input.lines, 0, taxMode);

  await db.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        partyId: party.id,
        supplierName: partyDisplayName(party),
        gstin: party.gstin,
        stateId: party.state,
        orderDate: input.orderDate,
        expectedDeliveryDate: input.expectedDeliveryDate ?? null,
        subtotalPaise: totals.subtotalPaise,
        itemDiscountPaise: totals.itemDiscountPaise,
        taxableBasePaise: totals.taxableBasePaise,
        cgstPaise: totals.cgstPaise,
        sgstPaise: totals.sgstPaise,
        igstPaise: totals.igstPaise,
        grandTotalPaise: totals.grandTotalPaise,
        taxMode,
        notes: input.notes ?? null,
      },
    });

    // Keyed on `existing.id`, and `existing` was fetched with `scopeWhere`
    // above - the same reasoning `sales-orders.ts`'s REVIEWED entry gives for
    // its own item replace-on-edit.
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: existing.id } });
    await tx.purchaseOrderItem.createMany({
      data: input.lines.map((l, i) => ({
        storeId,
        purchaseOrderId: existing.id,
        srNo: i + 1,
        productId: l.productId ?? null,
        productName: l.productName.trim(),
        productCode: l.productCode ?? null,
        qty: l.qty,
        unitCostPaise: l.unitCostPaise,
        discountPct: l.discountPct,
        taxRatePct: l.taxRatePct,
        lineDiscountPaise: totals.lines[i].lineDiscountPaise,
        lineTotalPaise: totals.lines[i].taxablePaise,
      })),
    });
  });
}

export async function movePoStatus(
  scope: StoreScope,
  id: string,
  to: PurchaseOrderStatus,
  userId: string,
): Promise<void> {
  scopeForWrite(scope);
  const existing = await db.purchaseOrder.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!existing) throw new PurchaseOrderError('Purchase order not found in your scope.');

  const from = existing.status as PurchaseOrderStatus;
  if (!canTransition(from, to)) {
    throw new PurchaseOrderError(`Cannot move a ${from.replace('_', ' ')} purchase order to ${to.replace('_', ' ')}.`);
  }
  // Approving a sent PO: same approver check as My Reminders & Requests (27 Sep 2026).
  if (from === 'sent' && to === 'approved') {
    const { screenDecision } = await import('./approval-hooks');
    await screenDecision(scope, 'purchase_order', id, 'approved', userId, null);
  }

  await db.purchaseOrder.update({
    where: { id },
    data: {
      status: to,
      ...(to === 'approved' ? { approvedBy: userId, approvedAt: new Date() } : {}),
    },
  });
  // Sent = waiting for approval: the rules decide, the approvers are told.
  if (to === 'sent') {
    const { onPending } = await import('./approval-hooks');
    await onPending(existing.storeId, 'purchase_order', id, userId);
  }
}

export async function cancelPurchaseOrder(
  scope: StoreScope,
  id: string,
  reason: string,
): Promise<void> {
  scopeForWrite(scope);
  const existing = await db.purchaseOrder.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!existing) throw new PurchaseOrderError('Purchase order not found in your scope.');
  if (!canCancel(existing.status as PurchaseOrderStatus)) {
    throw new PurchaseOrderError('This purchase order has already started receiving and can no longer be cancelled.');
  }

  await db.purchaseOrder.update({
    where: { id },
    data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason },
  });
}

export async function listPurchaseOrders(scope: StoreScope) {
  const orders = await db.purchaseOrder.findMany({
    where: scopeWhere(scope),
    orderBy: { orderDate: 'desc' },
    select: {
      id: true, orderNo: true, partyId: true, supplierName: true,
      orderDate: true, expectedDeliveryDate: true, status: true,
      grandTotalPaise: true, approvedBy: true, approvedAt: true,
      createdAt: true,
    },
  });
  return orders;
}

export async function getPurchaseOrderDetail(scope: StoreScope, id: string) {
  const order = await db.purchaseOrder.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: { items: { orderBy: { srNo: 'asc' } } },
  });
  if (!order) throw new PurchaseOrderError('Purchase order not found in your scope.');
  return order;
}
