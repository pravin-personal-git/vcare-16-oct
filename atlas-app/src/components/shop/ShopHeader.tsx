import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import type { ShopContext } from '@/server/shop-context';

/**
 * The business's own bar across the top of its shop: its logo, its name, its
 * colour. On the shared server this is the only thing telling a customer whose
 * shop they are in, so it is the business's identity and never Atlas's.
 *
 * UI refresh (4 Oct 2026): a light, frosted bar that stays put while you
 * scroll, so "My list" is always one tap away. The colour moved into the hero.
 */
export function ShopHeader({ shop, listCount }: { shop: ShopContext; listCount: number }) {
  const { organization: org } = shop;
  const next = encodeURIComponent(`${shop.base}/list`);
  const initials = org.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-card/95" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="mx-auto flex h-[4.25rem] max-w-7xl items-center gap-3 px-4">
        <Link href={shop.base} className="flex min-w-0 items-center gap-3">
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
            <img src={org.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl border border-border bg-white object-contain p-0.5" />
          ) : (
            <span className="btn-depth grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-sm font-black text-brand-fg">
              {initials}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-base font-extrabold leading-tight">{org.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{shop.store.address || shop.store.name}</span>
          </span>
        </Link>
        <nav className="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2" aria-label="Your account">
          {shop.partyId ? (
            <Link href="/portal" className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted sm:inline-flex">
              <Icon name="user" className="h-4 w-4" />
              <span className="max-w-[10rem] truncate">{shop.partyName}</span>
            </Link>
          ) : (
            <Link
              href={`/portal/login?shop=${shop.slug ?? ''}&next=${next}`}
              className="rounded-full px-3 py-2 text-sm font-bold text-foreground hover:bg-muted"
            >
              Sign in
            </Link>
          )}
          <Link
            href={`${shop.base}/list`}
            className="btn-depth relative inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-extrabold text-brand-fg hover:bg-brand-hover"
          >
            <Icon name="bag" className="h-4 w-4" />
            <span className="hidden sm:inline">My list</span>
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white/25 px-1.5 text-xs tabular-nums">{listCount}</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** The business's colours for this page. Values were filtered in shop-context. */
export function ShopTheme({ css }: { css: string }) {
  if (!css) return null;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
