/**
 * EVERY DOCUMENT AND WHAT CAN BE DONE TO IT (30 Oct 2026, Vcare: "har ek
 * document ko edit krne k liye approval chahye - nothing goes without
 * approval"). The list the Operations & approvals settings section is built
 * on: one row per action on a document. `type` names the approval request
 * type in lib/approval-rules when the engine can already hold that action;
 * a row without one is an action the engine cannot hold yet.
 */
export interface OpAction {
  key: string;
  /** What is done, in Hinglish, short. */
  label: string;
  /** lib/approval-rules request type that can already hold this action. */
  type?: string;
  /** The permission that lets someone do it today. */
  perm: string;
}

export interface OpDocument {
  key: string;
  label: string;
  /** Number format so people recognise it. */
  sample: string;
  group: 'Sales' | 'Service' | 'Stock & purchase' | 'Money' | 'People';
  actions: OpAction[];
}

const A = (key: string, label: string, perm: string, type?: string): OpAction => ({ key, label, perm, type });

export const OP_DOCUMENTS: OpDocument[] = [
  // ------------------------------------------------------------------ Sales
  { key: 'enquiry', label: 'Enquiry', sample: 'ENQ…', group: 'Sales', actions: [
    A('create', 'Nayi banana', 'leads.create'), A('edit', 'Details / stage badalna', 'leads.edit'), A('close', 'Lost karke band karna', 'leads.edit'), A('convert', 'Customer banana', 'customers.create'),
  ] },
  { key: 'customer', label: 'Customer', sample: 'PTY-…', group: 'Sales', actions: [
    A('create', 'Naya banana', 'customers.create'), A('edit', 'Details badalna', 'customers.edit'), A('credit', 'Credit limit badalna', 'customers.edit', 'credit_limit'),
  ] },
  { key: 'quotation', label: 'Quotation', sample: 'QTN…', group: 'Sales', actions: [
    A('create', 'Nayi banana', 'quotation.create'), A('edit', 'Items / rate badalna', 'quotation.edit'), A('send', 'Customer ko bhejna', 'quotation.edit', 'quotation_send'), A('delete', 'Delete karna', 'quotation.delete'),
  ] },
  { key: 'order', label: 'Sales order', sample: 'ORD… / SO-…', group: 'Sales', actions: [
    A('create', 'Naya banana', 'orders.create', 'sales_order'), A('edit', 'Items badalna', 'orders.edit'), A('cancel', 'Cancel karna (payment ke baad)', 'orders.approve', 'order_cancel_paid'),
  ] },
  { key: 'invoice', label: 'Invoice (bill)', sample: 'INV…', group: 'Sales', actions: [
    A('issue', 'Issue karna', 'invoice.approve', 'invoice_issue'), A('edit', 'Issue ke baad badalna', 'invoice.edit', 'invoice_edit'), A('cancel', 'Cancel karna', 'invoice.approve', 'invoice_cancel'),
  ] },
  { key: 'receipt', label: 'Payment receipt', sample: 'RCPT-…', group: 'Sales', actions: [
    A('create', 'Payment jama karna', 'invoice.edit'), A('reverse', 'Reverse / bounce karna', 'invoice.edit', 'receipt_reverse'),
  ] },
  { key: 'return', label: 'Sales return', sample: 'SR-…', group: 'Sales', actions: [
    A('create', 'Saman wapas lena', 'returns.edit', 'sales_return'), A('credit', 'Credit note dena', 'returns.credit', 'credit_note'), A('refund', 'Paise wapas dena', 'returns.credit', 'refund'),
  ] },

  // ---------------------------------------------------------------- Service
  { key: 'complaint', label: 'Complaint', sample: 'CMP-… / COMP…', group: 'Service', actions: [
    A('create', 'Darj karna', 'complaints.edit'), A('edit', 'Details / technician badalna', 'complaints.edit'), A('close', 'Band karna', 'complaints.edit', 'job_close'), A('cancel', 'Cancel karna', 'complaints.edit'),
  ] },
  { key: 'challan', label: 'Parts challan', sample: 'JCH-…', group: 'Service', actions: [
    A('create', 'Raise karna', 'complaints.edit', 'job_challan'), A('edit', 'Items badalna', 'complaints.edit'), A('withdraw', 'Withdraw karna', 'complaints.edit'),
  ] },
  { key: 'gdn', label: 'Goods dispatch (GDN)', sample: 'GDN-…', group: 'Service', actions: [
    A('create', 'Store se saman dena', 'stock.adjust'), A('edit', 'GDN theek karna / serial badalna', 'stock.adjust'), A('cancel', 'GDN cancel karna', 'stock.adjust'),
  ] },
  { key: 'installation', label: 'Installation', sample: 'ECHN… / ICH-…', group: 'Service', actions: [
    A('create', 'Job banana', 'installations.edit', 'installation_challan'), A('edit', 'Items badalna', 'installations.edit'), A('nobill', 'Bina bill band karna', 'invoice.approve'),
  ] },
  { key: 'repair', label: 'Repair challan (purana)', sample: 'CCHN…', group: 'Service', actions: [
    A('edit', 'Badalna', 'complaints.edit', 'repair_challan'),
  ] },
  { key: 'pickup', label: 'Pickup / handback', sample: 'PCK-…', group: 'Service', actions: [
    A('create', 'Saman office laana', 'complaints.edit'), A('handback', 'Customer ko wapas dena', 'complaints.edit'),
  ] },
  { key: 'rma', label: 'Supplier dispatch (RMA)', sample: 'RMA-…', group: 'Service', actions: [
    A('create', 'Supplier ko bhejna', 'complaints.edit'), A('receive', 'Wapas aaya lena', 'stock.adjust'),
  ] },
  { key: 'amc', label: 'AMC contract', sample: 'AMC-…', group: 'Service', actions: [
    A('create', 'Banana', 'amc.edit'), A('edit', 'Badalna', 'amc.edit'), A('renew', 'Renew karna', 'amc.edit'), A('cancel', 'Cancel karna', 'amc.edit'),
  ] },
  { key: 'warranty', label: 'Warranty / location', sample: '-', group: 'Service', actions: [
    A('void', 'Warranty void karna', 'complaints.approve', 'warranty_void'), A('site', 'Location check ke bina kaam shuru', 'complaints.edit', 'site_override'),
  ] },

  // ------------------------------------------------------- Stock & purchase
  { key: 'product', label: 'Product', sample: 'PRD…', group: 'Stock & purchase', actions: [
    A('create', 'Naya banana', 'products.edit'), A('edit', 'Details badalna', 'products.edit'), A('price', 'Price badalna', 'products.edit', 'price_change'),
  ] },
  { key: 'stock', label: 'Stock & serial', sample: '-', group: 'Stock & purchase', actions: [
    A('adjust', 'Stock haath se badalna', 'stock.adjust'), A('serial', 'Serial jodna / badalna', 'stock.adjust'), A('van', 'Van stock ki kami write-off', 'stock.adjust', 'van_writeoff'),
  ] },
  { key: 'po', label: 'Purchase order', sample: 'PO-…', group: 'Stock & purchase', actions: [
    A('create', 'Banana / supplier ko bhejna', 'purchase.edit', 'purchase_order'), A('edit', 'Badalna', 'purchase.edit'), A('cancel', 'Cancel karna', 'purchase.edit'),
  ] },
  { key: 'grn', label: 'Goods receipt (GRN)', sample: 'GRN…', group: 'Stock & purchase', actions: [
    A('create', 'Maal stock mein chadhana', 'purchase.edit'), A('edit', 'Items jodna', 'purchase.edit'), A('cancel', 'Cancel karna', 'purchase.edit'),
  ] },
  { key: 'bill', label: 'Purchase bill', sample: 'PB-…', group: 'Stock & purchase', actions: [
    A('create', 'Post karna', 'purchase.edit', 'purchase_bill'), A('edit', 'Badalna', 'purchase.edit'), A('cancel', 'Cancel karna', 'purchase.edit'),
  ] },
  { key: 'supplierpay', label: 'Supplier payment', sample: 'SP-…', group: 'Stock & purchase', actions: [
    A('create', 'Supplier ko paisa dena', 'purchase.pay', 'supplier_payment'), A('reverse', 'Reverse karna', 'purchase.pay', 'supplier_payment_reverse'),
  ] },
  { key: 'preturn', label: 'Purchase return', sample: 'DN-…', group: 'Stock & purchase', actions: [
    A('create', 'Supplier ko maal wapas', 'purchase.edit', 'debit_note'),
  ] },

  // ------------------------------------------------------------------ Money
  { key: 'expense', label: 'Office expense', sample: 'TXN-…', group: 'Money', actions: [
    A('create', 'Kharcha daalna', 'accounts.edit', 'expense'), A('edit', 'Badalna', 'accounts.edit'), A('cancel', 'Cancel karna', 'accounts.edit'),
  ] },
  { key: 'period', label: 'Band mahina', sample: '-', group: 'Money', actions: [
    A('reopen', 'Band mahina kholna', 'accounts.edit', 'period_reopen'),
  ] },

  // ----------------------------------------------------------------- People
  { key: 'leave', label: 'Leave / WFH', sample: '-', group: 'People', actions: [
    A('leave', 'Chhutti maangna', 'hrm.view', 'leave'), A('wfh', 'Ghar se kaam', 'hrm.view', 'wfh'), A('compoff', 'Comp-off', 'hrm.view', 'comp_off'),
  ] },
  { key: 'attendance', label: 'Attendance', sample: '-', group: 'People', actions: [
    A('correct', 'Attendance theek karna', 'attendance.edit'),
  ] },
  { key: 'claim', label: 'Claims', sample: '-', group: 'People', actions: [
    A('reimb', 'Kharche ka claim', 'payroll.view', 'reimbursement'), A('encash', 'Leave encashment', 'payroll.view', 'leave_encashment'), A('loan', 'Loan / advance', 'payroll.process', 'staff_loan'),
  ] },
  { key: 'payroll', label: 'Payroll', sample: '-', group: 'People', actions: [
    A('process', 'Salary process karna', 'payroll.process', 'payroll_process'), A('paid', 'Paid mark karna', 'payroll.process', 'payroll_paid'), A('revert', 'Wapas lena', 'payroll.process', 'payroll_revert'),
  ] },
  { key: 'asset', label: 'Asset / resignation', sample: '-', group: 'People', actions: [
    A('asset', 'Asset maangna', 'assets.view', 'asset_request'), A('resign', 'Resignation', 'hrm.view', 'resignation'),
  ] },
];

export const OP_GROUPS = ['Sales', 'Service', 'Stock & purchase', 'Money', 'People'] as const;
