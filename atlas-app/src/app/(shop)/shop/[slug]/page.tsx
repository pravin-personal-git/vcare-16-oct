import { redirect } from 'next/navigation';
import { getShopContext, portalInstead } from '@/server/shop-context';
import { publicShop, shopCategories } from '@/server/catalogue';
import { viewCart } from '@/server/shop';
import { ShopCatalogue } from '@/components/shop/ShopCatalogue';

/**
 * The shop, open to anybody.
 *
 * No `requireContext()` and no permission check, because there is nobody to
 * check. Everything it reads is already public by definition - a listing is on
 * the shop or it is not - and every query names its store explicitly, which is
 * the guarantee `scopeWhere` gives on the staff side written out by hand.
 */
export default async function BusinessShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = await getShopContext({ slug });
  if (!shop) return null; // the layout already says so
  const inside = await portalInstead(shop, shop.base);
  if (inside) redirect(inside);

  const [items, cart] = await Promise.all([
    publicShop(shop.store.id),
    shop.sessionKey ? viewCart(shop.store.id, shop.sessionKey) : Promise.resolve(null),
  ]);

  return (
    <ShopCatalogue
      shopRef={{ slug }}
      base={shop.base}
      items={items}
      categories={shopCategories(items)}
      cart={cart}
      signedIn={!!shop.partyId}
      orgName={shop.organization.name}
      customerName={shop.partyName}
    />
  );
}
