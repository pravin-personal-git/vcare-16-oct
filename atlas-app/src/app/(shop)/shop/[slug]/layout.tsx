import { getShopContext } from '@/server/shop-context';
import { viewCart } from '@/server/shop';
import { ShopHeader, ShopTheme } from '@/components/shop/ShopHeader';

/**
 * A business's shop: /shop/<short name> (3 Oct 2026).
 *
 * The layout resolves the business once, colours the page with its own theme,
 * and draws its header. A wrong or retired short name gets a plain "no shop
 * here", never somebody else's shop.
 */
export default async function BusinessShopLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const shop = await getShopContext({ slug });

  if (!shop) {
    return (
      <main className="mx-auto grid max-w-md gap-2 px-4 py-24 text-center">
        <h1 className="text-xl font-bold">No shop at this address</h1>
        <p className="text-sm text-muted-foreground">
          Check the link with the business you buy from - it looks like atlas.nairsolutions.org/shop/their-name.
        </p>
      </main>
    );
  }

  const cart = shop.sessionKey ? await viewCart(shop.store.id, shop.sessionKey) : null;
  const listCount = cart?.lines.reduce((t, l) => t + l.qty, 0) ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <ShopTheme css={shop.organization.themeCss} />
      <ShopHeader shop={shop} listCount={listCount} />
      <main className="mx-auto max-w-7xl px-4 pb-10 pt-5 sm:pt-6">{children}</main>
      <footer className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-7xl gap-2 px-4 py-8 text-sm text-muted-foreground sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <p className="text-base font-extrabold text-foreground">{shop.organization.name}</p>
            {shop.store.address && <p className="mt-0.5">{shop.store.address}</p>}
            <p className="mt-2 max-w-2xl">
              Prices are for the product only. Fitting, cable and travel are quoted separately. Nothing is paid online.
            </p>
          </div>
          <p className="text-xs">Shop by Atlas</p>
        </div>
      </footer>
    </div>
  );
}
