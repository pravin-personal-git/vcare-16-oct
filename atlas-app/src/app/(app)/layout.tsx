import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Toaster } from '@/components/ui/Toaster';
import { AskHost } from '@/components/ui/ask';
import { getLocale } from 'next-intl/server';
import { translateLabel } from '@/i18n/ui-translations';
import { OpenTarget } from '@/components/ui/OpenTarget';
import { redirect } from 'next/navigation';
import { getContext } from '@/server/context';
import { publicBrandUrl } from '@/server/storage';
import { Header } from '@/components/shell/Header';
import { Sidebar } from '@/components/shell/Sidebar';
import { DASHES, allowedDashes } from './dashboard/dashes';
import { MobileNavProvider } from '@/components/shell/MobileNav';
import { ImpersonationBanner } from '@/components/shell/ImpersonationBanner';
import { ReadOnlyBanner } from '@/components/shell/ReadOnlyBanner';
import { sidebarClass, tenantCss } from '@/lib/appearance';
import { ExportPermissionProvider } from '@/components/ui/ExportPermission';
import { canExportHere } from '@/server/can-export';

/**
 * The browser-tab favicon, per tenant.
 *
 * `getContext` is wrapped in React's `cache()`, so this costs nothing extra -
 * the layout below calls it too, and both calls within one request resolve to
 * the same underlying fetch. Falls back to the product's own `app/favicon.ico`
 * convention when a tenant has not uploaded one, which is what happens when
 * `publicBrandUrl` returns null.
 */
export async function generateMetadata(): Promise<Metadata> {
  const ctx = await getContext();
  const favicon = ctx ? publicBrandUrl(ctx.organization.faviconPath) : null;
  return favicon ? { icons: { icon: favicon } } : {};
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  if (!ctx) redirect('/login');

  /**
   * A temporary password gets you here and no further (3 Oct 2026).
   *
   * Gated in the LAYOUT rather than in middleware or per page, because it has to
   * hold for all ~150 screens and a per-page check is one new page away from
   * being forgotten. /set-password lives outside this layout, so there is no
   * loop.
   *
   * It takes effect on their next page view rather than when their session
   * expires: the flag is read from the database on every request, not baked into
   * the cookie. An admin resetting a password for somebody who has walked away
   * from a logged-in machine wants it to bite now.
   */
  if (ctx.mustChangePassword) redirect('/set-password');

  /**
   * Per-tenant theme tokens, injected as CSS custom properties.
   * This is the mechanism that makes the product white-labelable - the
   * original hard-codes its palette and cannot be rebranded without a
   * code change.
   */
  const themeCss = tenantCss(ctx.organization.themeTokens);
  const exportAllowed = await canExportHere(ctx);

  return (
    <>
      {themeCss && (
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      )}
      {/*
        The provider wraps, but does not replace, the server-rendered shell.
        `Header` and `Sidebar` stay exactly where they were - this only gives
        them somewhere to share "is the drawer open", which they cannot do as
        two sibling server components. See components/shell/MobileNav.tsx.
      */}
      {/* Keyboard users jump past the menu to the page (13 Oct 2026, WCAG audit). */}
      <a href="#main" className="sr-only z-[400] rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg focus:not-sr-only focus:fixed focus:start-3 focus:top-3">
        {translateLabel('Skip to content', await getLocale())}
      </a>
      <MobileNavProvider>
        {/*
          `relative` here and on <main> (13 Oct 2026): screen-reader-only labels
          are position:absolute. With no positioned parent they were placed
          against the whole browser page, so one far down a long page (the
          Attachments box) made the window scroll and dragged the app up,
          leaving an empty band at the bottom.
        */}
        <div className="relative flex h-screen overflow-hidden">
          <Sidebar
            menu={ctx.menu}
            orgName={ctx.organization.name}
            orgLogoUrl={publicBrandUrl(ctx.organization.logoPath)}
            styleClass={sidebarClass(ctx.organization.themeTokens)}
            dashboards={allowedDashes(ctx.permissions, ctx.excludedModules, ctx.menuRoutes).map((k) => {
              const d = DASHES.find((x) => x.k === k)!;
              return { k: d.k, l: d.l, i: d.i };
            })}
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {ctx.impersonation && (
              <ImpersonationBanner organizationName={ctx.impersonation.organizationName} />
            )}
            {ctx.readOnly && <ReadOnlyBanner />}
            <Header ctx={ctx} />
            {/*
              `min-w-0` on the column above, for the same reason the KPI tiles
              needed it: a flex child will not shrink below its content, so one
              wide table could push the whole main column past the screen and
              take the header with it.
            */}
            <main className="page-bg thin-scroll outline-none relative flex-1 overflow-y-auto bg-background p-3 sm:p-5 lg:p-6" id="main" tabIndex={-1}>
              {/*
                Mounted once for the whole app (7 Oct 2026): a `?open=<id>`
                link scrolls to that row and rings it, and says so plainly when
                a filter is hiding it. Suspense because it reads the address,
                and nothing of it renders until there is something to say.
              */}
              <Suspense fallback={null}><OpenTarget /></Suspense>
              <ExportPermissionProvider allowed={exportAllowed}>{children}</ExportPermissionProvider>
            </main>
            <Toaster />
            <AskHost />
          </div>
        </div>
      </MobileNavProvider>
    </>
  );
}
