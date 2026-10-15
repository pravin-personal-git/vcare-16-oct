import 'server-only';
import type { AppContext } from './context';
import { listSalesOrders, type SalesOrderRow } from './sales-orders';
import { salesReach } from './sales-reach';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { countByStatus, matchesFilter, parseFilter } from '@/lib/sales-order-status';

/**
 * Sales orders, filtered - shared by the screen and its export (F1).
 * A document list: order date defaults to this financial year; `olderLive`
 * counts orders dated earlier that are still moving, one click away.
 * ?card= is a KPI card key (fulfilment:x / payment:x / invoice:non_invoiced),
 * ?live=1 is the "Inprogress" chip.
 */

type Sp = Record<string, string | undefined>;

export const isLiveOrder = (r: SalesOrderRow) =>
  !['delivered', 'void', 'failed', 'refunded', 'returned'].includes(r.fulfilmentStatus);

export const ORDER_GRID: PageOptions<SalesOrderRow> = {
  search: (r) => [r.orderNo, r.quotationNo, r.customerName, r.organizationName, r.phone, r.awbNo, r.salespersonName],
  sort: {
    orderNo: (r) => r.orderNo, customerName: (r) => r.customerName, orderDate: (r) => r.orderDate,
    expectedDeliveryDate: (r) => r.expectedDeliveryDate, fulfilmentStatus: (r) => r.fulfilmentStatus, paymentStatus: (r) => r.paymentStatus, awbNo: (r) => r.awbNo, phone: (r) => r.phone,
    grandTotal: (r) => r.grandTotalPaise, due: (r) => r.grandTotalPaise - r.amountPaidPaise, salespersonName: (r) => r.salespersonName,
    itemCount: (r) => r.itemCount,
  },
};

export async function ordersList(ctx: AppContext, sp: Sp) {
  const view: 'active' | 'history' = sp.view === 'history' ? 'history' : 'active';
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const cardKey = sp.card ?? null;
  const filter = parseFilter(cardKey);
  const live = sp.live === '1';

  // Salesperson, city and courier - what the cards cannot say (4 Oct 2026).
  // Applied before the counts, so the cards answer for the narrowed list.
  const salesperson = sp.salesperson || null;
  const city = sp.city || null;
  const courier = sp.courier || null;

  // Whose orders this person sees (B4 step 3) - before the counts, so the cards agree.
  const reach = await salesReach(ctx);
  const all = (await listSalesOrders(ctx.scope, view)).filter((r) => !reach || reach.allows(r.salespersonId));
  const dated = all.filter((r) => inRange(r.orderDate, filters.range));
  const options = {
    salespeople: distinct(dated.map((r) => r.salespersonName)),
    cities: distinct(dated.map((r) => r.city)),
    couriers: distinct(dated.map((r) => r.courierName)),
  };
  const inScope = dated.filter((r) => (!salesperson || r.salespersonName === salesperson)
    && (!city || r.city === city) && (!courier || r.courierName === courier));
  const counts = countByStatus(inScope);
  const extra = { nonInvoiced: inScope.filter((r) => !r.isInvoiced).length, live: inScope.filter(isLiveOrder).length };
  const money = {
    openValuePaise: inScope.filter((r) => !['delivered', 'void', 'failed', 'refunded'].includes(r.fulfilmentStatus)).reduce((n, r) => n + r.grandTotalPaise, 0),
    dueValuePaise: inScope.reduce((n, r) => n + (r.grandTotalPaise - r.amountPaidPaise), 0),
  };
  const olderLive = inScope.length === all.length ? 0 : all.filter((r) => isLiveOrder(r) && !inRange(r.orderDate, filters.range)).length;

  const rows = searchAndSort(inScope.filter((r) => matchesFilter(r, filter) && (!live || isLiveOrder(r))), parseGridQuery(sp), ORDER_GRID);
  return {
    rows, counts, extra, money, cardKey: filter ? cardKey : null, live, view, filters, olderLive,
    options, picked: { salesperson, city, courier },
  };
}

const distinct = (xs: (string | null)[]) =>
  [...new Set(xs.filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b));
