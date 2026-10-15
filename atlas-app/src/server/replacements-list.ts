import 'server-only';
import type { AppContext } from './context';
import { listRmaCases, summariseRma, stuckAtVendor, type RmaRow } from './rma';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';

/**
 * Replacements (RMA cases), filtered - shared by the screen and its export
 * (F1). A work queue: logged date defaults to all time. ?filter= keeps the
 * name the dashboard tiles already link with.
 */

type Sp = Record<string, string | undefined>;

export const RMA_FILTERS: Record<string, (r: RmaRow) => boolean> = {
  open: (r) => r.status === 'open',
  sent: (r) => r.status === 'sent',
  overdue: (r) => r.overdue,
  received_back: (r) => r.status === 'received_back',
  done: (r) => ['returned_to_customer', 'closed', 'cancelled'].includes(r.status),
};

export const RMA_GRID: PageOptions<RmaRow> = {
  search: (r) => [r.caseNo, r.legacyRef, r.docketNo, r.serialNo, r.customerName, r.productName, r.brandModel, r.complaintNo, r.goingTo, r.courier],
  sort: {
    case: (r) => r.caseNo, item: (r) => r.productName, customer: (r) => r.customerName, where: (r) => r.goingTo,
    status: (r) => r.status, expected: (r) => r.expectedBackAt, createdAt: (r) => r.createdAt,
  },
};

export async function replacementsList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const filter = sp.filter && RMA_FILTERS[sp.filter] ? sp.filter : null;

  const all = await listRmaCases(ctx.scope);
  const inScope = all.filter((r) => inRange(r.createdAt, filters.range));
  const query = parseGridQuery(sp);
  const rows = searchAndSort(filter ? inScope.filter(RMA_FILTERS[filter]) : inScope,
    { q: query.q, sort: query.sort ?? { key: 'createdAt', dir: 'desc' } }, RMA_GRID);
  return {
    rows,
    totals: summariseRma(inScope),
    // From `all`, not `inScope`: see stuckAtVendor.
    stuck: stuckAtVendor(all),
    filter, filters, totalAll: all.length,
  };
}
