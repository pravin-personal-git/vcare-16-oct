import { isGstin } from './codes';

/**
 * What the AI reader is asked for, and how its answer is cleaned.
 *
 * The model is told the exact shape to return (the schemas below), but a
 * model's output is still input from outside: a mobile number comes back as
 * "+91 98765-43210", a date as "12/09/26", a rate as "18%". Everything that
 * reaches a form goes through these normalisers first, and anything that does
 * not survive them becomes null rather than a guess. A blank field is honest;
 * a wrong GSTIN on a lead is not.
 */

export const SCAN_KINDS = ['supplier_invoice', 'visiting_card', 'product_label'] as const;
export type ScanKind = (typeof SCAN_KINDS)[number];

export const SCAN_KIND_LABEL: Record<ScanKind, string> = {
  supplier_invoice: 'Supplier invoice',
  visiting_card: 'Visiting card',
  product_label: 'Product label',
};

export interface InvoiceLineScan {
  description: string;
  hsn: string | null;
  qty: number | null;
  /** Rupees per unit, before tax. */
  unitPrice: number | null;
  taxRatePct: number | null;
  serials: string[];
}

export interface SupplierInvoiceScan {
  supplierName: string | null;
  supplierGstin: string | null;
  invoiceNo: string | null;
  /** YYYY-MM-DD */
  invoiceDate: string | null;
  totalAmount: number | null;
  lines: InvoiceLineScan[];
}

export interface VisitingCardScan {
  companyName: string | null;
  personName: string | null;
  designation: string | null;
  /** 10-digit Indian mobiles, first is primary. */
  mobiles: string[];
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
}

export interface ProductLabelScan {
  brand: string | null;
  model: string | null;
  description: string | null;
  serials: string[];
  barcode: string | null;
}

export type ScanResult =
  | { kind: 'supplier_invoice'; data: SupplierInvoiceScan }
  | { kind: 'visiting_card'; data: VisitingCardScan }
  | { kind: 'product_label'; data: ProductLabelScan };

// ------------------------------------------------------------ field cleaners

const MAX_TEXT = 300;

export function toText(v: unknown, max = MAX_TEXT): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s || /^(null|n\/?a|none|-|unknown)$/i.test(s)) return null;
  return s.slice(0, max);
}

/** A 10-digit Indian mobile, or null. Accepts +91, 0 and spaced or dashed forms. */
export function toIndianMobile(v: unknown): string | null {
  const s = toText(v);
  if (!s) return null;
  // "0788 2345678" is a Durg landline - 0, an STD code of 2-4 digits, then
  // the number. A mobile written with a 0 groups as "098765 43210" instead.
  if (/^0\d{2,4}[\s-]\d{6,8}$/.test(s)) return null;
  let d = s.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export function toGstin(v: unknown): string | null {
  const s = toText(v)?.replace(/\s/g, '').toUpperCase();
  return s && isGstin(s) ? s : null;
}

export function toEmail(v: unknown): string | null {
  const s = toText(v)?.replace(/\s/g, '').toLowerCase();
  return s && /^[^@]+@[^@]+\.[a-z]{2,}$/.test(s) ? s : null;
}

export function toPincode(v: unknown): string | null {
  const s = toText(v)?.replace(/\s/g, '');
  return s && /^[1-9]\d{5}$/.test(s) ? s : null;
}

/** A plain number from "₹1,23,456.50", "18%" or 3. Null when there is no number. */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = toText(v);
  if (!s) return null;
  const cleaned = s.replace(/[₹,%\s]|rs\.?|inr/gi, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * YYYY-MM-DD from the forms Indian invoices actually print. Day comes first -
 * 04/05/2026 is the fourth of May here, never April the fifth.
 */
export function toIsoDate(v: unknown): string | null {
  const s = toText(v);
  if (!s) return null;
  let y: number; let m: number; let d: number;
  let r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    d = +r[1]; m = +r[2]; y = +r[3]; if (y < 100) y += 2000;
  } else if ((r = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{2}|\d{4})$/))) {
    d = +r[1]; m = MONTHS[r[2].slice(0, 4).toLowerCase()] ?? MONTHS[r[2].slice(0, 3).toLowerCase()] ?? 0;
    y = +r[3]; if (y < 100) y += 2000;
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // 31 Feb
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function toSerials(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,;]+/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const s = toText(item, 80)?.replace(/\s/g, '');
    if (!s || s.length < 3) continue;
    const k = s.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.slice(0, 500);
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// ------------------------------------------------------------ normalisers

export function normaliseInvoice(raw: unknown): SupplierInvoiceScan {
  const o = obj(raw);
  const lines = (Array.isArray(o.lines) ? o.lines : [])
    .map((l): InvoiceLineScan | null => {
      const x = obj(l);
      const description = toText(x.description, 200);
      if (!description) return null;
      const qty = toNumber(x.qty);
      const rate = toNumber(x.taxRatePct);
      return {
        description,
        hsn: toText(x.hsn, 12)?.replace(/\s/g, '') ?? null,
        qty: qty !== null && qty > 0 && qty < 1_000_000 ? qty : null,
        unitPrice: (() => { const n = toNumber(x.unitPrice); return n !== null && n >= 0 ? n : null; })(),
        taxRatePct: rate !== null && rate >= 0 && rate <= 100 ? rate : null,
        serials: toSerials(x.serials),
      };
    })
    .filter((l): l is InvoiceLineScan => l !== null)
    .slice(0, 100);
  return {
    supplierName: toText(o.supplierName, 150),
    supplierGstin: toGstin(o.supplierGstin),
    invoiceNo: toText(o.invoiceNo, 60),
    invoiceDate: toIsoDate(o.invoiceDate),
    totalAmount: toNumber(o.totalAmount),
    lines,
  };
}

export function normaliseCard(raw: unknown): VisitingCardScan {
  const o = obj(raw);
  const phones = Array.isArray(o.phones) ? o.phones : typeof o.phones === 'string' ? o.phones.split(/[,/;]+/) : [];
  const mobiles = [...new Set(phones.map(toIndianMobile).filter((m): m is string => !!m))].slice(0, 3);
  return {
    companyName: toText(o.companyName, 150),
    personName: toText(o.personName, 100),
    designation: toText(o.designation, 80),
    mobiles,
    email: toEmail(o.email),
    website: toText(o.website, 150),
    address: toText(o.address, 250),
    city: toText(o.city, 60),
    state: toText(o.state, 60),
    pincode: toPincode(o.pincode),
    gstin: toGstin(o.gstin),
  };
}

export function normaliseLabel(raw: unknown): ProductLabelScan {
  const o = obj(raw);
  return {
    brand: toText(o.brand, 60),
    model: toText(o.model, 80),
    description: toText(o.description, 200),
    serials: toSerials(o.serials),
    barcode: toText(o.barcode, 40)?.replace(/\s/g, '') ?? null,
  };
}

export function normaliseScan(kind: ScanKind, raw: unknown): ScanResult {
  switch (kind) {
    case 'supplier_invoice': return { kind, data: normaliseInvoice(raw) };
    case 'visiting_card': return { kind, data: normaliseCard(raw) };
    case 'product_label': return { kind, data: normaliseLabel(raw) };
  }
}

/** Title-stripped first and last name from a card's "Mr. Ramesh Kumar Sahu". */
export function splitPersonName(full: string | null): { title: string | null; firstName: string; lastName: string } {
  const words = (full ?? '').replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  let title: string | null = null;
  const t = words[0]?.toLowerCase();
  const TITLES: Record<string, string> = { mr: 'Mr', mrs: 'Mrs', ms: 'Ms', dr: 'Dr', prof: 'Prof', shri: 'Mr', smt: 'Mrs' };
  if (t && TITLES[t] && words.length > 1) { title = TITLES[t]; words.shift(); }
  return { title, firstName: words[0] ?? '', lastName: words.slice(1).join(' ') };
}

// ------------------------------------------------------------ what the model is asked for

const str = { type: ['string', 'null'] } as const;
const num = { type: ['number', 'null'] } as const;
const strList = { type: 'array', items: { type: 'string' } } as const;

/** JSON schemas for the model's one tool call, per kind. Keys match the normalisers above. */
export const SCAN_SCHEMAS: Record<ScanKind, { description: string; schema: Record<string, unknown> }> = {
  supplier_invoice: {
    description: 'Record the fields of an Indian supplier tax invoice / bill as printed.',
    schema: {
      type: 'object',
      properties: {
        supplierName: { ...str, description: 'Seller / supplier business name at the top of the invoice' },
        supplierGstin: { ...str, description: "Seller's 15-character GSTIN, not the buyer's" },
        invoiceNo: str,
        invoiceDate: { ...str, description: 'As printed, day first' },
        totalAmount: { ...num, description: 'Grand total in rupees' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: str,
              hsn: str,
              qty: num,
              unitPrice: { ...num, description: 'Rate per unit before tax, in rupees' },
              taxRatePct: { ...num, description: 'Total GST % for the line (CGST+SGST or IGST)' },
              serials: { ...strList, description: 'Serial numbers printed against this line, if any' },
            },
            required: ['description'],
          },
        },
      },
      required: ['lines'],
    },
  },
  visiting_card: {
    description: 'Record the contact details on a business / visiting card.',
    schema: {
      type: 'object',
      properties: {
        companyName: str,
        personName: { ...str, description: 'Full name of the person, with title if printed' },
        designation: str,
        phones: { ...strList, description: 'Every phone or mobile number printed' },
        email: str,
        website: str,
        address: { ...str, description: 'Street address without city, state and pincode' },
        city: str,
        state: str,
        pincode: str,
        gstin: str,
      },
    },
  },
  product_label: {
    description: 'Record what is printed on a product box or device label.',
    schema: {
      type: 'object',
      properties: {
        brand: str,
        model: { ...str, description: 'Model number exactly as printed, e.g. DS-2CE16D0T-IRP' },
        description: { ...str, description: 'Short plain description, e.g. 2MP bullet camera' },
        serials: { ...strList, description: 'Serial numbers (S/N, SN) exactly as printed' },
        barcode: { ...str, description: 'EAN / UPC digits if printed under a barcode' },
      },
    },
  },
};
