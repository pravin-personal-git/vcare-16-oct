/**
 * What a receipt is, in terms both the server and the browser can hold.
 *
 * Split out of `server/receipts.ts` because that module is marked
 * `server-only`, and a client component importing one runtime value from it -
 * a label map, in this case - drags the database client into the browser
 * bundle and fails the build.
 *
 * TypeScript cannot see that boundary: types are erased, so `import type` is
 * always safe, and importing a `const` next to it looks identical to the
 * compiler. `tsc` passed; `next build` did not. Anything both sides need lives
 * here, and `server/receipts.ts` re-exports it so callers need not know which
 * file it came from.
 */

export type ReceiptMethod = 'cash' | 'upi' | 'bank' | 'cheque' | 'card' | 'tds' | 'adjustment';
export type ReceiptStatus = 'received' | 'bounced' | 'reversed';

/**
 * Methods where money genuinely moved into an account we hold.
 *
 * `tds` is deliberately absent: the customer paid it to the government on the
 * seller's behalf. It settles an invoice exactly as cash does, but it is not
 * cash, and a cash book that counted it would never reconcile with the bank.
 */
export const CASH_METHODS: ReceiptMethod[] = ['cash', 'upi', 'bank', 'cheque', 'card'];

export const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank: 'Bank transfer',
  cheque: 'Cheque',
  card: 'Card',
  tds: 'TDS deducted',
  adjustment: 'Adjustment',
};

/** What to call the reference field, which differs by how the money arrived. */
export const REFERENCE_LABEL: Record<ReceiptMethod, string> = {
  cash: 'Reference',
  upi: 'UPI transaction ID',
  bank: 'UTR number',
  cheque: 'Cheque number',
  card: 'Approval code',
  tds: 'TDS certificate number',
  adjustment: 'Reference',
};

export interface ReceiptRow {
  id: string;
  receiptNo: string;
  partyId: string;
  partyName: string;
  amountPaise: number;
  allocatedPaise: number;
  /** Money on this receipt not yet applied to anything - an advance. */
  unallocatedPaise: number;
  receivedAt: Date;
  method: string;
  reference: string | null;
  note: string | null;
  status: ReceiptStatus;
  reversalReason: string | null;
  appliedTo: { invoiceId: string; invoiceNo: string; amountPaise: number }[];
}
