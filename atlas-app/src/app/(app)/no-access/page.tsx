import Link from 'next/link';
import { requireContext } from '@/server/context';
import { Card } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';

/** Where a page the person's role does not allow sends them (lib/route-access). */
export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ from?: string; plan?: string; menu?: string; reach?: string }> }) {
  const ctx = await requireContext();
  const { from, plan, menu, reach } = await searchParams;
  // Switched off by the platform owner for this business (F-01) - the whole
  // module, or this one page since 10 Oct 2026. No role can open it, so
  // pointing at Settings > Roles would send them in circles.
  const notInPlan = plan === '1';
  // Hidden in their menu (B1, 11 Oct 2026): the role may allow it, but the
  // branch, a role or a setting for this person switched the page off.
  const hiddenInMenu = !notInPlan && menu === '1';
  // Somebody else's quotation / order / invoice (B4 step 3, data reach).
  const outOfReach = !notInPlan && !hiddenInMenu && reach === '1';
  // Somebody outside their team (B4 step 4, attendance and leave reach).
  const personOutOfReach = !notInPlan && !hiddenInMenu && reach === 'people';
  const canFix = ctx.permissions.has('settings.edit');
  return (
    <div className="mx-auto mt-16 max-w-md">
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-warning/15 text-on-tint-warning">
          <Icon name="lock" className="h-6 w-6" />
        </span>
        <h1 className="text-lg font-semibold">{notInPlan ? 'Not part of your plan' : hiddenInMenu ? 'This page is switched off in your menu' : outOfReach ? 'This document belongs to someone else' : personOutOfReach ? 'This person is not in your team' : 'You do not have access to this page'}</h1>
        {personOutOfReach ? (
          <p className="text-sm text-muted-foreground">
            Your role shows you the attendance and leave of your own team only. To see this person, ask your administrator to widen
            {' '}&quot;Attendance and leave they see&quot; under Settings → Roles → Phone app, or to set who reports to whom in Team Setup.
          </p>
        ) : outOfReach ? (
          <p className="text-sm text-muted-foreground">
            Your role shows you only your own (or your team&apos;s) quotations, orders and invoices{from ? <> (<span className="font-mono text-xs">{from}</span>)</> : null}. To see this one, ask your administrator to widen
            {' '}&quot;Quotations, orders and invoices they see&quot; under Settings → Roles → Phone app.
          </p>
        ) : hiddenInMenu ? (
          <p className="text-sm text-muted-foreground">
            Your menu does not show this page{from ? <> (<span className="font-mono text-xs">{from}</span>)</> : null}, so it does not open from a link either.
            {canFix
              ? <> To show it, tick it for this branch, the role or the person in <Link href="/settings/store-menu-config" className="text-brand underline">Settings → Role &amp; User Menu</Link>.</>
              : <> If you need it for your work, ask your administrator to show it in Settings → Role &amp; User Menu.</>}
          </p>
        ) : notInPlan ? (
          <p className="text-sm text-muted-foreground">
            This area is not switched on for your business{from ? <> (<span className="font-mono text-xs">{from}</span>)</> : null}.
            To add it, contact your Atlas provider.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your role does not include this area{from ? <> (<span className="font-mono text-xs">{from}</span>)</> : null}.
            If you need it for your work, ask your administrator to add it to your role under Settings → Roles.
          </p>
        )}
        <Link href="/dashboard" className="mt-2 inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-fg hover:opacity-90">
          Go to the dashboard
        </Link>
      </Card>
    </div>
  );
}
