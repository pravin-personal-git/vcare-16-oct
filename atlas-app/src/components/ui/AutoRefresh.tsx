'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Quietly re-reads the page every few seconds while it is in front (Pravin,
 * 28 Sep 2026: "things should show without refreshing"). Skipped while the
 * person is typing or a dialog is open, so nothing they are doing is
 * interrupted; router.refresh keeps every input and open panel as it is.
 *
 * 30 s, not 5 s (30 Oct 2026): each refresh re-reads the whole page from the
 * database, and 5 s across a few open tabs used ~50 GB of Supabase egress in two weeks.
 */
export function AutoRefresh({ everyMs = 30_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const el = document.activeElement;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (document.querySelector('[role="dialog"]')) return;
      router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
