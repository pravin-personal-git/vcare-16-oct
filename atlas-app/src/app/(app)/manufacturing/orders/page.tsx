import { requireContext } from '@/server/context';
import { listProductionOrders } from '@/server/manufacturing';
import { ProductionOrderClient } from './ProductionOrderClient';

export default async function ProductionOrderPage() {
  const ctx = await requireContext();
  const rows = await listProductionOrders(ctx.scope);

  return (
    <ProductionOrderClient
      rows={rows.map((r) => ({
        id: r.id,
        orderNo: r.orderNo,
        qtyToProduce: r.qtyToProduce,
        status: r.status,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
        cancelReason: r.cancelReason,
        bom: {
          id: r.bom.id,
          outputQty: r.bom.outputQty,
          finishedProduct: r.bom.finishedProduct,
        },
      }))}
      canEdit={ctx.permissions.has('products.edit')}
    />
  );
}
