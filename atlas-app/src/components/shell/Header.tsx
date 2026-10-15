import { getLocale } from 'next-intl/server';
import { StoreSwitcher } from './StoreSwitcher';
import { configFor } from '@/server/config';
import { LocaleSwitcher } from './LocaleSwitcher';
import { UserMenu } from './UserMenu';
import { GlobalSearch } from './GlobalSearch';
import { HeaderRail } from './HeaderRail';
import { PresenceButton, type PresenceSnapshot } from './PresenceButton';
import { AskAiButton } from './AskAiButton';
import { HeaderScanButton } from '@/components/scan/HeaderScanButton';
import { MobileMenuButton } from './MobileNav';
import { HistoryBack } from './HistoryBack';
import { Suspense } from 'react';
import type { Locale } from '@/i18n/config';
import type { AppContext } from '@/server/context';
import { todaysPresence } from '@/server/presence';
import { listLinkedAccounts } from '@/server/linked-accounts';
import { businessCreationStatus } from '@/server/business-entitlements';
import { initials } from '@/lib/revenue';

/**
 * The application bar.
 *
 * Reads left to right as: what am I looking for → which store am I in → what
 * can I do → who am I. The store switcher sits in the middle rather than the
 * corner because it is the control most likely to explain why a screen looks
 * empty, and a control that answers "why is this blank" should not be hidden.
 */
export async function Header({ ctx }: { ctx: AppContext }) {
  // Only offered when the Platform Owner has enabled it, to the built-in
  // Admin, within the plan's limit (business-entitlements.ts).
  const canCreateBusiness = !ctx.impersonation && ctx.organization.allowSelfServiceBusinessCreation
    && (await businessCreationStatus(ctx.user.id, ctx.organization.id).catch(() => ({ allowed: false }))).allowed;
  const locale = (await getLocale()) as Locale;

  /**
   * `web.show.branchSwitcher` (F1a, wired 1 Oct 2026).
   *
   * A client with one branch has a switcher that does nothing, and some
   * businesses deliberately do not want a manager hopping between branches
   * from the top bar. The switch has existed in the registry since F1a and
   * nothing read it - it was on the PENDING_WIRING burn-down list.
   *
   * Hidden rather than disabled: a control you cannot use is worse than one
   * that is not there. The server still scopes every query, so this is a
   * presentation choice and not a security boundary.
   */
  const showBranchSwitcher = ctx.stores.length > 1
    && (await configFor(ctx).catch(() => null))?.on('web.show.branchSwitcher') !== false;

  // Shared, because four copies of this existed and they disagreed - two took
  // the first two words, one took the last two, so the same person showed
  // different initials on different screens.
  const avatar = initials(ctx.user.fullName);

  /*
    TODAY'S ATTENDANCE, READ ON THE SERVER SO THE BUTTON IS NEVER WRONG ON ARRIVAL.

    The alternative was to let the button fetch its own state after mounting,
    which means every page load shows "Present" for a moment to somebody who
    marked themselves present at nine o'clock. On a control whose whole job is
    to say whether a thing has been done, a flash of the wrong answer invites a
    second press.

    Failure is swallowed on purpose. Attendance is not what the header is for,
    and a database blip must not take the application bar down with it - the
    button falls back to its unmarked state, and the write it leads to would
    fail loudly and honestly at that point if the database were really gone.
  */
  let presence: PresenceSnapshot | null = null;
  try {
    const today = await todaysPresence(ctx.user.id);
    if (today) {
      presence = {
        clockInAt: today.clockInAt.toISOString(),
        clockOutAt: today.clockOutAt ? today.clockOutAt.toISOString() : null,
        workedMinutes: today.workedMinutes,
        hasLocation: today.hasLocation,
      };
    }
  } catch (err) {
    console.error('[header] could not read today\'s presence', err);
  }

  let linkedAccounts: Awaited<ReturnType<typeof listLinkedAccounts>> = [];
  try {
    linkedAccounts = await listLinkedAccounts(ctx.user.id);
  } catch (err) {
    console.error('[header] could not read linked accounts', err);
  }

  return (
    /*
      `min-w-0` and `overflow-hidden`: a header row whose children refuse to
      shrink does not wrap, it overflows, and on a phone the overflow is the
      right hand end -- the avatar and the store switcher, which are the two
      controls somebody actually needs. The children shrink first now; this is
      the backstop.
    */
    <header className="app-topbar flex h-16 w-full min-w-0 shrink-0 items-center gap-1.5 overflow-hidden border-b border-border bg-card/95 px-2 sm:gap-2 sm:px-3 lg:gap-3 lg:px-4">
      {/*
        The only way to the menu on a phone.

        Sits first because that is where a thumb and an eye both go for
        navigation, and because the sidebar it opens is itself `hidden md:flex`
        - below that breakpoint there is no other route to the menu at all.
      */}
      <MobileMenuButton />

      {/* G-31: back to the previous page, on every page. Suspense: it reads the URL's query. */}
      {/* Below 360px (small phones) the phone's own back gesture does this, and the avatar needs the room (13 Oct 2026, WCAG audit). */}
      <div className="hidden min-[360px]:contents"><Suspense fallback={null}><HistoryBack /></Suspense></div>

      <GlobalSearch
        menu={ctx.menu}
        permissions={[...ctx.permissions]}
        excludedModules={[...ctx.excludedModules]}
        excludedPages={[...ctx.excludedPages]}
      />

      <div className="flex-1" />

      {showBranchSwitcher && <StoreSwitcher stores={ctx.stores} activeStoreId={ctx.activeStoreId} />}

      {/* The camera: barcodes, QR codes, and - where the business allows it - invoices, cards and labels read by AI. */}
      <div className="hidden min-[360px]:contents"><HeaderScanButton /></div>
      {/*
        On a phone the bar has room for one of these, and switching to Hindi
        matters more to staff in the field than Ask AI - so below laptop width
        the language switcher takes Ask AI's place. The laptop layout keeps
        both, with the language switcher further along the bar.
      */}
      <div className="hidden lg:block">
        <AskAiButton />
      </div>
      <div className="lg:hidden">
        <LocaleSwitcher current={locale} />
      </div>
      <PresenceButton initial={presence} />

      <span className="mx-1 hidden h-6 w-px bg-border lg:block" />

      <div className="hidden lg:block">
        <LocaleSwitcher current={locale} />
      </div>

      <div className="hidden md:block">
        <HeaderRail />
      </div>

      <span className="mx-1 hidden h-6 w-px bg-border sm:block" />

      <UserMenu
        fullName={ctx.user.fullName}
        username={ctx.user.username}
        email={ctx.user.email}
        initials={avatar}
        roleNames={ctx.roleNames}
        permissionCount={ctx.permissions.size}
        linkedAccounts={linkedAccounts}
        canCreateBusiness={canCreateBusiness}
        canLinkAccount={ctx.organization.allowLinkedAccounts && !ctx.impersonation}
      />
    </header>
  );
}
