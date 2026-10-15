import { redirect } from 'next/navigation';
import { getShopContext } from '@/server/shop-context';

/**
 * Plain /shop (3 Oct 2026, Pravin's call).
 *
 * Every business has its own address, /shop/<short name>. With several
 * businesses on one server this page lists NOBODY: a list would show Vcare's
 * customers every other client hosted here. It used to show whichever business
 * was set up first, which put Vcare's customers in N.A.I.R.'s shop.
 *
 * On a server holding one business - the SaaS end state - there is no doubt
 * which shop is meant, so it goes straight there.
 */
export default async function ShopIndexPage() {
  const only = await getShopContext({ slug: null });
  if (only?.slug === null && only) {
    // One business, but does it have an address yet?
    const { db } = await import('@/server/db');
    const store = await db.store.findUnique({
      where: { id: only.store.id },
      select: { organization: { select: { shopSlug: true } } },
    });
    if (store?.organization.shopSlug) redirect(`/shop/${store.organization.shopSlug}`);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <div className="grid max-w-md gap-3 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted text-xl" aria-hidden="true">◎</span>
        <h1 className="text-2xl font-bold tracking-tight">Looking for a shop?</h1>
        <p className="text-base text-muted-foreground">
          Every business has its own shop link. Ask the business you buy from to send you theirs - it
          looks like <span className="font-semibold text-foreground">atlas.nairsolutions.org/shop/their-name</span>.
        </p>
        <p className="text-sm text-muted-foreground">
          Already a customer? <a href="/portal/login" className="font-semibold text-brand hover:underline">Sign in</a> and
          you will find the shop under Shop.
        </p>
      </div>
    </main>
  );
}
