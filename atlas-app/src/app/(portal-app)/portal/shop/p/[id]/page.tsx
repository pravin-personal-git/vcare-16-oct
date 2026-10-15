import Link from 'next/link';
import { getShopContext } from '@/server/shop-context';
import { publicShop } from '@/server/catalogue';
import { viewCart } from '@/server/shop';
import { ProductView } from '@/components/shop/ProductView';
import { productExtras } from '@/server/shop-extras';
import { ShopOff } from '@/components/shop/ShopOff';

export default async function PortalShopProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shop = await getShopContext({ portal: true });
  if (!shop) return <ShopOff />;

  const [items, cart] = await Promise.all([
    publicShop(shop.store.id),
    shop.sessionKey ? viewCart(shop.store.id, shop.sessionKey) : Promise.resolve(null),
  ]);
  const item = items.find((i) => i.id === id);
  if (!item) {
    return (
      <div className="grid gap-2 py-12 text-center">
        <p className="text-base font-semibold">This is no longer on the shop.</p>
        <Link href={shop.base} className="font-bold text-brand hover:underline">See what is</Link>
      </div>
    );
  }
  const extras = await productExtras(shop, item, items);
  const byId = new Map(items.map((i) => [i.id, i]));
  const pick = (ids: string[]) => ids.map((x) => byId.get(x)).filter((x): x is (typeof items)[number] => !!x);

  return (
    <ProductView
      shopRef={{ portal: true }}
      base={shop.base}
      item={item}
      inList={cart?.lines.find((l) => l.refId === item.id)?.qty ?? 0}
      related={pick(extras.similar)}
      alsoViewed={pick(extras.alsoViewed)}
      reviews={extras.reviews}
      myReview={extras.mine}
      canReview={extras.canReview}
      saved={extras.saved}
      registerHref={shop.slug ? `/shop/${shop.slug}/register` : null}
      listed={Object.fromEntries((cart?.lines ?? []).map((l) => [l.refId, l.qty]))}
    />
  );
}
