/**
 * ATTACHMENTS THAT DO SOMETHING (11 Oct 2026, ops-pages demo tab 4).
 *
 * Every file carries a tag saying what it is. A document type can "need" a
 * tag (a sales order needs the customer's PO); a missing one shows amber on
 * the document and, if the admin set it to Block, stops the one step it is
 * tied to (e.g. marking the order Delivered without a signed challan).
 *
 * Pure - used by the panel, the settings page and the server checks alike.
 */

export const ATTACHMENT_TAGS = [
  'Customer PO', 'Payment proof', 'Signed challan', 'Site photo', 'Before photo',
  'After photo', 'Warranty card', 'E-way bill',
  // The technician's spoken note on a job (13 Oct 2026, decision 6) - recorded on Vcare.
  'Voice note',
  'Other',
] as const;
export type AttachmentTag = (typeof ATTACHMENT_TAGS)[number];

export function cleanTag(v: unknown): AttachmentTag | null {
  return typeof v === 'string' && (ATTACHMENT_TAGS as readonly string[]).includes(v) ? (v as AttachmentTag) : null;
}

/** The tag a new file gets when nobody picked one, per kind of document. */
export const DEFAULT_TAG: Record<string, AttachmentTag> = {
  quotation: 'Other',
  sales_order: 'Customer PO',
  invoice: 'Other',
  receipt: 'Payment proof',
  complaint: 'Site photo',
  installation_challan: 'After photo',
};

/**
 * Where a rule is checked. `step` names the one move a Block stops; a Warn
 * only shows on the document.
 */
export const REQUIRED_DOCS = {
  sales_order: { label: 'Sales order', docType: 'sales_order', step: 'Confirmed' },
  delivery: { label: 'Delivery', docType: 'sales_order', step: 'Delivered' },
  receipt: { label: 'Receipt', docType: 'receipt', step: null },
  installation: { label: 'Installation', docType: 'installation_challan', step: 'Handover' },
} as const;
export type RequiredDoc = keyof typeof REQUIRED_DOCS;

export interface RequiredRule {
  doc: RequiredDoc;
  tag: AttachmentTag;
  /** Only when the document's amount is over this (paise). Receipts: ₹50,000. */
  overPaise?: number;
  mode: 'warn' | 'block';
  /** Off rows stay listed so the admin can switch them back on. */
  on: boolean;
}

/** Pravin's decision 6 (11 Oct 2026): these four, all Warn. */
export const DEFAULT_REQUIRED: RequiredRule[] = [
  { doc: 'sales_order', tag: 'Customer PO', mode: 'warn', on: true },
  { doc: 'delivery', tag: 'Signed challan', mode: 'warn', on: true },
  { doc: 'receipt', tag: 'Payment proof', overPaise: 50_000_00, mode: 'warn', on: true },
  { doc: 'installation', tag: 'After photo', mode: 'warn', on: true },
];

export function cleanRequired(raw: unknown): RequiredRule[] {
  if (!Array.isArray(raw)) return DEFAULT_REQUIRED;
  const out: RequiredRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const doc = typeof o.doc === 'string' && o.doc in REQUIRED_DOCS ? (o.doc as RequiredDoc) : null;
    const tag = cleanTag(o.tag);
    if (!doc || !tag) continue;
    // A receipt has no later step to stop, so it can only warn.
    const mode = o.mode === 'block' && REQUIRED_DOCS[doc].step ? 'block' : 'warn';
    const over = Number(o.overPaise);
    out.push({ doc, tag, mode, on: o.on !== false, ...(Number.isFinite(over) && over > 0 ? { overPaise: Math.round(over) } : {}) });
  }
  return out;
}

/** The rules that apply to one document of `docType` worth `amountPaise`. */
export function rulesFor(rules: RequiredRule[], docType: string, amountPaise = 0): RequiredRule[] {
  return rules.filter((r) => r.on && REQUIRED_DOCS[r.doc].docType === docType && (!r.overPaise || amountPaise > r.overPaise));
}

/** Each applicable rule, and whether a live file carries its tag. */
export function needsChecklist(rules: RequiredRule[], docType: string, tags: (string | null)[], amountPaise = 0) {
  const have = new Set(tags.filter(Boolean));
  return rulesFor(rules, docType, amountPaise).map((r) => ({ ...r, ok: have.has(r.tag) }));
}

/** The message a Block gives, or null when the step may go ahead. */
export function blockMessage(rules: RequiredRule[], doc: RequiredDoc, tags: (string | null)[]): string | null {
  const have = new Set(tags.filter(Boolean));
  const missing = rules.filter((r) => r.on && r.doc === doc && r.mode === 'block' && !have.has(r.tag));
  if (!missing.length) return null;
  const step = REQUIRED_DOCS[doc].step;
  return `Attach the ${missing.map((r) => r.tag.toLowerCase()).join(' and ')} first - this business needs it before ${step ? `"${step}"` : 'this step'}. Add it under Attachments, tagged "${missing[0].tag}".`;
}
