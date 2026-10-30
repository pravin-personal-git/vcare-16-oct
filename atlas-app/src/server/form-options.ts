import 'server-only';
import { unstable_cache } from 'next/cache';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { listProducts } from './products';
import { costsFor } from './product-cost';
import { availabilityFor } from './unit-allocation';

/**
 * The customer, product and lead lists a document form picks from - loaded
 * when a form OPENS, not with every list page (health check PERF-2).
 *
 * Invoices, quotations, sales orders and receipts used to put every customer
 * (with a balance worked out for each of 4,743) and every product into the
 * page, whether or not anybody pressed "Create". Customers here are the plain
 * fields a picker needs - no balances.
 */

export interface BuyerOptionRow {
  id: string; code: string; name: string; company: string | null; phone: string;
  email: string | null; city: string | null; state: string | null; gstin: string | null; address: string | null;
}

export interface CatalogueOptionRow {
  id: string; code: string; name: string; dlpPaise: number; mrpPaise: number; category: string | null; stock: number;
  subCategory?: string | null; brand?: string | null; hsn?: string | null; taxRatePct?: number;
  /** For the product box's search - a scanned or typed barcode finds the product (4 Oct 2026). */
  barcode?: string | null; sku?: string | null;
  /** Kept by serial number - a challan line can name its units (22 Oct 2026). */
  serial?: boolean;
  amcAvailable?: boolean; amcPricingMode?: string | null; amcDurationMonths?: number | null;
  amcAnnualPricePaise?: number | null; amcTerms?: string | null; costPaise: number | null;
  /**
   * RULE 3 (3 Oct 2026) - how much of `stock` is already promised to confirmed
   * orders that have not been dispatched. See server/unit-allocation
   * `availabilityFor`.
   *
   * Carried on the catalogue row rather than fetched when a product is picked,
   * because the number has to be on screen BEFORE somebody promises stock -
   * which is the moment the error happens. One extra query for the whole form,
   * not one per keystroke.
   */
  promised: number;
}

export interface LeadOptionRow {
  id: string; code: string; name: string; company: string | null; phone: string;
  email: string | null; city: string | null; state: string | null;
}

export async function buyerOptions(scope: StoreScope): Promise<BuyerOptionRow[]> {
  const rows = await db.party.findMany({
    where: { ...scopeWhere(scope), isCustomer: true, status: 'active' },
    select: {
      id: true, partyCode: true, title: true, firstName: true, lastName: true, companyName: true,
      phoneCc: true, phone: true, email: true, city: true, state: true, gstin: true, addressLine1: true,
    },
    orderBy: { firstName: 'asc' },
  });
  return rows.map((p) => ({
    id: p.id, code: p.partyCode, name: [p.title, p.firstName, p.lastName].filter(Boolean).join(' '),
    company: p.companyName, phone: `${p.phoneCc} ${p.phone}`, email: p.email, city: p.city, state: p.state,
    gstin: p.gstin, address: p.addressLine1,
  }));
}

export async function catalogueOptions(scope: StoreScope): Promise<CatalogueOptionRow[]> {
  const products = await listProducts(scope);
  const [costs, tax, availability, serialRows] = await Promise.all([
    costsFor(scope, products.map((p) => p.id)),
    taxChoices(scope),
    availabilityFor(scope, products.map((p) => p.id)),
    db.product.findMany({ where: { ...scopeWhere(scope), trackingMode: 'serial' }, select: { id: true } }),
  ]);
  const serialIds = new Set(serialRows.map((r) => r.id));
  return products.map((p) => {
    const c = costs.get(p.id);
    return {
      id: p.id, code: p.productCode, name: p.productName, dlpPaise: p.dlpPaise, mrpPaise: p.mrpPaise,
      category: p.categoryName, subCategory: p.subCategoryName, brand: p.brandName, hsn: p.hsnCode,
      barcode: p.barcode, sku: p.sku, serial: serialIds.has(p.id),
      // The master's rate for this HSN; undefined keeps the old 18% default.
      taxRatePct: rateForHsn(p.hsnCode, tax.byHsn) ?? undefined,
      stock: p.currentQty,
      promised: availability.get(p.id)?.promised ?? 0,
      amcAvailable: p.amcAvailable, amcPricingMode: p.amcPricingMode, amcDurationMonths: p.amcDurationMonths,
      amcAnnualPricePaise: p.amcAnnualPricePaise, amcTerms: p.amcTerms,
      // null, not 0 - an unpriced product must not read as free.
      costPaise: c && c.basis !== 'none' ? c.unitCostPaise : null,
    };
  });
}

/**
 * `catalogueOptions` kept for 2 minutes, for the job pages that AutoRefresh
 * (30 Oct 2026): every refresh re-read every product, price and purchase
 * - about 15 GB of egress in two weeks.
 * shortcut: stock on the challan picker can be up to 2 minutes old; issuing
 * still checks the real stock. Drop the cache if that ever matters.
 */
export function cachedCatalogueOptions(scope: StoreScope): Promise<CatalogueOptionRow[]> {
  return unstable_cache(() => catalogueOptions(scope), ['catalogue-options', JSON.stringify(scope)], { revalidate: 120 })();
}

export interface PartyOptionRow { id: string; name: string; phone: string; gstin: string | null; isCustomer: boolean; isSupplier: boolean }
export interface StockProductRow { id: string; name: string; code: string; trackingMode: string }

/** Every active party, customer or supplier - for moving a unit to whoever holds it. */
export async function partyOptions(scope: StoreScope): Promise<PartyOptionRow[]> {
  const rows = await db.party.findMany({
    where: { ...scopeWhere(scope), status: 'active' },
    select: { id: true, title: true, firstName: true, lastName: true, companyName: true, phone: true, gstin: true, isCustomer: true, isSupplier: true },
    orderBy: [{ isSupplier: 'desc' }, { firstName: 'asc' }],
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.companyName?.trim() || [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim(),
    phone: p.phone, gstin: p.gstin, isCustomer: p.isCustomer, isSupplier: p.isSupplier,
  }));
}

/** Active products with how they are tracked - for receiving goods. */
export async function stockProductOptions(scope: StoreScope): Promise<StockProductRow[]> {
  const rows = await db.product.findMany({
    where: { ...scopeWhere(scope), isActive: true },
    select: { id: true, productName: true, productCode: true, trackingMode: true },
    orderBy: { productName: 'asc' },
  });
  return rows.map((p) => ({ id: p.id, name: p.productName, code: p.productCode, trackingMode: p.trackingMode }));
}

export async function leadOptions(scope: StoreScope): Promise<LeadOptionRow[]> {
  const leads = await db.lead.findMany({
    where: { ...scopeWhere(scope), isClosed: false },
    select: { id: true, leadCode: true, firstName: true, lastName: true, businessName: true, mobile: true, email: true, city: true, state: true },
    orderBy: { createdAt: 'desc' },
  });
  return leads.map((l) => ({
    id: l.id, code: l.leadCode, name: [l.firstName, l.lastName].filter(Boolean).join(' '),
    company: l.businessName, phone: l.mobile, email: l.email, city: l.city, state: l.state,
  }));
}

/**
 * Type-ahead for the customer and lead pickers on documents (26 Sep 2026).
 * The pickers used to be a <select> of every customer - 4,556 for Vcare -
 * which took 400 ms to open (Vercel's INP warning) and could not be typed
 * into. Now the form asks for the 20 best matches as the user types, and
 * gets the same full row the old list carried, so autofill is unchanged.
 */
const SEARCH_TAKE = 20;
const like = (q: string) => ({ contains: q, mode: 'insensitive' as const });

export async function searchBuyers(scope: StoreScope, q: string): Promise<BuyerOptionRow[]> {
  const s = q.trim().slice(0, 60);
  const digits = s.replace(/\D/g, '');
  const rows = await db.party.findMany({
    where: {
      ...scopeWhere(scope), isCustomer: true, status: 'active',
      ...(s ? {
        OR: [
          { firstName: like(s) }, { lastName: like(s) }, { companyName: like(s) }, { partyCode: like(s) },
          { gstin: like(s) }, { city: like(s) }, { email: like(s) },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ],
      } : {}),
    },
    select: {
      id: true, partyCode: true, title: true, firstName: true, lastName: true, companyName: true,
      phoneCc: true, phone: true, email: true, city: true, state: true, gstin: true, addressLine1: true,
    },
    orderBy: s ? { firstName: 'asc' } : { updatedAt: 'desc' },
    take: SEARCH_TAKE,
  });
  return rows.map((p) => ({
    id: p.id, code: p.partyCode, name: [p.title, p.firstName, p.lastName].filter(Boolean).join(' '),
    company: p.companyName, phone: `${p.phoneCc} ${p.phone}`, email: p.email, city: p.city, state: p.state,
    gstin: p.gstin, address: p.addressLine1,
  }));
}

export async function searchLeadOptions(scope: StoreScope, q: string): Promise<LeadOptionRow[]> {
  const s = q.trim().slice(0, 60);
  const digits = s.replace(/\D/g, '');
  const leads = await db.lead.findMany({
    where: {
      ...scopeWhere(scope), isClosed: false,
      ...(s ? {
        OR: [
          { firstName: like(s) }, { lastName: like(s) }, { businessName: like(s) }, { leadCode: like(s) },
          { city: like(s) }, { email: like(s) },
          ...(digits.length >= 3 ? [{ mobile: { contains: digits } }] : []),
        ],
      } : {}),
    },
    select: { id: true, leadCode: true, firstName: true, lastName: true, businessName: true, mobile: true, email: true, city: true, state: true },
    orderBy: { createdAt: 'desc' },
    take: SEARCH_TAKE,
  });
  return leads.map((l) => ({
    id: l.id, code: l.leadCode, name: [l.firstName, l.lastName].filter(Boolean).join(' '),
    company: l.businessName, phone: l.mobile, email: l.email, city: l.city, state: l.state,
  }));
}

/**
 * GST rates offered on a document line, from the GST Rates master (26 Sep 2026
 * - it was a hard-coded list). Distinct rates across the branches in scope,
 * plus the HSN patterns, so a product's line starts at its HSN's rate.
 */
export interface TaxChoices { rates: number[]; byHsn: { pattern: string; ratePct: number }[] }

export async function taxChoices(scope: StoreScope): Promise<TaxChoices> {
  const rows = await db.taxRate.findMany({ where: scopeWhere(scope), select: { ratePct: true, hsnPattern: true } });
  const rates = [...new Set(rows.map((r) => Number(r.ratePct)))].sort((a, b) => a - b);
  const byHsn = rows.filter((r) => r.hsnPattern?.trim())
    .map((r) => ({ pattern: r.hsnPattern!.trim(), ratePct: Number(r.ratePct) }))
    // Longest pattern first, so 85258020 beats 8525.
    .sort((a, b) => b.pattern.length - a.pattern.length);
  return { rates: rates.length ? rates : [0, 5, 12, 18, 28], byHsn };
}

/** The rate a product's HSN maps to in the master, or null. */
export function rateForHsn(hsn: string | null | undefined, byHsn: TaxChoices['byHsn']): number | null {
  const h = (hsn ?? '').replace(/\s/g, '');
  if (!h) return null;
  return byHsn.find((r) => h.startsWith(r.pattern))?.ratePct ?? null;
}
