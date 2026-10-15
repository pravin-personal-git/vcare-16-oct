import type { DocType } from './document-number';

/**
 * WHERE EACH KIND OF DOCUMENT NUMBER ENDS UP (3 Oct 2026).
 *
 * The burnt-number fix needs to answer one question for any number it has
 * issued: is there a document holding it? That question has no generic answer -
 * each series lives in its own table under its own column - so the mapping is
 * declared here, once, and a test checks every entry against schema.prisma.
 *
 * `null` means the number is NOT stored on any row. Those series can never be
 * reconciled or reused, and that is recorded rather than hidden: a number this
 * module cannot find is treated as possibly in use, never as free.
 *
 * Why a declared map rather than something clever: the alternative is a
 * convention ("docType FOO lives in table Foo under fooNo"), and the real schema
 * does not follow one. `GDN` lives on `MaterialIssue`, `RF` on `Refund`, `ST`
 * used to live nowhere at all. A convention would be wrong silently; a map is
 * wrong loudly, in a test.
 */
export interface NumberHome {
  /** The Postgres table, exactly as Prisma names it. */
  table: string;
  /** The column holding the formatted number. */
  column: string;
}

export const NUMBER_HOME: Record<DocType, NumberHome | null> = {
  QT: { table: 'Quotation', column: 'quotationNo' },
  SO: { table: 'SalesOrder', column: 'orderNo' },
  INV: { table: 'Invoice', column: 'invoiceNo' },
  PO: { table: 'PurchaseOrder', column: 'orderNo' },
  GRN: { table: 'GoodsReceiptNote', column: 'grnNo' },
  GDN: { table: 'MaterialIssue', column: 'gdnNo' },
  RCP: { table: 'Receipt', column: 'receiptNo' },
  SR: { table: 'SalesReturn', column: 'returnNo' },
  CN: { table: 'CreditNote', column: 'creditNoteNo' },
  RF: { table: 'Refund', column: 'refundNo' },
  // Both live on StaffLoan - a salary advance IS a loan, with its own prefix
  // only so the two read apart in a list (9 Oct 2026).
  LN: { table: 'StaffLoan', column: 'loanNo' },
  ADV: { table: 'StaffLoan', column: 'loanNo' },
  PB: { table: 'PurchaseBill', column: 'billNo' },
  PMT: { table: 'SupplierPayment', column: 'paymentNo' },
  JE: { table: 'JournalEntry', column: 'entryNo' },
  ST: { table: 'StaffTransaction', column: 'txnNo' },
  TXN: { table: 'Transaction', column: 'txnNo' },
  PR: { table: 'PurchaseReturn', column: 'returnNo' },
  DN: { table: 'SupplierDebitNote', column: 'debitNoteNo' },
  MO: { table: 'ProductionOrder', column: 'orderNo' },
  CMP: { table: 'Complaint', column: 'complaintNo' },
  RCH: { table: 'RepairChallan', column: 'challanNo' },
  ICH: { table: 'InstallationChallan', column: 'challanNo' },
  JCH: { table: 'JobChallan', column: 'challanNo' },
  AMC: { table: 'AmcContract', column: 'contractNo' },
  RMA: { table: 'ReplacementCase', column: 'caseNo' },
  PKP: { table: 'ItemPickup', column: 'pickupNo' },
  DSP: { table: 'SupplierDispatch', column: 'dispatchNo' },
  GRR: { table: 'RmaReceipt', column: 'receiptNo' },
  HD: { table: 'HelpdeskTicket', column: 'ticketNo' },

  /**
   * The POS screen does not exist (it is on the not-built register), so no POS
   * number has ever been issued. Left explicitly null rather than pointed at a
   * guess, so that if POS is built the test below fails until somebody says
   * where its numbers live.
   */
  POS: null,
};

/**
 * Which series carry legal weight, and must therefore never show a gap.
 *
 * All of them matter to a tidy set of books; these are the ones where a missing
 * number is a question from the tax authority rather than from a colleague. A
 * gap in `CMP` is untidy. A gap in `INV` is a notice.
 */
export const STATUTORY: readonly DocType[] = ['INV', 'CN', 'RF', 'SR', 'PB', 'DN', 'PR', 'JE'];

export const isStatutory = (t: string): boolean => (STATUTORY as readonly string[]).includes(t);
