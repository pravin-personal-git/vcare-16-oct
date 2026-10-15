import { field, jsonBody, requireAction } from '@/server/auth/v1-staff';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { matchProduct } from '@/lib/scan/match';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * The lines of a photographed supplier bill, matched to this store's products
 * (Scan-to-Stock G7, 12 Oct 2026). The phone used to say "Add each product
 * below" and the store keeper re-entered every line; now matched lines are
 * added on their own and the rest come back unmatched, for "Create product".
 * The same matcher the website's receipt uses (lib/scan/match).
 */
export async function POST(req: Request) {
  return field(req, 'purchase.edit', 'stock', async (ctx, access) => {
    requireAction(access, 'stock.receive', 'Receiving goods');
    const b = await jsonBody(req);
    const raw = Array.isArray(b.lines) ? b.lines.slice(0, 100) : [];
    const products = await db.product.findMany({
      where: { ...scopeWhere(ctx.scope), isActive: true },
      select: { id: true, productCode: true, productName: true, barcode: true, trackingMode: true },
      take: LIST_MAX_ROWS,
    });
    const pool = products.map((p) => ({ ...p, id: p.id, name: p.productName, code: p.productCode }));
    return {
      lines: raw.map((l: unknown, index: number) => {
        const o = (l ?? {}) as Record<string, unknown>;
        const description = String(o.description ?? '').slice(0, 200);
        const byBarcode = typeof o.barcode === 'string' && o.barcode.trim()
          ? pool.find((p) => p.barcode?.toUpperCase() === String(o.barcode).trim().toUpperCase()) : undefined;
        const hit = byBarcode ?? matchProduct(pool, description);
        return {
          index, description,
          product: hit ? { id: hit.id, productCode: hit.productCode, productName: hit.productName, barcode: hit.barcode, trackingMode: hit.trackingMode } : null,
        };
      }),
    };
  });
}
