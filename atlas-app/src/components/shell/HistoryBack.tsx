'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';

/**
 * BACK, ON EVERY PAGE (G-31, 10 Oct 2026). Pravin: "one back button in each
 * page which will revert to its previous page".
 *
 * It sits in the top bar, so every screen has it in the same place. It goes
 * back to the page you came from inside Atlas. Opened from a shared link or a
 * fresh tab there is no Atlas page behind it - then it goes UP instead (a
 * record to its list, a list to the dashboard) rather than leaving Atlas for
 * whatever site was open before.
 *
 * How it knows: every page change in this tab is counted in sessionStorage.
 * One page seen means nothing to go back to.
 */
const KEY = 'atlas:navDepth';

function parentOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return '/dashboard';
  return `/${parts.slice(0, -1).join('/')}`;
}

export function HistoryBack() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const where = `${pathname}?${search?.toString() ?? ''}`;

  useEffect(() => {
    try { sessionStorage.setItem(KEY, String(Number(sessionStorage.getItem(KEY) ?? '0') + 1)); } catch { /* storage off */ }
  }, [where]);

  const back = () => {
    let depth = 0;
    try { depth = Number(sessionStorage.getItem(KEY) ?? '0'); } catch { /* storage off */ }
    if (depth > 1 && window.history.length > 1) {
      // The page we land on counts itself again, so take two off now.
      try { sessionStorage.setItem(KEY, String(Math.max(0, depth - 2))); } catch { /* storage off */ }
      router.back();
    } else {
      router.push(parentOf(pathname ?? '/dashboard'));
    }
  };

  if (pathname === '/dashboard') return null;
  return (
    <button type="button" onClick={back} title="Back to the previous page" aria-label="Back"
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-foreground transition hover:bg-muted">
      <Icon name="arrow-left" className="h-4 w-4" />
      <span className="hidden sm:inline">Back</span>
    </button>
  );
}
