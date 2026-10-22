import 'server-only';
import type { Prisma } from '@prisma/client';
import { awaitingApproval } from './approvals';
import { resolveSalesperson } from './salesperson';
import { db } from './db';
import { scopeWhere, scopeForWrite, userInScope, type StoreScope } from './store-scope';
import { computeTotals } from '@/lib/quotation-totals';
import { allocateDocumentNumber } from './allocate-document-number';
import { archiveWhere } from './archive';
import { countAttachments } from './attachments';
import { resolveTaxMode } from './gst';
import { applyMovements } from './stock';
import { stockDelta, describeChanges } from '@/lib/line-delta';
import { createReceipt, type ReceiptMethod } from './receipts';
import { REVENUE_ORDER_WHERE, countsAsRevenue } from '@/lib/revenue';
import { publicBrandUrl } from './storage';
import { postJournalEntry, reverseJournalEntry } from './ledger';
import type { LedgerLineInput } from '@/lib/ledger';
import { postCogsMovement } from './cogs';
import { ACCOUNT, splitRevenue } from '@/lib/service-revenue';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { serialsByLine } from '@/lib/invoice-serials';
import {
  amountDuePaise, canCancel, canEdit, canRecordPayment, countByStatus, dueDateFrom,
  invoiceStatus, type InvoiceLifecycle, type InvoiceStatus,
} from '@/lib/invoice-status';

export interface InvoiceRow {
  /** An approval request is open on it (issue / cancel / change held). */
  awaitingApproval: boolean;
  partyId: string | null;
  closedAt: Date | null;
  attachmentCount: number;
  id: string;
  invoiceNo: string;
  orderNo: string | null;
  /** The order it came from, so links open that order (G-27). */
  salesOrderId: string | null;
  customerName: string;
  organizationName: string | null;
  gstin: string | null;
  stateId: string | null;
  phone: string;
  invoiceDate: Date;
  dueDate: Date;
  lifecycle: InvoiceLifecycle;
  status: InvoiceStatus;
  taxableBasePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  grandTotalPaise: number;
  amountPaidPaise: number;
  duePaise: number;
  itemCount: number;
  /** For data reach (B4 step 3) - whose document this is. */
  salespersonId: string | null;
  salespersonName: string | null;
}

/**
 * Every invoice in scope for the view, not a slice - see lib/list-limits.
 *
 * The old 500-row cap made the SUMMARY wrong as well as the list short: the
 * header and the status tiles were computed from the loaded rows, so a store
 * with 3,380 invoices read "500 raised" with tiles adding to exactly 500. The
 * client read that as missing data, which was a reasonable thing to conclude.
 * `summariseAllInvoices` is still here and still separate, because a header
 * that counts the rows it happens to be holding is wrong the moment anything
 * slices them again.
 */
export async function listInvoices(
  scope: StoreScope,
  view: 'active' | 'history' | 'all' = 'active',
  opts: { take?: number } = {},
): Promise<InvoiceRow[]> {
  const [rows, users] = await Promise.all([
    db.invoice.findMany({
      where: { ...scopeWhere(scope), ...archiveWhere(view) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.take ?? LIST_MAX_ROWS, LIST_MAX_ROWS),
      select: {
        id: true, invoiceNo: true, customerName: true, organizationName: true,
        gstin: true, stateId: true, phone: true, invoiceDate: true, dueDate: true,
        lifecycle: true, taxableBasePaise: true, cgstPaise: true, sgstPaise: true,
        igstPaise: true, grandTotalPaise: true, amountPaidPaise: true,
        salespersonId: true, closedAt: true, partyId: true, salesOrderId: true,
        _count: { select: { items: true } },
        salesOrder: { select: { orderNo: true } },
      },
    }),
    db.user.findMany({ where: userInScope(scope), select: { id: true, fullName: true } }),
  ]);

  const name = new Map(users.map((u) => [u.id, u.fullName]));
  const files = await countAttachments(scope, 'invoice', rows.map((r) => r.id));
  const held = await awaitingApproval(scope, rows.map((r) => r.id));

  return rows.map((i) => {
    const like = {
      lifecycle: i.lifecycle as InvoiceLifecycle,
      grandTotalPaise: i.grandTotalPaise,
      amountPaidPaise: i.amountPaidPaise,
      dueDate: i.dueDate,
    };
    return {
      id: i.id,
      partyId: i.partyId,
      closedAt: i.closedAt,
      attachmentCount: files.get(i.id) ?? 0,
      awaitingApproval: held.has(i.id),
      invoiceNo: i.invoiceNo,
      orderNo: i.salesOrder?.orderNo ?? null,
      salesOrderId: i.salesOrderId ?? null,
      customerName: i.customerName,
      organizationName: i.organizationName,
      gstin: i.gstin,
      stateId: i.stateId,
      phone: i.phone,
      invoiceDate: i.invoiceDate,
      dueDate: i.dueDate,
      lifecycle: like.lifecycle,
      status: invoiceStatus(like),
      taxableBasePaise: i.taxableBasePaise,
      cgstPaise: i.cgstPaise,
      sgstPaise: i.sgstPaise,
      igstPaise: i.igstPaise,
      grandTotalPaise: i.grandTotalPaise,
      amountPaidPaise: i.amountPaidPaise,
      duePaise: amountDuePaise(like),
      itemCount: i._count.items,
      salespersonId: i.salespersonId ?? null,
      salespersonName: i.salespersonId ? name.get(i.salespersonId) ?? null : null,
    };
  });
}

export interface InvoiceTotals {
  /** Every invoice in scope for this view, counted independently of the rows. */
  total: number;
  receivablePaise: number;
  overduePaise: number;
  byStatus: Record<InvoiceStatus, number>;
}

/**
 * The real figures for the whole scope, computed independently of the rows.
 *
 * Selects only the four fields the status rule reads, so this is a narrow scan
 * rather than a second full load - 3,380 invoices of four scalars each, against
 * the ~25 columns plus joins the grid needs.
 *
 * Deliberately reuses `countByStatus` and `invoiceStatus` from
 * lib/invoice-status rather than expressing the same rule in SQL. "Overdue"
 * depends on today's date and on how much has been paid; two implementations of
 * that would agree right up until one of them was edited.
 */
export async function summariseAllInvoices(
  scope: StoreScope,
  view: 'active' | 'history' | 'all' = 'active',
): Promise<InvoiceTotals> {
  const rows = await db.invoice.findMany({
    where: { ...scopeWhere(scope), ...archiveWhere(view) },
    select: {
      lifecycle: true, grandTotalPaise: true, amountPaidPaise: true, dueDate: true,
    },
  });

  const now = new Date();
  const like = rows.map((r) => ({
    lifecycle: r.lifecycle as InvoiceLifecycle,
    grandTotalPaise: r.grandTotalPaise,
    amountPaidPaise: r.amountPaidPaise,
    dueDate: r.dueDate,
  }));

  let receivablePaise = 0;
  let overduePaise = 0;
  for (const r of like) {
    const status = invoiceStatus(r, now);
    if (status === 'draft' || status === 'cancelled' || status === 'paid') continue;
    const due = amountDuePaise(r);
    receivablePaise += due;
    if (status === 'overdue') overduePaise += due;
  }

  return {
    total: rows.length,
    receivablePaise,
    overduePaise,
    byStatus: countByStatus(like, now),
  };
}

/**
 * Convert a sales order into a tax invoice.
 *
 * Line items and the buyer snapshot are COPIED, not referenced. A tax invoice
 * is a legal document: once issued, the name, GSTIN and figures on it must not
 * change because somebody later edited a customer record.
 *
 * Totals are recomputed from the copied lines rather than carried across, so an
 * order saved before a totals fix cannot propagate the error into an invoice -
 * and an invoice with the wrong GST on it is a legal problem, not a bug.
 *
 * Payment already received against the order comes with it. The money did not
 * move; only the document it hangs off changed.
 */
export async function convertOrderToInvoice(
  scope: StoreScope,
  salesOrderId: string,
  userId: string,
  opts: { termsDays: number; invoiceDate?: Date },
) {
  const storeId = scopeForWrite(scope);

  const order = await db.salesOrder.findFirst({
    where: { id: salesOrderId, ...scopeWhere(scope) },
    include: { items: { orderBy: { srNo: 'asc' } } },
  });
  if (!order) throw new Error('Order not found in your scope.');
  if (order.isInvoiced) {
    const existing = await db.invoice.findFirst({
      where: { salesOrderId, ...scopeWhere(scope) },
      select: { invoiceNo: true },
    });
    throw new Error(
      existing
        ? `This order is already invoice ${existing.invoiceNo}.`
        : 'This order has already been invoiced.',
    );
  }
  if (!countsAsRevenue(order.fulfilmentStatus)) {
    throw new Error('A cancelled or failed order cannot be invoiced.');
  }
  if (order.items.length === 0) throw new Error('This order has no line items.');
  // Goods that came back unused from an installation are not billed (R2, 22 Oct 2026).
  const items = order.items.map((i) => ({ ...i, qty: i.qty - i.returnedQty })).filter((i) => i.qty > 0);
  if (items.length === 0) throw new Error('Everything on this order came back unused - there is nothing to bill.');

  const totals = computeTotals(
    items.map((i) => ({
      qty: i.qty,
      unitPricePaise: i.unitPricePaise,
      discountPct: Number(i.discountPct),
      taxRatePct: Number(i.taxRatePct),
    })),
    {
      /*
        The order's own answer, carried forward whole - including NONE,
        which the cast here used to throw away (8 Oct 2026). computeTotals
        takes all three, so there was never a reason to narrow it; the cast
        was left over from when there were only two.
      */
      taxMode: order.taxMode as 'CGST_SGST' | 'IGST' | 'NONE',
      discountType: order.discountType as 'amount' | 'percent',
      discountValue: order.discountValue,
      deliveryPaise: order.deliveryCharge,
      deliveryExempt: order.deliveryExempt,
    },
  );

  const invoiceNo = await allocateDocumentNumber(storeId, 'INV');
  const invoiceDate = opts.invoiceDate ?? new Date();

  // Both writes or neither. An invoice without the order marked invoiced
  // invites a second invoice for the same goods.
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        storeId,
        invoiceNo,
        salesOrderId: order.id,
        partyId: order.partyId,
        customerName: order.customerName,
        organizationName: order.organizationName,
        email: order.email,
        phone: order.phone,
        gstin: order.gstin,
        billingAddress: order.billingAddress,
        shippingAddress: order.shippingAddress,
        stateId: order.stateId,
        cityId: order.cityId,
        invoiceDate,
        dueDate: dueDateFrom(invoiceDate, opts.termsDays),
        lifecycle: 'draft',
        salespersonId: order.salespersonId ?? userId,
        deliveryCharge: order.deliveryCharge,
        deliveryExempt: order.deliveryExempt,
        discountType: order.discountType,
        discountValue: order.discountValue,
        subtotalPaise: totals.subtotalPaise,
        itemDiscountPaise: totals.itemDiscountPaise,
        orderDiscountPaise: totals.orderDiscountPaise,
        taxableBasePaise: totals.taxableBasePaise,
        cgstPaise: totals.cgstPaise,
        sgstPaise: totals.sgstPaise,
        igstPaise: totals.igstPaise,
        grandTotalPaise: totals.grandTotalPaise,
        taxMode: order.taxMode,
        // Money already collected against the order carries over. It was
        // received for these goods; only the document changed.
        amountPaidPaise: Math.min(order.amountPaidPaise, totals.grandTotalPaise),
        termsBody: order.termsBody,
        notes: order.notes,
        createdBy: userId,
        items: {
          create: items.map((i, n) => ({
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
            // Carried from the order, which carried it from the quotation.
            // Without this the chain breaks at the last step: a customer who
            // was quoted an AMC and agreed to it on the order would silently
            // lose it on the bill, and no contract would ever be created.
            amcOpted: i.amcOpted,
            amcMonths: i.amcMonths,
            amcPricePaise: i.amcPricePaise,
          })),
        },
      },
    });

    if (order.amountPaidPaise > 0) {
      await tx.invoicePayment.create({
        data: {
          invoiceId: invoice.id,
          storeId,
          amountPaise: Math.min(order.amountPaidPaise, totals.grandTotalPaise),
          method: 'adjustment',
          reference: order.orderNo,
          note: `Carried over from sales order ${order.orderNo}`,
          recordedBy: userId,
        },
      });
    }

    await tx.salesOrder.update({
      where: { id: order.id },
      data: { isInvoiced: true, invoiceId: invoice.id },
    });

    return invoice;
  });
}

/** Draft → sent. The moment it becomes a document in someone else's hands. */
/**
 * The invoice's financial effect, posted once, on issue - never on create.
 * A draft is paperwork; an issued invoice is the moment revenue and the
 * receivable become real.
 *
 * Guarded by looking for an existing entry first rather than a bare insert,
 * so a retry after a failure partway through `issueInvoice` posts once, not
 * twice - the same reason `createBill` checks for a duplicate supplier bill
 * number before it relies on the unique index to catch one.
 */
async function postInvoiceJournal(
  scope: StoreScope,
  inv: {
    id: string; invoiceNo: string; invoiceDate: Date; customerName: string;
    partyId: string | null; taxableBasePaise: number; cgstPaise: number;
    sgstPaise: number; igstPaise: number; grandTotalPaise: number;
  },
  userId: string,
): Promise<void> {
  const already = await db.journalEntry.findFirst({
    where: { ...scopeWhere(scope), sourceType: 'invoice', sourceId: inv.id },
    select: { id: true },
  });
  if (already) return;

  // Income split by what was sold (health check ACC-1): goods to Sales,
  // service-kind products to Service & Repair Income, an AMC fee invoice to
  // AMC Income - or, when the business spreads AMC income, to AMC Received
  // in Advance, released month by month (server/amc-revenue.ts).
  const [items, amcBilled, store] = await Promise.all([
    db.invoiceItem.findMany({ where: { invoiceId: inv.id }, select: { lineTotalPaise: true, productId: true } }),
    db.amcContract.count({ where: { invoiceId: inv.id, ...scopeWhere(scope) } }),
    db.store.findUnique({ where: { id: scopeForWrite(scope) }, select: { organizationId: true } }),
  ]);
  const productIds = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
  const [services, org] = await Promise.all([
    productIds.length
      ? db.product.findMany({ where: { id: { in: productIds }, kind: 'service', ...scopeWhere(scope) }, select: { id: true } })
      : Promise.resolve([]),
    store ? db.organization.findUnique({ where: { id: store.organizationId }, select: { amcRevenueMode: true } }) : Promise.resolve(null),
  ]);
  const isService = new Set(services.map((p) => p.id));
  const amcAccount = org?.amcRevenueMode === 'at_invoice' ? ACCOUNT.amcIncome : ACCOUNT.amcAdvance;
  const revenue = splitRevenue(
    items.map((i) => ({
      account: amcBilled > 0 ? amcAccount : i.productId && isService.has(i.productId) ? ACCOUNT.serviceIncome : ACCOUNT.sales,
      weightPaise: i.lineTotalPaise,
    })),
    inv.taxableBasePaise,
    amcBilled > 0 ? amcAccount : ACCOUNT.sales,
  );

  const lines: LedgerLineInput[] = [
    { accountCode: '1100', debitPaise: inv.grandTotalPaise, partyId: inv.partyId, description: inv.customerName },
    ...[...revenue].filter(([, p]) => p !== 0).map(([accountCode, creditPaise]) => ({ accountCode, creditPaise })),
  ];
  if (inv.cgstPaise > 0) lines.push({ accountCode: '2210', creditPaise: inv.cgstPaise });
  if (inv.sgstPaise > 0) lines.push({ accountCode: '2220', creditPaise: inv.sgstPaise });
  if (inv.igstPaise > 0) lines.push({ accountCode: '2230', creditPaise: inv.igstPaise });

  await postJournalEntry(scope, {
    entryDate: inv.invoiceDate,
    description: `Invoice ${inv.invoiceNo} - ${inv.customerName}`,
    sourceType: 'invoice',
    sourceId: inv.id,
    lines,
  }, userId);
}

export async function issueInvoice(scope: StoreScope, id: string, userId: string) {
  const inv = await db.invoice.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      id: true, lifecycle: true, invoiceNo: true, storeId: true, grandTotalPaise: true,
      taxableBasePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true,
      partyId: true, invoiceDate: true, customerName: true,
    },
  });
  if (!inv) throw new Error('Invoice not found in your scope.');
  if (inv.lifecycle !== 'draft') throw new Error('This invoice has already been issued.');
  if (inv.grandTotalPaise <= 0) {
    throw new Error('An invoice for zero cannot be issued. Add line items first.');
  }

  // Posted BEFORE the lifecycle flips, on purpose: if this throws (a locked
  // period, say), the invoice stays a draft - unchanged and safe - rather
  // than becoming "sent" with no ledger entry behind it.
  await postInvoiceJournal(scope, inv, userId);

  return db.invoice.update({
    where: { id },
    data: { lifecycle: 'sent', sentAt: new Date() },
  });
}

export async function cancelInvoice(scope: StoreScope, id: string, reason: string, userId: string) {
  const inv = await db.invoice.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      id: true, lifecycle: true, invoiceNo: true, storeId: true,
      grandTotalPaise: true, amountPaidPaise: true, dueDate: true,
      salesOrderId: true,
    },
  });
  if (!inv) throw new Error('Invoice not found in your scope.');

  if (!canCancel({
    lifecycle: inv.lifecycle as InvoiceLifecycle,
    grandTotalPaise: inv.grandTotalPaise,
    amountPaidPaise: inv.amountPaidPaise,
    dueDate: inv.dueDate,
  })) {
    throw new Error(
      inv.amountPaidPaise > 0
        ? 'Money has been received against this invoice. Raise a credit note instead of cancelling it.'
        : 'This invoice is already cancelled.',
    );
  }

  // Reversed BEFORE the lifecycle flips, same reasoning as `issueInvoice` in
  // reverse: if this throws, the invoice stays "sent" with its original
  // entry still standing, rather than "cancelled" with revenue still live
  // in the ledger.
  const entry = await db.journalEntry.findFirst({
    where: { ...scopeWhere(scope), sourceType: 'invoice', sourceId: id, reversalOfId: null },
    select: { id: true },
  });
  if (entry) {
    await reverseJournalEntry(scope, entry.id, userId, `Invoice ${inv.invoiceNo} cancelled: ${reason}`);
  }

  // Cancelling frees the order to be invoiced again - otherwise a mistyped
  // invoice would strand the order forever.
  return db.$transaction(async (tx) => {
    const updated = await tx.invoice.update({
      where: { id },
      data: { lifecycle: 'cancelled', cancelledAt: new Date(), cancelReason: reason },
    });
    if (inv.salesOrderId) {
      await tx.salesOrder.update({
        where: { id: inv.salesOrderId },
        data: { isInvoiced: false, invoiceId: null },
      });
    }

    /**
     * A "Bill a site" invoice covers several challans and orders, recorded as
     * InvoiceSource rows (3 Oct 2026). Cancelling used to free only the one
     * `salesOrderId` above, so every challan on a cancelled site bill stayed
     * marked billed and never came back to "Bill a site" - the bill could not
     * be raised again. The InvoiceSource rows themselves stay, as history;
     * `assertNotAlreadyBilled` only counts live invoices.
     */
    const sources = await tx.invoiceSource.findMany({
      where: { invoiceId: id },
      select: { challanId: true, salesOrderId: true },
    });
    const challanIds = sources.map((s) => s.challanId).filter((x): x is string => !!x);
    const orderIds = sources.map((s) => s.salesOrderId).filter((x): x is string => !!x);
    if (challanIds.length > 0) {
      await tx.installationChallan.updateMany({
        where: { id: { in: challanIds }, storeId: inv.storeId },
        data: { isInvoiced: false, invoicedAt: null },
      });
    }
    if (orderIds.length > 0) {
      await tx.salesOrder.updateMany({
        where: { id: { in: orderIds }, storeId: inv.storeId, invoiceId: id },
        data: { isInvoiced: false, invoiceId: null },
      });
    }
    return updated;
  });
}

/**
 * Record money received against one invoice.
 *
 * Now a thin front for `createReceipt`: it writes a real receipt and applies
 * all of it to this invoice, which is exactly what the old single-invoice
 * payment meant. Kept as its own function because "take a payment on this
 * invoice" is a real thing people do from the invoice screen, and making them
 * go to a receipts screen to do it would be worse.
 *
 * Everything general - advances, one cheque across several invoices, TDS -
 * belongs on the receipt screen, not here. This deliberately stays narrow.
 */
export async function recordPayment(
  scope: StoreScope,
  id: string,
  input: { amountPaise: number; method: string; reference?: string | null; note?: string | null },
  userId: string,
) {
  if (input.amountPaise <= 0) throw new Error('Enter an amount greater than zero.');

  const inv = await db.invoice.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      id: true, storeId: true, invoiceNo: true, lifecycle: true,
      grandTotalPaise: true, amountPaidPaise: true, dueDate: true, partyId: true,
    },
  });
  if (!inv) throw new Error('Invoice not found in your scope.');

  const like = {
    lifecycle: inv.lifecycle as InvoiceLifecycle,
    grandTotalPaise: inv.grandTotalPaise,
    amountPaidPaise: inv.amountPaidPaise,
    dueDate: inv.dueDate,
  };

  if (!canRecordPayment(like)) {
    throw new Error(
      inv.lifecycle === 'draft'
        ? 'Issue the invoice before recording a payment against it.'
        : inv.lifecycle === 'cancelled'
          ? 'This invoice is cancelled.'
          : 'This invoice is already settled.',
    );
  }

  const due = amountDuePaise(like);
  if (input.amountPaise > due) {
    throw new Error(
      `That is more than the outstanding amount. Only ₹${(due / 100).toLocaleString('en-IN')} is due.`,
    );
  }

  // An invoice with no customer record has nowhere to hang a receipt - a
  // receipt belongs to somebody, and that is the point of the new model rather
  // than a limitation of it. Walk-in billing needs a party for cash sales, and
  // until it has one this is refused rather than half-recorded.
  if (!inv.partyId) {
    throw new Error(
      `${inv.invoiceNo} is not linked to a customer record, so a receipt cannot be recorded against it.`
      + ' Attach a customer to the invoice first.',
    );
  }

  await createReceipt(
    scope,
    {
      partyId: inv.partyId,
      amountPaise: input.amountPaise,
      method: input.method as ReceiptMethod,
      reference: input.reference ?? null,
      note: input.note ?? null,
      // Explicitly this invoice, not auto-allocated. Somebody standing on the
      // invoice screen taking a payment means it for this bill, even if an
      // older one is outstanding - quietly settling the older one instead
      // would be the software overruling them.
      allocations: [{ invoiceId: id, amountPaise: input.amountPaise }],
    },
    userId,
  );

  return db.invoice.findFirstOrThrow({ where: { id, ...scopeWhere(scope) } });
}

export interface InvoiceDetail {
  id: string;
  invoiceNo: string;
  orderNo: string | null;
  /** The order it came from, so links open that order (G-27). */
  salesOrderId: string | null;
  lifecycle: InvoiceLifecycle;
  status: InvoiceStatus;
  invoiceDate: Date;
  dueDate: Date;
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
  /** Needed by the edit form, which reopens this invoice in the create form. */
  version: number;
  poNumber: string | null;
  deliveryExempt: boolean;
  discountType: string;
  discountValue: number;
  notes: string | null;
  items: {
    srNo: number; productId: string | null;
    productName: string; productCode: string | null; hsnCode: string | null;
    qty: number; unitPricePaise: number; discountPct: number;
    taxRatePct: number; lineTotalPaise: number;
    /**
     * The AMC sold on this line, as agreed. Carried so reopening a draft in
     * the edit form does not silently drop the AMC the customer asked for.
     */
    amcOpted: boolean; amcMonths: number | null; amcPricePaise: number | null;
    /** Serials sold on this line (15 Oct 2026) - printed under the product, on the customer's link too. */
    serials: string[];
  }[];
  payments: {
    id: string; amountPaise: number; paidAt: Date; method: string;
    reference: string | null; note: string | null; byName: string | null;
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
  duePaise: number;
  termsBody: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  canEdit: boolean;
  irn: string | null;
  org: {
    name: string; gstin: string | null; email: string | null;
    mobile: string | null; logoUrl: string | null; sealUrl: string | null;
    paymentQrUrl: string | null; paymentLink: string | null;
  };
  storeName: string;
  storeAddress: string | null;
  storeStateId: string | null;
}

const DETAIL_INCLUDE = {
  items: { orderBy: { srNo: 'asc' } },
  payments: { orderBy: { paidAt: 'desc' } },
  store: { include: { organization: true } },
  salesOrder: { select: { orderNo: true } },
  unitsSold: {
    where: { deletedAt: null, serialNo: { not: null } },
    select: { productId: true, serialNo: true },
    orderBy: { serialNo: 'asc' },
  },
} satisfies Prisma.InvoiceInclude;

type DetailRow = Prisma.InvoiceGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export async function getInvoiceDetail(
  scope: StoreScope, id: string,
): Promise<InvoiceDetail | null> {
  const i = await db.invoice.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: DETAIL_INCLUDE,
  });
  if (!i) return null;

  const [users, receiptAllocs, creditAllocs] = await Promise.all([
    db.user.findMany({ where: userInScope(scope), select: { id: true, fullName: true } }),
    db.receiptAllocation.findMany({
      where: { invoiceId: id, ...scopeWhere(scope), receipt: { status: 'received' } },
      select: {
        id: true, amountPaise: true, allocatedBy: true,
        receipt: { select: { receiptNo: true, receivedAt: true, method: true, reference: true, recordedBy: true } },
      },
    }),
    db.creditNoteAllocation.findMany({
      where: { invoiceId: id, ...scopeWhere(scope), creditNote: { lifecycle: 'issued' } },
      select: {
        id: true, amountPaise: true, allocatedBy: true,
        creditNote: { select: { creditNoteNo: true, creditNoteDate: true } },
      },
    }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  const d = toDetail(i, name);

  // What was received, as receipts and credit notes set against this invoice
  // (11 Oct 2026). `InvoicePayment` stopped being where money is recorded when
  // payments moved to receipts, so a fully paid invoice listed "Nothing
  // received yet" under a Received figure of the whole amount. These are the
  // same rows `amountPaidPaise` is summed from (server/settlement.ts), so the
  // list now adds up to the figure above it.
  const payments: InvoiceDetail['payments'] = [
    ...receiptAllocs.map((a) => ({
      id: a.id, amountPaise: a.amountPaise, paidAt: a.receipt.receivedAt, method: a.receipt.method,
      reference: a.receipt.reference, note: `Receipt ${a.receipt.receiptNo}`,
      byName: name.get(a.receipt.recordedBy ?? a.allocatedBy ?? '') ?? null,
    })),
    ...creditAllocs.map((a) => ({
      id: a.id, amountPaise: a.amountPaise, paidAt: a.creditNote.creditNoteDate, method: 'credit_note',
      reference: null, note: `Credit note ${a.creditNote.creditNoteNo}`,
      byName: a.allocatedBy ? name.get(a.allocatedBy) ?? null : null,
    })),
  ].sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());

  return { ...d, payments };
}

/**
 * Mint the customer's no-login link for an issued invoice (6 Oct 2026).
 *
 * WhatsApp's wa.me link carries text only, so "Send WhatsApp" used to send a
 * line with the amount and nothing the customer could open. The link is the
 * invoice itself, the same way a quotation goes out as /q/<token>.
 *
 * A draft has no link: it is not a bill yet, and an approval may still be
 * holding its issue.
 */
export async function ensureInvoiceShareToken(scope: StoreScope, id: string): Promise<string> {
  const i = await db.invoice.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: { id: true, lifecycle: true, publicToken: true },
  });
  if (!i) throw new Error('Invoice not found in your scope.');
  if (i.lifecycle === 'draft') throw new InvoiceShareError('Issue the invoice first - a draft cannot be sent to the customer.');
  if (i.publicToken) return i.publicToken;

  const { randomBytes } = await import('node:crypto');
  const token = randomBytes(24).toString('base64url');
  await db.invoice.update({ where: { id }, data: { publicToken: token } });
  return token;
}

/** A refusal worth showing the person as it is (not a crash). */
export class InvoiceShareError extends Error {}

/**
 * Public read by token. No scope - the token IS the credential. Drafts never
 * show, even with a token. Payments and the edit flags are left out: the
 * customer sees what was billed, received and is still due, nothing more.
 */
export async function getInvoiceByToken(token: string): Promise<InvoiceDetail | null> {
  if (!token || token.length < 20) return null;
  const i = await db.invoice.findUnique({ where: { publicToken: token }, include: DETAIL_INCLUDE });
  if (!i || i.lifecycle === 'draft') return null;

  const sp = i.salespersonId
    ? await db.user.findUnique({ where: { id: i.salespersonId }, select: { id: true, fullName: true } })
    : null;
  const d = toDetail(i, new Map(sp ? [[sp.id, sp.fullName]] : []));
  return { ...d, payments: [], notes: null, canEdit: false };
}

function toDetail(i: DetailRow, name: Map<string, string>): InvoiceDetail {
  const like = {
    lifecycle: i.lifecycle as InvoiceLifecycle,
    grandTotalPaise: i.grandTotalPaise,
    amountPaidPaise: i.amountPaidPaise,
    dueDate: i.dueDate,
  };

  return {
    id: i.id,
    invoiceNo: i.invoiceNo,
    orderNo: i.salesOrder?.orderNo ?? null,
      salesOrderId: i.salesOrderId ?? null,
    lifecycle: like.lifecycle,
    status: invoiceStatus(like),
    invoiceDate: i.invoiceDate,
    dueDate: i.dueDate,
    partyId: i.partyId,
    customerName: i.customerName,
    organizationName: i.organizationName,
    email: i.email,
    phone: i.phone,
    gstin: i.gstin,
    billingAddress: i.billingAddress,
    shippingAddress: i.shippingAddress,
    stateId: i.stateId,
    cityId: i.cityId,
    taxMode: i.taxMode,
    version: i.version,
    poNumber: i.poNumber,
    deliveryExempt: i.deliveryExempt,
    notes: i.notes,
    discountType: i.discountType,
    discountValue: i.discountValue,
    items: (() => {
      const serials = serialsByLine(i.items.map((x) => ({ productId: x.productId, qty: Number(x.qty) })), i.unitsSold);
      return i.items.map((x, n) => ({
        srNo: x.srNo, productId: x.productId,
        productName: x.productName, productCode: x.productCode,
        hsnCode: x.hsnCode, qty: x.qty, unitPricePaise: x.unitPricePaise,
        discountPct: Number(x.discountPct), taxRatePct: Number(x.taxRatePct),
        lineTotalPaise: x.lineTotalPaise,
        amcOpted: x.amcOpted, amcMonths: x.amcMonths, amcPricePaise: x.amcPricePaise,
        serials: serials[n],
      }));
    })(),
    payments: i.payments.map((p) => ({
      id: p.id, amountPaise: p.amountPaise, paidAt: p.paidAt, method: p.method,
      reference: p.reference, note: p.note,
      byName: p.recordedBy ? name.get(p.recordedBy) ?? null : null,
    })),
    subtotalPaise: i.subtotalPaise,
    itemDiscountPaise: i.itemDiscountPaise,
    orderDiscountPaise: i.orderDiscountPaise,
    taxableBasePaise: i.taxableBasePaise,
    cgstPaise: i.cgstPaise,
    sgstPaise: i.sgstPaise,
    igstPaise: i.igstPaise,
    deliveryCharge: i.deliveryExempt ? 0 : i.deliveryCharge,
    grandTotalPaise: i.grandTotalPaise,
    amountPaidPaise: i.amountPaidPaise,
    duePaise: amountDuePaise(like),
    termsBody: i.termsBody,
    salespersonId: i.salespersonId,
    salespersonName: i.salespersonId ? name.get(i.salespersonId) ?? null : null,
    canEdit: canEdit(like),
    irn: i.irn,
    org: {
      name: i.store.organization.name,
      gstin: i.store.organization.gstin,
      email: i.store.organization.email,
      mobile: i.store.organization.mobile,
      logoUrl: publicBrandUrl(i.store.organization.logoPath),
      sealUrl: publicBrandUrl(i.store.organization.sealPath),
      paymentQrUrl: publicBrandUrl(i.store.organization.paymentQrPath),
      paymentLink: i.store.organization.paymentLink,
    },
    storeName: i.store.name,
    storeAddress: i.store.address,
    storeStateId: i.store.stateId,
  };
}

/** Orders eligible to become an invoice, for the convert picker. */
export async function listInvoiceableOrders(scope: StoreScope) {
  return db.salesOrder.findMany({
    where: {
      ...scopeWhere(scope),
      isInvoiced: false,
      ...REVENUE_ORDER_WHERE,
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
    select: {
      id: true, orderNo: true, customerName: true, organizationName: true,
      grandTotalPaise: true, amountPaidPaise: true, fulfilmentStatus: true,
      orderDate: true, partyId: true,
    },
  });
}

/* ------------------------------------------------------------------------ */

export interface DirectInvoiceLine {
  productId: string | null;
  productName: string;
  productCode: string | null;
  qty: number;
  unitPricePaise: number;
  discountPct: number;
  taxRatePct: number;

  /**
   * The HSN (goods) or SAC (services) this line is billed under.
   *
   * Optional because the line-item editor does not collect it yet - it is read
   * off the product, and `InvoiceItem.hsnCode` has been nullable and unset
   * since this function was written. The AMC billing invoice is the first
   * caller with a code of its own to declare, and a service line with no SAC
   * on it is exactly what a GST return gets queried for, so the field exists
   * here rather than being worked around at the call site.
   */
  hsnCode?: string | null;

  /**
   * The AMC sold on this line, if any.
   *
   * Optional so the callers that have nothing to do with AMC - the AMC billing
   * invoice itself, tests, an order conversion - do not each have to pass three
   * nulls. Absent reads as no AMC.
   *
   * These never touch `computeTotals`: an extra-cost AMC is billed on its own
   * separate invoice, so folding it into this invoice would charge twice and
   * overstate the GST on the goods.
   */
  amcOpted?: boolean;
  amcMonths?: number | null;
  amcPricePaise?: number | null;

  /**
   * THE SERIALS SOLD (10 Oct 2026, live test 9 Oct). For a serial product, the
   * exact units the customer takes, ticked on the form. Without them stock
   * still binds oldest-first - which is how a customer ended up "owning"
   * serials that were never in their box.
   */
  stockUnitIds?: string[];
}

export interface DirectInvoiceInput {
  /**
   * GST switched OFF on this document (Vcare, 7 Oct 2026).
   *
   * Sent as an INTENT, not as a tax mode: the client says "no GST on this
   * one" and the server still decides what that means. The alternative - the
   * browser posting `taxMode` directly - would let a crafted request pick
   * CGST on an inter-state sale, which is a tax error somebody signs.
   *
   * Absent reads as false, so every existing caller keeps charging GST.
   */
  noGst?: boolean;
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
  invoiceDate: Date;
  termsDays: number;
  poNumber: string | null;
  deliveryCharge: number;
  deliveryExempt: boolean;
  discountType: 'amount' | 'percent';
  discountValue: number;
  termsBody: string | null;
  notes: string | null;
  /** Chosen on the form; absent = the creator (new) or unchanged (edit). */
  salespersonId?: string | null;
  lines: DirectInvoiceLine[];
}

/**
 * An invoice raised without a sales order behind it.
 *
 * The counter sale. Someone walks in, pays, and leaves with the goods - making
 * them wait while a quotation becomes an order becomes an invoice is ceremony
 * that helps nobody.
 *
 * Two things this does that the conversion path does not have to:
 *
 * 1. It resolves the tax mode itself, from the buyer's state against the
 *    store's. The conversion path inherits whatever the order decided, which is
 *    right - the tax was settled when the order was taken.
 *
 * 2. It moves stock immediately. A counter sale hands over goods at the moment
 *    of billing; there is no dispatch step coming later to do it.
 */
export async function createDirectInvoice(
  scope: StoreScope,
  input: DirectInvoiceInput,
  userId: string,
  /**
   * A number a phone gave offline from its own block (13 Oct 2026, F-13 Q3) -
   * already checked by server/phone-numbers `claimPhoneNumber`. Absent: the
   * branch's next number, as always.
   */
  opts: { presetInvoiceNo?: string } = {},
) {
  const storeId = scopeForWrite(scope);

  if (input.lines.length === 0) throw new Error('Add at least one line before saving.');
  if (!input.customerName.trim()) throw new Error('The customer name is required.');
  if (input.lines.some((l) => !l.productName.trim())) {
    throw new Error('Every line needs a product name.');
  }
  if (input.lines.some((l) => l.qty <= 0)) {
    throw new Error('Quantity must be more than zero on every line.');
  }
  // Serials ticked on the form must be on this branch's shelf, of that product, once each.
  for (const l of input.lines) {
    const ids = l.stockUnitIds ?? [];
    if (!ids.length) continue;
    if (!l.productId) throw new Error(`${l.productName}: serials can only be picked for a product.`);
    if (new Set(ids).size !== ids.length) throw new Error(`${l.productName}: the same serial is picked twice.`);
    if (ids.length > l.qty) throw new Error(`${l.productName}: ${ids.length} serials picked for a quantity of ${l.qty}.`);
    const ok = await db.stockUnit.count({ where: { id: { in: ids }, storeId, productId: l.productId, status: { in: ['in_stock', 'reserved'] }, deletedAt: null } });
    if (ok !== ids.length) throw new Error(`${l.productName}: a serial picked is not in stock any more - pick again.`);
  }
  const allPicked = input.lines.flatMap((l) => l.stockUnitIds ?? []);
  if (new Set(allPicked).size !== allPicked.length) throw new Error('The same serial is picked on two lines.');

  /**
   * NONE when the person switched GST off, otherwise the two states decide.
   * The toggle can only ever REMOVE tax - it cannot pick the wrong one.
   */
  /**
   * The branch's STATE against the customer's (13 Oct 2026). This passed the
   * branch's id, which never equals a state code - so every such invoice came
   * out IGST, even for a customer in the same state (since 14 Aug 2026).
   */
  const storeState = (await db.store.findUnique({ where: { id: storeId }, select: { stateId: true } }))?.stateId ?? '';
  const taxMode = input.noGst ? 'NONE' as const : resolveTaxMode(storeState, input.stateId);

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
      deliveryPaise: input.deliveryCharge,
      deliveryExempt: input.deliveryExempt,
    },
  );

  const salespersonId = await resolveSalesperson(storeId, input.salespersonId, userId);
  const invoiceNo = opts.presetInvoiceNo ?? await allocateDocumentNumber(storeId, 'INV');

  const created = await db.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        storeId,
        invoiceNo,
        salesOrderId: null,
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
        invoiceDate: input.invoiceDate,
        dueDate: dueDateFrom(input.invoiceDate, input.termsDays),
        lifecycle: 'draft',
        salespersonId,
        deliveryCharge: input.deliveryCharge,
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
        amountPaidPaise: 0,
        poNumber: input.poNumber,
        termsBody: input.termsBody,
        notes: input.notes,
        createdBy: userId,
        items: {
          create: input.lines.map((l, n) => ({
            srNo: n + 1,
            productId: l.productId,
            productName: l.productName.trim(),
            productCode: l.productCode,
            hsnCode: l.hsnCode ?? null,
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

    // Stock leaves now, in the same transaction. If the invoice rolls back the
    // stock movement rolls back with it - the two can never disagree.
    const stocked = input.lines.filter((l) => l.productId);
    if (stocked.length > 0) {
      await applyMovements(
        tx,
        storeId,
        userId,
        stocked.map((l) => ({
          productId: l.productId as string,
          qty: -l.qty,
          reason: 'counter_sale' as const,
          refType: 'invoice',
          refId: invoice.id,
          refNo: invoiceNo,
          note: `Counter sale ${invoiceNo}`,
          /**
           * RULE 4 - which physical items this invoice sold (3 Oct 2026).
           *
           * This file had ZERO references to `StockUnit` before today, which is
           * why not one of the 2,775 units on record carried its sale.
           * `applyMovements` now binds them, oldest stock first, and writes the
           * unit's own history event. `partyId` can be null for a genuine
           * walk-in; then nothing is bound and the movement note says so,
           * rather than a unit claiming a customer who does not exist.
           */
          partyId: input.partyId,
          invoiceId: invoice.id,
          // The units ticked on the form; none ticked binds oldest-first as before.
          ...(l.stockUnitIds?.length ? { stockUnitIds: l.stockUnitIds } : {}),
        })),
      );
    }

    return invoice;
  });

  // COGS follows stock, not revenue: a direct invoice moves stock at
  // creation (above), well before it may ever be issued, so the cost
  // leaves with it - not later, when somebody gets around to pressing
  // Issue. Posted after the transaction, since it needs the invoice's own
  // id as its source; `postCogsMovement`'s own guard means a retry that
  // somehow reaches this again for the same invoice id posts nothing twice.
  const stockedLines = input.lines.filter((l): l is DirectInvoiceLine & { productId: string } => !!l.productId);
  if (stockedLines.length > 0) {
    await postCogsMovement(scope, {
      direction: 'out',
      entryDate: input.invoiceDate,
      description: `Counter sale ${created.invoiceNo}`,
      sourceId: created.id,
      lines: stockedLines.map((l) => ({ productId: l.productId, qty: l.qty })),
    }, userId);
  }

  return created;
}

/* ------------------------------------------------------------------------ */

export interface EditInvoiceInput {
  customerName: string;
  organizationName: string | null;
  email: string | null;
  phone: string;
  gstin: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  stateId: string | null;
  cityId: string | null;
  invoiceDate: Date;
  termsDays: number;
  poNumber: string | null;
  deliveryCharge: number;
  deliveryExempt: boolean;
  discountType: 'amount' | 'percent';
  discountValue: number;
  termsBody: string | null;
  notes: string | null;
  /** Chosen on the form; absent = the creator (new) or unchanged (edit). */
  salespersonId?: string | null;
  lines: DirectInvoiceLine[];
  /** Why it is being changed. Required - see the note below. */
  reason: string;
  /**
   * The GST switch on the edit form (9 Oct 2026). Before this the edit path
   * never asked: it re-resolved CGST/IGST from the state every time, so a
   * no-GST invoice came back from an edit charging 18% the screen never
   * showed. Absent = keep whatever the invoice already had, so an edit held
   * for approval before this field existed replays without changing tax.
   */
  noGst?: boolean;
}

/**
 * Correct an invoice that has already been issued.
 *
 * The reason this exists, stated plainly because it goes against the usual
 * rule: in a trading business a bill gets corrected the same day it is written,
 * long before it is filed with GST. Refusing every correction means the shop
 * keeps a second set of numbers in a diary, which is worse than letting the
 * software hold the truth.
 *
 * The rule it replaces is not abandoned, only moved. What must not happen is a
 * silent change, so:
 *
 *  - **A reason is required.** An edit with no reason cannot be told apart from
 *    someone quietly moving a number.
 *  - **Every version is kept**, append-only, with the old lines snapshotted.
 *    The revision row is the only thing that remembers what the invoice used to
 *    say, because the lines themselves are replaced.
 *  - **It cannot go below what has been paid.** Reducing an invoice under the
 *    money already received turns the customer into a creditor by accident, and
 *    the honest instrument for that is a credit note.
 *  - **Stock moves by the difference**, never by the new quantity - see
 *    `stockDelta`. Moving the full amount again would double-count.
 *
 * Everything happens in one transaction. A half-applied edit - new lines, old
 * stock - is worse than a refused one.
 *
 * Spec: 07-invoicing.md §6
 */
export async function editIssuedInvoice(
  scope: StoreScope,
  id: string,
  input: EditInvoiceInput,
  userId: string,
) {
  const storeId = scopeForWrite(scope);

  if (!input.reason.trim()) {
    throw new Error('Say why this invoice is being changed. It goes on the record.');
  }
  if (input.lines.length === 0) throw new Error('An invoice needs at least one line.');
  if (input.lines.some((l) => !l.productName.trim())) {
    throw new Error('Every line needs a product name.');
  }
  if (input.lines.some((l) => l.qty <= 0)) {
    throw new Error('Quantity must be more than zero on every line.');
  }

  const existing = await db.invoice.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: { items: { orderBy: { srNo: 'asc' } } },
  });
  if (!existing) throw new Error('Invoice not found in your scope.');
  const salespersonId = await resolveSalesperson(storeId, input.salespersonId, existing.salespersonId);
  if (existing.lifecycle === 'cancelled') {
    throw new Error(
      `${existing.invoiceNo} has been cancelled. A cancelled invoice is a closed record - raise a new one.`,
    );
  }

  const noGst = input.noGst ?? existing.taxMode === 'NONE';
  /**
   * The branch's STATE against the customer's (13 Oct 2026). This passed the
   * branch's id, which never equals a state code - so every such invoice came
   * out IGST, even for a customer in the same state (since 14 Aug 2026).
   */
  const storeState = (await db.store.findUnique({ where: { id: storeId }, select: { stateId: true } }))?.stateId ?? '';
  const taxMode = noGst ? 'NONE' as const : resolveTaxMode(storeState, input.stateId);

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
      deliveryPaise: input.deliveryCharge,
      deliveryExempt: input.deliveryExempt,
    },
  );

  // Checked before anything is written. Letting the edit through and then
  // "fixing" the paid figure would silently rewrite a payment that actually
  // happened.
  if (totals.grandTotalPaise < existing.amountPaidPaise) {
    throw new Error(
      `${existing.invoiceNo} already has ₹${(existing.amountPaidPaise / 100).toLocaleString('en-IN')} paid against it.`
      + ` The new total of ₹${(totals.grandTotalPaise / 100).toLocaleString('en-IN')} is less than that.`
      + ' Reducing an invoice below what has been received turns the customer into a creditor -'
      + ' raise a credit note for the difference instead.',
    );
  }

  const beforeLines = existing.items.map((i) => ({
    productId: i.productId,
    productName: i.productName,
    productCode: i.productCode,
    qty: i.qty,
    unitPricePaise: i.unitPricePaise,
    discountPct: Number(i.discountPct),
    taxRatePct: Number(i.taxRatePct),
  }));

  const movements = stockDelta(beforeLines, input.lines);
  const changes = describeChanges(
    { lines: beforeLines, grandTotalPaise: existing.grandTotalPaise },
    { lines: input.lines, grandTotalPaise: totals.grandTotalPaise },
  );

  const nextVersion = existing.version + 1;

  return db.$transaction(async (tx) => {
    // Claim the version before touching anything else.
    //
    // `existing` was read outside this transaction, so between that read and
    // here somebody else may have edited the same invoice. Both edits would
    // compute their stock delta from the same starting quantities and both
    // would apply it - the shelf moves twice for one correction, and nothing
    // on screen looks wrong.
    //
    // This is not theoretical: two people share one admin login in most shops,
    // and an invoice open in two tabs is the normal way that happens.
    //
    // The guard is the `where` clause. Postgres locks the row for the first
    // writer; the second blocks, re-reads after the commit, finds the version
    // has moved on, and matches nothing. `count === 0` is that second writer.
    // `storeId` is redundant - `existing` was already fetched with scopeWhere -
    // but it costs one clause and means this line needs no reasoning about its
    // caller to be read as safe.
    const claimed = await tx.invoice.updateMany({
      where: { id: existing.id, storeId, version: existing.version },
      data: { version: nextVersion },
    });
    if (claimed.count === 0) {
      throw new Error(
        `${existing.invoiceNo} was changed by someone else while you had it open.`
        + ' Nothing has been saved. Reload the invoice to see the current version,'
        + ' then make your change again - saving now would apply your edit on top'
        + ' of theirs and move stock twice.',
      );
    }

    // The history first. If anything below fails the whole transaction rolls
    // back, but writing the record first means there is no ordering in which
    // the invoice changes and the record does not.
    await tx.invoiceRevision.create({
      data: {
        invoiceId: existing.id,
        storeId,
        version: nextVersion,
        reason: input.reason.trim(),
        changes,
        beforeGrandTotalPaise: existing.grandTotalPaise,
        afterGrandTotalPaise: totals.grandTotalPaise,
        beforeLineCount: existing.items.length,
        afterLineCount: input.lines.length,
        beforeLines,
        changedBy: userId,
      },
    });

    // Lines are replaced wholesale rather than diffed. An invoice line has no
    // identity a user would recognise - they think in terms of "the invoice
    // now says this", not "line 3 was amended".
    await tx.invoiceItem.deleteMany({ where: { invoiceId: existing.id } });

    const updated = await tx.invoice.update({
      where: { id: existing.id },
      data: {
        customerName: input.customerName.trim(),
        organizationName: input.organizationName,
        email: input.email,
        phone: input.phone,
        gstin: input.gstin,
        billingAddress: input.billingAddress,
        shippingAddress: input.shippingAddress ?? input.billingAddress,
        stateId: input.stateId,
        cityId: input.cityId,
        invoiceDate: input.invoiceDate,
        dueDate: dueDateFrom(input.invoiceDate, input.termsDays),
        salespersonId,
        poNumber: input.poNumber,
        deliveryCharge: input.deliveryCharge,
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
        // `version` is deliberately absent - the guarded updateMany above has
        // already set it. Setting it twice would work, but it would hide which
        // statement is the one holding the lock.
        items: {
          create: input.lines.map((l, n) => ({
            srNo: n + 1,
            productId: l.productId,
            productName: l.productName.trim(),
            productCode: l.productCode,
            hsnCode: l.hsnCode ?? null,
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

    // The difference only. The original issue already took the first quantity
    // out; moving the new quantity again would count it twice.
    if (movements.length > 0) {
      await applyMovements(
        tx,
        storeId,
        userId,
        movements.map((m) => ({
          productId: m.productId,
          qty: m.qty,
          reason: 'adjustment' as const,
          refType: 'invoice',
          refId: existing.id,
          refNo: existing.invoiceNo,
          note: `Invoice edited to v${nextVersion} - qty ${m.oldQty} → ${m.newQty}. ${input.reason.trim()}`,
          /**
           * An edit is the one `adjustment` whose destination IS known, and it
           * runs in both directions: raising the quantity sends more items to
           * the same customer, lowering it brings some back. Stated explicitly
           * because `adjustment` deliberately binds nothing by default - the
           * other caller of that reason is a stock count, where the right
           * answer is `lost`, and guessing between the two would mark real
           * units lost on an ordinary invoice edit.
           */
          unitDestination: 'customer' as const,
          partyId: existing.partyId,
          invoiceId: existing.id,
          returnFromInvoiceId: existing.id,
        })),
      );
    }

    return updated;
  });
}

export interface RevisionRow {
  id: string;
  /** 2 is the first correction - version 1 is the invoice as issued. */
  version: number;
  reason: string;
  changes: string[];
  beforeGrandTotalPaise: number;
  afterGrandTotalPaise: number;
  changedAt: Date;
  changedByName: string | null;
}

export async function listRevisions(scope: StoreScope, invoiceId: string): Promise<RevisionRow[]> {
  const rows = await db.invoiceRevision.findMany({
    where: { ...scopeWhere(scope), invoiceId },
    orderBy: { version: 'desc' },
  });
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.changedBy).filter((x): x is string => !!x))];
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true },
  });
  const name = new Map(users.map((u) => [u.id, u.fullName]));

  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    reason: r.reason,
    changes: r.changes,
    beforeGrandTotalPaise: r.beforeGrandTotalPaise,
    afterGrandTotalPaise: r.afterGrandTotalPaise,
    changedAt: r.changedAt,
    changedByName: r.changedBy ? name.get(r.changedBy) ?? null : null,
  }));
}
