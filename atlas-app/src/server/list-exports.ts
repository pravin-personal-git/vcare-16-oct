import 'server-only';
import { stageNamer } from './order-stages';
import { isDayKey, istToday, monthDays } from '@/lib/attendance-day';
import { istDayEnd, istDayStart } from '@/lib/date-ranges';
import type { AppContext } from './context';
import { visitReasonLabel } from '@/lib/visit-reasons';
import type { CsvColumn } from '@/lib/csv';
import { complaintsList } from './complaints-list';
import { invoicesList } from './invoices-list';
import { tasksList } from './tasks-list';
import { repairsList } from './repairs-list';
import { installationsList } from './installations-list';
import { replacementsList } from './replacements-list';
import { amcList } from './amc-list';
import { visitsList } from './visits-list';
import { leadsList } from './leads-list';
import { quotationsList } from './quotations-list';
import { ordersList } from './orders-list';
import { receiptsList } from './receipts-list';
import { customersList } from './customers-list';
import { productsList } from './products-list';
import { unitsList } from './units-list';
import { grnList } from './grn-list';
import { gdnList } from './gdn-list';
import { suppliersList } from './suppliers-list';
import { poList } from './po-list';
import { callsList } from './calls-list';
import { renewalsList } from './renewals-list';
import { shiftsList } from './shifts-list';
import { teamToday } from './team-today';
import { creditNotesList } from './credit-notes-list';
import { billsList } from './bills-list';
import { returnsList } from './returns-list';
import { transactionsList } from './transactions-list';
import { loansList } from './loans-list';
import { CARD_LISTS, cardListExport } from './card-lists';
import { findReport } from './report-catalogue';
import { DIRECTION_LABEL } from '@/lib/call-log';
import { PO_STATUS_LABEL } from '@/lib/purchase-order-status';
import { UNIT_STATUS_LABEL, UNIT_CONDITION_LABEL } from '@/lib/stock-units';
import { METHOD_LABEL } from '@/lib/receipt';
import { PAYMENT_LABEL } from '@/lib/sales-order-status';
import { AMC_STATUS_LABEL } from '@/lib/amc-status';
import { RMA_STATUS_LABEL } from '@/lib/rma';

const CHALLAN_STATUS: Record<string, string> = { pending: 'Pending', work_done: 'Work done', approved: 'Approved', rejected: 'Rejected', legacy_unknown: 'Not recorded' };
import { STATUS_LABEL as INVOICE_STATUS } from '@/lib/invoice-status';

/** Paise to rupees as a plain number, so Excel can add it up. */
const rupees = (paise: number) => Math.round(paise) / 100;

/**
 * "Export" on a list screen (F1 UI standard). One entry per screen: it reuses
 * the screen's own filtering function, so the file is exactly what the screen
 * shows, across all its pages, with the columns a person would expect.
 *
 * Who may export is decided in the route (office and admin, decision Q1) and
 * by the screen's own route permission - never by whether the button showed.
 */

export interface ListExport {
  /** The screen it belongs to - its route permission gates the export too. */
  route: string;
  /** File and sheet name. */
  title: string;
  load: (ctx: AppContext, sp: Record<string, string | undefined>) => Promise<{
    rows: unknown[];
    columns: CsvColumn<never>[];
    /** Words describing the filters, written on the file name. */
    rangeLabel?: string;
  }>;
}

const day = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';

const STATUS: Record<string, string> = {
  received: 'Received', assigned: 'Assigned', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed',
};

function cols<T>(c: CsvColumn<T>[]): CsvColumn<never>[] {
  return c as unknown as CsvColumn<never>[];
}

export const LIST_EXPORTS: Record<string, ListExport> = {
  complaints: {
    route: '/services/complaints',
    title: 'Customer Complaints',
    async load(ctx, sp) {
      const { rows, filters } = await complaintsList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Complaint', value: (c) => c.complaintNo },
          { header: 'Old number', value: (c) => (c.legacyRef && c.legacyRef !== c.complaintNo ? c.legacyRef : '') },
          { header: 'Raised', value: (c) => day(c.createdAt) },
          { header: 'Customer', value: (c) => c.customerName },
          { header: 'Phone', value: (c) => c.customerPhone },
          { header: 'Status', value: (c) => STATUS[c.status] ?? c.status },
          { header: 'Priority', value: (c) => c.priority },
          { header: 'Technician', value: (c) => c.assignedTechnicianName ?? '' },
          { header: 'Equipment', value: (c) => c.productName ?? '' },
          { header: 'Problem', value: (c) => c.description },
          { header: 'Site', value: (c) => c.siteLocation ?? '' },
          { header: 'Owner', value: (c) => c.ownerName ?? '' },
          { header: 'AMC', value: (c) => c.amcContractNo ?? '' },
        ]),
      };
    },
  },

  invoices: {
    route: '/invoices',
    title: 'Invoices',
    async load(ctx, sp) {
      const { rows, filters } = await invoicesList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Invoice', value: (r) => r.invoiceNo },
          { header: 'Order', value: (r) => r.orderNo ?? 'Direct' },
          { header: 'Date', value: (r) => day(r.invoiceDate) },
          { header: 'Due', value: (r) => day(r.dueDate) },
          { header: 'Customer', value: (r) => r.customerName },
          { header: 'Company', value: (r) => r.organizationName ?? '' },
          { header: 'Phone', value: (r) => r.phone },
          { header: 'GSTIN', value: (r) => r.gstin ?? '' },
          { header: 'State', value: (r) => r.stateId ?? '' },
          { header: 'Taxable (₹)', value: (r) => rupees(r.taxableBasePaise) },
          { header: 'CGST (₹)', value: (r) => rupees(r.cgstPaise) },
          { header: 'SGST (₹)', value: (r) => rupees(r.sgstPaise) },
          { header: 'IGST (₹)', value: (r) => rupees(r.igstPaise) },
          { header: 'Total (₹)', value: (r) => rupees(r.grandTotalPaise) },
          { header: 'Paid (₹)', value: (r) => rupees(r.amountPaidPaise) },
          { header: 'Balance (₹)', value: (r) => rupees(r.duePaise) },
          { header: 'Status', value: (r) => INVOICE_STATUS[r.status] },
          { header: 'Salesperson', value: (r) => r.salespersonName ?? '' },
        ]),
      };
    },
  },

  repairs: {
    route: '/services/repairs',
    title: 'Repair Challans',
    async load(ctx, sp) {
      const { rows, filters } = await repairsList(ctx, sp);
      type R = (typeof rows)[number];
      const STATUS: Record<string, string> = { pending: 'Pending', work_done: 'Work done', approved: 'Approved', rejected: 'Rejected', legacy_unknown: 'Not recorded' };
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Challan', value: (c) => c.challanNo },
          { header: 'Old number', value: (c) => (c.legacyRef && c.legacyRef !== c.challanNo ? c.legacyRef : '') },
          { header: 'Date', value: (c) => day(c.dispatchedAt) },
          { header: 'Complaint', value: (c) => c.complaintNo },
          { header: 'Customer', value: (c) => c.customerName },
          { header: 'Product', value: (c) => c.productName },
          { header: 'Qty', value: (c) => c.qty },
          { header: 'Cost (₹)', value: (c) => rupees(c.costPaise) },
          { header: 'Status', value: (c) => STATUS[c.status] ?? c.status },
          { header: 'Assigned to', value: (c) => c.assigneeNames.join(', ') },
          { header: 'Paper slip', value: (c) => c.physicalChallanNo ?? '' },
          { header: 'Technician remark', value: (c) => c.technicianRemark ?? '' },
          { header: 'AMC', value: (c) => c.amcContractNo ?? '' },
        ]),
      };
    },
  },

  installations: {
    route: '/services/installations',
    title: 'Installation Challans',
    async load(ctx, sp) {
      const { rows, filters } = await installationsList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Challan', value: (c) => c.challanNo },
          { header: 'Old number', value: (c) => (c.legacyRef && c.legacyRef !== c.challanNo ? c.legacyRef : '') },
          { header: 'Date', value: (c) => day(c.dispatchedAt) },
          { header: 'Order', value: (c) => c.orderNo ?? '' },
          { header: 'Customer', value: (c) => c.customerName ?? 'No customer on file' },
          { header: 'Lines', value: (c) => c.itemCount },
          { header: 'Units', value: (c) => c.totalQty },
          { header: 'Status', value: (c) => CHALLAN_STATUS[c.status] ?? c.status },
          { header: 'Assigned to', value: (c) => c.assignees.join(', ') },
          { header: 'Paper slip', value: (c) => c.physicalChallanNo ?? '' },
          { header: 'Technician remark', value: (c) => c.technicianRemark ?? '' },
          { header: 'Sent back because', value: (c) => c.rejectionReason ?? '' },
          { header: 'Completed', value: (c) => day(c.completedAt) },
        ]),
      };
    },
  },

  replacements: {
    route: '/services/replacements',
    title: 'Replacements',
    async load(ctx, sp) {
      const { rows, filters } = await replacementsList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Case', value: (r) => r.caseNo },
          { header: 'Old number', value: (r) => (r.legacyRef && r.legacyRef !== r.caseNo ? r.legacyRef : '') },
          { header: 'Logged', value: (r) => day(r.createdAt) },
          { header: 'Item', value: (r) => r.productName },
          { header: 'Brand / model', value: (r) => r.brandModel ?? '' },
          { header: 'Qty', value: (r) => r.qty },
          { header: 'Serial', value: (r) => r.serialNo ?? '' },
          { header: 'Customer', value: (r) => r.customerName ?? '' },
          { header: 'Complaint', value: (r) => r.complaintNo ?? '' },
          { header: 'Sent to', value: (r) => r.goingTo ?? '' },
          { header: 'Courier', value: (r) => r.courier ?? '' },
          { header: 'Docket', value: (r) => r.docketNo ?? '' },
          { header: 'Sent', value: (r) => day(r.sentAt) },
          { header: 'Expected back', value: (r) => day(r.expectedBackAt) },
          { header: 'Received back', value: (r) => day(r.receivedBackAt) },
          { header: 'Status', value: (r) => (RMA_STATUS_LABEL as Record<string, string>)[r.status] ?? r.status },
          { header: 'Days late', value: (r) => (r.overdue ? r.daysLate : '') },
        ]),
      };
    },
  },

  amc: {
    route: '/services/amc',
    title: 'Maintenance Contracts',
    async load(ctx, sp) {
      const { rows, filters } = await amcList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Contract', value: (r) => r.contractNo },
          { header: 'Old number', value: (r) => r.legacyRef ?? '' },
          { header: 'Customer', value: (r) => r.customerName },
          { header: 'Phone', value: (r) => r.customerPhone ?? '' },
          { header: 'Site', value: (r) => r.siteLabel ?? '' },
          { header: 'Starts', value: (r) => day(r.startDate) },
          { header: 'Ends', value: (r) => day(r.endDate) },
          { header: 'Days to expiry', value: (r) => r.daysToExpiry },
          { header: 'Amount (₹)', value: (r) => rupees(r.amountPaise) },
          { header: 'GST %', value: (r) => r.taxRatePct ?? '' },
          { header: 'Invoice', value: (r) => r.invoiceNo ?? '' },
          { header: 'Billing', value: (r) => r.billing.replace(/_/g, ' ') },
          { header: 'Status', value: (r) => (AMC_STATUS_LABEL as Record<string, string>)[r.status] ?? r.status },
          { header: 'Visits included', value: (r) => r.visitsIncluded ?? '' },
        ]),
      };
    },
  },

  visits: {
    route: '/services/visits',
    title: 'Visits',
    async load(ctx, sp) {
      const { rows, filters } = await visitsList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          // A visit is for a complaint OR a new installation now, so the
          // column names whichever document it is and says which kind.
          { header: 'Job / challan', value: (v) => v.docNo },
          { header: 'Kind', value: (v) => (v.subject === 'installation' ? 'New installation' : 'Complaint') },
          { header: 'Reason', value: (v) => visitReasonLabel(v.reason) },
          { header: 'Customer', value: (v) => v.customerName },
          { header: 'Technician', value: (v) => v.technicianName },
          { header: 'Purpose', value: (v) => (v.purpose === 'field_visit' ? 'Field visit' : 'Collect more details') },
          { header: 'Scheduled', value: (v) => day(v.scheduledAt) },
          { header: 'Status', value: (v) => v.status },
          { header: 'Checked in', value: (v) => day(v.checkedInAt) },
          { header: 'Metres from site', value: (v) => v.checkInDistanceM ?? '' },
          { header: 'Outcome', value: (v) => v.outcomeNote ?? '' },
        ]),
      };
    },
  },

  leads: {
    route: '/crm/leads',
    title: 'Leads',
    async load(ctx, sp) {
      const { rows, filters } = await leadsList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Lead', value: (r) => r.leadCode },
          { header: 'Name', value: (r) => r.displayName },
          { header: 'Business', value: (r) => r.businessName ?? '' },
          { header: 'Mobile', value: (r) => r.mobile },
          { header: 'Email', value: (r) => r.email ?? '' },
          { header: 'City', value: (r) => r.city ?? '' },
          { header: 'Requirement', value: (r) => r.requirement ?? '' },
          { header: 'Stage', value: (r) => r.stageName ?? '' },
          { header: 'Deal', value: (r) => r.dealStageName ?? '' },
          { header: 'Potential (₹)', value: (r) => rupees(r.potentialPaise) },
          { header: 'Source', value: (r) => r.sourceName ?? '' },
          { header: 'Assigned to', value: (r) => r.assignedToName ?? 'Unassigned' },
          { header: 'Next action', value: (r) => day(r.nextActionAt) },
          { header: 'Last talk', value: (r) => day(r.lastTalkAt) },
          { header: 'Since', value: (r) => day(r.sinceDate) },
          { header: 'Closed', value: (r) => (r.isClosed ? 'Yes' : '') },
          { header: 'Converted', value: (r) => (r.convertedCustomerId ? 'Yes' : '') },
          { header: 'Tags', value: (r) => r.tags.join(', ') },
        ]),
      };
    },
  },

  quotations: {
    route: '/quotation',
    title: 'Quotations',
    async load(ctx, sp) {
      const { rows, filters } = await quotationsList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Quotation', value: (r) => r.quotationNo },
          { header: 'Date', value: (r) => day(r.quotationDate) },
          { header: 'Valid until', value: (r) => day(r.validUntil) },
          { header: 'Customer', value: (r) => r.customerName },
          { header: 'Company', value: (r) => r.organizationName ?? '' },
          { header: 'Phone', value: (r) => r.phone },
          { header: 'Email', value: (r) => r.email ?? '' },
          { header: 'City', value: (r) => r.city ?? '' },
          { header: 'From', value: (r) => r.source },
          { header: 'Items', value: (r) => r.itemCount },
          { header: 'Total (₹)', value: (r) => rupees(r.grandTotalPaise) },
          { header: 'Status', value: (r) => r.status },
          { header: 'Salesperson', value: (r) => r.salespersonName ?? '' },
        ]),
      };
    },
  },

  orders: {
    route: '/sales/orders',
    title: 'Sales Orders',
    async load(ctx, sp) {
      const { rows, filters } = await ordersList(ctx, sp);
      const stage = await stageNamer(ctx.scope);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Order', value: (r) => r.orderNo },
          { header: 'From quotation', value: (r) => r.quotationNo ?? '' },
          { header: 'Ordered', value: (r) => day(r.orderDate) },
          { header: 'Expected', value: (r) => day(r.expectedDeliveryDate) },
          { header: 'Customer', value: (r) => r.customerName },
          { header: 'Company', value: (r) => r.organizationName ?? '' },
          { header: 'Phone', value: (r) => r.phone },
          { header: 'Items', value: (r) => r.itemCount },
          { header: 'Total (₹)', value: (r) => rupees(r.grandTotalPaise) },
          { header: 'Paid (₹)', value: (r) => rupees(r.amountPaidPaise) },
          { header: 'Due (₹)', value: (r) => rupees(r.grandTotalPaise - r.amountPaidPaise) },
          { header: 'Fulfilment', value: (r) => stage(r.fulfilmentStatus) },
          { header: 'Payment', value: (r) => PAYMENT_LABEL[r.paymentStatus] },
          { header: 'Invoiced', value: (r) => (r.isInvoiced ? 'Yes' : 'No') },
          { header: 'AWB', value: (r) => r.awbNo ?? '' },
          { header: 'Salesperson', value: (r) => r.salespersonName ?? '' },
        ]),
      };
    },
  },

  receipts: {
    route: '/receipts',
    title: 'Receipts',
    async load(ctx, sp) {
      const { rows, filters } = await receiptsList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Receipt', value: (r) => r.receiptNo },
          { header: 'Date', value: (r) => day(r.receivedAt) },
          { header: 'Customer', value: (r) => r.partyName },
          { header: 'Method', value: (r) => (METHOD_LABEL as Record<string, string>)[r.method] ?? r.method },
          { header: 'Reference', value: (r) => r.reference ?? '' },
          { header: 'Amount (₹)', value: (r) => rupees(r.amountPaise) },
          { header: 'Applied (₹)', value: (r) => rupees(r.allocatedPaise) },
          { header: 'On account (₹)', value: (r) => rupees(r.unallocatedPaise) },
          { header: 'Applied to', value: (r) => r.appliedTo.map((a) => a.invoiceNo).join(', ') },
          { header: 'Status', value: (r) => (r.status === 'received' ? 'Received' : 'Did not clear') },
          { header: 'Why it did not clear', value: (r) => r.reversalReason ?? '' },
          { header: 'Note', value: (r) => r.note ?? '' },
        ]),
      };
    },
  },

  customers: {
    route: '/customers',
    title: 'Customers',
    async load(ctx, sp) {
      const { rows, filters } = await customersList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Code', value: (r) => r.partyCode },
          { header: 'Name', value: (r) => r.displayName },
          { header: 'Company', value: (r) => r.companyName ?? '' },
          { header: 'Phone', value: (r) => r.phone },
          { header: 'Email', value: (r) => r.email ?? '' },
          { header: 'Address', value: (r) => r.addressLine1 ?? '' },
          { header: 'City', value: (r) => r.city ?? '' },
          { header: 'State', value: (r) => r.state ?? '' },
          { header: 'GSTIN', value: (r) => r.gstin ?? '' },
          { header: 'Type', value: (r) => r.customerTypeName ?? '' },
          { header: 'Balance (₹)', value: (r) => rupees(r.currentBalancePaise) },
          { header: 'Credit limit (₹)', value: (r) => rupees(r.creditLimitPaise) },
          { header: 'Last purchase', value: (r) => day(r.lastPurchaseAt) },
          { header: 'Last contact', value: (r) => day(r.lastCommunicationAt) },
          { header: 'Customer since', value: (r) => day(r.customerSince) },
          { header: 'Status', value: (r) => r.status },
        ]),
      };
    },
  },

  products: {
    route: '/products',
    title: 'Products',
    async load(ctx, sp) {
      const { rows } = await productsList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        columns: cols<R>([
          { header: 'Code', value: (r) => r.productCode },
          { header: 'Product', value: (r) => r.productName },
          { header: 'Category', value: (r) => r.categoryName ?? '' },
          { header: 'Sub-category', value: (r) => r.subCategoryName ?? '' },
          { header: 'Brand', value: (r) => r.brandName ?? '' },
          { header: 'HSN', value: (r) => r.hsnCode ?? '' },
          { header: 'Unit', value: (r) => r.unit },
          { header: 'In stock', value: (r) => r.currentQty },
          { header: 'Reorder level', value: (r) => r.reorderLevel },
          { header: 'DLP (₹)', value: (r) => rupees(r.dlpPaise) },
          { header: 'MRP (₹)', value: (r) => rupees(r.mrpPaise) },
          { header: 'Location', value: (r) => r.location ?? '' },
          { header: 'Active', value: (r) => (r.isActive ? 'Yes' : 'No') },
        ]),
      };
    },
  },

  units: {
    route: '/stock-units',
    title: 'Stock Units',
    async load(ctx, sp) {
      const { rows, filters } = await unitsList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Serial', value: (u) => u.serialNo ?? 'to follow' },
          { header: 'Product', value: (u) => u.productName },
          { header: 'Code', value: (u) => u.productCode },
          { header: 'Where', value: (u) => (UNIT_STATUS_LABEL as Record<string, string>)[u.status] ?? u.status },
          { header: 'Held by', value: (u) => u.holderName ?? '' },
          { header: 'Condition', value: (u) => (UNIT_CONDITION_LABEL as Record<string, string>)[u.condition] ?? u.condition },
          { header: 'Arrived', value: (u) => day(u.receivedAt) },
          { header: 'Receipt', value: (u) => u.grnNo ?? '' },
          { header: 'Supplier', value: (u) => u.supplierName ?? '' },
          { header: 'Old number', value: (u) => u.legacyRef ?? '' },
        ]),
      };
    },
  },

  grn: {
    route: '/goods-receipt',
    title: 'Goods Receipts',
    async load(ctx, sp) {
      const { rows, filters, qty } = await grnList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Receipt', value: (g) => g.grnNo },
          { header: 'Old number', value: (g) => g.legacyRef ?? '' },
          { header: 'Received', value: (g) => day(g.receivedDate) },
          { header: 'Supplier', value: (g) => g.supplierName },
          { header: 'Supplier bill', value: (g) => g.supplierInvoiceNo ?? '' },
          { header: 'Lines', value: (g) => g.items.length },
          { header: 'Units', value: (g) => qty(g) },
          { header: 'Status', value: (g) => g.status },
          { header: 'Notes', value: (g) => g.notes ?? '' },
        ]),
      };
    },
  },

  gdn: {
    route: '/goods-dispatch',
    title: 'Goods Dispatch Notes',
    async load(ctx, sp) {
      const { rows, filters } = await gdnList(ctx, sp);
      const stage = await stageNamer(ctx.scope);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Order', value: (r) => r.orderNo },
          { header: 'Ordered', value: (r) => day(r.orderDate) },
          { header: 'Expected', value: (r) => day(r.expectedDeliveryDate) },
          { header: 'Customer', value: (r) => r.organizationName ?? r.customerName },
          { header: 'Courier', value: (r) => r.courierName ?? '' },
          { header: 'AWB', value: (r) => r.awbNo ?? '' },
          { header: 'Mode', value: (r) => r.deliveryMode ?? '' },
          { header: 'Value (₹)', value: (r) => rupees(r.grandTotalPaise) },
          { header: 'Status', value: (r) => stage(r.fulfilmentStatus) },
        ]),
      };
    },
  },

  suppliers: {
    route: '/suppliers',
    title: 'Suppliers',
    async load(ctx, sp) {
      const { rows } = await suppliersList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        columns: cols<R>([
          { header: 'Code', value: (r) => r.partyCode },
          { header: 'Supplier', value: (r) => r.companyName ?? r.displayName },
          { header: 'Contact', value: (r) => r.displayName },
          { header: 'Type', value: (r) => r.supplierType ?? '' },
          { header: 'Phone', value: (r) => r.phone },
          { header: 'Email', value: (r) => r.email ?? '' },
          { header: 'City', value: (r) => r.city ?? '' },
          { header: 'GSTIN', value: (r) => r.gstin ?? '' },
          { header: 'We owe (₹)', value: (r) => rupees(r.payablePaise) },
          { header: 'Also a customer', value: (r) => (r.isCustomer ? 'Yes' : '') },
        ]),
      };
    },
  },

  purchase_orders: {
    route: '/purchase/orders',
    title: 'Purchase Orders',
    async load(ctx, sp) {
      const { rows, filters } = await poList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Order', value: (o) => o.orderNo },
          { header: 'Ordered', value: (o) => day(o.orderDate) },
          { header: 'Expected', value: (o) => day(o.expectedDeliveryDate) },
          { header: 'Supplier', value: (o) => o.supplierName },
          { header: 'Total (₹)', value: (o) => rupees(o.grandTotalPaise) },
          { header: 'Status', value: (o) => (PO_STATUS_LABEL as Record<string, string>)[o.status] ?? o.status },
          { header: 'Approved by', value: (o) => o.approvedBy ?? '' },
          { header: 'Approved on', value: (o) => day(o.approvedAt) },
        ]),
      };
    },
  },

  calls: {
    route: '/call-logs',
    title: 'Call Logs',
    async load(ctx, sp) {
      const { rows, filters } = await callsList(ctx, sp);
      type R = (typeof rows)[number];
      const when = (d: Date) => d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'When', value: (c) => when(c.startedAt) },
          { header: 'Employee', value: (c) => c.userName },
          { header: 'Number', value: (c) => c.e164Number },
          { header: 'Customer', value: (c) => c.partyName ?? '' },
          { header: 'Type', value: (c) => (DIRECTION_LABEL as Record<string, string>)[c.direction] ?? c.direction },
          { header: 'Seconds', value: (c) => c.durationSec },
          { header: 'Reported', value: (c) => when(c.syncedAt) },
        ]),
      };
    },
  },

  renewals: {
    route: '/hrm/renewal',
    title: 'Insurance and Policies',
    async load(ctx, sp) {
      const { rows, filters } = await renewalsList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Title', value: (r) => r.title },
          { header: 'Type', value: (r) => r.policyType },
          { header: 'Provider', value: (r) => r.provider ?? '' },
          { header: 'Policy number', value: (r) => r.policyNumber ?? '' },
          { header: 'Expires', value: (r) => day(r.expiryDate) },
          { header: 'Days to expiry', value: (r) => r.daysToExpiry },
          { header: 'Remind days before', value: (r) => r.reminderDays },
          { header: 'Active', value: (r) => (r.isActive ? 'Yes' : 'No') },
          { header: 'Notes', value: (r) => r.notes ?? '' },
        ]),
      };
    },
  },

  checklist: {
    route: '/attendance/checklist',
    title: 'Daily Checklist',
    // The same rows as the Daily Checklist report, for the day or month on screen.
    async load(ctx, sp) {
      const d = isDayKey(sp.d) ? sp.d : istToday(new Date());
      const m = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : d.slice(0, 7);
      const month = monthDays(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1);
      const [fromDay, toDay] = sp.tab === 'month' ? [month[0], month[month.length - 1]] : [d, d];
      const report = findReport('attendance-checklist')!;
      // India midnight to India midnight: a zone-less `T23:59:59.999` is 05:29
      // the next morning in India on the UTC server, which added a day.
      const res = await report.run(ctx.scope, istDayStart(fromDay)!, istDayEnd(toDay)!);
      const q = (sp.q ?? '').trim().toLowerCase();
      const rows = q ? (res.rows as never[]).filter((r) => res.columns.some((c) => String(c.value(r) ?? '').toLowerCase().includes(q))) : res.rows;
      return { rows, columns: res.columns as never, rangeLabel: fromDay === toDay ? fromDay : m };
    },
  },

  shifts: {
    route: '/attendance/shifts',
    title: 'Shift Log',
    async load(ctx, sp) {
      const { rows, filters } = await shiftsList(ctx, sp);
      type R = (typeof rows)[number];
      const t = (d: Date | null) => (d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Date', value: (s) => day(s.startedAt) },
          { header: 'Employee', value: (s) => s.userName },
          { header: 'Started', value: (s) => t(s.startedAt) },
          { header: 'Ended', value: (s) => t(s.correctedEndedAt ?? s.endedAt) },
          { header: 'Never ended', value: (s) => (s.autoClosed ? 'Yes' : '') },
          { header: 'Worked (min)', value: (s) => s.workedMinutes ?? '' },
          { header: 'Overtime (min)', value: (s) => s.overtimeMinutes || '' },
          { header: 'Calls', value: (s) => s.callCount },
          { header: 'Corrected because', value: (s) => s.correctionReason ?? '' },
          { header: 'Note', value: (s) => s.note ?? '' },
        ]),
      };
    },
  },

  team_today: {
    route: '/attendance/team-today',
    title: 'Team Today',
    async load(ctx, sp) {
      const all = await teamToday(ctx.scope);
      const q = (sp.q ?? '').trim().toLowerCase();
      const rows = q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all;
      type R = (typeof rows)[number];
      const t = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
      return {
        rows,
        rangeLabel: 'Today',
        columns: cols<R>([
          { header: 'Name', value: (r) => r.name },
          { header: 'Status', value: (r) => r.status.replace(/_/g, ' ') },
          { header: 'In', value: (r) => t(r.firstInAt) },
          { header: 'Out', value: (r) => t(r.lastOutAt) },
          { header: 'Worked (min)', value: (r) => r.workedMinutes ?? '' },
          { header: 'Clocked in outside zone', value: (r) => (r.inWithinPolicy === false ? 'Yes' : '') },
          { header: 'Fake locations today', value: (r) => r.mockedToday || '' },
          { header: 'Phone', value: (r) => r.phone.replace(/_/g, ' ') },
        ]),
      };
    },
  },

  attendance_month: {
    route: '/attendance/grid',
    title: 'Attendance by Day',
    // The Attendance by Day report for the month on the grid (?m=), person search applied.
    async load(ctx, sp) {
      const m = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : istToday(new Date()).slice(0, 7);
      const month = monthDays(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1);
      // The month in India days - the zone-less end used to pull in the 1st of the next month.
      const res = await findReport('attendance-days')!.run(ctx.scope, istDayStart(month[0])!, istDayEnd(month[month.length - 1])!);
      const q = (sp.q ?? '').trim().toLowerCase();
      const rows = q ? (res.rows as never[]).filter((r) => res.columns.some((c) => String(c.value(r) ?? '').toLowerCase().includes(q))) : res.rows;
      return { rows, columns: res.columns as never, rangeLabel: m };
    },
  },

  tasks: {
    route: '/tasks',
    title: 'Tasks',
    async load(ctx, sp) {
      const { rows, filters } = await tasksList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel: filters.range.label,
        columns: cols<R>([
          { header: 'Task', value: (t) => t.title },
          { header: 'Details', value: (t) => t.description ?? '' },
          { header: 'Status', value: (t) => t.status },
          { header: 'Overdue', value: (t) => (t.isOverdue ? 'Yes' : '') },
          { header: 'Priority', value: (t) => t.priority },
          { header: 'Assigned to', value: (t) => t.assignedToName ?? 'Unassigned' },
          { header: 'Due', value: (t) => day(t.dueDate) },
          { header: 'Given by', value: (t) => t.createdByName ?? '' },
          { header: 'Created', value: (t) => day(t.createdAt) },
          { header: 'Completed', value: (t) => day(t.completedAt) },
        ]),
      };
    },
  },

  // F1b server paging (6 Oct 2026): every page of the filtered list.
  creditNotes: {
    route: '/credit-notes',
    title: 'Credit Notes',
    async load(ctx, sp) {
      const { rows, rangeLabel } = await creditNotesList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel,
        columns: cols<R>([
          { header: 'Credit note', value: (r) => r.creditNoteNo },
          { header: 'Against invoice', value: (r) => r.invoiceNo },
          { header: 'Return', value: (r) => r.returnNo ?? '' },
          { header: 'Customer', value: (r) => r.customerName },
          { header: 'Dated', value: (r) => day(r.creditNoteDate) },
          { header: 'Reason', value: (r) => r.reason },
          { header: 'Taxable (₹)', value: (r) => rupees(r.taxableBasePaise) },
          { header: 'GST (₹)', value: (r) => rupees(r.taxTotalPaise) },
          { header: 'Total (₹)', value: (r) => rupees(r.grandTotalPaise) },
          { header: 'Applied (₹)', value: (r) => rupees(r.allocatedPaise) },
          { header: 'Refunded (₹)', value: (r) => rupees(r.refundedPaise) },
          { header: 'Unused (₹)', value: (r) => rupees(r.unusedPaise) },
          { header: 'Status', value: (r) => (r.awaitingApproval ? 'Awaiting approval' : r.lifecycle) },
        ]),
      };
    },
  },

  bills: {
    route: '/purchase/bills',
    title: 'Purchase Bills',
    async load(ctx, sp) {
      const { rows, rangeLabel } = await billsList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel,
        columns: cols<R>([
          { header: 'Bill', value: (b) => b.billNo },
          { header: 'Supplier bill no', value: (b) => b.supplierBillNo },
          { header: 'Supplier', value: (b) => b.supplierName },
          { header: 'Date', value: (b) => day(b.billDate) },
          { header: 'Due', value: (b) => day(b.dueDate) },
          { header: 'Total (₹)', value: (b) => rupees(b.grandTotalPaise) },
          { header: 'Paid (₹)', value: (b) => rupees(b.paidPaise) },
          { header: 'Outstanding (₹)', value: (b) => rupees(b.outstandingPaise) },
          { header: 'Status', value: (b) => (b.awaitingApproval ? 'Awaiting approval' : b.status) },
          { header: 'Lines', value: (b) => b.lineCount },
        ]),
      };
    },
  },

  salesReturns: {
    route: '/sales-return',
    title: 'Sales Returns',
    async load(ctx, sp) {
      const { rows, rangeLabel } = await returnsList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel,
        columns: cols<R>([
          { header: 'Return', value: (r) => r.returnNo },
          { header: 'Against invoice', value: (r) => r.invoiceNo },
          { header: 'Customer', value: (r) => r.customerName },
          { header: 'Returned', value: (r) => day(r.returnedAt) },
          { header: 'Items', value: (r) => r.totalQty },
          { header: 'Back to stock', value: (r) => r.restockQty },
          { header: 'Not resellable', value: (r) => r.damagedQty },
          { header: 'Value (₹)', value: (r) => rupees(r.valuePaise) },
          { header: 'Credited (₹)', value: (r) => rupees(r.creditedPaise) },
          { header: 'Credit notes', value: (r) => r.creditNotes.map((c) => c.creditNoteNo).join(', ') },
          { header: 'Status', value: (r) => r.lifecycle },
          { header: 'Reason', value: (r) => r.reason },
        ]),
      };
    },
  },

  transactions: {
    route: '/transactions',
    title: 'Transactions',
    async load(ctx, sp) {
      const { rows, rangeLabel } = await transactionsList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel,
        columns: cols<R>([
          { header: 'No.', value: (r) => r.txnNo },
          { header: 'Type', value: (r) => r.txnType },
          { header: 'Date', value: (r) => day(r.txnDate) },
          { header: 'Category', value: (r) => r.categoryAccountCode ?? '' },
          { header: 'From', value: (r) => r.fromAccountCode ?? '' },
          { header: 'To', value: (r) => r.toAccountCode ?? '' },
          { header: 'Method', value: (r) => r.method ?? '' },
          { header: 'Amount (₹)', value: (r) => rupees(r.amountPaise) },
          { header: 'Description', value: (r) => r.description ?? '' },
          { header: 'Status', value: (r) => r.status },
        ]),
      };
    },
  },

  loans: {
    route: '/hrm/loans',
    title: 'Loans and Advances',
    async load(ctx, sp) {
      const { rows, rangeLabel } = await loansList(ctx, sp);
      type R = (typeof rows)[number];
      return {
        rows,
        rangeLabel,
        columns: cols<R>([
          { header: 'Employee', value: (l) => l.userName },
          { header: 'Principal (₹)', value: (l) => rupees(l.principalPaise) },
          { header: 'EMI (₹)', value: (l) => rupees(l.emiPaise) },
          { header: 'Months', value: (l) => l.tenureMonths },
          { header: 'Repaid (₹)', value: (l) => rupees(l.repaidPaise) },
          { header: 'Outstanding (₹)', value: (l) => rupees(l.principalPaise - l.repaidPaise) },
          { header: 'Status', value: (l) => l.status },
          { header: 'Started', value: (l) => day(l.startPeriod) },
          { header: 'Reason', value: (l) => l.reason ?? '' },
        ]),
      };
    },
  },
};

// The card lists (server/card-lists, F1b 6 Oct 2026): one definition serves the
// screen's page and this export, so the file matches the screen's filters.
for (const [key, list] of Object.entries(CARD_LISTS)) {
  LIST_EXPORTS[key] = {
    route: list.route,
    title: list.title,
    load: (ctx, sp) => cardListExport(list as never, ctx, sp) as never,
  };
}
