import { field } from '@/server/auth/v1-staff';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';

/**
 * Parts search for a technician raising a challan on site (workflow slice 4).
 * Separate from the stock lookup, which needs stock rights most technicians
 * do not have: this returns only what a challan needs - name and code - and
 * never prices or stock figures.
 */
export async function GET(req: Request) {
  return field(req, 'complaints.edit', 'complaints', async (ctx) => {
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 60);
    if (q.length < 2) return { products: [] };
    const products = await db.product.findMany({
      where: {
        ...scopeWhere(ctx.scope), isActive: true, kind: { not: 'service' },
        OR: [{ productName: { contains: q, mode: 'insensitive' } }, { productCode: { contains: q, mode: 'insensitive' } }],
      },
      select: { id: true, productCode: true, productName: true },
      orderBy: { productName: 'asc' },
      take: 25,
    });
    return { products };
  });
}
