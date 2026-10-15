import 'server-only';
import type { AppContext } from './context';
import { listDispatches } from './goods-dispatch';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';

/**
 * Goods Dispatch Notes, filtered - shared by the screen and its export (F1).
 * Order date defaults to this financial year; `olderInTransit` counts
 * dispatches dated earlier that have not arrived, one click away.
 * ?card= in_transit | delivered | returned - the same groups the cards count
 * (before 26 Sep the cards did not filter and the chips used other groups).
 */

type Sp = Record<string, string | undefined>;
type Gdn = Awaited<ReturnType<typeof listDispatches>>[number];

export const GDN_CARDS: Record<string, (r: Gdn) => boolean> = {
  in_transit: (r) => r.fulfilmentStatus === 'dispatched' || r.fulfilmentStatus === 'shipped',
  delivered: (r) => r.fulfilmentStatus === 'delivered',
  returned: (r) => r.fulfilmentStatus === 'returned' || r.fulfilmentStatus === 'damage_or_lost',
};

export const GDN_GRID: PageOptions<Gdn> = {
  search: (r) => [r.orderNo, r.customerName, r.organizationName, r.courierName, r.awbNo],
  sort: {
    orderNo: (r) => r.orderNo, customer: (r) => r.organizationName ?? r.customerName, date: (r) => r.orderDate,
    courier: (r) => r.courierName, awb: (r) => r.awbNo, total: (r) => r.grandTotalPaise, status: (r) => r.fulfilmentStatus,
  },
};

export async function gdnList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const card = sp.card && GDN_CARDS[sp.card] ? sp.card : null;
  const all = await listDispatches(ctx.scope);
  const inScope = all.filter((r) => inRange(r.orderDate, filters.range));
  const counts = Object.fromEntries(Object.entries(GDN_CARDS).map(([k, fn]) => [k, inScope.filter(fn).length])) as Record<string, number>;
  const olderInTransit = inScope.length === all.length ? 0
    : all.filter((r) => GDN_CARDS.in_transit(r) && !inRange(r.orderDate, filters.range)).length;
  const rows = searchAndSort(card ? inScope.filter(GDN_CARDS[card]) : inScope, parseGridQuery(sp), GDN_GRID);
  return { rows, counts, card, filters, olderInTransit, totalAll: all.length };
}
