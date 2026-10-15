import 'server-only';
import type { AppContext } from './context';
import { salesReach } from './sales-reach';
import { listQuotations, type QuotationRow } from './quotations';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { isExpired, type QuotationStatus } from '@/lib/quotation-totals';

/**
 * Quotations, filtered - shared by the screen and its export (F1).
 * A document list: quotation date defaults to this financial year, and
 * `olderOpen` counts drafts and sent quotations dated earlier so they are
 * one click away. Expiry is worked out here, never stored.
 */

type Sp = Record<string, string | undefined>;
export const QUOTATION_STATUSES: QuotationStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'converted', 'expired'];

export const QUOTATION_GRID: PageOptions<QuotationRow> = {
  search: (r) => [r.quotationNo, r.customerName, r.organizationName, r.phone, r.email, r.city, r.salespersonName],
  sort: {
    customerName: (r) => r.customerName, quotationNo: (r) => r.quotationNo, email: (r) => r.email, phone: (r) => r.phone,
    city: (r) => r.city, state: (r) => r.state, source: (r) => r.source, itemCount: (r) => r.itemCount,
    grandTotal: (r) => r.grandTotalPaise, quotationDate: (r) => r.quotationDate, validUntil: (r) => r.validUntil,
    status: (r) => r.status, salespersonName: (r) => r.salespersonName,
  },
};

export async function quotationsList(ctx: AppContext, sp: Sp) {
  const view: 'active' | 'history' = sp.view === 'history' ? 'history' : 'active';
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const card = (QUOTATION_STATUSES as string[]).includes(sp.card ?? '') ? sp.card as QuotationStatus : null;
  const source: 'lead' | 'customer' | null = sp.source === 'lead' || sp.source === 'customer' ? sp.source : null;

  // Whose quotations this person sees (B4 step 3) - before the counts, so the cards agree.
  const reach = await salesReach(ctx);
  const all = (await listQuotations(ctx.scope, view)).filter((r) => !reach || reach.allows(r.salespersonId)).map((r) => ({
    ...r, status: (isExpired(r.validUntil, r.status) ? 'expired' : r.status) as QuotationStatus,
  }));
  // Salesperson and city - what the cards cannot say (4 Oct 2026). Applied
  // before the counts, so the cards answer for the narrowed list.
  const salesperson = sp.salesperson || null;
  const city = sp.city || null;
  const dated = all.filter((r) => inRange(r.quotationDate, filters.range));
  const options = {
    salespeople: distinct(dated.map((r) => r.salespersonName)),
    cities: distinct(dated.map((r) => r.city)),
  };
  const inScope = dated.filter((r) => (!salesperson || r.salespersonName === salesperson) && (!city || r.city === city));
  const counts = Object.fromEntries(QUOTATION_STATUSES.map((s) => [s, inScope.filter((r) => r.status === s).length])) as Record<QuotationStatus, number>;
  const bySource = { lead: inScope.filter((r) => r.source === 'lead').length, customer: inScope.filter((r) => r.source === 'customer').length };
  const olderOpen = inScope.length === all.length ? 0
    : all.filter((r) => (r.status === 'draft' || r.status === 'sent') && !inRange(r.quotationDate, filters.range)).length;
  const openValuePaise = inScope.filter((r) => r.status === 'draft' || r.status === 'sent').reduce((n, r) => n + r.grandTotalPaise, 0);

  const rows = searchAndSort(inScope.filter((r) => (!card || r.status === card) && (!source || r.source === source)), parseGridQuery(sp), QUOTATION_GRID);
  return { rows, counts, bySource, card, source, view, filters, olderOpen, openValuePaise, options, picked: { salesperson, city } };
}

const distinct = (xs: (string | null)[]) =>
  [...new Set(xs.filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b));
