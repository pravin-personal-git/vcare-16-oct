import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { computeTotals } from '@/lib/quotation-totals';
import { allocateDocumentNumber } from './allocate-document-number';
import { resolveTaxMode } from './gst';
import { dueDateFrom } from '@/lib/invoice-status';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { LIVE_RECEIPT } from './receipts';
import {
  buildConsolidatedLines, type BuiltLine, type BuiltSource, type ProductFacts,
} from '@/lib/consolidated-lines';

/**
 * ONE INVOICE FOR A WHOLE SITE. Written 2 Oct 2026.
 *
 * Vcare do not sell orders, they sell sites. A job runs for weeks: a quotation
 * becomes an order, three technicians raise three installation challans on
 * three different days, the customer adds two more cameras halfway through on
 * a second order, and at the end they expect ONE bill covering all of it.
 *
 * `convertOrderToInvoice` cannot do that and never could - `Invoice.salesOrderId`
 * is a single foreign key, so one order in, one invoice out. Billing per order
 * means the customer reconciles four documents against one site, which is
 * precisely what they complained about.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS BILLS, AND WHY THAT SPLIT
 *
 * The challans, not the orders. A challan is the record of what physically
 * left the building; an order is a promise, and a promise is not a thing you
 * can lawfully put on a tax invoice. Pravin's own rule for an abandoned job is
 * the same rule read from the other end: invoice what was delivered.
 *
 * So goods are billed from CHALLAN lines - at the price the ORDER agreed,
 * because a challan carries no money, only quantities. And labour, visit
 * charges and anything else no technician can carry out of a warehouse are
 * billed from the ORDER lines, once, because there is no challan that could
 * ever record them.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not move stock. Stock left on dispatch, weeks ago, and moving it
 * again here would take the same cameras out of the warehouse twice.
 * `createDirectInvoice` moves stock because a counter sale has no dispatch
 * step coming; this one has already had three.
 */

/* -------------------------------------------------------------------------- */
/*  What is waiting to be billed                                              */
/* -------------------------------------------------------------------------- */

export interface BillableChallan {
  id: string;
  challanNo: string;
  dispatchedAt: Date;
  status: string;
  salesOrderId: string | null;
  orderNo: string | null;
  itemCount: number;
  totalQty: number;
}

export interface BillableOrder {
  id: string;
  orderNo: string;
  orderDate: Date;
  grandTotalPaise: number;
  amountPaidPaise: number;
  isInvoiced: boolean;
}

export interface BillableCustomer {
  partyId: string;
  customerName: string;
  organizationName: string | null;
  challans: BillableChallan[];
  orders: BillableOrder[];
}

/**
 * Work that has gone out and not yet been billed, grouped by customer.
 *
 * Grouped by customer rather than listed flat because the decision being made
 * is "what do I bill Shree Ram Textiles for?", not "what shall I do with
 * challan 67?". A flat list of 200 challans makes somebody sort it themselves.
 *
 * Challans with no customer behind them are dropped rather than bucketed under
 * a placeholder: three of Vcare's 203 migrated challans name only an enquiry,
 * and an invoice needs a buyer. They stay visible on the challan list, where
 * somebody can attach a customer to them.
 */
export async function listBillableWork(scope: StoreScope): Promise<BillableCustomer[]> {
  const challans = await db.installationChallan.findMany({
    where: {
      ...scopeWhere(scope),
      isInvoiced: false,
      // Work that was rejected never happened as far as billing is concerned.
      status: { notIn: ['rejected'] },
    },
    orderBy: { dispatchedAt: 'desc' },
    take: LIST_MAX_ROWS,
    select: {
      id: true, challanNo: true, dispatchedAt: true, status: true, salesOrderId: true,
      salesOrder: {
        select: {
          id: true, orderNo: true, orderDate: true, partyId: true, customerName: true,
          organizationName: true, grandTotalPaise: true, amountPaidPaise: true, isInvoiced: true,
        },
      },
      items: { select: { qty: true } },
    },
  });

  const byParty = new Map<string, BillableCustomer>();
  const seenOrder = new Set<string>();

  for (const c of challans) {
    const order = c.salesOrder;
    if (!order?.partyId) continue;

    let bucket = byParty.get(order.partyId);
    if (!bucket) {
      bucket = {
        partyId: order.partyId,
        customerName: order.customerName,
        organizationName: order.organizationName,
        challans: [],
        orders: [],
      };
      byParty.set(order.partyId, bucket);
    }

    bucket.challans.push({
      id: c.id,
      challanNo: c.challanNo,
      dispatchedAt: c.dispatchedAt,
      status: c.status,
      salesOrderId: c.salesOrderId,
      orderNo: order.orderNo,
      itemCount: c.items.length,
      totalQty: c.items.reduce((t, i) => t + i.qty, 0),
    });

    const key = `${order.partyId}|${order.id}`;
    if (!seenOrder.has(key)) {
      seenOrder.add(key);
      bucket.orders.push({
        id: order.id,
        orderNo: order.orderNo,
        orderDate: order.orderDate,
        grandTotalPaise: order.grandTotalPaise,
        amountPaidPaise: order.amountPaidPaise,
        isInvoiced: order.isInvoiced,
      });
    }
  }

  return [...byParty.values()].sort((a, b) =>
    (b.challans[0]?.dispatchedAt.getTime() ?? 0) - (a.challans[0]?.dispatchedAt.getTime() ?? 0));
}

/* -------------------------------------------------------------------------- */
/*  Building the bill                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The shapes the screen renders. The work of deciding what to charge lives in
 * `lib/consolidated-lines`, which is pure and tested without a database; this
 * file is the part that knows where the rows come from and how to write them.
 */
export type DraftLineSource = BuiltSource;
export type DraftLine = BuiltLine;

export interface ConsolidatedDraft {
  partyId: string;
  customerName: string;
  organizationName: string | null;
  email: string | null;
  phone: string;
  gstin: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  stateId: string | null;
  cityId: string | null;
  lines: DraftLine[];
  challanNos: string[];
  orderNos: string[];
  /**
   * Advances already received against this work, as REAL receipts with money
   * still sitting on them. Each is allocated to the invoice when it is raised.
   */
  advances: { id: string; receiptNo: string; receivedAt: Date; heldPaise: number; against: string }[];
  advancePaise: number;
  warnings: string[];
}

/**
 * Advances collected against this work, with the money still unapplied.
 *
 * Real receipts, not `SalesOrder.amountPaidPaise`. That column was incremented
 * directly for years with no receipt and no journal entry behind it, so
 * carrying it onto an invoice as "already paid" would have the invoice claim
 * money the books have never seen. `recordPayment` writes a proper receipt
 * from 2 Oct 2026 onwards; anything older is reported as a discrepancy rather
 * than quietly believed - see the warning in `previewConsolidatedInvoice`.
 *
 * "Unapplied" is the whole test. A receipt already settling another invoice has
 * nothing left to give this one, and `amountPaise` alone cannot tell the
 * difference.
 */
async function advancesAgainst(
  scope: StoreScope,
  challanIds: string[],
  salesOrderIds: string[],
) {
  if (challanIds.length === 0 && salesOrderIds.length === 0) return [];
  const receipts = await db.receipt.findMany({
    where: {
      ...scopeWhere(scope),
      ...LIVE_RECEIPT,
      OR: [
        ...(challanIds.length ? [{ challanId: { in: challanIds } }] : []),
        ...(salesOrderIds.length ? [{ salesOrderId: { in: salesOrderIds } }] : []),
      ],
    },
    orderBy: { receivedAt: 'asc' },
    select: {
      id: true, receiptNo: true, receivedAt: true, amountPaise: true,
      challan: { select: { challanNo: true } },
      salesOrder: { select: { orderNo: true } },
      allocations: { select: { amountPaise: true } },
    },
  });

  return receipts
    .map((r) => ({
      id: r.id,
      receiptNo: r.receiptNo,
      receivedAt: r.receivedAt,
      heldPaise: r.amountPaise - r.allocations.reduce((t, a) => t + a.amountPaise, 0),
      against: r.challan?.challanNo ?? r.salesOrder?.orderNo ?? '',
    }))
    .filter((r) => r.heldPaise > 0);
}

/**
 * Build the bill without writing anything.
 *
 * Separate from `createConsolidatedInvoice` so the screen can show exactly what
 * is about to be raised, and so the hard part - working out what to charge for
 * - is testable without a transaction.
 */
export async function previewConsolidatedInvoice(
  scope: StoreScope,
  input: { challanIds: string[]; salesOrderIds: string[] },
): Promise<ConsolidatedDraft> {
  if (input.challanIds.length === 0 && input.salesOrderIds.length === 0) {
    throw new Error('Choose at least one challan or order to bill.');
  }

  const challans = await db.installationChallan.findMany({
    where: { id: { in: input.challanIds }, ...scopeWhere(scope) },
    orderBy: { dispatchedAt: 'asc' },
    select: {
      id: true, challanNo: true, dispatchedAt: true, isInvoiced: true, salesOrderId: true,
      items: {
        orderBy: { srNo: 'asc' },
        select: { id: true, productId: true, productName: true, qty: true, unit: true },
      },
    },
  });

  if (challans.length !== input.challanIds.length) {
    throw new Error('One of those challans is not in your scope.');
  }
  const billed = challans.find((c) => c.isInvoiced);
  if (billed) throw new Error(`Challan ${billed.challanNo} has already been billed.`);

  // Every order that prices this work: the ones chosen explicitly, plus the one
  // behind each challan. A challan's own order is implied - you cannot bill its
  // goods without the prices that order agreed.
  const orderIds = [...new Set([
    ...input.salesOrderIds,
    ...challans.map((c) => c.salesOrderId).filter((id): id is string => !!id),
  ])];

  const orders = await db.salesOrder.findMany({
    where: { id: { in: orderIds }, ...scopeWhere(scope) },
    orderBy: { orderDate: 'asc' },
    select: {
      id: true, orderNo: true, orderDate: true, partyId: true, customerName: true,
      organizationName: true, email: true, phone: true, gstin: true,
      billingAddress: true, shippingAddress: true, stateId: true, cityId: true,
      amountPaidPaise: true,
      items: {
        orderBy: { srNo: 'asc' },
        select: {
          id: true, productId: true, productName: true, productCode: true, qty: true,
          unitPricePaise: true, discountPct: true, taxRatePct: true,
        },
      },
    },
  });

  if (orders.length === 0) throw new Error('None of that work has an order behind it to price from.');

  // Everything on one invoice belongs to one buyer. Two customers on one tax
  // invoice is not a thing, and letting it through here would produce a
  // document naming whichever of them happened to sort first.
  const parties = new Set(orders.map((o) => o.partyId).filter(Boolean));
  if (parties.size > 1) {
    throw new Error('That work belongs to more than one customer. Bill them separately.');
  }
  const head = orders[0];
  if (!head.partyId) throw new Error('That order has no customer on it, so it cannot be invoiced.');

  /**
   * The products every line names, in one query.
   *
   * `SalesOrderItem` carries no relation to `Product` - the line snapshots the
   * name and code at the time of sale, deliberately - so what the product IS
   * (goods or a service, its HSN, its current price) has to be fetched. One
   * query rather than a lookup per line, because an order with forty lines is
   * ordinary here.
   */
  const productIds = [...new Set([
    ...orders.flatMap((o) => o.items.map((i) => i.productId)),
    ...challans.flatMap((c) => c.items.map((i) => i.productId)),
  ].filter((id): id is string => !!id))];

  const products = await db.product.findMany({
    where: { id: { in: productIds }, ...scopeWhere(scope) },
    select: {
      id: true, kind: true, hsnCode: true, productCode: true, productName: true,
      // The price in force now, which is only ever a FALLBACK - see
      // `pricedFromCatalogue`. What was agreed lives on the order.
      prices: { orderBy: { effectiveFrom: 'desc' }, take: 1, select: { dlpPaise: true } },
    },
  });

  const facts = new Map<string, ProductFacts>(products.map((p) => [p.id, {
    id: p.id,
    kind: p.kind,
    hsnCode: p.hsnCode,
    productCode: p.productCode,
    productName: p.productName,
    fallbackPricePaise: p.prices[0]?.dlpPaise ?? 0,
  }]));

  const { lines, warnings } = buildConsolidatedLines(
    challans.map((c) => ({
      id: c.id,
      challanNo: c.challanNo,
      dispatchedAt: c.dispatchedAt,
      salesOrderId: c.salesOrderId,
      items: c.items.map((i) => ({
        id: i.id, productId: i.productId, productName: i.productName, qty: i.qty, unit: i.unit,
      })),
    })),
    orders.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      orderDate: o.orderDate,
      items: o.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.productName,
        productCode: i.productCode,
        qty: i.qty,
        unitPricePaise: i.unitPricePaise,
        discountPct: Number(i.discountPct),
        taxRatePct: Number(i.taxRatePct),
      })),
    })),
    facts,
  );

  if (lines.length === 0) throw new Error('There is nothing to bill on that work.');

  const advances = await advancesAgainst(scope, input.challanIds, orders.map((o) => o.id));
  const advancePaise = advances.reduce((t, a) => t + a.heldPaise, 0);

  /**
   * The old counter against the real receipts.
   *
   * Where they disagree it is almost always money recorded before 2 Oct 2026,
   * when `recordPayment` wrote a number and nothing else. Said out loud rather
   * than silently believed or silently dropped: believing it puts money on the
   * invoice the ledger has never seen, and dropping it bills a customer twice
   * for the same advance.
   */
  const counted = orders.reduce((t, o) => t + o.amountPaidPaise, 0);
  if (counted > advancePaise) {
    warnings.push(
      `${orders.map((o) => o.orderNo).join(', ')} shows `
      + `${((counted - advancePaise) / 100).toLocaleString('en-IN')} paid with no receipt behind it. `
      + 'It is NOT on this bill. Raise a receipt for it first, or the customer will be asked for it twice.',
    );
  }

  return {
    partyId: head.partyId,
    customerName: head.customerName,
    organizationName: head.organizationName,
    email: head.email,
    phone: head.phone,
    gstin: head.gstin,
    billingAddress: head.billingAddress,
    shippingAddress: head.shippingAddress,
    stateId: head.stateId,
    cityId: head.cityId,
    lines,
    challanNos: challans.map((c) => c.challanNo),
    orderNos: orders.map((o) => o.orderNo),
    advances,
    advancePaise,
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/*  Writing it                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Refuse work that is already on a live invoice.
 *
 * Asks for a LIVE invoice, not any invoice, which is why there is no database
 * unique doing this instead. Cancelling an invoice has to release its challans
 * so they can be billed again, and nothing here is ever deleted - so a unique
 * index could not tell a cancelled invoice from a current one.
 */
async function assertNotAlreadyBilled(scope: StoreScope, docNos: string[]) {
  if (docNos.length === 0) return;
  const clash = await db.invoiceSource.findFirst({
    where: {
      ...scopeWhere(scope),
      docNo: { in: docNos },
      invoice: { cancelledAt: null },
    },
    select: { docNo: true, invoice: { select: { invoiceNo: true } } },
  });
  if (clash) {
    throw new Error(`${clash.docNo} is already on invoice ${clash.invoice.invoiceNo}.`);
  }
}

export async function createConsolidatedInvoice(
  scope: StoreScope,
  input: {
    challanIds: string[];
    salesOrderIds: string[];
    invoiceDate: Date;
    termsDays: number;
    poNumber?: string | null;
    notes?: string | null;
  },
  userId: string,
) {
  const storeId = scopeForWrite(scope);
  const draft = await previewConsolidatedInvoice(scope, input);

  await assertNotAlreadyBilled(scope, [...draft.challanNos, ...draft.orderNos]);

  /**
   * The branch's STATE against the customer's (13 Oct 2026). This passed the
   * branch's id, which never equals a state code - so every such invoice came
   * out IGST, even for a customer in the same state (since 14 Aug 2026).
   */
  const storeState = (await db.store.findUnique({ where: { id: storeId }, select: { stateId: true } }))?.stateId ?? '';
  const taxMode = resolveTaxMode(storeState, draft.stateId);
  const totals = computeTotals(
    draft.lines.map((l) => ({
      qty: l.qty,
      unitPricePaise: l.unitPricePaise,
      discountPct: l.discountPct,
      taxRatePct: l.taxRatePct,
    })),
    { taxMode, discountType: 'amount', discountValue: 0, deliveryPaise: 0, deliveryExempt: false },
  );

  const invoiceNo = await allocateDocumentNumber(storeId, 'INV');

  // The challans referenced in the draft, resolved once so the write does not
  // have to go looking inside the transaction.
  const challans = await db.installationChallan.findMany({
    where: { id: { in: input.challanIds }, ...scopeWhere(scope) },
    select: { id: true, challanNo: true, dispatchedAt: true },
  });
  const orders = await db.salesOrder.findMany({
    where: {
      id: {
        in: [...new Set(draft.lines.flatMap((l) =>
          l.sources.map((s) => s.salesOrderId).filter((x): x is string => !!x)))],
      },
      ...scopeWhere(scope),
    },
    select: { id: true, orderNo: true, orderDate: true },
  });

  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        storeId,
        invoiceNo,
        // The FIRST order, for every existing call site that still reads this
        // column. The full list lives in `sources` below.
        salesOrderId: orders[0]?.id ?? null,
        partyId: draft.partyId,
        customerName: draft.customerName,
        organizationName: draft.organizationName,
        email: draft.email,
        phone: draft.phone,
        gstin: draft.gstin,
        billingAddress: draft.billingAddress,
        shippingAddress: draft.shippingAddress ?? draft.billingAddress,
        stateId: draft.stateId,
        cityId: draft.cityId,
        invoiceDate: input.invoiceDate,
        dueDate: dueDateFrom(input.invoiceDate, input.termsDays),
        lifecycle: 'draft',
        salespersonId: userId,
        deliveryCharge: 0,
        deliveryExempt: false,
        discountType: 'amount',
        discountValue: 0,
        subtotalPaise: totals.subtotalPaise,
        itemDiscountPaise: totals.itemDiscountPaise,
        orderDiscountPaise: totals.orderDiscountPaise,
        taxableBasePaise: totals.taxableBasePaise,
        cgstPaise: totals.cgstPaise,
        sgstPaise: totals.sgstPaise,
        igstPaise: totals.igstPaise,
        grandTotalPaise: totals.grandTotalPaise,
        taxMode,
        // Mirrors the allocations written below, which are the real record.
        // Capped at the bill: money beyond it stays on the receipt as credit
        // for the next invoice, rather than being written off here.
        amountPaidPaise: Math.min(draft.advancePaise, totals.grandTotalPaise),
        poNumber: input.poNumber ?? null,
        notes: input.notes ?? null,
        createdBy: userId,
        items: {
          create: draft.lines.map((l, n) => ({
            srNo: n + 1,
            productId: l.productId,
            productName: l.productName,
            productCode: l.productCode,
            hsnCode: l.hsnCode,
            qty: l.qty,
            unitPricePaise: l.unitPricePaise,
            discountPct: l.discountPct,
            taxRatePct: l.taxRatePct,
            lineDiscountPaise: totals.lines[n].lineDiscountPaise,
            lineTotalPaise: totals.lines[n].netPaise,
          })),
        },
      },
      include: { items: { orderBy: { srNo: 'asc' }, select: { id: true } } },
    });

    // The per-line trail. Written in the same transaction as the lines, because
    // an invoice line whose origin is unknown is the thing this whole feature
    // exists to prevent.
    const itemIds = invoice.items.map((i) => i.id);
    await tx.invoiceItemSource.createMany({
      data: draft.lines.flatMap((l, n) =>
        l.sources.map((s) => ({
          storeId,
          invoiceItemId: itemIds[n],
          kind: s.kind,
          challanId: s.challanId,
          challanItemId: s.challanItemId,
          salesOrderId: s.salesOrderId,
          salesOrderItemId: s.salesOrderItemId,
          qty: s.qty,
          docNo: s.docNo,
          docDate: s.docDate,
        }))),
    });

    // What this invoice covers, at the header.
    await tx.invoiceSource.createMany({
      data: [
        ...challans.map((c) => ({
          storeId, invoiceId: invoice.id, kind: 'installation_challan',
          challanId: c.id, salesOrderId: null, complaintId: null,
          docNo: c.challanNo, docDate: c.dispatchedAt,
        })),
        ...orders.map((o) => ({
          storeId, invoiceId: invoice.id, kind: 'sales_order',
          challanId: null, salesOrderId: o.id, complaintId: null,
          docNo: o.orderNo, docDate: o.orderDate,
        })),
      ],
    });

    /**
     * The advances, applied as REAL allocations.
     *
     * Setting `amountPaidPaise` alone would make the invoice say "paid" while
     * the receipt still showed its money as unapplied credit - the same figure
     * counted twice, once as a payment and once as money the customer is still
     * owed. These rows are what actually settle it.
     *
     * Oldest receipt first, and each gives only what it still holds. The last
     * one may be used in part, and whatever is left on it stays as credit
     * against the customer's next invoice.
     */
    let remaining = totals.grandTotalPaise;
    const applied: { receiptId: string; invoiceId: string; storeId: string; amountPaise: number; allocatedBy: string }[] = [];
    for (const a of draft.advances) {
      if (remaining <= 0) break;
      const take = Math.min(a.heldPaise, remaining);
      if (take <= 0) continue;
      applied.push({
        receiptId: a.id, invoiceId: invoice.id, storeId, amountPaise: take, allocatedBy: userId,
      });
      remaining -= take;
    }
    if (applied.length > 0) await tx.receiptAllocation.createMany({ data: applied });

    if (challans.length > 0) {
      await tx.installationChallan.updateMany({
        where: { id: { in: challans.map((c) => c.id) }, storeId },
        data: { isInvoiced: true, invoicedAt: input.invoiceDate },
      });
    }

    // The orders are marked billed too, so they stop appearing as work waiting
    // to be invoiced. `invoiceId` points at this bill even though several
    // orders now share it - which is the honest answer to "where was this
    // order billed?" and exactly what the old single column was always for.
    if (orders.length > 0) {
      await tx.salesOrder.updateMany({
        where: { id: { in: orders.map((o) => o.id) }, storeId },
        data: { isInvoiced: true, invoiceId: invoice.id },
      });
    }

    return invoice;
  });
}

/* -------------------------------------------------------------------------- */
/*  Reading the trail back                                                    */
/* -------------------------------------------------------------------------- */

export interface TrailEntry {
  kind: string;
  qty: number;
  docNo: string;
  docDate: Date;
  /** Where pressing it should land. Null when the document has gone. */
  href: string | null;
}

export interface LineTrail {
  invoiceItemId: string;
  productName: string;
  qty: number;
  lineTotalPaise: number;
  entries: TrailEntry[];
  /** The physical units this line sold, where they are known. */
  units: { id: string; serialNo: string | null }[];
}

/**
 * Where every charge on an invoice came from.
 *
 * The caller checks `invoice.costTrail` before asking. This function does not
 * check it itself for the same reason none of the other read functions do -
 * the permission belongs at the action boundary, where the user is - but it is
 * worth saying plainly here, because the data it returns is the one thing on
 * an invoice the customer must never see.
 */
export async function getInvoiceTrail(scope: StoreScope, invoiceId: string): Promise<LineTrail[]> {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, ...scopeWhere(scope) },
    select: {
      id: true,
      items: {
        orderBy: { srNo: 'asc' },
        select: {
          id: true, productId: true, productName: true, qty: true, lineTotalPaise: true,
          sources: {
            orderBy: { docDate: 'asc' },
            select: {
              kind: true, qty: true, docNo: true, docDate: true,
              challanId: true, salesOrderId: true,
            },
          },
        },
      },
      unitsSold: { select: { id: true, serialNo: true, productId: true } },
    },
  });
  if (!invoice) throw new Error('Invoice not found in your scope.');

  return invoice.items.map((item) => ({
    invoiceItemId: item.id,
    productName: item.productName,
    qty: item.qty,
    lineTotalPaise: item.lineTotalPaise,
    /**
     * One row per DOCUMENT, not per source row.
     *
     * A challan that fitted three cameras carries three lines - one per
     * barcode - and storing them separately is right, because each names a
     * different physical unit. Showing them separately is not: the trail then
     * reads "ECHN-0515 (1) ECHN-0515 (1) ECHN-0515 (1)", which tells a reader
     * nothing except that something is repeating. The quantities add up here
     * and the individual units are listed below the line anyway.
     */
    entries: Object.values(
      item.sources.reduce<Record<string, TrailEntry>>((acc, s) => {
        const existing = acc[s.docNo];
        if (existing) { existing.qty += s.qty; return acc; }
        acc[s.docNo] = {
          kind: s.kind,
          qty: s.qty,
          docNo: s.docNo,
          docDate: s.docDate,
          /** Each source opens itself: a sales order its own page (G-34), an
           * installation challan from `?open=` on Installations. */
          href: s.challanId
            ? `/services/installations/${s.challanId}`
            : s.salesOrderId
              ? `/sales/orders/${s.salesOrderId}`
              : null,
        };
        return acc;
      }, {}),
    ),
    // Matched on the product rather than stored per line: a unit knows which
    // invoice sold it (Rule 4), and which LINE of that invoice is not a
    // question anybody asks - "which twelve cameras" is.
    units: invoice.unitsSold
      .filter((u) => item.productId && u.productId === item.productId)
      .map((u) => ({ id: u.id, serialNo: u.serialNo })),
  }));
}
