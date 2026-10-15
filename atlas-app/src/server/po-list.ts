import 'server-only';
import type { AppContext } from './context';
import { listPurchaseOrders } from './purchase-orders';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';

/**
 * Purchase orders, filtered - shared by the screen and its export (F1).
 * Order date defaults to this financial year; `olderOpen` counts orders dated
 * earlier that are still waiting (sent, approved, partly received).
 * ?status= a status card (every status, incl. partly received - the old
 * chips left it out and the old cards did not filter).
 */

type Sp = Record<string, string | undefined>;
type Po = Awaited<ReturnType<typeof listPurchaseOrders>>[number];
export const PO_STATUSES = ['draft', 'sent', 'approved', 'partially_received', 'received', 'cancelled'] as const;
const OPEN = new Set(['sent', 'approved', 'partially_received']);

export const PO_GRID: PageOptions<Po> = {
  search: (o) => [o.orderNo, o.supplierName, o.approvedBy],
  sort: {
    orderNo: (o) => o.orderNo, supplier: (o) => o.supplierName, date: (o) => o.orderDate,
    expected: (o) => o.expectedDeliveryDate, total: (o) => o.grandTotalPaise, status: (o) => o.status,
  },
};

export async function poList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const status = (PO_STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status! : null;
  const all = await listPurchaseOrders(ctx.scope);
  const inScope = all.filter((o) => inRange(o.orderDate, filters.range));
  const counts = Object.fromEntries(PO_STATUSES.map((s) => [s, inScope.filter((o) => o.status === s).length])) as Record<string, number>;
  const onOrderPaise = inScope.filter((o) => o.status !== 'cancelled').reduce((n, o) => n + o.grandTotalPaise, 0);
  const olderOpen = inScope.length === all.length ? 0 : all.filter((o) => OPEN.has(o.status) && !inRange(o.orderDate, filters.range)).length;
  const rows = searchAndSort(status ? inScope.filter((o) => o.status === status) : inScope, parseGridQuery(sp), PO_GRID);
  return { rows, counts, status, filters, onOrderPaise, olderOpen, totalAll: all.length };
}
