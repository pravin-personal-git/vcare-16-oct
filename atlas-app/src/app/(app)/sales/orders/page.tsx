import { redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { listConvertibleQuotations } from '@/server/sales-orders';
import { ordersList } from '@/server/orders-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { db } from '@/server/db';
import { SalesOrdersClient } from './SalesOrdersClient';
import { orderStagesFor } from '@/server/order-stages';

export default async function SalesOrdersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  // G-34: older links (`?open=<id>`) land on the order's own page.
  if (sp.open) redirect(`/sales/orders/${encodeURIComponent(sp.open)}`);
  const ctx = await requireContext();

  // Customers and products for the order form load when it opens (PERF-2).
  const [list, quotations, store, views, roles] = await Promise.all([
    ordersList(ctx, sp),
    listConvertibleQuotations(ctx.scope),
    ctx.scope.kind === 'single'
      ? db.store.findUnique({ where: { id: ctx.scope.storeId }, select: { stateId: true } })
      : Promise.resolve(null),
    listSavedViews(ctx, '/sales/orders'),
    shareableRoles(ctx),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp));


  return (
    <SalesOrdersClient
      rows={page.rows}
      paging={page.paging}
      counts={list.counts}
      extra={list.extra}
      money={list.money}
      cardKey={list.cardKey}
      live={list.live}
      rangeLabel={list.filters.range.label}
      olderLive={list.olderLive}
      canExport={canExportLists(ctx.permissions)}
      canRaiseJob={ctx.permissions.has('complaints.edit')}
      views={{ initial: views, roles }}
      quotations={quotations}
      storeState={store?.stateId ?? null}
      canCreate={ctx.scope.kind === 'single' && ctx.permissions.has('orders.create')}
      canApprove={ctx.permissions.has('orders.approve')}
      scopeIsAll={ctx.scope.kind === 'all'}
      view={list.view}
      filterOptions={list.options}
      picked={list.picked}
      stages={await orderStagesFor(ctx.scope)}
    />
  );
}
