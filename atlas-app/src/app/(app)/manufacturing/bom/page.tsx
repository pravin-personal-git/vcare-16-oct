import { requireContext } from '@/server/context';
import { listBoms } from '@/server/manufacturing';
import { BomClient } from './BomClient';

export default async function BomPage() {
  const ctx = await requireContext();
  const rows = await listBoms(ctx.scope);

  return (
    <BomClient
      rows={rows.map((r) => ({
        id: r.id,
        outputQty: r.outputQty,
        isActive: r.isActive,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
        finishedProduct: r.finishedProduct,
        components: r.components,
        orderCount: r._count.productionOrders,
      }))}
      canEdit={ctx.permissions.has('products.edit')}
    />
  );
}
