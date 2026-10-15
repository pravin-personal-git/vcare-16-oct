import { redirect } from 'next/navigation';
import { getPortalContext } from '@/server/portal-context';
import { publicBrandUrl } from '@/server/storage';
import { portalConfig } from '@/server/config';
import { themeCssFrom } from '@/server/shop-context';
import { PortalNav } from './PortalNav';
import { Icon } from '@/components/ui/Icon';
import { logout } from '../../portal/login/actions';

/**
 * The portal's own shell - deliberately not the staff (app) layout.
 *
 * A customer has three screens, no sidebar, no store switcher, no menu tree.
 * Reusing the staff shell would mean threading a fake AppContext through it
 * for a role that was never meant to hold one; simpler and safer to build a
 * shell this small from scratch.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPortalContext();
  if (!ctx) redirect('/portal/login');
  if (ctx.party.portalMustReset) redirect('/portal/reset-password');

  const logoUrl = publicBrandUrl(ctx.organization.logoPath);
  // The business's own colours (3 Oct 2026): the portal used to ignore them,
  // so every client's customers saw the same blue Atlas default.
  const themeCss = themeCssFrom(ctx.organization.themeTokens);
  const showShop = (await portalConfig(ctx.store.id)).on('portal.shop');
  const initials = ctx.organization.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      {themeCss && <style dangerouslySetInnerHTML={{ __html: themeCss }} />}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-card/95">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={ctx.organization.name} className="h-10 w-10 rounded-xl border border-border bg-white object-contain p-0.5" />
          ) : (
            <span className="btn-depth grid h-10 w-10 place-items-center rounded-xl bg-brand text-sm font-black text-brand-fg">{initials}</span>
          )}
          <div className="min-w-0">
            <p className="truncate text-base font-extrabold leading-tight">{ctx.organization.name}</p>
            <p className="truncate text-micro uppercase text-muted-foreground">{ctx.store.name}</p>
          </div>

          <nav className="ms-6 hidden items-center gap-1 sm:flex" aria-label="Portal">
            <PortalNav showShop={showShop} />
          </nav>

          <div className="ms-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{ctx.party.displayName}</span>
            <form action={logout}>
              <button type="submit" title="Sign out"
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-danger/10 hover:text-danger">
                <Icon name="log-out" className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto border-t border-border px-2 py-1.5 sm:hidden" aria-label="Portal">
          <PortalNav showShop={showShop} compact />
        </nav>
      </header>

      <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
