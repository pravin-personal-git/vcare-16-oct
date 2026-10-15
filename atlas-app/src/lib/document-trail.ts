/**
 * The document trail's shape and words - the pure half (F1b, decision D18).
 *
 * WHY THIS IS SPLIT FROM `server/document-trail.ts`.
 *
 * The resolver is `server-only`: it reads the database. The kinds, labels and
 * the step shape are plain data that the strip has to render, and the strip is
 * now used from client components too (the complaint page's `ComplaintView` is
 * `'use client'`). Importing `KIND_LABEL` from the server module dragged
 * `server-only` into the client bundle and failed the build - correctly, since
 * that import would have shipped database code to the browser.
 *
 * So: pure things here, queries there. Same split as `lib/job-flow.ts` versus
 * `server/complaints.ts`.
 */

export type TrailKind =
  | 'quotation' | 'order' | 'invoice' | 'receipt' | 'return' | 'credit_note'
  // An order's installations (11 Oct 2026, G1) - one order may have several.
  | 'installation'
  | 'complaint' | 'visit' | 'challan' | 'gdn' | 'replacement'
  // The repair loop (10 Oct 2026): taken from the customer, sent in a box, back on a receipt.
  | 'pickup' | 'supplier_dispatch' | 'rma_receipt'
  | 'purchase_order' | 'goods_receipt' | 'bill' | 'supplier_payment' | 'purchase_return';

export interface TrailStep {
  kind: TrailKind;
  id: string;
  /** The document number a person recognises. */
  label: string;
  /** Status, amount - whatever makes the step readable at a glance. */
  detail: string;
  route: string;
  /** The one being looked at now. */
  current: boolean;
  /** A step that has not happened. Rendered greyed, with what it would be. */
  pending?: boolean;
}

export const KIND_LABEL: Record<TrailKind, string> = {
  quotation: 'Quotation',
  order: 'Sales order',
  installation: 'Installation',
  invoice: 'Invoice',
  receipt: 'Payment',
  return: 'Return',
  credit_note: 'Credit note',
  complaint: 'Job',
  visit: 'Site visit',
  challan: 'Parts challan',
  gdn: 'Goods dispatch',
  replacement: 'Replacement',
  pickup: 'Pickup receipt',
  supplier_dispatch: 'Supplier dispatch',
  rma_receipt: 'RMA receipt',
  purchase_order: 'Purchase order',
  goods_receipt: 'Goods receipt',
  bill: 'Supplier bill',
  supplier_payment: 'Payment made',
  purchase_return: 'Purchase return',
};

/** The kinds that resolve through a complaint rather than an invoice. */
export const SERVICE_KINDS: readonly TrailKind[] = ['complaint', 'visit', 'challan', 'gdn', 'replacement'];

/**
 * The buying side: purchase order → goods receipt → supplier bill → payment,
 * with returns hanging off the bill.
 *
 * A separate walk from the selling side rather than a generalised one. The two
 * chains look symmetrical and are not: a sale is anchored on the invoice, a
 * purchase on the supplier's bill, and the joins differ (a GRN carries its
 * purchase order; a bill and a GRN are only linked directly when the app
 * created the receipt itself, `GoodsReceiptNote.sourceBillId`). Forcing one
 * walk to serve both would mean a function that is mostly conditionals.
 */
export const PURCHASE_KINDS: readonly TrailKind[] = [
  'purchase_order', 'goods_receipt', 'bill', 'supplier_payment', 'purchase_return',
];
