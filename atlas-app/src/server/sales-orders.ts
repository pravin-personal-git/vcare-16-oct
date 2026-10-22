import 'server-only';
import { getOrderStages } from './order-stages';
import type { OrderStageConfig } from '@/lib/order-stages';
import { resolveSalesperson } from './salesperson';
import { db } from './db';
import { scopeWhere, scopeForWrite, userInScope, type StoreScope } from './store-scope';
import { orderHistoryReason, type HistoryReason } from '@/lib/history-rules';
import { countAttachments } from './attachments';
import { computeTotals } from '@/lib/quotation-totals';
import { resolveTaxMode } from './gst';
import { allocateDocumentNumber } from './allocate-document-number';
import {
  canEdit,
  canTransition,
  derivePaymentStatus,
  type FulfilmentStatus,
  type PaymentStatus,
} from '@/lib/sales-order-status';
import { applyMovements } from './stock';
import { countsAsRevenue } from '@/lib/revenue';
import { createReceipt, type ReceiptMethod } from './receipts';
import { formatCurrency } from '@/lib/format';
import { publicBrandUrl } from './storage';
import { postCogsMovement, reverseCogsMovement } from './cogs';

export interface SalesOrderRow {
  closedAt: Date | null;
  /** Why it is in History, or null while it is Active. See lib/history-rules. */
  historyReason: HistoryReason | null;
  attachmentCount: number;
  id: string;
  orderNo: string;
  quotationNo: string | null;
  quotationId: string | null;
  /** The customer record (G-35). Null for a walk-in. */
  partyId: string | null;
  customerName: string;
  organizationName: string | null;
  phone: string;
  orderDate: Date;
  expectedDeliveryDate: Date | null;
  fulfilmentStatus: FulfilmentStatus;
  paymentStatus: PaymentStatus;
  grandTotalPaise: number;
  amountPaidPaise: number;
  isInvoiced: boolean;
  itemCount: number;
  /** For data reach (B4 step 3) - whose document this is. */
  salespersonId: string | null;
  salespersonName: string | null;
  awbNo: string | null;
  /** For the City and Courier filters (4 Oct 2026). */
  city: string | null;
  courierName: string | null;
}

export async function listSalesOrders(
  scope: StoreScope,
  view: 'active' | 'history' | 'all' = 'active',
): Promise<SalesOrderRow[]> {
  const [rows, users, couriers] = await Promise.all([
    db.salesOrder.findMany({
      // Active / History is decided below - it needs the invoices' money as
      // well as closedAt - so the query takes both and the split happens after.
      where: { ...scopeWhere(scope) },
      include: {
        _count: { select: { items: true } },
        quotation: { select: { id: true, quotationNo: true } },
        invoices: { select: { lifecycle: true, grandTotalPaise: true, amountPaidPaise: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.user.findMany({ where: userInScope(scope), select: { id: true, fullName: true } }),
    db.courier.findMany({ where: scopeWhere(scope), select: { id: true, name: true } }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  const courierName = new Map(couriers.map((c) => [c.id, c.name]));

  const inView = rows
    .map((o) => ({ o, historyReason: orderHistoryReason({ ...o, fullyPaid: orderFullyPaid(o) }) }))
    .filter(({ historyReason }) => view === 'all' || (view === 'history') === (historyReason !== null));
  const files = await countAttachments(scope, 'sales_order', inView.map(({ o }) => o.id));

  return inView.map(({ o, historyReason }) => ({
    id: o.id,
    orderNo: o.orderNo,
    quotationNo: o.quotation?.quotationNo ?? null,
    quotationId: o.quotation?.id ?? null,
    partyId: o.partyId,
    customerName: o.customerName,
    organizationName: o.organizationName,
    phone: o.phone,
    orderDate: o.orderDate,
    expectedDeliveryDate: o.expectedDeliveryDate,
    fulfilmentStatus: o.fulfilmentStatus as FulfilmentStatus,
    // Derived from the money, not read from the column. A stored status is
    // one more thing that can disagree with the amounts beside it.
    paymentStatus: derivePaymentStatus(o.grandTotalPaise, o.amountPaidPaise),
    grandTotalPaise: o.grandTotalPaise,
    amountPaidPaise: o.amountPaidPaise,
    isInvoiced: o.isInvoiced,
    itemCount: o._count.items,
    salespersonId: o.salespersonId ?? null,
    salespersonName: o.salespersonId ? name.get(o.salespersonId) ?? null : null,
    awbNo: o.awbNo,
    city: o.cityId,
    courierName: o.courierId ? courierName.get(o.courierId) ?? null : null,
    closedAt: o.closedAt,
    historyReason,
    attachmentCount: files.get(o.id) ?? 0,
  }));
}

/**
 * Is the money for this order in? Once invoiced, payments are recorded against
 * the invoice and the order's own paid figure stops moving, so the invoices
 * decide - every one still standing must be settled. An order billed only
 * through a consolidated invoice has no direct invoice row, and falls back to
 * its own figure.
 */
function orderFullyPaid(o: {
  grandTotalPaise: number; amountPaidPaise: number;
  invoices: { lifecycle: string; grandTotalPaise: number; amountPaidPaise: number }[];
}): boolean {
  if (o.grandTotalPaise > 0 && o.amountPaidPaise >= o.grandTotalPaise) return true;
  const standing = o.invoices.filter((i) => i.lifecycle !== 'cancelled');
  return standing.length > 0 && standing.every((i) => i.amountPaidPaise >= i.grandTotalPaise);
}

/**
 * Convert an accepted quotation into a sales order.
 *
 * The line items and the buyer snapshot are COPIED, not referenced. A quotation
 * is an offer at a moment in time; once it becomes an order, the numbers must
 * stop moving even if someone later edits the source. The link back is kept for
 * traceability only - spec Â§6.5.
 *
 * Totals are recomputed from the copied lines rather than carried across, so a
 * quotation saved before a totals bug was fixed does not propagate the error
 * into an order.
 */
export async function convertQuotationToOrder(
  scope: StoreScope,
  quotationId: string,
  userId: string,
  opts: { expectedDeliveryDate: Date | null; requiresApproval: boolean },
) {
  const storeId = scopeForWrite(scope);

  const q = await db.quotation.findFirst({
    where: { id: quotationId, ...scopeWhere(scope) },
    include: { items: { orderBy: { srNo: 'asc' } } },
  });
  if (!q) throw new Error('Quotation not found in your scope.');
  if (q.status === 'converted') {
    const existing = await db.salesOrder.findFirst({
      where: { quotationId, ...scopeWhere(scope) },
      select: { orderNo: true },
    });
    throw new Error(
      existing
        ? `This quotation is already order ${existing.orderNo}.`
        : 'This quotation has already been converted.',
    );
  }
  if (q.status === 'rejected') {
    throw new Error('A rejected quotation cannot be turned into an order.');
  }
  if (q.items.length === 0) {
    throw new Error('This quotation has no line items.');
  }

  const totals = computeTotals(
    q.items.map((i) => ({
      qty: i.qty,
      unitPricePaise: i.unitPricePaise,
      discountPct: Number(i.discountPct),
      taxRatePct: Number(i.taxRatePct),
    })),
    {
      /*
        The quotation's own answer, carried forward whole - including NONE,
        which the cast here used to throw away (8 Oct 2026). computeTotals
        takes all three, so there was never a reason to narrow it; the cast
        was left over from when there were only two.
      */
      taxMode: q.taxMode as 'CGST_SGST' | 'IGST' | 'NONE',
      discountType: q.discountType as 'amount' | 'percent',
      discountValue: q.discountValue,
      deliveryPaise: q.deliveryCharge,
      deliveryExempt: q.deliveryExempt,
    },
  );

  const orderNo = await allocateDocumentNumber(storeId, 'SO');

  // Both writes or neither: an order with no quotation marked converted invites
  // a second order from the same quotation.
  const order = await db.$transaction(async (tx) => {
    const order = await tx.salesOrder.create({
      data: {
        storeId,
        orderNo,
        quotationId: q.id,
        partyId: q.partyId,
        customerName: q.customerName,
        organizationName: q.organizationName,
        email: q.email,
        phone: q.phone,
        gstin: q.gstin,
        billingAddress: q.billingAddress,
        shippingAddress: q.shippingAddress ?? q.billingAddress,
        stateId: q.stateId,
        cityId: q.cityId,
        expectedDeliveryDate: opts.expectedDeliveryDate,
        salespersonId: q.salespersonId ?? userId,
        fulfilmentStatus: opts.requiresApproval ? 'pending_approval' : 'booked',
        paymentStatus: 'unpaid',
        courierId: q.courierId,
        deliveryMode: q.deliveryMode,
        deliveryCharge: q.deliveryCharge,
        deliveryExempt: q.deliveryExempt,
        discountType: q.discountType,
        discountValue: q.discountValue,
        subtotalPaise: totals.subtotalPaise,
        itemDiscountPaise: totals.itemDiscountPaise,
        orderDiscountPaise: totals.orderDiscountPaise,
        taxableBasePaise: totals.taxableBasePaise,
        cgstPaise: totals.cgstPaise,
        sgstPaise: totals.sgstPaise,
        igstPaise: totals.igstPaise,
        grandTotalPaise: totals.grandTotalPaise,
        taxMode: q.taxMode,
        termsBody: q.termsBody,
        notes: q.notes,
        createdBy: userId,
        items: {
          create: q.items.map((i, n) => ({
            srNo: n + 1,
            productId: i.productId,
            productName: i.productName,
            productCode: i.productCode,
            qty: i.qty,
            unitPricePaise: i.unitPricePaise,
            discountPct: i.discountPct,
            taxRatePct: i.taxRatePct,
            lineDiscountPaise: totals.lines[n].lineDiscountPaise,
            lineTotalPaise: totals.lines[n].netPaise,
            amcOpted: i.amcOpted ?? false,
            amcMonths: i.amcMonths ?? null,
            amcPricePaise: i.amcPricePaise ?? null,
          })),
        },
      },
    });

    await tx.quotation.update({
      where: { id: q.id },
      data: { status: 'converted', convertedAt: new Date() },
    });
    return order;
  });

  // After the transaction, never inside it (live test 29 Sep 2026): the
  // approval step reads rules and writes through `db`, which needs a second
  // connection - with one pooled connection it waited until the transaction
  // expired and every conversion failed. Same order as createSalesOrder.
  await salesOrderApproval(storeId, order.id, userId, opts.requiresApproval);
  return order;
}

export interface SalesOrderInput {
  /**
   * GST switched OFF on this document (Vcare, 7 Oct 2026).
   *
   * An INTENT, not a tax mode: the client says "no GST on this one" and the
   * server still decides what that means. A browser posting `taxMode` could
   * pick CGST on an inter-state sale, which is a tax error somebody signs.
   * Absent reads as false, so every existing caller keeps charging GST.
   */
  noGst?: boolean;

  /** The customer's own PO reference. */
  poNumber?: string | null;
  partyId: string | null;
  customerName: string;
  organizationName: string | null;
  email: string | null;
  phone: string;
  gstin: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  stateId: string | null;
  cityId: string | null;
  expectedDeliveryDate: Date | null;
  discountType: 'amount' | 'percent';
  discountValue: number;
  deliveryPaise: number;
  deliveryExempt: boolean;
  deliveryMode: string | null;
  termsBody: string | null;
  notes: string | null;
  /** Chosen on the form; absent = the creator (new) or unchanged (edit). */
  salespersonId?: string | null;
  lines: {
    productId: string | null;
    productName: string;
    productCode: string | null;
    qty: number;
    unitPricePaise: number;
    discountPct: number;
    taxRatePct: number;
    /**
     * The AMC on this line, carried from the quotation and on to the invoice,
     * where it becomes a contract. Optional so callers that have nothing to do
     * with AMC need not pass three nulls. Never folded into the order total -
     * an extra-cost AMC is billed on its own invoice.
     */
    amcOpted?: boolean;
    amcMonths?: number | null;
    amcPricePaise?: number | null;
  }[];
}

/** Raise an order directly, without a quotation first. */
export async function createSalesOrder(
  scope: StoreScope,
  input: SalesOrderInput,
  userId: string,
) {
  const storeId = scopeForWrite(scope);

  const store = await db.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { stateId: true },
  });

  /**
   * NONE when the person switched GST off, otherwise the two states decide.
   * The toggle can only ever REMOVE tax - it cannot pick the wrong one.
   */
  const taxMode = input.noGst ? 'NONE' as const : resolveTaxMode(store.stateId ?? '', input.stateId);

  const totals = computeTotals(
    input.lines.map((l) => ({
      qty: l.qty,
      unitPricePaise: l.unitPricePaise,
      discountPct: l.discountPct,
      taxRatePct: l.taxRatePct,
    })),
    {
      taxMode,
      discountType: input.discountType,
      discountValue: input.discountValue,
      deliveryPaise: input.deliveryPaise,
      deliveryExempt: input.deliveryExempt,
    },
  );

  const salespersonId = await resolveSalesperson(storeId, input.salespersonId, userId);
  const orderNo = await allocateDocumentNumber(storeId, 'SO');

  const created = await db.salesOrder.create({
    data: {
      storeId,
      orderNo,
      partyId: input.partyId,
      customerName: input.customerName,
      organizationName: input.organizationName,
      email: input.email,
      phone: input.phone,
      gstin: input.gstin,
      billingAddress: input.billingAddress,
      shippingAddress: input.shippingAddress ?? input.billingAddress,
      stateId: input.stateId,
      cityId: input.cityId,
      expectedDeliveryDate: input.expectedDeliveryDate,
      salespersonId,
      deliveryMode: input.deliveryMode,
      deliveryCharge: input.deliveryPaise,
      deliveryExempt: input.deliveryExempt,
      discountType: input.discountType,
      discountValue: input.discountValue,
      subtotalPaise: totals.subtotalPaise,
      itemDiscountPaise: totals.itemDiscountPaise,
      orderDiscountPaise: totals.orderDiscountPaise,
      taxableBasePaise: totals.taxableBasePaise,
      cgstPaise: totals.cgstPaise,
      sgstPaise: totals.sgstPaise,
      igstPaise: totals.igstPaise,
      grandTotalPaise: totals.grandTotalPaise,
      taxMode,
      termsBody: input.termsBody,
      notes: input.notes,
      poNumber: input.poNumber ?? null,
      createdBy: userId,
      items: {
        create: input.lines.map((l, i) => ({
          srNo: i + 1,
          productId: l.productId,
          productName: l.productName,
          productCode: l.productCode,
          qty: l.qty,
          unitPricePaise: l.unitPricePaise,
          discountPct: l.discountPct,
          taxRatePct: l.taxRatePct,
          lineDiscountPaise: totals.lines[i].lineDiscountPaise,
          lineTotalPaise: totals.lines[i].netPaise,
          amcOpted: l.amcOpted ?? false,
          amcMonths: l.amcMonths ?? null,
          amcPricePaise: l.amcPricePaise ?? null,
        })),
      },
    },
  });
  await salesOrderApproval(storeId, created.id, userId, false);
  return created;
}

/**
 * Approval rules for orders (27 Sep 2026): with a saved rule, the rule
 * decides - Pending Approval and the approvers are told, or booked straight
 * away (skip list, below the threshold). Without one, the old "requires
 * approval" tick still works, and the owner is now told.
 */
async function salesOrderApproval(storeId: string, orderId: string, userId: string, ticked: boolean) {
  const { loadRule, requestApproval } = await import('./approvals');
  const rule = await loadRule(storeId, 'sales_order');
  if (!rule && !ticked) return;
  if (rule) await db.salesOrder.update({ where: { id: orderId }, data: { fulfilmentStatus: 'pending_approval' } });
  const answer = await requestApproval(storeId, { type: 'sales_order', entityId: orderId, requesterId: userId })
    .catch((e) => { console.error('[approvals] sales order', e); return null; });
  if (answer?.auto) await db.salesOrder.update({ where: { id: orderId }, data: { fulfilmentStatus: 'booked' } });
}

/**
 * Move an order along the fulfilment flow.
 *
 * The legality of the move is checked server-side against the state machine.
 * The client only offers valid options; this is what stops a crafted request
 * marking an unpacked order as delivered.
 */
export async function moveFulfilment(
  scope: StoreScope,
  id: string,
  to: FulfilmentStatus,
  userId: string,
  extra?: { awbNo?: string | null; expectedDeliveryDate?: Date | null },
) {
  const order = await db.salesOrder.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      id: true, storeId: true, orderNo: true, fulfilmentStatus: true,
      // Needed so dispatch can bind each serial unit to the customer taking it
      // (Rule 4). Without it the unit would say `with_customer` and name
      // nobody, which is the exact hole this work closes.
      partyId: true,
      items: { select: { productId: true, productName: true, qty: true, dispatchedQty: true, returnedQty: true } },
    },
  });
  if (!order) throw new Error('Order not found in your scope.');

  const from = order.fulfilmentStatus as FulfilmentStatus;
  // The stages this branch uses (11 Oct 2026): a stage switched off is
  // skipped, so the next one on is a legal move. Approval still moves an
  // order out of Pending approval exactly as before.
  const { getOrderStages } = await import('./order-stages');
  const { canMove } = await import('@/lib/order-stages');
  const stages = await getOrderStages(order.storeId);
  if (!canTransition(from, to) && !canMove(from, to, stages)) {
    throw new Error(`An order cannot move from ${from.replace(/_/g, ' ')} to ${to.replace(/_/g, ' ')}.`);
  }
  // Settings › Required documents (11 Oct 2026): a rule set to Block stops
  // Confirmed (sales order rule) or Delivered (delivery rule) until a file
  // with that tag is attached. Warn rules only show on the page.
  if (to === 'confirmed' || to === 'delivered') {
    const { requiredRules, tagsOn } = await import('./attachments');
    const { blockMessage } = await import('@/lib/attachment-tags');
    const rules = await requiredRules(order.storeId);
    if (rules.some((r) => r.mode === 'block')) {
      const msg = blockMessage(rules, to === 'confirmed' ? 'sales_order' : 'delivery', await tagsOn(order.storeId, 'sales_order', order.id));
      if (msg) throw new Error(msg);
    }
  }
  // Leaving Pending Approval is the approval itself - same approver check as
  // My Reminders & Requests when a request is open (27 Sep 2026).
  if (from === 'pending_approval' && (to === 'confirmed' || to === 'hold' || to === 'void')) {
    const { screenDecision } = await import('./approval-hooks');
    await screenDecision(scope, 'sales_order', id, to === 'confirmed' ? 'approved' : 'rejected', userId, null);
  }

  /**
   * Dispatch is the moment goods physically leave, so it is the moment stock
   * moves. Not at order, not at invoice - an order is a promise and an invoice
   * is paperwork; only dispatch is a fact about the shelf.
   *
   * A return puts it back, for the same reason.
   */
  // With Dispatched switched off, the goods still leave: the first of
  // Shipped / Delivered reached moves the stock - but only if nothing has
  // gone yet (a GDN may already have moved it).
  const stockOut = (to === 'dispatched' && from !== 'dispatched')
    || ((to === 'shipped' || to === 'delivered') && !['dispatched', 'shipped'].includes(from)
      && order.items.every((i) => !i.dispatchedQty));
  const stockBack = to === 'returned';

  // COGS posts (or reverses) BEFORE the stock/lifecycle transaction, same
  // "riskiest step first" ordering as every other posting - a failure here
  // leaves the order's status and stock untouched.
  if (stockOut) {
    await postCogsMovement(scope, {
      direction: 'out',
      entryDate: new Date(),
      description: `Dispatch ${order.orderNo}`,
      sourceId: order.id,
      lines: order.items.filter((i) => i.productId).map((i) => ({ productId: i.productId as string, qty: i.qty })),
    }, userId);
  } else if (stockBack) {
    // Undoing THIS order's own dispatch, not a separate return document -
    // reverse the entry dispatch posted rather than guess a fresh figure
    // from today's cost data, which may have moved on since.
    //
    // Unless part of it already came back from an installation (R2, 22 Oct
    // 2026): that part's cost came off when it was received, so reversing the
    // whole dispatch would take it off twice. Then only what is still out.
    const stillOut = order.items.filter((i) => i.productId && i.qty - i.returnedQty > 0);
    if (order.items.some((i) => i.returnedQty > 0)) {
      await postCogsMovement(scope, {
        direction: 'in', entryDate: new Date(), description: `Order ${order.orderNo} returned`, sourceId: `${order.id}:returned`,
        lines: stillOut.map((i) => ({ productId: i.productId as string, qty: i.qty - i.returnedQty })),
      }, userId);
    } else {
      await reverseCogsMovement(scope, order.id, userId, `Order ${order.orderNo} returned`);
    }
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.salesOrder.update({
      where: { id },
      data: {
        fulfilmentStatus: to,
        ...(to === 'confirmed' ? { approvedBy: userId, approvedAt: new Date() } : {}),
        ...(extra?.awbNo !== undefined ? { awbNo: extra.awbNo } : {}),
        ...(extra?.expectedDeliveryDate !== undefined
          ? { expectedDeliveryDate: extra.expectedDeliveryDate }
          : {}),
      },
    });

    if (stockOut || stockBack) {
      // A return brings back only what is still out - not what already came
      // back from an installation (R2).
      const lines = order.items.filter((i) => i.productId && (stockOut || i.qty - i.returnedQty > 0));
      const sign = stockOut ? -1 : 1;

      await applyMovements(
        tx,
        order.storeId,
        userId,
        lines.map((i) => ({
          productId: i.productId as string,
          qty: stockOut ? -i.qty : sign * (i.qty - i.returnedQty),
          reason: stockOut ? ('dispatch' as const) : ('return_in' as const),
          refType: 'SalesOrder',
          refId: order.id,
          refNo: order.orderNo,
          // Rule 4: which physical items went, and to whom. `applyMovements`
          // picks them oldest-first and records what it could not name.
          partyId: order.partyId,
        })),
      );

      if (stockOut) {
        // Record what actually went, so a partial dispatch has somewhere to
        // live when that arrives.
        for (const i of order.items) {
          await tx.salesOrderItem.updateMany({
            where: { salesOrderId: order.id, productId: i.productId },
            data: { dispatchedQty: i.qty },
          });
        }
      }
    }

    return updated;
  });
}

/**
 * Record money received. The payment STATUS is derived, never passed in - see
 * `derivePaymentStatus`. Payments accumulate; this takes the amount received
 * now, not the running total, because that is what the person at the counter
 * actually knows.
 */
/**
 * Money taken against an order before there is an invoice.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED ON 2 OCTOBER 2026, AND WHY IT MATTERED
 *
 * This used to increment `amountPaidPaise` and stop. No receipt, no receipt
 * number, no journal entry - a customer's fifty thousand rupees existed as an
 * integer on one row and nowhere else in the books. The order read "paid
 * 50,000", the ledger said the business had received nothing, and the two were
 * never going to be reconciled because nothing connected them.
 *
 * It now writes a real `Receipt`, tied to this order and HELD ON ACCOUNT
 * (`allocations: []`), because there is no invoice yet for it to settle. That
 * is also the correct accounting: an advance is not revenue and carries no GST
 * until the invoice. `createReceipt` posts the journal entry, so the money
 * lands in Cash or Bank and the customer goes into credit - which is what
 * actually happened.
 *
 * `amountPaidPaise` is still maintained, because the order list, the payment
 * status and several reports read it. It is now a MIRROR of real receipts
 * rather than the only record of them.
 *
 * Historic figures are NOT back-filled. Money recorded before today has no
 * receipt to attach to, and inventing one would post a journal entry into a
 * closed month for a payment nobody can evidence.
 */
export async function recordPayment(
  scope: StoreScope,
  id: string,
  amountPaise: number,
  userId: string,
  opts?: { method?: ReceiptMethod; reference?: string | null; note?: string | null; receivedAt?: Date },
) {
  if (amountPaise <= 0) throw new Error('Enter an amount greater than zero.');
  if (!Number.isInteger(amountPaise)) throw new Error('Amounts are whole paise.');

  const found = await db.salesOrder.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      id: true, orderNo: true, fulfilmentStatus: true, partyId: true,
      grandTotalPaise: true, amountPaidPaise: true,
    },
  });
  if (!found) throw new Error('Order not found in your scope.');
  if (!countsAsRevenue(found.fulfilmentStatus)) {
    throw new Error('This order is closed. Payment cannot be recorded against it.');
  }

  /**
   * Refused BEFORE anything is written, not after.
   *
   * The old code incremented first and threw afterwards, relying on the
   * transaction to roll the increment back. That was fine for one column and
   * is wrong now: `createReceipt` posts a journal entry of its own, outside
   * this transaction, and a rollback here would leave it stranded.
   */
  if (found.amountPaidPaise + amountPaise > found.grandTotalPaise) {
    const over = found.amountPaidPaise + amountPaise - found.grandTotalPaise;
    throw new Error(
      `That is ${formatCurrency(over)} more than is outstanding on ${found.orderNo}.`
      + ' Nothing has been recorded.',
    );
  }

  /**
   * An order with no customer on it cannot take a receipt, because a receipt
   * needs a party. Rare and real: a few migrated orders name only an enquiry.
   * The old counter is kept up for those so nothing regresses, and the caller
   * is told plainly that no receipt exists behind it.
   */
  if (!found.partyId) {
    await db.salesOrder.update({
      where: { id },
      data: {
        amountPaidPaise: { increment: amountPaise },
        paymentStatus: derivePaymentStatus(
          found.grandTotalPaise, found.amountPaidPaise + amountPaise),
      },
    });
    throw new Error(
      `${found.orderNo} has no customer on it, so no receipt could be raised.`
      + ' The amount is recorded against the order. Add a customer, then raise a receipt properly.',
    );
  }

  // The real thing: a numbered receipt, held on account, with its journal
  // entry. `allocations: []` is what holds it - there is no invoice yet.
  await createReceipt(scope, {
    partyId: found.partyId,
    amountPaise,
    method: opts?.method ?? 'cash',
    receivedAt: opts?.receivedAt,
    reference: opts?.reference ?? null,
    note: opts?.note ?? `Advance against ${found.orderNo}`,
    allocations: [],
    salesOrderId: found.id,
  }, userId);

  /**
   * The mirror, incremented by the DATABASE rather than read-modify-written.
   *
   * Two people at the counter taking 5,000 each at the same moment would both
   * read zero, both write 5,000, and one payment would vanish with nothing to
   * show it had ever been taken. Money silently disappearing is the worst
   * failure this app can have, and it needed no unusual timing - just two tabs.
   */
  return db.$transaction(async (tx) => {
    const updated = await tx.salesOrder.update({
      where: { id },
      data: { amountPaidPaise: { increment: amountPaise } },
      select: { id: true, orderNo: true, grandTotalPaise: true, amountPaidPaise: true },
    });

    // Written so nothing reading the column lands on a stale value, but no
    // screen trusts it - the row derives the status from the amounts.
    return tx.salesOrder.update({
      where: { id },
      data: {
        paymentStatus: derivePaymentStatus(updated.grandTotalPaise, updated.amountPaidPaise),
      },
    });
  });
}

export interface SalesOrderDetail {
  id: string;
  /** The stages this branch uses (11 Oct 2026) - names, colours, which are on. */
  stages: OrderStageConfig;
  orderNo: string;
  quotationNo: string | null;
  quotationId: string | null;
  fulfilmentStatus: FulfilmentStatus;
  paymentStatus: PaymentStatus;
  orderDate: Date;
  expectedDeliveryDate: Date | null;
  /** The customer record, so the name opens their page (G-35). Null for a walk-in. */
  partyId: string | null;
  customerName: string;
  organizationName: string | null;
  email: string | null;
  phone: string;
  gstin: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  stateId: string | null;
  cityId: string | null;
  taxMode: string;
  awbNo: string | null;
  items: {
    srNo: number; productId: string | null; productName: string; productCode: string | null;
    qty: number; unitPricePaise: number; discountPct: number;
    taxRatePct: number; lineTotalPaise: number;
    /** The AMC on this line, so it survives being reopened in the form. */
    amcOpted: boolean; amcMonths: number | null; amcPricePaise: number | null;
  }[];
  subtotalPaise: number;
  itemDiscountPaise: number;
  orderDiscountPaise: number;
  taxableBasePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  deliveryCharge: number;
  grandTotalPaise: number;
  amountPaidPaise: number;
  termsBody: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  /** Who typed it in. Not the salesperson since 4 Oct 2026 - office staff book orders for the field team. */
  createdByName: string | null;
  /**
   * Who approved it and the line the approval engine wrote - including
   * "approved as admin, skipping level 1 (...)" when an owner stepped past the
   * route. Shown on screen, never on the customer's printed copy.
   */
  approval: { byName: string | null; at: Date | null; note: string | null } | null;
  canEdit: boolean;
  org: {
    name: string; gstin: string | null; email: string | null;
    mobile: string | null; logoUrl: string | null; sealUrl: string | null;
  };
  storeName: string;
  storeAddress: string | null;
}

export async function getSalesOrderDetail(
  scope: StoreScope,
  id: string,
): Promise<SalesOrderDetail | null> {
  const o = await db.salesOrder.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      items: { orderBy: { srNo: 'asc' } },
      store: { include: { organization: true } },
      quotation: { select: { id: true, quotationNo: true } },
    },
  });
  if (!o) return null;

  const decided = await db.approvalRequest.findFirst({
    where: { storeId: o.storeId, entityType: 'sales_order', entityId: o.id, status: { not: 'PENDING' } },
    orderBy: { decidedAt: 'desc' },
    select: { decidedBy: true, decidedAt: true, note: true, status: true },
  });
  const ids = [o.salespersonId, o.createdBy, o.approvedBy, decided?.decidedBy].filter((x): x is string => Boolean(x));
  const people = new Map(
    (await db.user.findMany({ where: { id: { in: ids }, ...userInScope(scope) }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]),
  );
  const nameOf = (id: string | null | undefined) => (id ? people.get(id) ?? null : null);
  const approval = decided?.status === 'APPROVED'
    ? { byName: nameOf(decided.decidedBy), at: decided.decidedAt, note: decided.note }
    : o.approvedBy
      ? { byName: nameOf(o.approvedBy), at: o.approvedAt, note: null }
      : null;

  const stages = await getOrderStages(o.storeId);
  return {
    stages,
    id: o.id,
    orderNo: o.orderNo,
    quotationNo: o.quotation?.quotationNo ?? null,
    quotationId: o.quotation?.id ?? null,
    fulfilmentStatus: o.fulfilmentStatus as FulfilmentStatus,
    // Derived from the money, not read from the column. A stored status is
    // one more thing that can disagree with the amounts beside it.
    paymentStatus: derivePaymentStatus(o.grandTotalPaise, o.amountPaidPaise),
    orderDate: o.orderDate,
    expectedDeliveryDate: o.expectedDeliveryDate,
    partyId: o.partyId,
    customerName: o.customerName,
    organizationName: o.organizationName,
    email: o.email,
    phone: o.phone,
    gstin: o.gstin,
    billingAddress: o.billingAddress,
    shippingAddress: o.shippingAddress,
    stateId: o.stateId,
    cityId: o.cityId,
    taxMode: o.taxMode,
    awbNo: o.awbNo,
    items: o.items.map((i) => ({
      srNo: i.srNo, productId: i.productId, productName: i.productName, productCode: i.productCode,
      qty: i.qty, unitPricePaise: i.unitPricePaise,
      discountPct: Number(i.discountPct), taxRatePct: Number(i.taxRatePct),
      lineTotalPaise: i.lineTotalPaise,
      amcOpted: i.amcOpted, amcMonths: i.amcMonths, amcPricePaise: i.amcPricePaise,
    })),
    subtotalPaise: o.subtotalPaise,
    itemDiscountPaise: o.itemDiscountPaise,
    orderDiscountPaise: o.orderDiscountPaise,
    taxableBasePaise: o.taxableBasePaise,
    cgstPaise: o.cgstPaise,
    sgstPaise: o.sgstPaise,
    igstPaise: o.igstPaise,
    deliveryCharge: o.deliveryExempt ? 0 : o.deliveryCharge,
    grandTotalPaise: o.grandTotalPaise,
    amountPaidPaise: o.amountPaidPaise,
    termsBody: o.termsBody,
    salespersonId: o.salespersonId,
    salespersonName: nameOf(o.salespersonId),
    createdByName: nameOf(o.createdBy),
    approval,
    canEdit: canEdit(o.fulfilmentStatus as FulfilmentStatus),
    org: {
      name: o.store.organization.name,
      gstin: o.store.organization.gstin,
      email: o.store.organization.email,
      mobile: o.store.organization.mobile,
      logoUrl: publicBrandUrl(o.store.organization.logoPath),
      sealUrl: publicBrandUrl(o.store.organization.sealPath),
    },
    storeName: o.store.name,
    storeAddress: o.store.address,
  };
}

/** Quotations that are eligible to become an order, for the convert picker. */
export async function listConvertibleQuotations(scope: StoreScope) {
  const rows = await db.quotation.findMany({
    where: { ...scopeWhere(scope), status: { in: ['accepted', 'sent', 'draft'] } },
    select: {
      id: true, quotationNo: true, customerName: true, organizationName: true,
      grandTotalPaise: true, status: true, quotationDate: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows;
}

/**
 * Change an order that has not left the building yet.
 *
 * The gap this fills was odd in shape: `canEdit` was written, tested, and
 * already sent to the screen by `getSalesOrderDetail` - only the action behind
 * it had never been built. So the button could be drawn and could do nothing.
 *
 * WHY THIS IS SIMPLER THAN EDITING AN INVOICE
 *
 * `canEdit` allows booked, pending approval, confirmed and hold. Stock leaves
 * on dispatch, which comes after packed, and packed is not editable. **An
 * editable order has therefore never moved a single unit**, so there is no
 * stock delta to work out - the whole hard half of the invoice edit does not
 * arise here. That is not luck; it is why the line was drawn at packed.
 *
 * The order is also the document that changes most: a customer adds an item,
 * halves a quantity, asks for a different rate. Making that mean "raise a new
 * order" is how a shop ends up with three orders for one job and no idea which
 * is live.
 *
 * `_userId` IS DELIBERATELY UNUSED, AND THAT IS A GAP, NOT A TIDY-UP.
 *
 * Editing an *issued invoice* demands a written reason and writes an
 * `InvoiceRevision` carrying `changedBy`, the before-totals and the before-lines.
 * Editing an order records nothing at all: not who, not why, not what it said
 * before. So a salesperson can halve a rate on a confirmed order and the only
 * evidence is that the number is now different from what the customer was told.
 *
 * That is defensible as far as it goes - an editable order has never dispatched
 * stock and was never handed to the customer as a tax document, which is why the
 * invoice machinery is heavier. It is not defensible as "who changed this?" being
 * unanswerable in a shop with staff.
 *
 * The parameter stays, underscored, rather than being deleted: every other
 * mutation in this file takes it, the call site already passes it, and the fix
 * (an `SalesOrderRevision`, or at minimum `updatedBy`) needs it back. Deleting it
 * would make the signature *look* finished.
 *
 * Tracked as roadmap item "order edit audit trail".
 */
export async function updateSalesOrder(
  scope: StoreScope,
  id: string,
  input: SalesOrderInput,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userId: string,
) {
  const storeId = scopeForWrite(scope);

  if (input.lines.length === 0) throw new Error('An order needs at least one line.');
  if (input.lines.some((l) => !l.productName.trim())) {
    throw new Error('Every line needs a product name.');
  }
  if (input.lines.some((l) => l.qty <= 0)) {
    throw new Error('Quantity must be more than zero on every line.');
  }

  const existing = await db.salesOrder.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      id: true, orderNo: true, fulfilmentStatus: true, isInvoiced: true,
      amountPaidPaise: true, grandTotalPaise: true, updatedAt: true, salespersonId: true,
      invoices: { select: { invoiceNo: true }, take: 1 },
    },
  });
  if (!existing) throw new Error('Order not found in your scope.');
  const salespersonId = await resolveSalesperson(storeId, input.salespersonId, existing.salespersonId);

  // The invoice is downstream. Changing the order underneath one would leave
  // two documents disagreeing about the same sale, and the invoice is the one
  // the customer holds.
  if (existing.isInvoiced) {
    throw new Error(
      `${existing.orderNo} has already been invoiced as ${existing.invoices[0]?.invoiceNo ?? 'an invoice'}.`
      + ' Edit the invoice instead, or cancel it to release the order.',
    );
  }

  const status = existing.fulfilmentStatus as FulfilmentStatus;
  if (!canEdit(status)) {
    throw new Error(
      `${existing.orderNo} is marked ${status.replace(/_/g, ' ')}, so the warehouse is already acting on it.`
      + ' Put it on hold first if it genuinely needs to change.',
    );
  }

  const store = await db.store.findUniqueOrThrow({
    where: { id: storeId }, select: { stateId: true },
  });
  /**
   * NONE when the person switched GST off, otherwise the two states decide.
   * The toggle can only ever REMOVE tax - it cannot pick the wrong one.
   */
  const taxMode = input.noGst ? 'NONE' as const : resolveTaxMode(store.stateId ?? '', input.stateId);

  const totals = computeTotals(
    input.lines.map((l) => ({
      qty: l.qty, unitPricePaise: l.unitPricePaise,
      discountPct: l.discountPct, taxRatePct: l.taxRatePct,
    })),
    {
      taxMode,
      discountType: input.discountType,
      discountValue: input.discountValue,
      deliveryPaise: input.deliveryPaise,
      deliveryExempt: input.deliveryExempt,
    },
  );

  // Same rule as an invoice, for the same reason: taking the total below what
  // has been received turns the customer into a creditor by accident.
  if (totals.grandTotalPaise < existing.amountPaidPaise) {
    throw new Error(
      `${existing.orderNo} already has â‚¹${(existing.amountPaidPaise / 100).toLocaleString('en-IN')} paid against it,`
      + ` and the new total is â‚¹${(totals.grandTotalPaise / 100).toLocaleString('en-IN')}.`
      + ' Refund the difference before reducing the order.',
    );
  }

  return db.$transaction(async (tx) => {
    // Guarded on what was read. Two people editing one order would otherwise
    // both succeed and the second would silently discard the first's changes.
    const claimed = await tx.salesOrder.updateMany({
      where: { id, storeId, updatedAt: existing.updatedAt },
      data: { updatedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new Error(
        `${existing.orderNo} was changed by someone else while you had it open.`
        + ' Nothing has been saved - reload and make your change again.',
      );
    }

    await tx.salesOrderItem.deleteMany({ where: { salesOrderId: id } });

    return tx.salesOrder.update({
      where: { id },
      data: {
        poNumber: input.poNumber ?? null,
        partyId: input.partyId,
        customerName: input.customerName.trim(),
        organizationName: input.organizationName,
        email: input.email,
        phone: input.phone,
        gstin: input.gstin,
        billingAddress: input.billingAddress,
        shippingAddress: input.shippingAddress ?? input.billingAddress,
        stateId: input.stateId,
        cityId: input.cityId,
        expectedDeliveryDate: input.expectedDeliveryDate,
        salespersonId,
        deliveryMode: input.deliveryMode,
        deliveryCharge: input.deliveryPaise,
        deliveryExempt: input.deliveryExempt,
        discountType: input.discountType,
        discountValue: input.discountValue,
        subtotalPaise: totals.subtotalPaise,
        itemDiscountPaise: totals.itemDiscountPaise,
        orderDiscountPaise: totals.orderDiscountPaise,
        taxableBasePaise: totals.taxableBasePaise,
        cgstPaise: totals.cgstPaise,
        sgstPaise: totals.sgstPaise,
        igstPaise: totals.igstPaise,
        grandTotalPaise: totals.grandTotalPaise,
        taxMode,
        termsBody: input.termsBody,
        notes: input.notes,
        paymentStatus: derivePaymentStatus(existing.amountPaidPaise, totals.grandTotalPaise),
        items: {
          create: input.lines.map((l, n) => ({
            srNo: n + 1,
            productId: l.productId,
            productName: l.productName.trim(),
            productCode: l.productCode,
            qty: l.qty,
            unitPricePaise: l.unitPricePaise,
            discountPct: l.discountPct,
            taxRatePct: l.taxRatePct,
            lineDiscountPaise: totals.lines[n].lineDiscountPaise,
            lineTotalPaise: totals.lines[n].netPaise,
            amcOpted: l.amcOpted ?? false,
            amcMonths: l.amcMonths ?? null,
            amcPricePaise: l.amcPricePaise ?? null,
          })),
        },
      },
    });
  });
}

/**
 * Cancel an order - it happened, and it stopped.
 *
 * Deliberately not the same as deleting one. Deleting says the order never
 * existed, which leaves a hole in the numbering and no answer to "what happened
 * to SO-0043?". Cancelling says what actually occurred, keeps the document, and
 * is the honest thing to show a customer who asks.
 *
 * If the goods had already gone out they come back here, as a real stock
 * movement with the cancellation as its reason. An order cancelled after
 * dispatch without returning the stock would leave the shelf permanently short
 * by the amount of one mistake.
 */
export async function cancelSalesOrder(
  scope: StoreScope,
  id: string,
  reason: string,
  userId: string,
) {
  const storeId = scopeForWrite(scope);

  if (!reason.trim()) {
    throw new Error('Say why this order is being cancelled. It goes on the record.');
  }

  const order = await db.salesOrder.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      id: true, orderNo: true, fulfilmentStatus: true, isInvoiced: true,
      amountPaidPaise: true, partyId: true,
      invoices: { select: { invoiceNo: true }, take: 1 },
      items: {
        select: { productId: true, productName: true, dispatchedQty: true, returnedQty: true },
      },
    },
  });
  if (!order) throw new Error('Order not found in your scope.');

  if (order.fulfilmentStatus === 'void') {
    throw new Error(`${order.orderNo} is already cancelled.`);
  }
  if (order.isInvoiced) {
    throw new Error(
      `${order.orderNo} has been invoiced as ${order.invoices[0]?.invoiceNo ?? 'an invoice'}.`
      + ' Cancel the invoice first - that releases the order.',
    );
  }

  // Money received against a cancelled order does not vanish; it becomes
  // something the customer is owed. Refusing here rather than quietly voiding
  // it, because until refunds exist there is nowhere honest to put it.
  if (order.amountPaidPaise > 0) {
    throw new Error(
      `${order.orderNo} has â‚¹${(order.amountPaidPaise / 100).toLocaleString('en-IN')} paid against it.`
      + ' Refund or reallocate that money before cancelling, or it disappears from the customerâ€™s account.',
    );
  }

  // What is still out: goods already back from an installation came back then (R2).
  const toReturn = order.items.filter((i) => i.productId && i.dispatchedQty - i.returnedQty > 0);

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.salesOrder.updateMany({
      where: { id, storeId, fulfilmentStatus: { not: 'void' } },
      data: {
        fulfilmentStatus: 'void',
        notes: reason.trim(),
      },
    });
    if (updated.count === 0) throw new Error(`${order.orderNo} was cancelled by someone else.`);

    if (toReturn.length > 0) {
      await applyMovements(
        tx,
        storeId,
        userId,
        toReturn.map((i) => ({
          productId: i.productId!,
          qty: i.dispatchedQty - i.returnedQty,
          reason: 'return_in' as const,
          refType: 'SalesOrder',
          refId: order.id,
          refNo: order.orderNo,
          note: `Order cancelled - ${reason.trim()}`,
          // Puts this customer's own units back, not somebody else's.
          partyId: order.partyId,
        })),
      );
      await tx.salesOrderItem.updateMany({
        where: { salesOrderId: id }, data: { dispatchedQty: 0, returnedQty: 0 },
      });
    }

    return { orderNo: order.orderNo, returned: toReturn.length };
  });

  /**
   * The goods came back, so their cost comes off cost of goods sold too (22 Oct
   * 2026 - found by the live-like returns test: a cancelled dispatched order put
   * its stock back but kept its cost, so profit read low). The same rule as an
   * order marked Returned: reverse the dispatch's own entry, or - when part
   * already came back from an installation and its cost came off then - post
   * only what was still out. Once the cancel itself has gone through.
   */
  if (toReturn.length > 0) {
    if (order.items.some((i) => i.returnedQty > 0)) {
      await postCogsMovement(scope, {
        direction: 'in', entryDate: new Date(), description: `Order ${order.orderNo} cancelled`, sourceId: `${order.id}:cancelled`,
        lines: toReturn.map((i) => ({ productId: i.productId as string, qty: i.dispatchedQty - i.returnedQty })),
      }, userId);
    } else {
      await reverseCogsMovement(scope, order.id, userId, `Order ${order.orderNo} cancelled`);
    }
  }
  return result;
}
