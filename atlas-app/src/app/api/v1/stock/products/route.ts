import { field, jsonBody, requireAction, str, V1Error } from '@/server/auth/v1-staff';
import { createProductFromScan, ScanProductError, scanProductOptions } from '@/server/product-from-scan';

/**
 * New product from a scan, on the phone (Scan-to-Stock G2, 12 Oct 2026): the
 * same short form and the same checks as the website - one barcode per
 * product across the business, selling price optional ("price missing").
 * Needs Products add / edit and the Receive action, since it is reached from
 * the Receive screen.
 */
export async function GET(req: Request) {
  return field(req, 'products.edit', 'stock', async (ctx) => scanProductOptions(ctx.scope));
}

export async function POST(req: Request) {
  return field(req, 'products.edit', 'stock', async (ctx, access) => {
    requireAction(access, 'stock.receive', 'Receiving goods');
    if (ctx.scope.kind !== 'single') throw new V1Error('Choose a single branch first.');
    const b = await jsonBody(req);
    const rupees = (v: unknown) => {
      const n = Number(String(v ?? '').replace(/,/g, '').trim());
      return String(v ?? '').trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
    };
    try {
      const p = await createProductFromScan(ctx.scope, {
        productName: str(b.productName, 200) ?? '',
        barcode: str(b.barcode, 60),
        categoryId: str(b.categoryId, 60),
        trackingMode: str(b.trackingMode, 20) ?? 'quantity',
        unit: str(b.unit, 20) ?? 'pcs',
        costPaise: access.hide.purchaseRate ? null : rupees(b.cost),
        sellPaise: rupees(b.sell),
        taxRatePct: Number(b.taxRatePct ?? 18),
        hsnCode: str(b.hsnCode, 20),
      });
      return {
        ok: true,
        product: { id: p.id, productCode: p.productCode, productName: p.productName, barcode: p.barcode, trackingMode: p.trackingMode },
      };
    } catch (e) {
      if (e instanceof ScanProductError) throw new V1Error(e.message);
      throw e;
    }
  });
}
