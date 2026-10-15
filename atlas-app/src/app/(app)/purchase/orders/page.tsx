import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { poList } from '@/server/po-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { scopeWhere } from '@/server/store-scope';
import { PurchaseOrdersClient } from './PurchaseOrdersClient';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

export default async function PurchaseOrdersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  const [list, suppliers, products, views, roles] = await Promise.all([
    poList(ctx, sp),
    // Same "suppliers first, not suppliers only" rule as Purchase Bills -
    // `createPurchaseOrder` flips `isSupplier` itself the first time a party
    // is ordered from.
    db.party.findMany({
      where: { ...scopeWhere(ctx.scope), status: 'active' },
      select: {
        id: true, title: true, firstName: true, lastName: true,
        companyName: true, gstin: true, isSupplier: true, state: true,
      },
      orderBy: [{ isSupplier: 'desc' }, { firstName: 'asc' }],
      take: LIST_MAX_ROWS,
    }),
    db.product.findMany({
      where: { ...scopeWhere(ctx.scope), isActive: true },
      select: { id: true, productName: true, productCode: true, hsnCode: true, sacCode: true },
      orderBy: { productName: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    listSavedViews(ctx, '/purchase/orders'),
    shareableRoles(ctx),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp));

  return (
    <PurchaseOrdersClient
      paging={page.paging}
      counts={list.counts}
      status={list.status}
      rangeLabel={list.filters.range.label}
      onOrderPaise={list.onOrderPaise}
      olderOpen={list.olderOpen}
      totalAll={list.totalAll}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      orders={page.rows.map((o) => ({
        ...o,
        orderDate: o.orderDate.toISOString(),
        expectedDeliveryDate: o.expectedDeliveryDate?.toISOString() ?? null,
        approvedAt: o.approvedAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
      }))}
      suppliers={suppliers.map((p) => ({
        id: p.id,
        name: p.companyName?.trim() || [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim(),
        gstin: p.gstin,
        isSupplier: p.isSupplier,
      }))}
      products={products.map((p) => ({
        id: p.id, name: p.productName, code: p.productCode, hsnCode: p.hsnCode ?? p.sacCode,
      }))}
      canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('purchase.edit')}
      canApprove={ctx.permissions.has('purchase.approve')}
      isSingleStore={ctx.scope.kind === 'single'}
    />
  );
}
