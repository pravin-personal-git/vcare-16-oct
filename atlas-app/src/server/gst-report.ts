import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { computeTax, type TaxMode } from './gst';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * GST Computation - a working figure, derived from documents already issued.
 *
 * NOT A FILED RETURN. Every number here is recomputed on the fly from
 * `Invoice`, `CreditNote` and `PurchaseBill` rows that already carry their own
 * GST split - this module adds nothing, it only totals what those documents
 * already say. There is no GSP integration, no carry-forward from a prior
 * period and no record of what was actually paid to the government: all
 * three need a real ledger (the same D011 double-entry decision that blocks
 * `/transactions`), so this report answers "what do the documents say I
 * owe", not "what is my filed liability this period".
 *
 * `lineTotalPaise` on every item is a taxable value, not a tax amount - line
 * tax is recomputed here with `computeTax`, using the PARENT DOCUMENT's
 * `taxMode`. A document's tax mode is a fact about the whole document (same
 * state or not), never chosen per line, so this can never disagree with the
 * header totals it is built to reconcile against.
 */

export interface GstDocRow {
  id: string;
  docNo: string;
  date: Date;
  partyName: string;
  /** The document and the party, each opening its own page (G-35). */
  docHref: string;
  partyHref: string | null;
  gstin: string | null;
  isB2B: boolean;
  taxableBasePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  grandTotalPaise: number;
}

export interface HsnRow {
  hsnCode: string;
  taxRatePct: number;
  qty: number;
  taxableBasePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

export interface GstReport {
  from: Date;
  to: Date;
  outputTaxPaise: number;
  inputTaxPaise: number;
  netPayablePaise: number;
  invoiceCount: number;
  creditNoteCount: number;
  billCount: number;
  sales: GstDocRow[];
  creditNotes: GstDocRow[];
  purchases: GstDocRow[];
  hsnOutward: HsnRow[];
  hsnInward: HsnRow[];
}

type ItemLike = { hsnCode: string | null; taxRatePct: unknown; lineTotalPaise: number; qty: number };

function hsnKey(hsnCode: string | null, ratePct: number): string {
  return `${hsnCode ?? 'Not set'}::${ratePct}`;
}

/** Adds (`sign` 1) or nets out (`sign` -1) a document's lines into the HSN map, in place. */
function accumulateHsn(map: Map<string, HsnRow>, items: ItemLike[], taxMode: TaxMode, sign: 1 | -1): void {
  for (const item of items) {
    const ratePct = Number(item.taxRatePct);
    const key = hsnKey(item.hsnCode, ratePct);
    const tax = computeTax(item.lineTotalPaise, ratePct, taxMode);

    const row = map.get(key) ?? {
      hsnCode: item.hsnCode ?? 'Not set', taxRatePct: ratePct, qty: 0,
      taxableBasePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0,
    };
    row.qty += sign * item.qty;
    row.taxableBasePaise += sign * item.lineTotalPaise;
    row.cgstPaise += sign * tax.cgstPaise;
    row.sgstPaise += sign * tax.sgstPaise;
    row.igstPaise += sign * tax.igstPaise;
    row.totalPaise += sign * tax.totalPaise;
    map.set(key, row);
  }
}

function sortedHsn(map: Map<string, HsnRow>): HsnRow[] {
  return [...map.values()].sort((a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.taxRatePct - b.taxRatePct);
}

export async function gstReport(scope: StoreScope, from: Date, to: Date): Promise<GstReport> {
  const [invoices, creditNotes, bills] = await Promise.all([
    db.invoice.findMany({
      where: { ...scopeWhere(scope), invoiceDate: { gte: from, lte: to }, lifecycle: 'sent' },
      select: {
        id: true, invoiceNo: true, invoiceDate: true, customerName: true, partyId: true, gstin: true,
        taxableBasePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true,
        grandTotalPaise: true, taxMode: true,
        items: { select: { hsnCode: true, taxRatePct: true, lineTotalPaise: true, qty: true } },
      },
      orderBy: { invoiceDate: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    db.creditNote.findMany({
      where: { ...scopeWhere(scope), creditNoteDate: { gte: from, lte: to }, lifecycle: 'issued' },
      select: {
        id: true, creditNoteNo: true, creditNoteDate: true, customerName: true, partyId: true, gstin: true,
        taxableBasePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true,
        grandTotalPaise: true, taxMode: true,
        items: { select: { hsnCode: true, taxRatePct: true, lineTotalPaise: true, qty: true } },
      },
      orderBy: { creditNoteDate: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    db.purchaseBill.findMany({
      where: { ...scopeWhere(scope), billDate: { gte: from, lte: to }, lifecycle: 'received' },
      select: {
        id: true, billNo: true, billDate: true, supplierName: true, partyId: true, gstin: true,
        taxableBasePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true,
        grandTotalPaise: true, taxMode: true,
        items: { select: { hsnCode: true, taxRatePct: true, lineTotalPaise: true, qty: true } },
      },
      orderBy: { billDate: 'asc' },
      take: LIST_MAX_ROWS,
    }),
  ]);

  const outputTaxPaise =
    invoices.reduce((n, i) => n + i.cgstPaise + i.sgstPaise + i.igstPaise, 0)
    - creditNotes.reduce((n, c) => n + c.cgstPaise + c.sgstPaise + c.igstPaise, 0);
  const inputTaxPaise = bills.reduce((n, b) => n + b.cgstPaise + b.sgstPaise + b.igstPaise, 0);

  const hsnOutward = new Map<string, HsnRow>();
  for (const inv of invoices) accumulateHsn(hsnOutward, inv.items, inv.taxMode as TaxMode, 1);
  for (const cn of creditNotes) accumulateHsn(hsnOutward, cn.items, cn.taxMode as TaxMode, -1);

  const hsnInward = new Map<string, HsnRow>();
  for (const bill of bills) accumulateHsn(hsnInward, bill.items, bill.taxMode as TaxMode, 1);

  return {
    from, to,
    outputTaxPaise, inputTaxPaise, netPayablePaise: outputTaxPaise - inputTaxPaise,
    invoiceCount: invoices.length, creditNoteCount: creditNotes.length, billCount: bills.length,
    sales: invoices.map((i) => ({
      id: i.id, docNo: i.invoiceNo, date: i.invoiceDate, partyName: i.customerName, gstin: i.gstin,
      docHref: `/invoices/${i.id}`, partyHref: i.partyId ? `/customers/${i.partyId}` : null,
      isB2B: !!i.gstin, taxableBasePaise: i.taxableBasePaise, cgstPaise: i.cgstPaise,
      sgstPaise: i.sgstPaise, igstPaise: i.igstPaise, grandTotalPaise: i.grandTotalPaise,
    })),
    creditNotes: creditNotes.map((c) => ({
      id: c.id, docNo: c.creditNoteNo, date: c.creditNoteDate, partyName: c.customerName, gstin: c.gstin,
      docHref: `/credit-notes/${c.id}`, partyHref: c.partyId ? `/customers/${c.partyId}` : null,
      isB2B: !!c.gstin, taxableBasePaise: c.taxableBasePaise, cgstPaise: c.cgstPaise,
      sgstPaise: c.sgstPaise, igstPaise: c.igstPaise, grandTotalPaise: c.grandTotalPaise,
    })),
    purchases: bills.map((b) => ({
      id: b.id, docNo: b.billNo, date: b.billDate, partyName: b.supplierName, gstin: b.gstin,
      docHref: `/purchase/bills/${b.id}`, partyHref: b.partyId ? `/suppliers/${b.partyId}` : null,
      isB2B: !!b.gstin, taxableBasePaise: b.taxableBasePaise, cgstPaise: b.cgstPaise,
      sgstPaise: b.sgstPaise, igstPaise: b.igstPaise, grandTotalPaise: b.grandTotalPaise,
    })),
    hsnOutward: sortedHsn(hsnOutward),
    hsnInward: sortedHsn(hsnInward),
  };
}
