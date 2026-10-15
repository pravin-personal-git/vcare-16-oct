import { NextResponse } from 'next/server';
import { getShopContext } from '@/server/shop-context';
import { publicShop, shopCategories } from '@/server/catalogue';

/**
 * A business's shop for Vcare before anybody signs in (3 Oct 2026):
 * read-only, exactly what /shop/<slug> shows on the web. Making a list needs
 * an account (decision 9), so there is no basket here.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = await getShopContext({ slug });
  if (!shop) return NextResponse.json({ error: 'There is no shop with that name. Check it with the business.' }, { status: 404 });
  const items = await publicShop(shop.store.id);
  return NextResponse.json(
    { business: shop.organization.name, slug: shop.slug, items, categories: shopCategories(items) },
    { headers: { 'cache-control': 'public, max-age=60' } },
  );
}
