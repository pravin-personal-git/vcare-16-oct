import { getShopContext } from '@/server/shop-context';
import { publicShop, shopCategories } from '@/server/catalogue';
import { viewCart } from '@/server/shop';
import { ShopCatalogue } from '@/components/shop/ShopCatalogue';
import { ShopOff } from '@/components/shop/ShopOff';

/**
 * The shop, for a customer who is already signed in (3 Oct 2026).
 *
 * Pravin's point: existing customers must see the catalogue too, without
 * registering a second time. It is the same catalogue and the same list as the
 * public shop, for the customer's own business - which comes from their login,
 * never from the address.
 */
export default async function PortalShopPage() {
  const shop = await getShopContext({ portal: true });
  if (!shop) return <ShopOff />;

  const [items, cart] = await Promise.all([
    publicShop(shop.store.id),
    shop.sessionKey ? viewCart(shop.store.id, shop.sessionKey) : Promise.resolve(null),
  ]);

  return (
    <ShopCatalogue
      shopRef={{ portal: true }}
      base={shop.base}
      items={items}
      categories={shopCategories(items)}
      cart={cart}
      signedIn
      orgName={shop.organization.name}
      customerName={shop.partyName}
      stickyTop="4rem"
    />
  );
}
