import 'server-only';
import type { AppContext } from './context';
import { listAmcContracts, type AmcContractRow } from './amc';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';

/**
 * Maintenance contracts, filtered - shared by the screen and its export (F1).
 * The date is the END date (what renewals are chased by), default all time.
 * ?filter= keeps the name the dashboard tiles link with; `due` and `lapsed`
 * are windows over active contracts, not statuses.
 */

type Sp = Record<string, string | undefined>;

export const AMC_FILTERS: Record<string, (r: AmcContractRow) => boolean> = {
  active: (r) => r.status === 'active',
  due: (r) => r.status === 'active' && r.isDue,
  lapsed: (r) => r.status === 'active' && r.isOverdue,
  unbilled: (r) => r.billing === 'awaiting_invoice',
  draft: (r) => r.status === 'draft',
  expired: (r) => r.status === 'expired',
  cancelled: (r) => r.status === 'cancelled',
};

export const AMC_GRID: PageOptions<AmcContractRow> = {
  search: (r) => [r.contractNo, r.legacyRef, r.customerName, r.customerPhone, r.siteLabel, r.invoiceNo, r.coverageTerms, r.notes],
  // Same keys as the AMC grid's columns, so a header click sorts on the server (F1b, 6 Oct 2026).
  sort: {
    contractNo: (r) => r.contractNo, customerName: (r) => r.customerName, phone: (r) => r.customerPhone,
    period: (r) => r.startDate, remaining: (r) => r.daysToExpiry, covers: (r) => r.itemCount,
    coverageTerms: (r) => r.coverageTerms,
    visits: (r) => (r.allowance.unlimited ? -1 : r.allowance.exceededBy * 1000 + r.allowance.used),
    amount: (r) => r.amountPaise, status: (r) => r.status, billing: (r) => r.billing, originInvoiceNo: (r) => r.originInvoiceNo,
  },
};

export async function amcList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const filter = sp.filter && AMC_FILTERS[sp.filter] ? sp.filter : null;
  const all = await listAmcContracts(ctx.scope);
  const inScope = all.filter((r) => inRange(r.endDate, filters.range));
  const rows = searchAndSort(filter ? inScope.filter(AMC_FILTERS[filter]) : inScope, parseGridQuery(sp), AMC_GRID);
  return { rows, filter, filters };
}
