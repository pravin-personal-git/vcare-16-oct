'use client';

import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { Icon } from './Icon';
import { SavedViewsMenu } from './SavedViewsMenu';
import { ToolbarMenu } from './Toolbar';
import { useDebouncedSearch, useListParams } from './useListParams';
import { RANGE_PRESETS, type RangePreset } from '@/lib/date-ranges';
import { LIST_FILTER_KEYS } from '@/lib/list-filters';
import type { SavedViewRow } from '@/server/saved-views';

/**
 * The filter bar every list screen wears (F1 UI standard, 26 Sep 2026).
 *
 * One row that answers "narrow this down": a search box that says what it
 * searches, a date range with presets, "Assigned to me" / a person, the
 * screen's own extra filter, saved views and export. Under it, one quiet line:
 * how many rows are showing, the active date range, and "Clear all filters".
 *
 * Everything lives in the address (?q= ?range= ?from= ?to= ?person=), so a
 * refresh, the Back button and a shared link all keep the same view. The
 * server does the filtering - this component only edits the address.
 *
 * On a phone the filters fold behind a "Filters (n)" button so the search box
 * keeps the full width.
 */

export interface FilterBarPeople {
  /** e.g. "Technician", "Assigned to". */
  label: string;
  options: { id: string; fullName: string }[];
  /** No choice means "Assigned to me" (then "everyone" is stored as person=all). */
  defaultMine?: boolean;
}

export interface FilterBarViews {
  /** The saved views for this screen, loaded by the page. */
  initial: SavedViewRow[];
  /** Role names an admin may share with; empty for everyone else. */
  roles: string[];
}

const selectClass = 'h-ctl rounded-sm border border-border bg-card px-2.5 text-sm font-medium outline-none transition hover:border-border-strong focus:border-brand focus:ring-[3px] focus:ring-brand/20';

export function FilterBar({
  searchPlaceholder,
  dates,
  people,
  extra,
  shown,
  total,
  clearKeys = [],
  exportScreen,
  views,
  tools,
  searchParam = 'q',
}: {
  /** Name what the box searches: "Complaint no, customer, phone, equipment…". */
  searchPlaceholder: string;
  /** Date filter: the screen's default when nothing is chosen, and what the date is ("Raised"). */
  dates?: { defaultPreset: Exclude<RangePreset, 'custom'>; label: string; activeLabel: string };
  people?: FilterBarPeople;
  /** The screen's own filters (warehouse, type…), drawn after the standard ones. */
  extra?: ReactNode;
  /** Rows matching now, across all pages. */
  shown: number;
  /**
   * Rows before any filter - the "of Y" in "Showing X of Y" (AGENTS.md §4).
   *
   * Optional because a screen that pages on the server often does not know the
   * unfiltered total without a second count, and an approximate denominator is
   * worse than none. Where it IS known, pass it: "Showing 12" leaves somebody
   * wondering whether twelve is all of them, and that question is the reason
   * the Definition of Done asks for both numbers.
   */
  total?: number;
  /** The screen's own address keys, so "Clear all" clears them too (e.g. 'card'). */
  clearKeys?: string[];
  /** Key in LIST_EXPORTS; omit when the viewer may not export (field level). */
  exportScreen?: string | null;
  views?: FilterBarViews;
  /** The screen's own buttons (History, Metrics), drawn before Views. */
  tools?: ReactNode;
  /** Address key for the search box - 'q' unless the screen already uses q for something else. */
  searchParam?: string;
}) {
  const sp = useSearchParams();
  const list = useListParams();
  const search = useDebouncedSearch(searchParam);
  const [showFilters, setShowFilters] = useState(false);

  const range = sp.get('range') ?? (sp.get('from') || sp.get('to') ? 'custom' : '');
  /**
   * What is ACTUALLY filtering, not what is in the address.
   *
   * `range` is empty while the screen's own default is in force - the address
   * only carries it once somebody changes it. So an empty value means the
   * default, which is what decides whether anything is being hidden.
   */
  const activeRange: string = range || dates?.defaultPreset || 'all';
  const everyone = people?.defaultMine ? 'all' : '';
  const person = sp.get('person') ?? sp.get('tech') ?? (people?.defaultMine ? 'me' : '');
  const activeKeys = [...LIST_FILTER_KEYS, searchParam, 'tech', ...clearKeys].filter((k) => k !== 'page' && sp.get(k));
  const filterCount = activeKeys.filter((k) => k !== 'q' && k !== searchParam).length;

  const setRange = (v: string) => {
    if (v === 'custom') { list.set({ range: 'custom' }); return; }
    list.set({ range: v === dates?.defaultPreset ? null : v, from: null, to: null });
  };

  const exportHref = (format: 'xlsx' | 'csv') => {
    const q = new URLSearchParams(sp.toString());
    q.delete('page');
    q.set('screen', exportScreen ?? '');
    q.set('format', format);
    return `/api/list-export?${q.toString()}`;
  };

  const filters = (
    <>
      {dates && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="fb-range">{dates.label} date</label>
          <select id="fb-range" value={range || dates.defaultPreset} onChange={(e) => setRange(e.target.value)} className={selectClass}>
            {RANGE_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>{dates.label}: {p.label}{p.key === dates.defaultPreset ? ' (default)' : ''}</option>
            ))}
            <option value="custom">{dates.label}: Custom range…</option>
          </select>
          {range === 'custom' && (
            <>
              <label className="sr-only" htmlFor="fb-from">From</label>
              <input id="fb-from" type="date" value={sp.get('from') ?? ''} onChange={(e) => list.set({ range: 'custom', from: e.target.value || null })} className={selectClass} />
              <span className="text-xs text-muted-foreground">to</span>
              <label className="sr-only" htmlFor="fb-to">To</label>
              <input id="fb-to" type="date" value={sp.get('to') ?? ''} onChange={(e) => list.set({ range: 'custom', to: e.target.value || null })} className={selectClass} />
            </>
          )}
        </div>
      )}
      {people && (
        <>
          <label className="sr-only" htmlFor="fb-person">{people.label}</label>
          <select
            id="fb-person"
            value={person}
            onChange={(e) => {
              const v = e.target.value;
              // The screen's default is kept out of the address, so a clean link means "the usual view".
              list.set({ person: people.defaultMine ? (v === 'me' ? null : v) : (v || null), tech: null });
            }}
            className={`${selectClass} ${person && person !== everyone ? 'border-brand bg-brand/5 font-medium text-brand' : ''}`}
          >
            <option value={everyone}>{people.label}: everyone</option>
            <option value="me">Assigned to me</option>
            {people.options.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
        </>
      )}
      {extra}
    </>
  );

  return (
    <div className="mb-4 rounded border border-border bg-card p-2.5 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Icon name="search" className="pointer-events-none absolute start-0 top-1/2 ms-3 h-4 w-4 -translate-y-1/2 text-foreground/70" />
          <input
            type="search"
            aria-label="Search"
            value={search.value}
            onChange={(e) => search.setValue(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-ctl w-full rounded-sm border border-border bg-background ps-9 pe-8 text-sm outline-none transition placeholder:text-muted-foreground hover:border-border-strong focus:border-brand focus:bg-card focus:ring-[3px] focus:ring-brand/20"
          />
          {search.value && (
            <button type="button" onClick={() => search.setValue('')} aria-label="Clear search"
              className="absolute end-0 top-1/2 me-1 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted">
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((s) => !s)}
          aria-expanded={showFilters}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium sm:hidden"
        >
          <Icon name="filter" className="h-3.5 w-3.5" />
          Filters{filterCount ? ` (${filterCount})` : ''}
        </button>

        <div className="hidden flex-wrap items-center gap-2 sm:flex">{filters}</div>

        {tools}
        {views && <SavedViewsMenu source={{ initial: views.initial, roles: views.roles }} />}
        {exportScreen && (
          <ToolbarMenu label="Export" icon="download" width="w-48">
            <a role="menuitem" href={exportHref('xlsx')} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
              <Icon name="download" className="h-3.5 w-3.5" /> Excel (.xlsx)
            </a>
            <a role="menuitem" href={exportHref('csv')} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
              <Icon name="download" className="h-3.5 w-3.5" /> CSV
            </a>
            <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">Exactly the rows filtered here, all pages.</p>
          </ToolbarMenu>
        )}
      </div>

      {showFilters && <div className="mt-2 flex flex-col gap-2 sm:hidden">{filters}</div>}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
        <span>
          Showing <strong className="font-semibold text-foreground">{shown.toLocaleString('en-IN')}</strong>
          {/* "of Y" only where it adds something: when they are equal the row
              already says nothing is hidden, and "12 of 12" is noise. */}
          {typeof total === 'number' && total !== shown && <> of {total.toLocaleString('en-IN')}</>}
          {dates && <> · {dates.label.toLowerCase()} {dates.activeLabel.toLowerCase() === 'all time' ? 'any time' : /^[A-Z][a-z]/.test(dates.activeLabel) ? dates.activeLabel.charAt(0).toLowerCase() + dates.activeLabel.slice(1) : dates.activeLabel}</>}
          {list.pending && <span className="ms-2 text-brand">Loading…</span>}
        </span>

        {/*
          THE WAY OUT OF A NARROWED DATE RANGE.

          Added 7 Oct 2026 when every list defaulted to today; kept on 8 Oct
          when Pravin changed his mind and sent the defaults back to all time.
          It still earns its place, because the hazard it guards against was
          never about the DEFAULT - it is that a date filter silently hides
          open work. A job raised on Friday and still open on Monday is simply
          not there, and the person looking concludes it was closed.

          So whenever a range is narrowing the list, the bar says so and offers
          one click to drop it. Never shown on "all time", which is now the
          default again, so most screens never draw it at all.

          No count, deliberately. `total` is the count before EVERY filter, so
          "14 more outside this range" would be a lie whenever a search was
          also typed. A claim that is sometimes wrong is worse than no claim;
          the button is the point.
        */}
        {dates && activeRange !== 'all' && (
          <button
            type="button"
            onClick={() => list.set({ range: 'all', from: null, to: null })}
            className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
          >
            <Icon name="calendar" className="h-3 w-3" />
            Older ones are hidden — show all dates
          </button>
        )}
        {activeKeys.length > 0 && (
          <button
            type="button"
            onClick={() => list.set(Object.fromEntries(activeKeys.map((k) => [k, null])))}
            className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
          >
            <Icon name="x" className="h-3 w-3" /> Clear all filters
          </button>
        )}
      </div>
    </div>
  );
}
