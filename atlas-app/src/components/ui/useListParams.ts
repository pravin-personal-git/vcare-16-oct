'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * The list screen's filters, kept in the address (health check PERF-1): the
 * server reads them, filters, and sends one page. `set` changes one or more
 * and goes back to page 1; the search box is debounced so typing does not
 * fire a request per key.
 */
export function useListParams() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  // Remember the list as it is now, so a detail page's Back returns to it
  // with the same filters (BackLink, F1b 6 Oct 2026). Per tab only.
  const qs0 = sp.toString();
  useEffect(() => {
    try { sessionStorage.setItem(`atlas:list:${pathname}`, qs0 ? `${pathname}?${qs0}` : pathname); } catch { /* storage off */ }
  }, [pathname, qs0]);

  const set =(patch: Record<string, string | null | undefined>) => {
    // From the address bar as it is NOW, not the router's copy (9 Oct 2026):
    // a screen that wrote the address itself a moment ago (My Desk's tab) had
    // that change undone by the next filter, built from the older copy.
    const next = new URLSearchParams(typeof window === 'undefined' ? sp.toString() : window.location.search);
    // Any change of filter goes back to the first page - the grid's `page` and a
    // card list's `<key>_p` alike. A patch that sets a page itself wins, as it
    // is applied after.
    for (const k of [...next.keys()]) if (k === 'page' || k.endsWith('_p')) next.delete(k);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined || v === '') next.delete(k); else next.set(k, v); }
    const qs = next.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return { get: (k: string) => sp.get(k), set, pending };
}

/** A search box value that commits to the address 350 ms after typing stops. */
export function useDebouncedSearch(param = 'q') {
  const { get, set, pending } = useListParams();
  const [value, setValue] = useState(get(param) ?? '');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const h = setTimeout(() => { if ((get(param) ?? '') !== value.trim()) set({ [param]: value.trim() || null }); }, 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return { value, setValue, pending };
}

/**
 * A filter value kept in the address WITHOUT asking the server again (F1b,
 * 6 Oct 2026) - for screens that already hold their whole list in the page
 * and filter it in the browser. The value survives refresh, Back and a shared
 * link; typing does not refetch anything. Also remembers the list's address
 * for a detail page's Back (BackLink).
 */
export function useUrlState(param = 'q'): [string, (v: string) => void] {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [value, setValue] = useState(sp.get(param) ?? '');
  useEffect(() => {
    const h = setTimeout(() => {
      try {
        const next = new URLSearchParams(window.location.search);
        if (value.trim()) next.set(param, value.trim()); else next.delete(param);
        const qs = next.toString();
        const url = qs ? `${pathname}?${qs}` : pathname;
        window.history.replaceState(window.history.state, '', url);
        sessionStorage.setItem(`atlas:list:${pathname}`, url);
      } catch { /* history or storage unavailable: the box still filters */ }
    }, 300);
    return () => clearTimeout(h);
  }, [value, param, pathname]);
  return [value, setValue];
}
