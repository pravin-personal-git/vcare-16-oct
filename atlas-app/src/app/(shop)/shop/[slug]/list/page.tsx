import { redirect } from 'next/navigation';
import { getShopContext, portalInstead } from '@/server/shop-context';
import { viewCart } from '@/server/shop';
import { ListView } from '@/components/shop/ListView';

export default async function ShopListPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const shop = await getShopContext({ slug });
  if (!shop) return null;
  const inside = await portalInstead(shop, `${shop.base}/list${sp.want === 'visit' ? '?want=visit' : ''}`);
  if (inside) redirect(inside);

  const cart = shop.sessionKey ? await viewCart(shop.store.id, shop.sessionKey) : null;
  const back = encodeURIComponent(`${shop.base}/list`);

  return (
    <ListView
      shopRef={{ slug }}
      base={shop.base}
      cart={cart}
      signedIn={!!shop.partyId}
      orgName={shop.organization.name}
      signInHref={`/portal/login?shop=${slug}&next=${back}`}
      registerHref={`${shop.base}/register?next=${back}`}
      initialWant={sp.want === 'visit' ? 'visit' : 'buy'}
    />
  );
}
