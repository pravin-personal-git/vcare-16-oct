import { requireContext } from '@/server/context';
import { listInvoiceableOrders, summariseAllInvoices } from '@/server/invoices';
import { listBillableWork } from '@/server/consolidated-invoice';
import { invoicesList } from '@/server/invoices-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { db } from '@/server/db';
import type { FulfilmentStatus } from '@/lib/sales-order-status';
import { stageNamer } from '@/server/order-stages';
import { InvoicesClient } from './InvoicesClient';

export default async function InvoicesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  // `totals` covers every invoice in scope. `rows` is capped, and summing a
  // capped page is what made the header and the status tiles report 500 for a
  // store holding 3,380 invoices.
  // Filtered, searched and paged here; the browser gets one page (PERF-1).
  // Customers and products for the create form load when it opens (PERF-2).
  // F1 (26 Sep 2026): the list and its cards follow the invoice-date range
  // (default this FY) through server/invoices-list; `totals` - receivable and
  // overdue in the header - stay all time, because money owed does not expire.
  const list = await invoicesList(ctx, sp);
  const { view, query } = list;
  const [totals, orders, billable, store, views, roles, stageName] = await Promise.all([
    summariseAllInvoices(ctx.scope, view),
    listInvoiceableOrders(ctx.scope),
    listBillableWork(ctx.scope),
    ctx.scope.kind === 'single'
      ? db.store.findUnique({ where: { id: ctx.scope.storeId }, select: { stateId: true } })
      : Promise.resolve(null),
    listSavedViews(ctx, '/invoices'),
    shareableRoles(ctx),
    stageNamer(ctx.scope),
  ]);

  const pageCount = Math.max(1, Math.ceil(list.rows.length / query.pageSize));
  const pageNo = Math.min(query.page, pageCount - 1);

  return (
    <InvoicesClient
      rows={list.rows.slice(pageNo * query.pageSize, (pageNo + 1) * query.pageSize)}
      paging={{ total: list.rows.length, page: pageNo, pageSize: query.pageSize, sort: query.sort }}
      card={list.card}
      counts={list.counts}
      rangeLabel={list.filters.range.label}
      olderUnpaid={list.olderUnpaid}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      totals={totals}
      orders={orders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        customerName: o.customerName,
        organizationName: o.organizationName,
        grandTotalPaise: o.grandTotalPaise,
        amountPaidPaise: o.amountPaidPaise,
        fulfilmentStatus: o.fulfilmentStatus as FulfilmentStatus,
        stageLabel: stageName(o.fulfilmentStatus),
        orderDate: o.orderDate,
      }))}
      billable={billable}
      storeState={store?.stateId ?? null}
      canCreate={ctx.scope.kind === 'single' && ctx.permissions.has('invoice.create')}
      canApprove={ctx.permissions.has('invoice.approve')}
      scopeIsAll={ctx.scope.kind === 'all'}
      view={view}
    />
  );
}
