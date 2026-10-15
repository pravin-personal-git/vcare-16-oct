'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';

/**
 * Whether the navigation drawer is open, shared between the header and the
 * sidebar.
 *
 * WHY A CONTEXT AND NOT A PROP.
 *
 * The button that opens the drawer lives in `Header`; the drawer itself lives
 * in `Sidebar`. They are siblings under `(app)/layout.tsx`, and both of those
 * are server components - so there is no shared client parent to hold a
 * `useState` between them, and no way to pass a setter down without turning the
 * whole layout into a client component and giving up its server-side data
 * fetch.
 *
 * A three-line context is the smaller change, and it keeps the layout on the
 * server where it belongs.
 */

const MobileNavContext = createContext<{
  open: boolean;
  setOpen: (v: boolean) => void;
} | null>(null);

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <MobileNavContext.Provider value={{ open, setOpen }}>
      {children}
    </MobileNavContext.Provider>
  );
}

/**
 * Throws rather than returning a default.
 *
 * A silent no-op here would mean the hamburger renders, the user taps it, and
 * nothing happens - with no error anywhere to explain why. Failing at the
 * provider boundary makes a missing provider a build-time-obvious bug instead
 * of a mystery on someone's phone.
 */
export function useMobileNav() {
  const ctx = useContext(MobileNavContext);
  if (!ctx) throw new Error('useMobileNav must be used inside <MobileNavProvider>');
  return ctx;
}

/**
 * The hamburger. Phone and small-tablet only.
 *
 * `md:hidden` mirrors the sidebar's own `hidden md:flex` exactly. The two must
 * agree: a width where both are hidden leaves a user with no navigation at all,
 * and a width where both show puts a dead button next to a visible menu.
 */
export function MobileMenuButton() {
  const { setOpen } = useMobileNav();

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open menu"
      // 40px square: Android and iOS both want at least ~44px of touch target,
      // and this sits inside a 56px header with padding making up the rest.
      className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground md:hidden"
    >
      <Icon name="menu" className="h-5 w-5" />
    </button>
  );
}
