import { getShopContext } from '@/server/shop-context';
import { viewCart } from '@/server/shop';
import { ListView } from '@/components/shop/ListView';
import { ShopOff } from '@/components/shop/ShopOff';

export default async function PortalShopListPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const shop = await getShopContext({ portal: true });
  if (!shop) return <ShopOff />;
  const cart = shop.sessionKey ? await viewCart(shop.store.id, shop.sessionKey) : null;
  return (
    <ListView
      shopRef={{ portal: true }}
      base={shop.base}
      cart={cart}
      signedIn
      orgName={shop.organization.name}
      signInHref="/portal/login"
      registerHref={null}
      initialWant={sp.want === 'visit' ? 'visit' : 'buy'}
    />
  );
}
