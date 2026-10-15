/**
 * Document numbering - {TYPE}-{BRANCH}-{FY}-{SEQ}
 * e.g. QT-BR052-2026-0007
 *
 * One service for quotations, sales orders, invoices, purchase orders,
 * GRNs, GDNs and POS bills. Per-store sequences, FY-aware reset.
 *
 * Concurrency: the caller must run this inside a transaction and rely on the
 * unique constraint on (storeId, docType, financialYear) plus an atomic
 * increment. Do not read-then-write outside a transaction.
 *
 * Spec: 03-technical-docs/01-specification/04-quotation.md §5.1
 */

/**
 * `CN` is a statutory series. A credit note reduces output tax, so its numbering
 * must be unbroken and sequential in the same way an invoice's is - an auditor
 * asking where CN-0008 went is asking whether tax was reclaimed off the books.
 */
/**
 * Every document series, declared ONCE and at runtime.
 *
 * It was a bare union type until 3 Oct 2026, which vanishes at compile time -
 * and two things need to walk the list: the burnt-number report, and the test
 * checking that every entry in `document-number-home` names a real table. A
 * second hand-written copy of twenty-six codes would have drifted, so `DocType`
 * is derived from this array rather than declared beside it.
 */
export const DOC_TYPES = [
  'QT',     // quotation
  'SO',     // sales order
  'INV',    // tax invoice
  'PO',     // purchase order
  'GRN',    // goods receipt - the one thing that may increase stock quantity
  'GDN',    // goods dispatch note
  'POS',    // point of sale - the screen is not built; see document-number-home
  'RCP',    // customer receipt - money coming in
  'SR',     // sales return - goods coming back
  'CN',     // credit note - the statutory document
  'RF',     // refund - money going out
  'PB',     // purchase bill - a supplier's invoice, as we file it
  'PMT',    // supplier payment - money going out to a supplier
  'JE',     // journal entry - a general-ledger posting
  'ST',     // staff transaction - an advance, expense, or settlement with an employee
  'TXN',    // expense, non-sale income, or cash/bank transfer
  'PR',     // purchase return - goods going back to a supplier
  'DN',     // supplier debit note - the financial half of a purchase return
  'MO',     // production order - components in, finished goods out
  'CMP',    // complaint - service & complaints module
  'RCH',    // repair challan - replacement stock dispatched against a complaint
  'ICH',    // installation challan - the signed work slip for a new installation
  'JCH',    // job challan - parts for a field job, raised on site (workflow spec 4.4)
  'AMC',    // annual maintenance contract - a customer's service agreement
  'RMA',    // replacement case - a faulty item sent back for repair or replacement
  'DSP',    // supplier dispatch - one box to one supplier; printed as the delivery challan for repair (10 Oct 2026)
  'PKP',    // pickup receipt - the customer's own item taken away for repair (10 Oct 2026)
  'GRR',    // RMA receipt - what came back from a supplier for repair, line by line; never our stock (10 Oct 2026)
  'LN',     // staff loan - money lent to an employee, collected by EMI on the payslip
  'ADV',    // salary advance - the same thing, usually one instalment (9 Oct 2026)
  'HD',     // helpdesk ticket - internal employee support desk
] as const;

export type DocType = (typeof DOC_TYPES)[number];

export interface DocumentNumberParts {
  docType: DocType;
  branchCode: string;
  financialYear: number;
  sequence: number;
  padding?: number;
}

export function formatDocumentNumber(parts: DocumentNumberParts): string {
  const { docType, branchCode, financialYear, sequence, padding = 4 } = parts;
  return `${docType}-${branchCode}-${financialYear}-${String(sequence).padStart(padding, '0')}`;
}

const PATTERN = /^([A-Z]+)-([A-Z0-9]+)-(\d{4})-(\d+)$/;

export function parseDocumentNumber(value: string): DocumentNumberParts | null {
  const m = PATTERN.exec(value);
  if (!m) return null;
  return {
    docType: m[1] as DocType,
    branchCode: m[2],
    financialYear: Number(m[3]),
    sequence: Number(m[4]),
    padding: m[4].length,
  };
}
