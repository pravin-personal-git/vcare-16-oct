import 'server-only';
import { storedDay } from '@/lib/attendance-day';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { listBills, listPayments, supplierBalances } from './purchases';
import { listShifts } from './shifts';
import { listCalls } from './call-logs';
import { stockReport } from './stock-report';
import { profitAndLoss } from './reports';
import { listJoiners } from './onboarding';
import { listResignations } from './offboarding';
import type { CsvColumn } from '@/lib/csv';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { AMC_STATUS_LABEL, COVERAGE_TERMS_LABEL } from '@/lib/amc-status';
import { billingState, visitAllowance, BILLING_LABEL } from '@/lib/amc-offer';
import { expiryState } from '@/lib/expiry';
import { listAuditEvents, listSignInEvents } from './audit-log';

/**
 * Every report the platform can produce, in one registry.
 *
 * WHY A REGISTRY RATHER THAN A SCREEN PER REPORT.
 *
 * A report is three things: a name somebody searches for, a query, and a set of
 * columns. Written as a screen each, that is thirty files that drift apart -
 * one gets a date filter, another does not; one exports, another forgot. As
 * data, the download centre lists them, filters them and exports them all
 * identically, and adding the thirty-first is eight lines here.
 *
 * MONEY IS EXPORTED IN RUPEES, NOT PAISE.
 *
 * Internally everything is integer paise, because floats lose money. But a
 * spreadsheet is opened by a human who will sum a column and compare it to a
 * bank statement - `125000` where they expect `1250.00` is not a rounding
 * question, it is a wrong number by a factor of a hundred. Converted once,
 * here, at the boundary.
 */

const rupees = (paise: number) => Number((paise / 100).toFixed(2));
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
/** Date and time in India, for events (a call, a visit) rather than days. */
const stamp = (d: Date | null | undefined) => (d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ') : '');
const clock = (d: Date | null | undefined) => (d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16) : '');
const isoDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const daysBetween = (a: Date, b: Date | null | undefined) => (b ? Math.round((b.getTime() - a.getTime()) / 86_400_000) : null);
const partyLabel = (p: { companyName?: string | null; firstName: string; lastName?: string | null }) =>
  p.companyName?.trim() || [p.firstName, p.lastName].filter(Boolean).join(' ');
const scopeStoreIds = (scope: StoreScope) => (scope.kind === 'single' ? [scope.storeId] : scope.storeIds);

async function userNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (want.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: want } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

export type ReportCategory =
  | 'Sales' | 'Purchase' | 'Accounts' | 'Inventory' | 'People'
  | 'Service' | 'Tasks' | 'CRM' | 'Calls' | 'Attendance' | 'Audit';

export interface ReportDef {
  id: string;
  name: string;
  description: string;
  category: ReportCategory;
  /** False for reports that are a snapshot of right now, like stock on hand. */
  dated: boolean;
  /** Permission needed to run it. */
  permission: string;
  run: (scope: StoreScope, from: Date, to: Date) => Promise<{
    rows: unknown[];
    columns: CsvColumn<never>[];
  }>;
}

/** Helper so each definition reads as a table rather than as generics. */
function def<T>(
  d: Omit<ReportDef, 'run'> & {
    run: (scope: StoreScope, from: Date, to: Date) => Promise<T[]>;
    columns: CsvColumn<T>[];
  },
): ReportDef {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    category: d.category,
    dated: d.dated,
    permission: d.permission,
    run: async (scope, from, to) => ({
      rows: await d.run(scope, from, to),
      columns: d.columns as unknown as CsvColumn<never>[],
    }),
  };
}

export const REPORTS: ReportDef[] = [
  // ------------------------------------------------------------------ Masters
  def({
    /**
     * The full customer list.
     *
     * The Customers screen now shows every customer, so this is no longer the
     * only way to reach them - it is the way to get them OUT, as a spreadsheet
     * somebody can sort, print or hand to an accountant.
     *
     * `accounts-receivables` was the nearest thing and it answers a different
     * question: it lists only the customers who currently owe money (381 of
     * 4,556 for the migrated tenant), so as a customer master it reads as
     * though the other four thousand do not exist.
     *
     * Not `dated`: a customer master is a current-state list, not a period of
     * activity. Asking for a date range would imply otherwise.
     */
    id: 'masters-customers',
    name: 'Customers',
    description: 'Every customer on file, with contact details, GSTIN and what they owe.',
    category: 'Sales',
    dated: false,
    permission: 'customers.view',
    run: (scope) => db.party.findMany({
      where: { ...scopeWhere(scope), isCustomer: true },
      select: {
        partyCode: true, companyName: true, title: true, firstName: true, lastName: true,
        phoneCc: true, phone: true, altPhone: true, email: true,
        gstin: true, addressLine1: true, city: true, state: true, pincode: true,
        customerType: { select: { name: true } },
        creditLimitPaise: true, creditLimitDays: true,
        customerSince: true, status: true,
        // Derived, not the stored balance - see the note in parties.ts on why
        // `currentBalancePaise` drifted and is no longer trusted.
        invoices: {
          where: { lifecycle: 'sent' },
          select: { grandTotalPaise: true, amountPaidPaise: true },
        },
      },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Code', value: (r) => r.partyCode },
      { header: 'Customer', value: (r) => r.companyName
        || [r.title, r.firstName, r.lastName].filter(Boolean).join(' ') },
      { header: 'Phone', value: (r) => `${r.phoneCc} ${r.phone}` },
      { header: 'Alt Phone', value: (r) => r.altPhone },
      { header: 'Email', value: (r) => r.email },
      { header: 'GSTIN', value: (r) => r.gstin },
      { header: 'Address', value: (r) => r.addressLine1 },
      { header: 'City', value: (r) => r.city },
      { header: 'State', value: (r) => r.state },
      { header: 'Pincode', value: (r) => r.pincode },
      { header: 'Type', value: (r) => r.customerType?.name ?? null },
      { header: 'Credit Limit', value: (r) => rupees(r.creditLimitPaise) },
      { header: 'Credit Days', value: (r) => r.creditLimitDays },
      { header: 'Customer Since', value: (r) => day(r.customerSince) },
      { header: 'Status', value: (r) => r.status },
      { header: 'Outstanding', value: (r) => rupees(
        r.invoices.reduce((n, i) => n + Math.max(0, i.grandTotalPaise - i.amountPaidPaise), 0),
      ) },
    ],
  }),

  // ------------------------------------------------------------------ Sales
  def({
    id: 'sales-invoices',
    name: 'Invoices',
    description: 'Every invoice raised, what it came to, and what is still owed.',
    category: 'Sales',
    dated: true,
    permission: 'invoice.view',
    run: (scope, from, to) => db.invoice.findMany({
      where: { ...scopeWhere(scope), invoiceDate: { gte: from, lte: to } },
      select: {
        invoiceNo: true, invoiceDate: true, dueDate: true, customerName: true,
        gstin: true, lifecycle: true, taxableBasePaise: true,
        cgstPaise: true, sgstPaise: true, igstPaise: true,
        grandTotalPaise: true, amountPaidPaise: true,
      },
      orderBy: { invoiceDate: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Invoice No', value: (r) => r.invoiceNo },
      { header: 'Date', value: (r) => day(r.invoiceDate) },
      { header: 'Due Date', value: (r) => day(r.dueDate) },
      { header: 'Customer', value: (r) => r.customerName },
      { header: 'GSTIN', value: (r) => r.gstin },
      { header: 'Status', value: (r) => r.lifecycle },
      { header: 'Taxable Value', value: (r) => rupees(r.taxableBasePaise) },
      { header: 'CGST', value: (r) => rupees(r.cgstPaise) },
      { header: 'SGST', value: (r) => rupees(r.sgstPaise) },
      { header: 'IGST', value: (r) => rupees(r.igstPaise) },
      { header: 'Total', value: (r) => rupees(r.grandTotalPaise) },
      { header: 'Settled', value: (r) => rupees(r.amountPaidPaise) },
      { header: 'Outstanding', value: (r) => rupees(Math.max(0, r.grandTotalPaise - r.amountPaidPaise)) },
    ],
  }),

  def({
    /**
     * Every maintenance contract, with what is left on it.
     *
     * The report a renewal conversation is had from, and the one thing the AMC
     * screen could not do: hand somebody a list. Not `dated` - a contract book
     * is a current-state list, and asking for a date range would imply it was
     * a period of activity.
     *
     * Days left and visits used are computed here from the same rules the
     * screens use, rather than restated in SQL. "Expired" depends on today's
     * date and "visits used" on which visits completed; two implementations of
     * either would agree only until one was edited.
     */
    id: 'masters-amc',
    name: 'Maintenance Contracts (AMC)',
    description: 'Every AMC on file - period, value, visits used and what is due to renew.',
    category: 'Service',
    dated: false,
    permission: 'complaints.view',
    run: (scope) => db.amcContract.findMany({
      where: scopeWhere(scope),
      select: {
        contractNo: true, legacyRef: true, status: true, coverageTerms: true,
        startDate: true, endDate: true, amountPaise: true,
        visitsIncluded: true, reminderDays: true, siteLabel: true,
        customer: {
          select: {
            partyCode: true, companyName: true, title: true, firstName: true,
            lastName: true, phoneCc: true, phone: true, city: true,
          },
        },
        invoice: { select: { invoiceNo: true } },
        originInvoice: { select: { invoiceNo: true } },
        renewedFrom: { select: { contractNo: true } },
        items: { select: { productName: true, qty: true } },
        _count: { select: { visits: { where: { status: 'completed' } } } },
      },
      orderBy: { endDate: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Contract No', value: (r) => r.contractNo },
      { header: 'Old Reference', value: (r) => r.legacyRef },
      { header: 'Customer Code', value: (r) => r.customer.partyCode },
      { header: 'Customer', value: (r) => r.customer.companyName
        || [r.customer.title, r.customer.firstName, r.customer.lastName].filter(Boolean).join(' ') },
      { header: 'Phone', value: (r) => `${r.customer.phoneCc} ${r.customer.phone}` },
      { header: 'City', value: (r) => r.customer.city },
      { header: 'Site', value: (r) => r.siteLabel },
      { header: 'Status', value: (r) => AMC_STATUS_LABEL[r.status] ?? r.status },
      { header: 'Covers', value: (r) => (r.items.length === 0
        ? 'Whole site'
        : r.items.map((i) => `${i.productName}${i.qty > 1 ? ` x${i.qty}` : ''}`).join('; ')) },
      { header: 'Terms', value: (r) => COVERAGE_TERMS_LABEL[r.coverageTerms] ?? r.coverageTerms },
      { header: 'Start', value: (r) => day(r.startDate) },
      { header: 'End', value: (r) => day(r.endDate) },
      { header: 'Days Left', value: (r) => expiryState(
        { expiryDate: r.endDate, reminderDays: r.reminderDays },
      ).daysToExpiry },
      { header: 'Due To Renew', value: (r) => {
        const s = expiryState({ expiryDate: r.endDate, reminderDays: r.reminderDays });
        if (r.status !== 'active') return 'No';
        if (s.isOverdue) return 'Lapsed';
        return s.isDue ? 'Yes' : 'No';
      } },
      { header: 'Value', value: (r) => rupees(r.amountPaise) },
      { header: 'Visits Included', value: (r) => (r.visitsIncluded === null ? 'Unlimited' : r.visitsIncluded) },
      { header: 'Visits Used', value: (r) => r._count.visits },
      { header: 'Visits Left', value: (r) => {
        const a = visitAllowance({ visitsIncluded: r.visitsIncluded, visitsUsed: r._count.visits });
        return a.unlimited ? 'Unlimited' : a.remaining;
      } },
      { header: 'Over Allowance', value: (r) => visitAllowance(
        { visitsIncluded: r.visitsIncluded, visitsUsed: r._count.visits },
      ).exceededBy },
      { header: 'Fee Invoiced On', value: (r) => r.invoice?.invoiceNo ?? null },
      { header: 'Fee Status', value: (r) => BILLING_LABEL[billingState(
        { amountPaise: r.amountPaise, invoiceId: r.invoice ? 'set' : null },
      )] },
      { header: 'Sold On', value: (r) => r.originInvoice?.invoiceNo ?? null },
      { header: 'Renewed From', value: (r) => r.renewedFrom?.contractNo ?? null },
    ],
  }),

  def({
    id: 'sales-receipts',
    name: 'Receipts',
    description: 'Money received from customers, and how it was received.',
    category: 'Accounts',
    dated: true,
    permission: 'accounts.view',
    run: (scope, from, to) => db.receipt.findMany({
      where: { ...scopeWhere(scope), receivedAt: { gte: from, lte: to } },
      select: {
        receiptNo: true, receivedAt: true, amountPaise: true, method: true,
        reference: true, status: true, party: { select: { firstName: true, lastName: true, companyName: true } },
      },
      orderBy: { receivedAt: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Receipt No', value: (r) => r.receiptNo },
      { header: 'Date', value: (r) => day(r.receivedAt) },
      {
        header: 'Customer',
        value: (r) => r.party?.companyName
          || [r.party?.firstName, r.party?.lastName].filter(Boolean).join(' '),
      },
      { header: 'Amount', value: (r) => rupees(r.amountPaise) },
      { header: 'Method', value: (r) => r.method },
      { header: 'Reference', value: (r) => r.reference },
      { header: 'Status', value: (r) => r.status },
    ],
  }),

  def({
    id: 'sales-quotations',
    name: 'Quotations',
    description: 'What was quoted, to whom, and whether it was won.',
    category: 'Sales',
    dated: true,
    permission: 'quotation.view',
    run: (scope, from, to) => db.quotation.findMany({
      where: { ...scopeWhere(scope), quotationDate: { gte: from, lte: to } },
      select: {
        quotationNo: true, quotationDate: true, customerName: true,
        status: true, grandTotalPaise: true, validUntil: true,
      },
      orderBy: { quotationDate: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Quotation No', value: (r) => r.quotationNo },
      { header: 'Date', value: (r) => day(r.quotationDate) },
      { header: 'Customer', value: (r) => r.customerName },
      { header: 'Valid Until', value: (r) => day(r.validUntil) },
      { header: 'Status', value: (r) => r.status },
      { header: 'Total', value: (r) => rupees(r.grandTotalPaise) },
    ],
  }),

  def({
    id: 'sales-returns',
    name: 'Sales Returns',
    description: 'Goods customers sent back, and what condition they arrived in.',
    category: 'Sales',
    dated: true,
    permission: 'returns.view',
    run: (scope, from, to) => db.salesReturn.findMany({
      where: { ...scopeWhere(scope), returnedAt: { gte: from, lte: to } },
      select: {
        returnNo: true, returnedAt: true, customerName: true, reason: true,
        lifecycle: true, invoice: { select: { invoiceNo: true } },
      },
      orderBy: { returnedAt: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Return No', value: (r) => r.returnNo },
      { header: 'Date', value: (r) => day(r.returnedAt) },
      { header: 'Against Invoice', value: (r) => r.invoice?.invoiceNo },
      { header: 'Customer', value: (r) => r.customerName },
      { header: 'Reason', value: (r) => r.reason },
      { header: 'Status', value: (r) => r.lifecycle },
    ],
  }),

  def({
    id: 'sales-credit-notes',
    name: 'Credit Notes',
    description: 'Credit given back to customers. Reduces the GST you owe.',
    category: 'Accounts',
    dated: true,
    permission: 'returns.view',
    run: (scope, from, to) => db.creditNote.findMany({
      where: { ...scopeWhere(scope), creditNoteDate: { gte: from, lte: to } },
      select: {
        creditNoteNo: true, creditNoteDate: true, customerName: true,
        lifecycle: true, taxableBasePaise: true,
        cgstPaise: true, sgstPaise: true, igstPaise: true, grandTotalPaise: true,
      },
      orderBy: { creditNoteDate: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Credit Note No', value: (r) => r.creditNoteNo },
      { header: 'Date', value: (r) => day(r.creditNoteDate) },
      { header: 'Customer', value: (r) => r.customerName },
      { header: 'Status', value: (r) => r.lifecycle },
      { header: 'Taxable Value', value: (r) => rupees(r.taxableBasePaise) },
      { header: 'CGST', value: (r) => rupees(r.cgstPaise) },
      { header: 'SGST', value: (r) => rupees(r.sgstPaise) },
      { header: 'IGST', value: (r) => rupees(r.igstPaise) },
      { header: 'Total', value: (r) => rupees(r.grandTotalPaise) },
    ],
  }),

  // --------------------------------------------------------------- Purchase
  def({
    id: 'purchase-bills',
    name: 'Purchase Bills',
    description: 'What you bought, from whom, and what is still owed.',
    category: 'Purchase',
    dated: true,
    permission: 'purchase.view',
    run: (scope, from, to) => listBills(scope, { from, to, take: LIST_MAX_ROWS }),
    columns: [
      { header: 'Our Ref', value: (r) => r.billNo },
      { header: 'Supplier Bill No', value: (r) => r.supplierBillNo },
      { header: 'Date', value: (r) => day(r.billDate) },
      { header: 'Due Date', value: (r) => day(r.dueDate) },
      { header: 'Supplier', value: (r) => r.supplierName },
      { header: 'Status', value: (r) => r.status },
      { header: 'Total', value: (r) => rupees(r.grandTotalPaise) },
      { header: 'Paid', value: (r) => rupees(r.paidPaise) },
      { header: 'Outstanding', value: (r) => rupees(r.outstandingPaise) },
    ],
  }),

  def({
    id: 'purchase-payables',
    name: 'Payables by Supplier',
    description: 'What you owe each supplier, and how old the oldest bill is.',
    category: 'Purchase',
    dated: false,
    permission: 'purchase.view',
    run: (scope) => supplierBalances(scope),
    columns: [
      { header: 'Supplier', value: (r) => r.supplierName },
      { header: 'Bills', value: (r) => r.billCount },
      { header: 'Billed', value: (r) => rupees(r.billedPaise) },
      { header: 'Paid', value: (r) => rupees(r.paidPaise) },
      { header: 'Outstanding', value: (r) => rupees(r.outstandingPaise) },
      { header: 'Oldest Due', value: (r) => day(r.oldestDueDate) },
    ],
  }),

  def({
    id: 'purchase-payments',
    name: 'Supplier Payments',
    description: 'Money paid out, how, and against which bills.',
    category: 'Accounts',
    dated: false,
    permission: 'purchase.pay',
    run: (scope) => listPayments(scope, { take: LIST_MAX_ROWS }),
    columns: [
      { header: 'Payment No', value: (r) => r.paymentNo },
      { header: 'Date', value: (r) => day(r.paidAt) },
      { header: 'Supplier', value: (r) => r.supplierName },
      { header: 'Amount', value: (r) => rupees(r.amountPaise) },
      { header: 'Allocated', value: (r) => rupees(r.allocatedPaise) },
      { header: 'On Account', value: (r) => rupees(Math.max(0, r.amountPaise - r.allocatedPaise)) },
      { header: 'Method', value: (r) => r.method },
      { header: 'Reference', value: (r) => r.reference },
      { header: 'Status', value: (r) => r.status },
    ],
  }),

  // -------------------------------------------------------------- Inventory
  def({
    id: 'stock-on-hand',
    name: 'Stock on Hand',
    description: 'Everything held, what it is worth, and what needs reordering.',
    category: 'Inventory',
    dated: false,
    permission: 'stock.view',
    run: async (scope) => (await stockReport(scope)).rows,
    columns: [
      { header: 'Code', value: (r) => r.productCode },
      { header: 'Product', value: (r) => r.productName },
      { header: 'Category', value: (r) => r.categoryName },
      { header: 'On Hand', value: (r) => r.qty },
      { header: 'Unit', value: (r) => r.unit },
      { header: 'Reorder At', value: (r) => r.reorderLevel },
      { header: 'Needs Reorder', value: (r) => r.needsReorder },
      { header: 'Unit Cost', value: (r) => (r.costKnown ? rupees(r.unitCostPaise) : '') },
      { header: 'Value', value: (r) => rupees(r.valuePaise) },
    ],
  }),

  def({
    id: 'stock-movements',
    name: 'Stock Movements',
    description: 'Every unit in and out, and which document moved it.',
    category: 'Inventory',
    dated: true,
    permission: 'stock.view',
    run: (scope, from, to) => db.stockMovement.findMany({
      where: { ...scopeWhere(scope), createdAt: { gte: from, lte: to } },
      select: {
        createdAt: true, qty: true, reason: true, refType: true, refNo: true,
        balanceAfter: true, note: true,
        product: { select: { productCode: true, productName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Date', value: (r) => day(r.createdAt) },
      { header: 'Code', value: (r) => r.product?.productCode },
      { header: 'Product', value: (r) => r.product?.productName },
      { header: 'Quantity', value: (r) => r.qty },
      { header: 'Reason', value: (r) => r.reason },
      { header: 'Document', value: (r) => `${r.refType ?? ''} ${r.refNo ?? ''}`.trim() },
      { header: 'Balance After', value: (r) => r.balanceAfter },
      { header: 'Note', value: (r) => r.note },
    ],
  }),

  /**
   * The old system's "stock by supplier invoice" report, which was blocked
   * until receipts carried the supplier's invoice number (Phase 3). One row per
   * receipt line: what arrived, from whom, on which of THEIR invoices, and how
   * many of its serialised units are still on the shelf.
   */
  def({
    id: 'stock-by-supplier-invoice',
    name: 'Stock by Supplier Invoice',
    description: 'What each supplier invoice brought in, and how much of it is still on the shelf.',
    category: 'Inventory',
    dated: true,
    permission: 'stock.view',
    run: (scope, from, to) => db.goodsReceiptNoteItem.findMany({
      where: { ...scopeWhere(scope), grn: { status: 'posted', receivedDate: { gte: from, lte: to } } },
      select: {
        productCode: true, productName: true, qty: true, unitCostPaise: true, taxRatePct: true, warrantyMonths: true,
        grn: { select: { grnNo: true, legacyRef: true, supplierName: true, supplierInvoiceNo: true, receivedDate: true } },
        _count: { select: { units: { where: { status: { in: ['in_stock', 'reserved'] } } } } },
      },
      orderBy: { grn: { receivedDate: 'asc' } },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Received', value: (r) => day(r.grn.receivedDate) },
      { header: 'Supplier', value: (r) => r.grn.supplierName },
      { header: 'Supplier Invoice', value: (r) => r.grn.supplierInvoiceNo },
      { header: 'Receipt', value: (r) => r.grn.grnNo },
      { header: 'Code', value: (r) => r.productCode },
      { header: 'Product', value: (r) => r.productName },
      { header: 'Quantity', value: (r) => r.qty },
      { header: 'Unit Cost', value: (r) => rupees(r.unitCostPaise) },
      { header: 'GST %', value: (r) => (r.taxRatePct !== null ? Number(r.taxRatePct) : '') },
      { header: 'Supplier Warranty (months)', value: (r) => r.warrantyMonths },
      { header: 'Units Still On Shelf', value: (r) => r._count.units },
    ],
  }),

  def({
    id: 'stock-units',
    name: 'Serialised Units',
    description: 'Every tracked unit: serial, where it is, who holds it, when it arrived.',
    category: 'Inventory',
    dated: false,
    permission: 'stock.view',
    run: (scope) => db.stockUnit.findMany({
      where: scopeWhere(scope),
      select: {
        serialNo: true, status: true, condition: true, receivedAt: true, unitCostPaise: true, legacyRef: true,
        product: { select: { productCode: true, productName: true } },
        party: { select: { firstName: true, companyName: true } },
        grnItem: { select: { grn: { select: { grnNo: true, supplierName: true, supplierInvoiceNo: true } } } },
      },
      orderBy: { receivedAt: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Serial', value: (r) => r.serialNo ?? '(to follow)' },
      { header: 'Code', value: (r) => r.product.productCode },
      { header: 'Product', value: (r) => r.product.productName },
      { header: 'Status', value: (r) => r.status },
      { header: 'Condition', value: (r) => r.condition },
      { header: 'Held By', value: (r) => (r.party ? r.party.companyName || r.party.firstName : '') },
      { header: 'Arrived', value: (r) => day(r.receivedAt) },
      { header: 'Receipt', value: (r) => r.grnItem?.grn.grnNo ?? r.legacyRef ?? 'Opening stock' },
      { header: 'Supplier', value: (r) => r.grnItem?.grn.supplierName },
      { header: 'Supplier Invoice', value: (r) => r.grnItem?.grn.supplierInvoiceNo },
      { header: 'Unit Cost', value: (r) => (r.unitCostPaise !== null ? rupees(r.unitCostPaise) : '') },
    ],
  }),

  /** The old system's "replace report" - blocked until the tracker existed (Phase 6). */
  def({
    id: 'service-replacements',
    name: 'Replacements',
    description: 'Every faulty item sent for repair or replacement, where it went, and when it came back.',
    category: 'Service',
    dated: true,
    permission: 'stock.view',
    run: (scope, from, to) => db.replacementCase.findMany({
      where: { ...scopeWhere(scope), createdAt: { gte: from, lte: to } },
      select: {
        caseNo: true, legacyRef: true, status: true, productName: true, serialNo: true, supplierName: true,
        serviceCentre: true, courier: true, docketNo: true, sentAt: true, expectedBackAt: true,
        receivedBackAt: true, returnedToCustomerAt: true, outcome: true, createdAt: true,
        customer: { select: { firstName: true, companyName: true } },
        supplier: { select: { firstName: true, companyName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Case', value: (r) => r.caseNo },
      { header: 'Logged', value: (r) => day(r.createdAt) },
      { header: 'Item', value: (r) => r.productName },
      { header: 'Serial', value: (r) => r.serialNo },
      { header: 'Customer', value: (r) => (r.customer ? r.customer.companyName || r.customer.firstName : '') },
      { header: 'Sent To', value: (r) => [r.supplier ? r.supplier.companyName || r.supplier.firstName : r.supplierName, r.serviceCentre].filter(Boolean).join(' / ') },
      { header: 'Courier', value: (r) => r.courier },
      { header: 'Docket', value: (r) => r.docketNo },
      { header: 'Sent', value: (r) => day(r.sentAt) },
      { header: 'Expected Back', value: (r) => day(r.expectedBackAt) },
      { header: 'Back In Office', value: (r) => day(r.receivedBackAt) },
      { header: 'Customer Received', value: (r) => day(r.returnedToCustomerAt) },
      { header: 'Outcome', value: (r) => r.outcome },
      { header: 'Status', value: (r) => r.status },
    ],
  }),

  // ----------------------------------------------------------------- People
  def({
    id: 'people-shifts',
    name: 'Attendance - Shifts',
    description: 'Who worked, when they started and finished, and for how long.',
    category: 'Attendance',
    dated: true,
    permission: 'attendance.view',
    run: (scope, from, to) => listShifts(scope, { from, to }),
    columns: [
      { header: 'Date', value: (r) => day(r.startedAt) },
      { header: 'Employee', value: (r) => r.userName },
      { header: 'Started', value: (r) => r.startedAt.toTimeString().slice(0, 5) },
      {
        header: 'Finished',
        value: (r) => {
          const end = r.correctedEndedAt ?? r.endedAt;
          return end ? end.toTimeString().slice(0, 5) : '';
        },
      },
      // Blank, not zero, when nobody closed the shift. A zero in a payroll
      // column is a number somebody will multiply by an hourly rate.
      { header: 'Hours Worked', value: (r) => (r.workedMinutes === null ? '' : (r.workedMinutes / 60).toFixed(2)) },
      { header: 'Corrected', value: (r) => r.correctedEndedAt != null },
      { header: 'Correction Reason', value: (r) => r.correctionReason },
      { header: 'Calls', value: (r) => r.callCount },
    ],
  }),

  def({
    id: 'people-calls',
    name: 'Call Activity',
    description: 'Every call your team made or received, with duration.',
    category: 'Calls',
    dated: true,
    permission: 'calls.view',
    run: (scope, from, to) => listCalls(scope, { from, to, take: LIST_MAX_ROWS }),
    columns: [
      { header: 'When', value: (r) => r.startedAt.toISOString().slice(0, 16).replace('T', ' ') },
      { header: 'Employee', value: (r) => r.userName },
      { header: 'Number', value: (r) => r.e164Number },
      { header: 'Customer', value: (r) => r.partyName },
      { header: 'Direction', value: (r) => r.direction },
      { header: 'Duration (sec)', value: (r) => r.durationSec },
      { header: 'In CRM', value: (r) => r.matchedCrm },
    ],
  }),

  // --------------------------------------------------------------- HRM (§4.10)
  // No new schema - a read + CSV serialization layer over data every module
  // above already owns. Snapshot-style (dated: false) except Leave Requests
  // and Payroll, where a period genuinely narrows what's exported.
  def({
    id: 'hrm-employees',
    name: 'Employees',
    description: 'Everyone holding a role in this branch, with their onboarding basics.',
    category: 'People',
    dated: false,
    permission: 'hrm.view',
    run: (scope) => listJoiners(scope),
    columns: [
      { header: 'Employee', value: (r) => r.fullName },
      { header: 'Employment Type', value: (r) => r.employmentType },
      { header: 'Date of Joining', value: (r) => day(r.dateOfJoining) },
      { header: 'Confirmed', value: (r) => r.confirmedAt != null },
      { header: 'Confirmed On', value: (r) => day(r.confirmedAt) },
    ],
  }),

  def({
    id: 'hrm-leave-requests',
    name: 'Leave Requests',
    description: 'Every leave, WFH and half-day request raised in the period.',
    category: 'People',
    dated: true,
    permission: 'hrm.view',
    run: (scope, from, to) => db.leaveRequest.findMany({
      where: { ...scopeWhere(scope), fromDate: { lte: to }, toDate: { gte: from } },
      include: { user: { select: { fullName: true } }, leaveType: { select: { name: true } } },
      orderBy: { fromDate: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Employee', value: (r) => r.user.fullName },
      { header: 'Kind', value: (r) => r.kind },
      { header: 'Leave Type', value: (r) => r.leaveType?.name ?? '' },
      // India days - a leave saved at midnight India time is 18:30 UTC the day before.
      { header: 'From', value: (r) => storedDay(r.fromDate) },
      { header: 'To', value: (r) => storedDay(r.toDate) },
      { header: 'Status', value: (r) => r.status },
      { header: 'Reason', value: (r) => r.reason },
    ],
  }),

  def({
    id: 'hrm-payroll',
    name: 'Payroll',
    description: 'Every payslip generated in the period - one row per employee per run.',
    category: 'People',
    dated: true,
    permission: 'payroll.view',
    run: (scope, from, to) => db.payslip.findMany({
      where: { ...scopeWhere(scope), payrollRun: { periodEnd: { gte: from, lte: to } } },
      include: { payrollRun: { select: { label: true, status: true } } },
      orderBy: { generatedAt: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Run', value: (r) => r.payrollRun.label },
      { header: 'Run Status', value: (r) => r.payrollRun.status },
      { header: 'Employee', value: (r) => r.employeeName },
      { header: 'Code', value: (r) => r.employeeCode },
      { header: 'Working Days', value: (r) => r.workingDays },
      { header: 'Paid Days', value: (r) => Number(r.paidDays) },
      { header: 'LOP Days', value: (r) => Number(r.lopDays) },
      { header: 'Gross', value: (r) => rupees(r.grossPaise) },
      { header: 'Deductions', value: (r) => rupees(r.totalDeductionsPaise) },
      { header: 'Net', value: (r) => rupees(r.netPaise) },
    ],
  }),

  def({
    id: 'hrm-assets',
    name: 'Assets',
    description: 'Every company asset, who holds it, and its current status.',
    category: 'People',
    dated: false,
    permission: 'hrm.view',
    run: (scope) => db.asset.findMany({
      where: scopeWhere(scope),
      include: { assignedTo: { select: { fullName: true } } },
      orderBy: { name: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Name', value: (r) => r.name },
      { header: 'Type', value: (r) => r.assetType },
      { header: 'Serial Number', value: (r) => r.serialNumber },
      { header: 'Purchase Date', value: (r) => day(r.purchaseDate) },
      { header: 'Cost', value: (r) => (r.costPaise == null ? '' : rupees(r.costPaise)) },
      { header: 'Assigned To', value: (r) => r.assignedTo?.fullName ?? '' },
      { header: 'Status', value: (r) => r.status },
    ],
  }),

  def({
    id: 'hrm-helpdesk',
    name: 'Helpdesk Tickets',
    description: 'Every internal support ticket raised in this branch.',
    category: 'People',
    dated: false,
    permission: 'helpdesk.view',
    run: (scope) => db.helpdeskTicket.findMany({
      where: scopeWhere(scope),
      include: { raisedBy: { select: { fullName: true } }, category: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Ticket No', value: (r) => r.ticketNo },
      { header: 'Raised By', value: (r) => r.raisedBy.fullName },
      { header: 'Category', value: (r) => r.category?.name ?? '' },
      { header: 'Subject', value: (r) => r.subject },
      { header: 'Priority', value: (r) => r.priority },
      { header: 'Status', value: (r) => r.status },
      { header: 'Raised On', value: (r) => day(r.createdAt) },
    ],
  }),

  def({
    id: 'hrm-onboarding',
    name: 'Onboarding Status',
    description: 'Every current employee’s onboarding checklist progress.',
    category: 'People',
    dated: false,
    permission: 'hrm.view',
    run: (scope) => listJoiners(scope),
    columns: [
      { header: 'Employee', value: (r) => r.fullName },
      { header: 'Date of Joining', value: (r) => day(r.dateOfJoining) },
      { header: 'Tasks Done', value: (r) => r.progress.done },
      { header: 'Tasks Total', value: (r) => r.progress.total },
      { header: 'Confirmed', value: (r) => r.confirmedAt != null },
    ],
  }),

  def({
    id: 'hrm-offboarding',
    name: 'Offboarding Status',
    description: 'Every resignation on file and its exit-checklist progress.',
    category: 'People',
    dated: false,
    permission: 'hrm.view',
    run: (scope) => listResignations(scope, { userId: '', canViewAll: true }),
    columns: [
      { header: 'Employee', value: (r) => r.userName },
      { header: 'Resigned On', value: (r) => day(r.resignedOn) },
      { header: 'Last Working Day', value: (r) => day(r.lastWorkingDay) },
      { header: 'Status', value: (r) => r.status },
      { header: 'Tasks Done', value: (r) => r.progress?.done ?? '' },
      { header: 'Tasks Total', value: (r) => r.progress?.total ?? '' },
      { header: 'Completed On', value: (r) => day(r.completedAt) },
    ],
  }),

  // --------------------------------------------------------------- Accounts
  def({
    id: 'accounts-receivables',
    name: 'Receivables by Customer',
    description: 'Who owes you money, and against which invoices.',
    category: 'Accounts',
    dated: false,
    permission: 'accounts.view',
    run: async (scope) => {
      const invoices = await db.invoice.findMany({
        where: { ...scopeWhere(scope), lifecycle: 'sent' },
        select: {
          invoiceNo: true, customerName: true, invoiceDate: true, dueDate: true,
          grandTotalPaise: true, amountPaidPaise: true,
        },
        orderBy: { dueDate: 'asc' },
        take: LIST_MAX_ROWS,
      });
      return invoices.filter((i) => i.grandTotalPaise > i.amountPaidPaise);
    },
    columns: [
      { header: 'Invoice No', value: (r) => r.invoiceNo },
      { header: 'Customer', value: (r) => r.customerName },
      { header: 'Date', value: (r) => day(r.invoiceDate) },
      { header: 'Due Date', value: (r) => day(r.dueDate) },
      { header: 'Total', value: (r) => rupees(r.grandTotalPaise) },
      { header: 'Settled', value: (r) => rupees(r.amountPaidPaise) },
      { header: 'Outstanding', value: (r) => rupees(r.grandTotalPaise - r.amountPaidPaise) },
      {
        header: 'Days Overdue',
        value: (r) => Math.max(0, Math.floor((Date.now() - r.dueDate.getTime()) / 86_400_000)),
      },
    ],
  }),

  def({
    id: 'accounts-gst',
    name: 'GST Summary',
    description: 'Output tax collected, input tax paid, and the difference.',
    category: 'Accounts',
    dated: true,
    permission: 'accounts.view',
    run: async (scope, from, to) => {
      const p = await profitAndLoss(scope, from, to);
      return [
        { line: 'Output tax (collected on sales)', amount: rupees(p.outputTaxPaise) },
        { line: 'Input tax (paid on purchases)', amount: rupees(p.inputTaxPaise) },
        {
          line: p.netGstPaise >= 0 ? 'Net payable' : 'Net reclaimable',
          amount: rupees(Math.abs(p.netGstPaise)),
        },
      ];
    },
    columns: [
      { header: 'Line', value: (r) => r.line },
      { header: 'Amount', value: (r) => r.amount },
    ],
  }),

  def({
    id: 'accounts-pnl',
    name: 'Profit & Loss',
    description: 'Revenue, cost of goods sold and expenses for the period.',
    category: 'Accounts',
    dated: true,
    permission: 'accounts.view',
    run: async (scope, from, to) => {
      const p = await profitAndLoss(scope, from, to);
      return [
        { line: 'Sales invoiced', amount: rupees(p.revenuePaise) },
        { line: 'Less credit notes', amount: -rupees(p.creditNotesPaise) },
        { line: 'Net revenue', amount: rupees(p.netRevenuePaise) },
        { line: 'Cost of goods sold', amount: -rupees(p.cogsPaise) },
        { line: 'Gross profit', amount: rupees(p.grossProfitPaise) },
        { line: 'Operating expenses', amount: -rupees(p.expensesPaise) },
        { line: 'Indicative net (before salaries, rent, tax)', amount: rupees(p.indicativeNetPaise) },
      ];
    },
    columns: [
      { header: 'Line', value: (r) => r.line },
      { header: 'Amount', value: (r) => r.amount },
    ],
  }),

  // ================================================================ Service
  // Health check RPT-1 (25 Sep 2026): the download centre only had Sales,
  // Purchase, Accounts, Inventory and People. The service desk, tasks, CRM,
  // calls, attendance and the audit trail get their own groups.
  def({
    id: 'service-complaints',
    name: 'Complaints Register',
    description: 'Every complaint raised in the period - customer, product, technician, status and how long it took.',
    category: 'Service',
    dated: true,
    permission: 'complaints.view',
    run: (scope, from, to) => db.complaint.findMany({
      where: { ...scopeWhere(scope), createdAt: { gte: from, lte: to } },
      select: {
        complaintNo: true, legacyRef: true, createdAt: true, description: true, status: true, priority: true,
        resolutionType: true, assignedAt: true, resolvedAt: true, closedAt: true, raisedByPortal: true, siteLocation: true,
        customer: { select: { partyCode: true, companyName: true, firstName: true, lastName: true, phoneCc: true, phone: true, city: true } },
        product: { select: { productName: true } },
        assignedTechnician: { select: { fullName: true } },
        _count: { select: { visits: true, challans: true, replacements: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Complaint No', value: (r) => r.complaintNo },
      { header: 'Old Reference', value: (r) => r.legacyRef },
      { header: 'Raised', value: (r) => day(r.createdAt) },
      { header: 'Customer Code', value: (r) => r.customer.partyCode },
      { header: 'Customer', value: (r) => partyLabel(r.customer) },
      { header: 'Phone', value: (r) => `${r.customer.phoneCc} ${r.customer.phone}` },
      { header: 'City', value: (r) => r.customer.city },
      { header: 'Site', value: (r) => r.siteLocation },
      { header: 'Product', value: (r) => r.product?.productName ?? null },
      { header: 'Problem', value: (r) => r.description },
      { header: 'Priority', value: (r) => r.priority },
      { header: 'Status', value: (r) => r.status },
      { header: 'Technician', value: (r) => r.assignedTechnician?.fullName ?? null },
      { header: 'Assigned', value: (r) => day(r.assignedAt) },
      { header: 'Resolved', value: (r) => day(r.resolvedAt) },
      { header: 'Closed', value: (r) => day(r.closedAt) },
      { header: 'Days To Close', value: (r) => daysBetween(r.createdAt, r.closedAt ?? r.resolvedAt) },
      { header: 'Resolution', value: (r) => r.resolutionType },
      { header: 'Visits', value: (r) => r._count.visits },
      { header: 'Repair Challans', value: (r) => r._count.challans },
      { header: 'Replacements', value: (r) => r._count.replacements },
      { header: 'From Customer Portal', value: (r) => r.raisedByPortal },
    ],
  }),

  def({
    id: 'service-visits',
    name: 'Service Visits',
    description: 'Visits scheduled in the period - technician, purpose, check-in at site and the outcome.',
    category: 'Service',
    dated: true,
    permission: 'complaints.view',
    run: (scope, from, to) => db.serviceVisit.findMany({
      where: { complaint: scopeWhere(scope), scheduledAt: { gte: from, lte: to } },
      select: {
        scheduledAt: true, purpose: true, status: true, outcomeNote: true, completedAt: true, checkedInAt: true,
        checkInDistanceM: true, checkInWithinRange: true,
        technician: { select: { fullName: true } },
        complaint: { select: { complaintNo: true, customer: { select: { companyName: true, firstName: true, lastName: true } } } },
        installationChallan: { select: { challanNo: true, salesOrder: { select: { customerName: true } } } },
        amcContract: { select: { contractNo: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Scheduled', value: (r) => stamp(r.scheduledAt) },
      { header: 'Technician', value: (r) => r.technician.fullName },
      // Either document - a visit can be booked for a new installation now.
      { header: 'Job / challan', value: (r) => r.complaint?.complaintNo ?? r.installationChallan?.challanNo ?? null },
      { header: 'Customer', value: (r) => (r.complaint ? partyLabel(r.complaint.customer) : r.installationChallan?.salesOrder?.customerName ?? null) },
      { header: 'Purpose', value: (r) => r.purpose },
      { header: 'AMC', value: (r) => r.amcContract?.contractNo ?? null },
      { header: 'Status', value: (r) => r.status },
      { header: 'Checked In', value: (r) => stamp(r.checkedInAt) },
      { header: 'Distance From Site (m)', value: (r) => r.checkInDistanceM },
      { header: 'At Site', value: (r) => (r.checkInWithinRange === null ? '' : r.checkInWithinRange) },
      { header: 'Completed', value: (r) => stamp(r.completedAt) },
      { header: 'Outcome', value: (r) => r.outcomeNote },
    ],
  }),

  def({
    id: 'service-repair-challans',
    name: 'Repair Challans',
    description: 'Parts sent out against complaints in the period, at cost, with approval status.',
    category: 'Service',
    dated: true,
    permission: 'complaints.view',
    run: (scope, from, to) => db.repairChallan.findMany({
      where: { ...scopeWhere(scope), dispatchedAt: { gte: from, lte: to } },
      select: {
        challanNo: true, legacyRef: true, physicalChallanNo: true, dispatchedAt: true, qty: true, costPaise: true,
        status: true, approvedAt: true, rejectionReason: true, technicianRemark: true, note: true,
        product: { select: { productName: true, productCode: true } },
        complaint: { select: { complaintNo: true, customer: { select: { companyName: true, firstName: true, lastName: true } } } },
      },
      orderBy: { dispatchedAt: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Challan No', value: (r) => r.challanNo },
      { header: 'Book No', value: (r) => r.physicalChallanNo },
      { header: 'Old Reference', value: (r) => r.legacyRef },
      { header: 'Dispatched', value: (r) => day(r.dispatchedAt) },
      { header: 'Complaint', value: (r) => r.complaint.complaintNo },
      { header: 'Customer', value: (r) => partyLabel(r.complaint.customer) },
      { header: 'Part', value: (r) => r.product.productName },
      { header: 'Part Code', value: (r) => r.product.productCode },
      { header: 'Qty', value: (r) => r.qty },
      { header: 'Cost', value: (r) => rupees(r.costPaise) },
      { header: 'Status', value: (r) => r.status },
      { header: 'Approved', value: (r) => day(r.approvedAt) },
      { header: 'Rejection Reason', value: (r) => r.rejectionReason },
      { header: 'Technician Remark', value: (r) => r.technicianRemark },
      { header: 'Note', value: (r) => r.note },
    ],
  }),

  def({
    id: 'service-installation-challans',
    name: 'Installation Challans',
    description: 'Installations dispatched in the period - order, customer, team, items and completion.',
    category: 'Service',
    dated: true,
    permission: 'complaints.view',
    run: (scope, from, to) => db.installationChallan.findMany({
      where: { ...scopeWhere(scope), dispatchedAt: { gte: from, lte: to } },
      select: {
        challanNo: true, legacyRef: true, physicalChallanNo: true, dispatchedAt: true, completedAt: true,
        status: true, approvedAt: true, rejectionReason: true, technicianRemark: true,
        salesOrder: { select: { orderNo: true, customerName: true } },
        assignees: { select: { user: { select: { fullName: true } } } },
        items: { select: { productName: true, qty: true } },
      },
      orderBy: { dispatchedAt: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Challan No', value: (r) => r.challanNo },
      { header: 'Book No', value: (r) => r.physicalChallanNo },
      { header: 'Old Reference', value: (r) => r.legacyRef },
      { header: 'Dispatched', value: (r) => day(r.dispatchedAt) },
      { header: 'Sales Order', value: (r) => r.salesOrder?.orderNo ?? null },
      { header: 'Customer', value: (r) => r.salesOrder?.customerName ?? null },
      { header: 'Team', value: (r) => r.assignees.map((a) => a.user.fullName).join(', ') },
      { header: 'Items', value: (r) => r.items.map((i) => `${i.productName}${i.qty > 1 ? ` x${i.qty}` : ''}`).join('; ') },
      { header: 'Status', value: (r) => r.status },
      { header: 'Approved', value: (r) => day(r.approvedAt) },
      { header: 'Completed', value: (r) => day(r.completedAt) },
      { header: 'Rejection Reason', value: (r) => r.rejectionReason },
      { header: 'Technician Remark', value: (r) => r.technicianRemark },
    ],
  }),

  def({
    id: 'service-technicians',
    name: 'Technician Performance',
    description: 'Per technician: complaints assigned in the period, closed, still open, average days to close, visits done and checked in at site.',
    category: 'Service',
    dated: true,
    permission: 'complaints.view',
    run: async (scope, from, to) => {
      const [complaints, visits] = await Promise.all([
        db.complaint.findMany({
          where: { ...scopeWhere(scope), assignedTechnicianId: { not: null }, assignedAt: { gte: from, lte: to } },
          select: { assignedTechnicianId: true, createdAt: true, closedAt: true, resolvedAt: true, assignedTechnician: { select: { fullName: true } } },
          take: LIST_MAX_ROWS,
        }),
        db.serviceVisit.findMany({
          where: { complaint: scopeWhere(scope), scheduledAt: { gte: from, lte: to } },
          select: { technicianId: true, status: true, checkInWithinRange: true, technician: { select: { fullName: true } } },
          take: LIST_MAX_ROWS,
        }),
      ]);
      const by = new Map<string, { name: string; assigned: number; closed: number; open: number; closeDays: number[]; visits: number; done: number; atSite: number }>();
      const get = (id: string, name: string) => {
        let t = by.get(id);
        if (!t) { t = { name, assigned: 0, closed: 0, open: 0, closeDays: [], visits: 0, done: 0, atSite: 0 }; by.set(id, t); }
        return t;
      };
      for (const c of complaints) {
        const t = get(c.assignedTechnicianId!, c.assignedTechnician?.fullName ?? '');
        t.assigned += 1;
        const end = c.closedAt ?? c.resolvedAt;
        if (end) { t.closed += 1; t.closeDays.push(daysBetween(c.createdAt, end) ?? 0); } else t.open += 1;
      }
      for (const v of visits) {
        const t = get(v.technicianId, v.technician.fullName);
        t.visits += 1;
        if (v.status === 'completed') t.done += 1;
        if (v.checkInWithinRange) t.atSite += 1;
      }
      return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    columns: [
      { header: 'Technician', value: (r) => r.name },
      { header: 'Complaints Assigned', value: (r) => r.assigned },
      { header: 'Closed', value: (r) => r.closed },
      { header: 'Still Open', value: (r) => r.open },
      { header: 'Avg Days To Close', value: (r) => (r.closeDays.length ? Number((r.closeDays.reduce((n, d) => n + d, 0) / r.closeDays.length).toFixed(1)) : '') },
      { header: 'Visits Scheduled', value: (r) => r.visits },
      { header: 'Visits Completed', value: (r) => r.done },
      { header: 'Checked In At Site', value: (r) => r.atSite },
    ],
  }),

  def({
    id: 'service-amc-renewals',
    name: 'AMC Renewals Due',
    description: 'Active contracts ending in the period, with value and visits used - the renewal call list.',
    category: 'Service',
    dated: true,
    permission: 'complaints.view',
    run: (scope, from, to) => db.amcContract.findMany({
      where: { ...scopeWhere(scope), status: 'active', endDate: { gte: from, lte: to } },
      select: {
        contractNo: true, startDate: true, endDate: true, amountPaise: true, visitsIncluded: true, siteLabel: true,
        customer: { select: { partyCode: true, companyName: true, firstName: true, lastName: true, phoneCc: true, phone: true, city: true } },
        renewedTo: { select: { contractNo: true } },
        _count: { select: { visits: { where: { status: 'completed' } } } },
      },
      orderBy: { endDate: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Contract No', value: (r) => r.contractNo },
      { header: 'Customer Code', value: (r) => r.customer.partyCode },
      { header: 'Customer', value: (r) => partyLabel(r.customer) },
      { header: 'Phone', value: (r) => `${r.customer.phoneCc} ${r.customer.phone}` },
      { header: 'City', value: (r) => r.customer.city },
      { header: 'Site', value: (r) => r.siteLabel },
      { header: 'Start', value: (r) => day(r.startDate) },
      { header: 'Ends', value: (r) => day(r.endDate) },
      { header: 'Value', value: (r) => rupees(r.amountPaise) },
      { header: 'Visits Included', value: (r) => (r.visitsIncluded === null ? 'Unlimited' : r.visitsIncluded) },
      { header: 'Visits Used', value: (r) => r._count.visits },
      { header: 'Already Renewed As', value: (r) => r.renewedTo.map((x) => x.contractNo).join(', ') },
    ],
  }),

  def({
    /**
     * What the business's AMC income setting did (decision 3). A contract
     * whose fee went to "AMC Received in Advance" is spread; one whose fee
     * went straight to income was booked at invoice. Read off the ledger per
     * contract, so the report shows what actually happened even for contracts
     * invoiced before the setting changed.
     */
    id: 'service-amc-income',
    name: 'AMC Income',
    description: 'Per billed contract: how its fee is booked (spread monthly or at invoice), earned in the period, earned to date and still held in advance.',
    category: 'Service',
    dated: true,
    permission: 'accounts.view',
    run: async (scope, from, to) => {
      const contracts = await db.amcContract.findMany({
        where: { ...scopeWhere(scope), invoiceId: { not: null }, amountPaise: { gt: 0 } },
        select: {
          id: true, contractNo: true, startDate: true, endDate: true, amountPaise: true, status: true, invoiceId: true,
          invoice: { select: { invoiceNo: true, invoiceDate: true } },
          customer: { select: { companyName: true, firstName: true, lastName: true } },
        },
        orderBy: { startDate: 'asc' },
        take: LIST_MAX_ROWS,
      });
      const lines = await db.journalLine.findMany({
        where: {
          account: { code: '2500' },
          journalEntry: {
            ...scopeWhere(scope),
            OR: [
              { sourceType: 'invoice', sourceId: { in: contracts.map((c) => c.invoiceId!) } },
              { sourceType: 'amc_recognition', sourceId: { in: contracts.map((c) => c.id) } },
            ],
          },
        },
        select: { debitPaise: true, creditPaise: true, journalEntry: { select: { sourceType: true, sourceId: true, entryDate: true } } },
      });
      return contracts.map((c) => {
        let held = 0; let released = 0; let releasedInPeriod = 0;
        for (const l of lines) {
          const e = l.journalEntry;
          if (e.sourceType === 'invoice' && e.sourceId === c.invoiceId) held += l.creditPaise - l.debitPaise;
          if (e.sourceType === 'amc_recognition' && e.sourceId === c.id) {
            const amt = l.debitPaise - l.creditPaise;
            released += amt;
            if (e.entryDate >= from && e.entryDate <= to) releasedInPeriod += amt;
          }
        }
        const spread = held > 0;
        const invoiced = c.invoice?.invoiceDate ?? null;
        const atInvoiceInPeriod = !spread && invoiced && invoiced >= from && invoiced <= to ? c.amountPaise : 0;
        return {
          ...c,
          customerName: partyLabel(c.customer),
          booking: spread ? 'Spread monthly' : 'At invoice',
          earnedInPeriod: spread ? releasedInPeriod : atInvoiceInPeriod,
          earnedToDate: spread ? released : c.amountPaise,
          stillHeld: spread ? held - released : 0,
        };
      });
    },
    columns: [
      { header: 'Contract No', value: (r) => r.contractNo },
      { header: 'Customer', value: (r) => r.customerName },
      { header: 'Invoice', value: (r) => r.invoice?.invoiceNo ?? null },
      { header: 'Start', value: (r) => day(r.startDate) },
      { header: 'End', value: (r) => day(r.endDate) },
      { header: 'Status', value: (r) => AMC_STATUS_LABEL[r.status] ?? r.status },
      { header: 'Fee', value: (r) => rupees(r.amountPaise) },
      { header: 'Booked', value: (r) => r.booking },
      { header: 'Earned In Period', value: (r) => rupees(r.earnedInPeriod) },
      { header: 'Earned To Date', value: (r) => rupees(r.earnedToDate) },
      { header: 'Still Held In Advance', value: (r) => rupees(r.stillHeld) },
    ],
  }),

  // ================================================================== Tasks
  def({
    id: 'tasks-register',
    name: 'Tasks',
    description: 'Tasks created in the period - who has them, due dates, what got done and what is overdue.',
    category: 'Tasks',
    dated: true,
    permission: 'tasks.edit',
    run: async (scope, from, to) => {
      const rows = await db.task.findMany({
        where: { ...scopeWhere(scope), createdAt: { gte: from, lte: to } },
        select: {
          title: true, description: true, status: true, priority: true, dueDate: true, createdAt: true, completedAt: true,
          createdBy: true, assignedTo: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: LIST_MAX_ROWS,
      });
      const names = await userNames(rows.map((r) => r.createdBy));
      return rows.map((r) => ({ ...r, createdByName: r.createdBy ? names.get(r.createdBy) ?? null : null }));
    },
    columns: [
      { header: 'Created', value: (r) => day(r.createdAt) },
      { header: 'Task', value: (r) => r.title },
      { header: 'Details', value: (r) => r.description },
      { header: 'Assigned To', value: (r) => r.assignedTo?.fullName ?? null },
      { header: 'Created By', value: (r) => r.createdByName },
      { header: 'Priority', value: (r) => r.priority },
      { header: 'Status', value: (r) => r.status },
      { header: 'Due', value: (r) => day(r.dueDate) },
      { header: 'Completed', value: (r) => day(r.completedAt) },
      { header: 'Overdue', value: (r) => !!r.dueDate && !r.completedAt && r.status !== 'Cancelled' && r.dueDate < new Date() },
    ],
  }),

  def({
    id: 'tasks-by-person',
    name: 'Tasks by Person',
    description: 'Per person: tasks given in the period, completed, pending and overdue.',
    category: 'Tasks',
    dated: true,
    permission: 'tasks.edit',
    run: async (scope, from, to) => {
      const rows = await db.task.findMany({
        where: { ...scopeWhere(scope), createdAt: { gte: from, lte: to } },
        select: { status: true, dueDate: true, completedAt: true, assignedTo: { select: { fullName: true } } },
        take: LIST_MAX_ROWS,
      });
      const now = new Date();
      const by = new Map<string, { name: string; total: number; done: number; pending: number; overdue: number }>();
      for (const r of rows) {
        const name = r.assignedTo?.fullName ?? 'Unassigned';
        const t = by.get(name) ?? { name, total: 0, done: 0, pending: 0, overdue: 0 };
        t.total += 1;
        if (r.completedAt || r.status === 'Completed') t.done += 1;
        else if (r.status !== 'Cancelled') { t.pending += 1; if (r.dueDate && r.dueDate < now) t.overdue += 1; }
        by.set(name, t);
      }
      return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    columns: [
      { header: 'Person', value: (r) => r.name },
      { header: 'Tasks', value: (r) => r.total },
      { header: 'Completed', value: (r) => r.done },
      { header: 'Pending', value: (r) => r.pending },
      { header: 'Overdue', value: (r) => r.overdue },
    ],
  }),

  // ==================================================================== CRM
  def({
    id: 'crm-leads',
    name: 'Leads Register',
    description: 'Leads added in the period - source, stage, owner, value, last contact and next follow-up.',
    category: 'CRM',
    dated: true,
    permission: 'leads.view',
    run: async (scope, from, to) => {
      const rows = await db.lead.findMany({
        where: { ...scopeWhere(scope), createdAt: { gte: from, lte: to } },
        select: {
          leadCode: true, firstName: true, lastName: true, businessName: true, mobileCc: true, mobile: true, email: true, city: true,
          requirement: true, potentialPaise: true, priority: true, lastTalkAt: true, nextActionAt: true, isClosed: true,
          convertedAt: true, createdAt: true, assignedToUserId: true,
          source: { select: { name: true } }, stage: { select: { name: true } }, dealStage: { select: { name: true } },
          _count: { select: { activities: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: LIST_MAX_ROWS,
      });
      const names = await userNames(rows.map((r) => r.assignedToUserId));
      return rows.map((r) => ({ ...r, owner: r.assignedToUserId ? names.get(r.assignedToUserId) ?? null : null }));
    },
    columns: [
      { header: 'Lead', value: (r) => r.leadCode },
      { header: 'Added', value: (r) => day(r.createdAt) },
      { header: 'Name', value: (r) => [r.firstName, r.lastName].filter(Boolean).join(' ') },
      { header: 'Business', value: (r) => r.businessName },
      { header: 'Mobile', value: (r) => `${r.mobileCc} ${r.mobile}` },
      { header: 'Email', value: (r) => r.email },
      { header: 'City', value: (r) => r.city },
      { header: 'Source', value: (r) => r.source?.name ?? null },
      { header: 'Stage', value: (r) => r.stage?.name ?? null },
      { header: 'Deal Stage', value: (r) => r.dealStage?.name ?? null },
      { header: 'Owner', value: (r) => r.owner },
      { header: 'Requirement', value: (r) => r.requirement },
      { header: 'Potential', value: (r) => rupees(r.potentialPaise) },
      { header: 'Priority', value: (r) => r.priority },
      { header: 'Activities', value: (r) => r._count.activities },
      { header: 'Last Contact', value: (r) => day(r.lastTalkAt) },
      { header: 'Next Follow-up', value: (r) => day(r.nextActionAt) },
      { header: 'Closed', value: (r) => r.isClosed },
      { header: 'Converted To Customer', value: (r) => day(r.convertedAt) },
    ],
  }),

  def({
    id: 'crm-follow-ups',
    name: 'Follow-ups Due',
    description: 'Open leads whose next follow-up falls in the period or is already overdue, oldest first.',
    category: 'CRM',
    dated: true,
    permission: 'leads.view',
    run: async (scope, _from, to) => {
      const rows = await db.lead.findMany({
        where: { ...scopeWhere(scope), isClosed: false, archivedAt: null, nextActionAt: { not: null, lte: to } },
        select: {
          leadCode: true, firstName: true, lastName: true, businessName: true, mobileCc: true, mobile: true,
          nextActionAt: true, lastTalkAt: true, assignedToUserId: true, stage: { select: { name: true } },
        },
        orderBy: { nextActionAt: 'asc' },
        take: LIST_MAX_ROWS,
      });
      const names = await userNames(rows.map((r) => r.assignedToUserId));
      return rows.map((r) => ({ ...r, owner: r.assignedToUserId ? names.get(r.assignedToUserId) ?? null : null }));
    },
    columns: [
      { header: 'Follow-up Due', value: (r) => day(r.nextActionAt) },
      { header: 'Days Overdue', value: (r) => Math.max(0, daysBetween(r.nextActionAt!, new Date()) ?? 0) },
      { header: 'Lead', value: (r) => r.leadCode },
      { header: 'Name', value: (r) => [r.firstName, r.lastName].filter(Boolean).join(' ') },
      { header: 'Business', value: (r) => r.businessName },
      { header: 'Mobile', value: (r) => `${r.mobileCc} ${r.mobile}` },
      { header: 'Stage', value: (r) => r.stage?.name ?? null },
      { header: 'Owner', value: (r) => r.owner },
      { header: 'Last Contact', value: (r) => day(r.lastTalkAt) },
    ],
  }),

  def({
    id: 'crm-lead-activity',
    name: 'Lead Activity',
    description: 'Every call, visit, message and note logged against a lead in the period, and by whom.',
    category: 'CRM',
    dated: true,
    permission: 'leads.view',
    run: async (scope, from, to) => {
      const rows = await db.leadActivity.findMany({
        where: { lead: scopeWhere(scope), occurredAt: { gte: from, lte: to } },
        select: {
          channel: true, type: true, outcome: true, durationSec: true, occurredAt: true, createdBy: true, note: true,
          lead: { select: { leadCode: true, firstName: true, lastName: true, businessName: true } },
        },
        orderBy: { occurredAt: 'asc' },
        take: LIST_MAX_ROWS,
      });
      const names = await userNames(rows.map((r) => r.createdBy));
      return rows.map((r) => ({ ...r, by: r.createdBy ? names.get(r.createdBy) ?? null : null }));
    },
    columns: [
      { header: 'When', value: (r) => stamp(r.occurredAt) },
      { header: 'Lead', value: (r) => r.lead.leadCode },
      { header: 'Name', value: (r) => [r.lead.firstName, r.lead.lastName].filter(Boolean).join(' ') },
      { header: 'Business', value: (r) => r.lead.businessName },
      { header: 'Channel', value: (r) => r.channel },
      { header: 'Type', value: (r) => r.type },
      { header: 'Outcome', value: (r) => r.outcome },
      { header: 'Duration (sec)', value: (r) => r.durationSec },
      { header: 'By', value: (r) => r.by },
      { header: 'Note', value: (r) => r.note },
    ],
  }),

  def({
    id: 'crm-source-conversion',
    name: 'Lead Source Conversion',
    description: 'Per lead source: leads added in the period, won, lost, still open, conversion rate and pipeline value.',
    category: 'CRM',
    dated: true,
    permission: 'leads.view',
    run: async (scope, from, to) => {
      const rows = await db.lead.findMany({
        where: { ...scopeWhere(scope), createdAt: { gte: from, lte: to } },
        select: { potentialPaise: true, convertedAt: true, source: { select: { name: true } }, stage: { select: { isWon: true, isLost: true } } },
        take: LIST_MAX_ROWS,
      });
      const by = new Map<string, { source: string; total: number; won: number; lost: number; open: number; potential: number }>();
      for (const r of rows) {
        const source = r.source?.name ?? 'No source';
        const t = by.get(source) ?? { source, total: 0, won: 0, lost: 0, open: 0, potential: 0 };
        t.total += 1;
        t.potential += r.potentialPaise;
        if (r.stage?.isWon || r.convertedAt) t.won += 1;
        else if (r.stage?.isLost) t.lost += 1;
        else t.open += 1;
        by.set(source, t);
      }
      return [...by.values()].sort((a, b) => b.total - a.total);
    },
    columns: [
      { header: 'Source', value: (r) => r.source },
      { header: 'Leads', value: (r) => r.total },
      { header: 'Won', value: (r) => r.won },
      { header: 'Lost', value: (r) => r.lost },
      { header: 'Open', value: (r) => r.open },
      { header: 'Conversion %', value: (r) => (r.total ? Number(((r.won / r.total) * 100).toFixed(1)) : 0) },
      { header: 'Pipeline Value', value: (r) => rupees(r.potential) },
    ],
  }),

  // ================================================================== Calls
  def({
    id: 'calls-by-person',
    name: 'Calls by Person',
    description: 'Per person: calls made and received, missed, talk time, and how many were with known customers or leads.',
    category: 'Calls',
    dated: true,
    permission: 'calls.view',
    run: async (scope, from, to) => {
      const calls = await listCalls(scope, { from, to, take: LIST_MAX_ROWS });
      const by = new Map<string, { name: string; total: number; outgoing: number; incoming: number; missed: number; talkSec: number; crm: number }>();
      for (const c of calls) {
        const name = c.userName ?? 'Unknown';
        const t = by.get(name) ?? { name, total: 0, outgoing: 0, incoming: 0, missed: 0, talkSec: 0, crm: 0 };
        t.total += 1;
        if (c.direction === 'outgoing') t.outgoing += 1;
        else if (c.direction === 'incoming') t.incoming += 1;
        else t.missed += 1;
        t.talkSec += c.durationSec ?? 0;
        if (c.matchedCrm) t.crm += 1;
        by.set(name, t);
      }
      return [...by.values()].sort((a, b) => b.total - a.total);
    },
    columns: [
      { header: 'Person', value: (r) => r.name },
      { header: 'Calls', value: (r) => r.total },
      { header: 'Outgoing', value: (r) => r.outgoing },
      { header: 'Incoming', value: (r) => r.incoming },
      { header: 'Missed / Rejected', value: (r) => r.missed },
      { header: 'Talk Time (min)', value: (r) => Number((r.talkSec / 60).toFixed(1)) },
      { header: 'With Customers / Leads', value: (r) => r.crm },
    ],
  }),

  // ============================================================= Attendance
  def({
    id: 'attendance-days',
    name: 'Attendance by Day',
    description: 'One row per person per day: first in, last out, hours and status - website and Vcare alike.',
    category: 'Attendance',
    dated: true,
    permission: 'attendance.view',
    run: (scope, from, to) => db.attendanceDay.findMany({
      where: { ...scopeWhere(scope), workDate: { gte: isoDay(from), lte: isoDay(to) } },
      select: {
        workDate: true, firstInAt: true, firstInSource: true, lastOutAt: true, lastOutSource: true, workedMinutes: true, status: true,
        user: { select: { fullName: true, userCode: true } },
      },
      orderBy: [{ workDate: 'asc' }],
      take: LIST_MAX_ROWS,
    }),
    columns: [
      { header: 'Date', value: (r) => r.workDate },
      { header: 'Employee', value: (r) => r.user.fullName },
      { header: 'Code', value: (r) => r.user.userCode },
      { header: 'Status', value: (r) => r.status },
      { header: 'First In', value: (r) => clock(r.firstInAt) },
      { header: 'In From', value: (r) => r.firstInSource },
      { header: 'Last Out', value: (r) => clock(r.lastOutAt) },
      { header: 'Out From', value: (r) => r.lastOutSource },
      { header: 'Hours', value: (r) => (r.workedMinutes === null ? '' : Number((r.workedMinutes / 60).toFixed(2))) },
    ],
  }),

  def({
    id: 'attendance-summary',
    name: 'Attendance Summary',
    description: 'Per person for the period: days present, total and average hours.',
    category: 'Attendance',
    dated: true,
    permission: 'attendance.view',
    run: async (scope, from, to) => {
      const days = await db.attendanceDay.findMany({
        where: { ...scopeWhere(scope), workDate: { gte: isoDay(from), lte: isoDay(to) } },
        select: { userId: true, workedMinutes: true, firstInAt: true, user: { select: { fullName: true, userCode: true } } },
        take: LIST_MAX_ROWS,
      });
      const by = new Map<string, { name: string; code: string; days: number; minutes: number; closed: number }>();
      for (const d of days) {
        const t = by.get(d.userId) ?? { name: d.user.fullName, code: d.user.userCode, days: 0, minutes: 0, closed: 0 };
        if (d.firstInAt) t.days += 1;
        if (d.workedMinutes !== null) { t.minutes += d.workedMinutes; t.closed += 1; }
        by.set(d.userId, t);
      }
      return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    columns: [
      { header: 'Employee', value: (r) => r.name },
      { header: 'Code', value: (r) => r.code },
      { header: 'Days Present', value: (r) => r.days },
      { header: 'Total Hours', value: (r) => Number((r.minutes / 60).toFixed(2)) },
      { header: 'Average Hours / Day', value: (r) => (r.closed ? Number((r.minutes / r.closed / 60).toFixed(2)) : '') },
    ],
  }),

  def({
    id: 'attendance-checklist',
    name: 'Daily Checklist',
    description: 'Each person, each day: the checklist points ticked (present, on time, dress code and your own), who marked it.',
    category: 'Attendance',
    dated: true,
    permission: 'attendance.view',
    run: async (scope, from, to) => {
      const storeIds = scopeStoreIds(scope);
      const [items, rows] = await Promise.all([
        db.staffChecklistItem.findMany({ where: { storeId: { in: storeIds } }, orderBy: { sort: 'asc' }, select: { key: true, label: true } }),
        db.staffChecklistEntry.findMany({
          where: { ...scopeWhere(scope), workDate: { gte: isoDay(from), lte: isoDay(to) } },
          select: { workDate: true, values: true, note: true, recordedBy: true, user: { select: { fullName: true, userCode: true } } },
          orderBy: [{ workDate: 'asc' }],
          take: LIST_MAX_ROWS,
        }),
      ]);
      const labels = new Map(items.map((i) => [i.key, i.label]));
      const names = await userNames(rows.map((r) => r.recordedBy));
      return rows.map((r) => {
        const v = r.values as Record<string, boolean>;
        return {
          date: r.workDate, name: r.user.fullName, code: r.user.userCode,
          ticked: Object.entries(v).filter(([, on]) => on).map(([k]) => labels.get(k) ?? k).join(', '),
          notTicked: Object.entries(v).filter(([, on]) => !on).map(([k]) => labels.get(k) ?? k).join(', '),
          note: r.note, by: r.recordedBy ? names.get(r.recordedBy) ?? null : 'Old system',
        };
      });
    },
    columns: [
      { header: 'Date', value: (r) => r.date },
      { header: 'Employee', value: (r) => r.name },
      { header: 'Code', value: (r) => r.code },
      { header: 'Ticked', value: (r) => r.ticked },
      { header: 'Not Ticked', value: (r) => r.notTicked },
      { header: 'Note', value: (r) => r.note },
      { header: 'Marked By', value: (r) => r.by },
    ],
  }),

  // ================================================================== Audit
  def({
    id: 'audit-changes',
    name: 'Changes (Audit Trail)',
    description: 'Every record added, changed or removed in the period - who, what, from where, and the before/after values.',
    category: 'Audit',
    dated: true,
    permission: 'users.view',
    run: async (scope, from, to) => (await listAuditEvents(scope, scopeStoreIds(scope), { from, to }, 0, LIST_MAX_ROWS)).rows,
    columns: [
      { header: 'When', value: (r) => r.at },
      { header: 'Action', value: (r) => r.action },
      { header: 'Record Type', value: (r) => r.tableLabel },
      { header: 'Record', value: (r) => r.label ?? r.rowId },
      { header: 'Person', value: (r) => r.actor },
      { header: 'Via', value: (r) => r.via },
      { header: 'IP', value: (r) => r.ip },
      { header: 'Changes', value: (r) => r.changes.map((c) => `${c.field}: ${c.from ?? '(empty)'} -> ${c.to ?? '(empty)'}`).join('; ') },
    ],
  }),

  def({
    id: 'audit-sign-ins',
    name: 'Sign-ins',
    description: 'Sign-ins, sign-outs, failed attempts and locked accounts in the period.',
    category: 'Audit',
    dated: true,
    permission: 'users.view',
    run: async (scope, from, to) => (await listSignInEvents(scope, scopeStoreIds(scope), { from, to }, 0, LIST_MAX_ROWS)).rows,
    columns: [
      { header: 'When', value: (r) => r.at },
      { header: 'Type', value: (r) => r.type },
      { header: 'Person', value: (r) => r.actor },
      { header: 'IP', value: (r) => r.ip },
      { header: 'Description', value: (r) => r.description },
    ],
  }),
];

export function findReport(id: string): ReportDef | undefined {
  return REPORTS.find((r) => r.id === id);
}
