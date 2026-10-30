import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getPlatformContext } from '@/server/platform-context';
import { resolveBestOrgScope } from '@/server/platform-scope';
import { supportWaitingCount } from '@/server/platform-support';
import { logout } from '@/app/login/actions';
import { Icon } from '@/components/ui/Icon';

/**
 * The Platform Owner / Reseller shell - deliberately not the staff (app)
 * layout, same reasoning as `(portal-app)/portal/layout.tsx`: this role has
 * no store, no `Organization`, no menu tree. Reusing the staff shell would
 * mean threading a fake tenant `AppContext` through it for a role that was
 * never meant to hold one.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPlatformContext();
  if (!ctx) redirect('/platform-login');

  const canSeeResellers = ctx.permissions.has('platformReseller.view');
  const canSeeSettings = ctx.permissions.has('platformConfig.edit');
  const canSeeAudit = ctx.permissions.has('platformAudit.view');
  // Tickets businesses sent to support, still waiting on a first answer or the next one.
  const scope = await resolveBestOrgScope(ctx.memberships);
  const waiting = scope ? await supportWaitingCount(scope) : 0;
  const supportLink = (cls: string) => (
    <Link href="/platform/support" className={cls}>
      Support{waiting > 0 && <span className="ms-1.5 rounded-full bg-danger px-1.5 text-micro font-bold text-white">{waiting}</span>}
    </Link>
  );

  // The widest membership names the shell - a PLATFORM one reads "Atlas
  // Platform" (the root account's own name), a RESELLER-only user sees
  // their own reseller's name instead. Showing "Atlas Platform" to a
  // Reseller Owner would be actively misleading about whose data they're
  // looking at.
  const primary =
    ctx.memberships.find((m) => m.scopeType === 'PLATFORM')
    ?? ctx.memberships.find((m) => m.scopeType === 'RESELLER')
    ?? ctx.memberships[0];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-navy text-navy-fg">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <span className="grid h-8 w-8 place-items-center rounded bg-brand text-sm font-black text-brand-fg">A</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight">{primary.scopeName}</p>
            <p className="truncate text-micro uppercase text-navy-fg/60">
              {ctx.memberships.map((m) => m.roleName).join(' · ')}
            </p>
          </div>

          <nav className="ms-6 hidden items-center gap-1 sm:flex">
            <Link href="/platform/tenants" className="rounded px-3 py-1.5 text-sm font-medium text-navy-fg/80 transition hover:bg-white/10 hover:text-navy-fg">Tenants</Link>
            {scope && supportLink('rounded px-3 py-1.5 text-sm font-medium text-navy-fg/80 transition hover:bg-white/10 hover:text-navy-fg')}
            {canSeeResellers && (
              <Link href="/platform/resellers" className="rounded px-3 py-1.5 text-sm font-medium text-navy-fg/80 transition hover:bg-white/10 hover:text-navy-fg">Resellers</Link>
            )}
            {canSeeAudit && (
              <Link href="/platform/audit" className="rounded px-3 py-1.5 text-sm font-medium text-navy-fg/80 transition hover:bg-white/10 hover:text-navy-fg">Audit</Link>
            )}
            {canSeeSettings && (
              <Link href="/platform/settings" className="rounded px-3 py-1.5 text-sm font-medium text-navy-fg/80 transition hover:bg-white/10 hover:text-navy-fg">Settings</Link>
            )}
          </nav>

          <div className="ms-auto flex items-center gap-3">
            <span className="hidden text-xs text-navy-fg/70 sm:inline">{ctx.user.fullName}</span>
            <form action={logout}>
              <button type="submit" title="Sign out"
                className="grid h-8 w-8 place-items-center rounded-full text-navy-fg/70 transition hover:bg-white/10 hover:text-navy-fg">
                <Icon name="log-out" className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto border-t border-white/10 px-2 py-1.5 sm:hidden">
          <Link href="/platform/tenants" className="whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium text-navy-fg/80 hover:bg-white/10 hover:text-navy-fg">Tenants</Link>
          {scope && supportLink('whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium text-navy-fg/80 hover:bg-white/10 hover:text-navy-fg')}
          {canSeeResellers && (
            <Link href="/platform/resellers" className="whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium text-navy-fg/80 hover:bg-white/10 hover:text-navy-fg">Resellers</Link>
          )}
          {canSeeAudit && (
            <Link href="/platform/audit" className="whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium text-navy-fg/80 hover:bg-white/10 hover:text-navy-fg">Audit</Link>
          )}
          {canSeeSettings && (
            <Link href="/platform/settings" className="whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium text-navy-fg/80 hover:bg-white/10 hover:text-navy-fg">Settings</Link>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
