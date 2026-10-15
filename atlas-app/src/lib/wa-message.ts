/**
 * The WhatsApp message for a document - one builder for every button (A1,
 * 11 Oct 2026).
 *
 * Seven screens built their own text, in seven wordings, and two built the
 * wa.me link by hand and skipped the +91 rule. Every message now reads the
 * same way:
 *
 *   Hello {name},
 *   {Kind} {NUMBER} from {Org}
 *   {amount / due / status lines}
 *
 *   {link}
 *
 * Pure (no React, no server), so the list screens, the document pages and
 * the tests all share it. The text stays English - it goes to the customer,
 * not to the person pressing the button.
 */
import { formatIndianGrouping } from './format';

export type DocKind = 'quotation' | 'order' | 'invoice' | 'installation' | 'complaint' | 'receipt' | 'statement';

const KIND: Record<DocKind, string> = {
  quotation: 'Quotation',
  order: 'Sales order',
  invoice: 'Invoice',
  installation: 'Installation',
  complaint: 'Service request',
  receipt: 'Receipt',
  statement: 'Account statement',
};

/**
 * A document number WhatsApp will not read as a phone number.
 *
 * `SO-BR001-2026-0014` was shown with a green underline and opened the
 * dialler: the phone sees `001-2026-0014` as a number because `-` is a phone
 * separator. A non-breaking hyphen (U+2011) looks the same and is not a
 * separator, so no run of digits is long enough to be a phone number.
 * Ctrl+K and the list searches turn it back into `-` (`plainDocNo`), so a
 * number copied out of a chat still finds the document.
 */
export function safeDocNo(no: string): string {
  return no.replace(/-/g, '‑');
}

/** The reverse, for search boxes: a number pasted from WhatsApp finds its document. */
export function plainDocNo(text: string): string {
  return text.replace(/[‐‑‒–]/g, '-');
}

/**
 * Money for a message: whole rupees without `.00`. "₹ 12,34,567" has no run
 * of more than three digits for the phone to mistake; "34,567.00" would have
 * one.
 */
export function waMoney(paise: number): string {
  const whole = paise % 100 === 0;
  return `₹ ${paise < 0 ? '-' : ''}${formatIndianGrouping(Math.abs(paise) / 100, whole ? 0 : 2)}`;
}

/** 12 Oct 2026, in India time whatever the device clock says. */
export function waDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
}

export interface DocMessage {
  kind: DocKind;
  number: string;
  customerName?: string | null;
  org?: string | null;
  /** Document total. Left out where prices are not shown (W2: order and installation links). */
  amountPaise?: number | null;
  /** Still to pay. 0 says "fully paid"; leave out to say nothing. */
  duePaise?: number | null;
  dueBy?: Date | string | null;
  /** Stage / status in the business's own words (`stageName`). */
  status?: string | null;
  validUntil?: Date | string | null;
  /** One extra line, e.g. "Please confirm when it is fixed and rate us." */
  note?: string | null;
  /** The no-login link (/q, /i, /o, /c, /j). */
  url?: string | null;
}

export function docMessage(m: DocMessage): string {
  const name = m.customerName?.trim();
  const head = `${KIND[m.kind]} ${safeDocNo(m.number)}${m.org ? ` from ${m.org}` : ''}`;
  const lines: string[] = [];
  if (m.amountPaise != null) lines.push(`Amount: ${waMoney(m.amountPaise)}`);
  if (m.duePaise != null) {
    lines.push(m.duePaise > 0
      ? `Due: ${waMoney(m.duePaise)}${m.dueBy ? ` by ${waDate(m.dueBy)}` : ''}`
      : 'Fully paid - thank you.');
  }
  if (m.status) lines.push(`Status: ${m.status}`);
  if (m.validUntil) lines.push(`Valid until: ${waDate(m.validUntil)}`);
  if (m.note) lines.push(m.note);
  return [
    name ? `Hello ${name},` : 'Hello,',
    head,
    ...lines,
    ...(m.url ? ['', m.url] : []),
  ].join('\n');
}
