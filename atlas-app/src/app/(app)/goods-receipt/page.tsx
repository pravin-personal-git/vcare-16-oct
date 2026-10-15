import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { grnList } from '@/server/grn-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { listPurchaseOrders } from '@/server/purchase-orders';
import { scopeWhere } from '@/server/store-scope';
import { countAttachments } from '@/server/attachments';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { GoodsReceiptClient } from './GoodsReceiptClient';

/**
 * Goods receipts - searched and paged on the server (PERF-1); the counts cover
 * every receipt. Suppliers and products for "Receive goods" load when the
 * form opens (PERF-2), and the open purchase orders are read in ONE query -
 * they were read one per order, each waiting for the last on a single
 * database connection.
 */
export default async function GoodsReceiptPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [list, orders, views, roles] = await Promise.all([
    grnList(ctx, sp), listPurchaseOrders(ctx.scope), listSavedViews(ctx, '/goods-receipt'), shareableRoles(ctx),
  ]);

  const openIds = orders.filter((o) => o.status === 'approved' || o.status === 'partially_received').map((o) => o.id);
  const receivableOrders = openIds.length
    ? await db.purchaseOrder.findMany({
      where: { id: { in: openIds }, ...scopeWhere(ctx.scope) },
      include: { items: { orderBy: { srNo: 'asc' } } },
      orderBy: { orderDate: 'desc' },
    })
    : [];

  const page = slicePage(list.rows, parseGridQuery(sp));
  const photos = await countAttachments(ctx.scope, 'goods_receipt', page.rows.map((g) => g.id));

  return (
    <GoodsReceiptClient
      receipts={page.rows.map((g) => ({
        ...g,
        receivedDate: g.receivedDate.toISOString(),
        supplierInvoiceNo: g.supplierInvoiceNo,
        qty: list.qty(g),
        photoCount: photos.get(g.id) ?? 0,
      }))}
      paging={page.paging}
      counts={list.counts}
      status={list.status}
      totalAll={list.totalAll}
      rangeLabel={list.filters.range.label}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      orders={receivableOrders.map((o) => ({
        id: o.id, orderNo: o.orderNo, partyId: o.partyId, supplierName: o.supplierName,
        items: o.items.map((i) => ({
          id: i.id, productId: i.productId, productName: i.productName, productCode: i.productCode,
          qty: i.qty, receivedQty: i.receivedQty, unitCostPaise: i.unitCostPaise,
        })),
      }))}
      canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('purchase.edit')}
      isSingleStore={ctx.scope.kind === 'single'}
    />
  );
}
