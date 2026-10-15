import { toIsoDate, toNumber, toText } from './extraction';

/**
 * READING AN ATTACHMENT (11 Oct 2026, ops-pages demo tab 4).
 *
 * A customer's PO or a UPI / bank screenshot attached to a document is read
 * by the same AI reader the camera scanner uses, and the number and amount
 * are checked against the document: "Read: PO 4471 · ₹ 34,810 · matches".
 * The reader only reports; nothing on the document is changed by it.
 */

export const DOC_READ_KINDS = ['customer_po', 'payment_proof'] as const;
export type DocReadKind = (typeof DOC_READ_KINDS)[number];

export const DOC_READ_LABEL: Record<DocReadKind, string> = {
  customer_po: 'Customer purchase order',
  payment_proof: 'Payment screenshot or bank slip',
};

/** Which kind of reading a tag gets. Other tags are not read. */
export function readKindForTag(tag: string | null | undefined): DocReadKind | null {
  if (tag === 'Customer PO') return 'customer_po';
  if (tag === 'Payment proof') return 'payment_proof';
  return null;
}

export interface DocRead {
  /** PO number, or UTR / transaction id. */
  reference: string | null;
  /** Rupees. */
  amount: number | null;
  /** YYYY-MM-DD */
  date: string | null;
  party: string | null;
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function normaliseDocRead(raw: unknown): DocRead {
  const o = obj(raw);
  return {
    reference: toText(o.reference, 60),
    amount: toNumber(o.amount),
    date: toIsoDate(o.date),
    party: toText(o.party, 120),
  };
}

const str = { type: ['string', 'null'] } as const;
const num = { type: ['number', 'null'] } as const;

export const DOC_READ_SCHEMAS: Record<DocReadKind, { description: string; schema: Record<string, unknown> }> = {
  customer_po: {
    description: "Record the fields of a customer's purchase order as printed.",
    schema: {
      type: 'object',
      properties: {
        reference: { ...str, description: 'The purchase order (PO) number' },
        amount: { ...num, description: 'PO grand total in rupees' },
        date: { ...str, description: 'PO date as printed, day first' },
        party: { ...str, description: 'Name of the company that issued the PO (the buyer)' },
      },
    },
  },
  payment_proof: {
    description: 'Record a payment screenshot (UPI, NEFT, IMPS) or bank deposit slip.',
    schema: {
      type: 'object',
      properties: {
        reference: { ...str, description: 'UTR / transaction / reference number exactly as printed' },
        amount: { ...num, description: 'Amount paid in rupees' },
        date: { ...str, description: 'Payment date as printed, day first' },
        party: { ...str, description: 'Who paid (payer name), if shown' },
      },
    },
  },
};

const inr = (rupees: number) => `₹ ${rupees.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * The one line shown under the file, and whether the amount matches the
 * document. A rupee either way counts as a match (round-off on a PO).
 */
export function describeDocRead(kind: DocReadKind, r: DocRead, expectedPaise?: number | null): { summary: string; match: boolean | null } {
  const ref = r.reference ? `${kind === 'customer_po' ? 'PO' : 'UTR'} ${r.reference}` : null;
  const amt = r.amount != null ? inr(r.amount) : null;
  let match: boolean | null = null;
  if (r.amount != null && expectedPaise != null && expectedPaise > 0) {
    match = Math.abs(Math.round(r.amount * 100) - expectedPaise) <= 100;
  }
  const parts = [ref, amt, match === null ? null : match ? 'matches' : `doesn't match ${inr(expectedPaise! / 100)}`].filter(Boolean);
  return { summary: parts.length ? parts.join(' · ') : 'Nothing clear could be read', match };
}
