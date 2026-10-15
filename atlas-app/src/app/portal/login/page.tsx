import { redirect } from 'next/navigation';
import { getPortalContext } from '@/server/portal-context';
import { getShopContext } from '@/server/shop-context';
import { LoginForm } from './LoginForm';
import { portalPathFor } from '@/lib/portal-target';

/**
 * Customer sign-in. Arriving from a shop (`?shop=vcare&next=/shop/vcare/list`)
 * it wears that business's name and colours, signs into that business's
 * account, and goes back to where the customer was.
 */
export default async function PortalLoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await getPortalContext();
  const shop = sp.shop ? await getShopContext({ slug: sp.shop }) : null;
  const next = sp.next?.startsWith('/') ? sp.next : null;

  if (ctx) {
    if (ctx.party.portalMustReset) redirect('/portal/reset-password');
    // Signed in to the business whose shop sent them here (or no shop at all):
    // straight into the portal, at the matching page.
    if (!shop || shop.partyId) redirect(portalPathFor(next));
  }

  const name = shop?.organization.name ?? 'Customer Portal';

  return (
    <main className="grid min-h-screen place-items-center bg-background p-4">
      {shop?.organization.themeCss && (
        <style dangerouslySetInnerHTML={{ __html: shop.organization.themeCss }} />
      )}
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-card sm:p-8">
        <div className="flex items-center gap-2.5">
          {shop?.organization.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
            <img src={shop.organization.logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain" />
          ) : (
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-navy text-lg font-black text-navy-fg">
              {name.slice(0, 1)}
            </span>
          )}
          <div>
            <p className="text-base font-bold leading-tight text-navy">{name}</p>
            {/* Arriving without a shop there is no business to name, so the
                product does: Vcare, the brand (25 Sep 2026). This page is
                seen by a CLIENT'S CUSTOMER, which is as public as it gets, and
                it said "Atlas" - a name only we use. */}
            <p className="text-micro uppercase text-muted-foreground">{shop ? 'Customer sign-in' : 'Vcare'}</p>
          </div>
        </div>

        <h1 className="mt-6 text-xl font-bold">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {shop ? 'To send your list, and to see your bills and complaints.' : 'See your purchases and raise a complaint directly.'}
        </p>

        <div className="mt-6">
          <LoginForm
            next={next}
            shop={shop?.slug ?? null}
            registerHref={shop ? `${shop.base}/register${next ? `?next=${encodeURIComponent(next)}` : ''}` : null}
          />
        </div>
      </div>
    </main>
  );
}
