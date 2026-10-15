'use client';

import { isPageOff } from '@/lib/modules';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';
import { iconFor } from './Sidebar';
import type { MenuNode } from '@/server/context';
// One source for the kinds, their labels and their icons - see the note there.
import { KIND_ICON, KIND_LABEL, type SearchHit } from '@/lib/search-kinds';
import { searchSettings } from '@/lib/settings-registry';

/**
 * Command palette - screens and records.
 *
 * Two things share one box, in this order:
 *
 *   1. SCREENS, shown instantly from a list held in the browser. Zero latency,
 *      which is what makes the palette worth reaching for at all. Built from
 *      the same menu tree the sidebar renders - every screen a user's role
 *      can actually see, not a hand-picked handful - so a control never
 *      shows up in search that the sidebar itself would hide from them.
 *   2. SETTINGS, also instant, from `lib/settings-registry`. This is the half
 *      the menu cannot do: settings live INSIDE screens, so searching menu
 *      labels never finds them. Typing "hsn", "geofence", "biometric" or
 *      "lost phone" lands on the right settings page even though none of
 *      those words appears in its name (workstream B, 1 Oct 2026).
 *   3. RECORDS, fetched after a pause in typing. Customers, invoices, purchase
 *      bills, products, quotations, orders, leads, receipts, credit notes,
 *      sales returns, purchase orders, employees, tasks.
 *
 * Screens first because they are certain and free. A record search that made
 * you wait before showing "Dashboard" would be slower than clicking the
 * sidebar, and nobody would use it twice.
 *
 * Records arrive underneath and the list grows. The cursor is deliberately NOT
 * reset when they land - somebody who has already arrowed down to a screen and
 * is about to press Enter must not have the selection move under them.
 */
interface Destination { label: string; hint: string; route: string; icon: IconName }

/** Every leaf the menu tree actually links to, flattened with its group as a hint. */
function flattenMenu(nodes: MenuNode[], groupLabel: string | null = null): Destination[] {
  const out: Destination[] = [];
  for (const n of nodes) {
    if (n.route) {
      out.push({ label: n.label, hint: groupLabel ?? 'Menu', route: n.route, icon: iconFor(n.label) });
    }
    if (n.children.length > 0) {
      out.push(...flattenMenu(n.children, n.label));
    }
  }
  return out;
}

/*
 * `Hit` was a third copy of the server result shape, with `kind: string` -
 * which is why a kind the query returned but nothing labelled produced a
 * blank row instead of a compile error. It is the shared `SearchHit` now, so
 * `kind` is the union and both maps are exhaustive by construction.
 */
type Hit = SearchHit;

/*
 * The KIND_ICON and KIND_LABEL maps were declared here as a second copy of
 * the ones in server/search.ts. Both are now imported from lib/search-kinds,
 * so a new result kind cannot appear in the query and be unlabelled here.
 */

export function GlobalSearch({ menu, permissions, excludedModules = [], excludedPages = [] }: {
  menu: MenuNode[];
  /**
   * Passed in rather than re-derived: a settings screen must never be offered
   * to somebody who would be refused at the door. The menu tree is already
   * permission-filtered on the server, but settings entries are matched by
   * KEYWORD, so several are reachable here that the menu would never show.
   */
  permissions: string[];
  /** Modules the platform owner switched off (F-01). */
  excludedModules?: string[];
  /** Individual pages the platform owner switched off (F-01, 10 Oct 2026). */
  excludedPages?: string[];
}) {
  const router = useRouter();
  const destinations = useMemo(() => flattenMenu(menu), [menu]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
      setHits([]);
      // The input mounts with the dialog; focus after paint or it is ignored.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const needle = q.trim().toLowerCase();

  /**
   * Fetch records after the typing stops.
   *
   * 220ms is long enough that a normal typist fires one request for a word
   * rather than one per letter, and short enough that it still feels like the
   * results are keeping up.
   *
   * The AbortController matters more than the debounce. Without it, a slow
   * response for "sha" can land after the fast one for "sharma" and overwrite
   * it - the list would flick back to the wrong results with no obvious cause,
   * and only on a bad connection, which is exactly where it is hardest to
   * reproduce.
   */
  useEffect(() => {
    if (!open || needle.length < 3) {
      setHits([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(needle)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setHits(Array.isArray(data.hits) ? data.hits : []);
      } catch {
        // An aborted request is the normal case, not an error - the user kept
        // typing. A failed one leaves the previous results, which is friendlier
        // than blanking the list because one packet went missing.
      } finally {
        setSearching(false);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needle, open]);

  const menuScreens = needle
    ? destinations.filter((d) => `${d.label} ${d.hint}`.toLowerCase().includes(needle))
    : destinations;

  const permSet = useMemo(() => new Set(permissions), [permissions]);

  /**
   * Settings, matched by keyword as well as by name.
   *
   * Only when something has been typed: with an empty box the palette lists
   * the menu, and adding twenty settings cards to that would bury it.
   */
  const settingsHits = useMemo(
    // Settings of a module switched off for this business are not offered (F-01).
    () => (needle ? searchSettings(needle, (perm) => permSet.has(perm))
      .filter((e) => !isPageOff(e.route, new Set(excludedModules), new Set(excludedPages))) : []),
    [needle, permSet, excludedModules, excludedPages],
  );

  /**
   * A settings screen that is also a menu item would otherwise appear twice.
   * The settings row wins, because it carries a hint saying what the screen
   * decides rather than just which group it sits in.
   */
  const claimed = new Set(settingsHits.map((e) => e.route));
  const screens = menuScreens.filter((d) => !claimed.has(d.route));

  // One flat list so the arrow keys run straight through every group without
  // the user having to know there are three.
  const results: { route: string; icon: IconName; label: string; hint: string; meta?: string }[] = [
    ...screens.map((d) => ({ route: d.route, icon: d.icon, label: d.label, hint: d.hint })),
    ...settingsHits.map((e) => ({
      route: e.route,
      icon: 'sliders' as const,
      label: e.label,
      hint: `Setting · ${e.hint}`,
    })),
    ...hits.map((h) => ({
      route: h.route,
      icon: KIND_ICON[h.kind],
      label: h.title,
      hint: `${KIND_LABEL[h.kind]} · ${h.subtitle}`,
      meta: h.meta,
    })),
  ];

  /**
   * Keep the cursor inside the list.
   *
   * The list SHRINKS on its own: arrow down onto a record, type another letter,
   * the records clear while the new fetch is in flight and the highlight is now
   * pointing past the end. Enter then does nothing at all, with no visible
   * reason - the worst kind of small bug, because the user assumes they
   * mistyped.
   */
  const safeCursor = Math.min(cursor, Math.max(0, results.length - 1));

  const go = (route: string) => {
    setOpen(false);
    router.push(route);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        /*
          A 224px search box on a 360px phone, next to a menu button, a store
          switcher, two action buttons and an avatar, is what pushed the right
          hand end of the header off the screen. Below `sm` it is the icon
          alone; the dialog it opens is unchanged.
        */
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-full border border-border bg-background text-sm text-muted-foreground transition hover:border-brand/40 hover:text-foreground sm:w-56 sm:justify-start sm:px-3.5 lg:w-80"
      >
        <Icon name="search" className="h-4 w-4 shrink-0" />
        <span className="hidden flex-1 text-start sm:inline">Search</span>
        <kbd className="hidden rounded border border-border bg-card px-1.5 py-0.5 font-sans text-xs font-medium sm:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- backdrop click; Escape closes by keyboard
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          className="fixed inset-0 z-[300] flex items-start justify-center bg-black/45 p-4 pt-[12vh]"
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="w-full max-w-lg animate-slide-up overflow-hidden rounded-lg border border-border bg-card shadow-overlay">
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Icon name="search" className="h-4 w-4 text-muted-foreground" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => { setQ(e.target.value); setCursor(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCursor((c) => Math.min(c + 1, results.length - 1));
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCursor((c) => Math.max(c - 1, 0));
                  }
                  if (e.key === 'Enter' && results[safeCursor]) go(results[safeCursor].route);
                }}
                placeholder="Search a customer, invoice, bill, product…"
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
              />
              {searching && (
                <span className="text-xs text-muted-foreground">searching…</span>
              )}
              <kbd className="rounded border border-border px-1.5 py-0.5 font-sans text-xs text-muted-foreground">
                esc
              </kbd>
            </div>

            <div className="thin-scroll max-h-72 overflow-y-auto py-1">
              {results.map((d, i) => (
                <button
                  key={d.route}
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(d.route)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-start transition ${
                    i === safeCursor ? 'bg-brand/[0.08]' : ''
                  }`}
                >
                  <Icon
                    name={d.icon}
                    className={`h-4 w-4 shrink-0 ${i === safeCursor ? 'text-brand' : 'text-muted-foreground'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{d.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {d.hint}
                    </span>
                  </span>
                  {d.meta && (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {d.meta}
                    </span>
                  )}
                </button>
              ))}
              {results.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {searching ? 'Searching…' : <>Nothing matches &ldquo;{q}&rdquo;.</>}
                </p>
              )}
              {/* Said plainly, because otherwise typing two letters and seeing
                  no records looks like the search is broken rather than
                  waiting. */}
              {needle.length > 0 && needle.length < 3 && (
                <p className="px-4 py-3 text-center text-xs text-muted-foreground">
                  Type three letters to search customers, invoices and bills.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
