import { field, requireAction } from '@/server/auth/v1-staff';
import { lookupCode, searchProducts } from '@/server/stock-lookup';

/** `?code=` a scanned code (product code, barcode or unit serial); `?q=` a typed product search. */
export async function GET(req: Request) {
  return field(req, ['stock.view', 'purchase.edit', 'purchase.view'], 'stock', async (ctx, access) => {
    requireAction(access, 'stock.lookup', 'Stock look-up');
    const sp = new URL(req.url).searchParams;
    const code = sp.get('code');
    if (code) return lookupCode(ctx.scope, code);
    return { products: await searchProducts(ctx.scope, sp.get('q') ?? ''), units: [] };
  });
}
