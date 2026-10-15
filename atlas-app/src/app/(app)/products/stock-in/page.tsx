import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { StockInClient } from './StockInClient';

/**
 * STOCK IN BY SCAN (Scan-to-Stock G6, 12 Oct 2026) - opening stock, stock
 * found in a count, a transfer in. Opened from Products, or from the header
 * scanner's "Stock in by scan" with the scanned product (and serial) on it.
 */
export default async function StockInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const p = sp.product
    ? await db.product.findFirst({
      where: { id: sp.product, ...scopeWhere(ctx.scope) },
      select: { id: true, productCode: true, productName: true, trackingMode: true },
    })
    : null;
  return (
    <StockInClient
      canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('products.edit')}
      initial={p ? { product: { id: p.id, code: p.productCode, name: p.productName, trackingMode: p.trackingMode }, serial: sp.serial ?? null } : null}
    />
  );
}
