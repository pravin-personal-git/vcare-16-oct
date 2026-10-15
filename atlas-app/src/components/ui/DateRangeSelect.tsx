'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { RANGE_PRESETS, resolveRange, type DateRange } from '@/lib/date-ranges';
import { useListParams } from './useListParams';

/**
 * The date filter on its own, for screens built on `Toolbar` rather than
 * `FilterBar` (9 Oct 2026 - Pravin asked for "the same date filters" on every
 * list page, and about a dozen money and stock screens had none).
 *
 * The SAME address keys as FilterBar - ?range= &from= &to= - so the server
 * reads them with the same `parseListFilters` / `resolveRange`, the export
 * follows them, and a saved View keeps them. Default is All time everywhere.
 */
const selectClass = 'h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand';

export function DateRangeSelect({ label }: { label: string }) {
  const sp = useSearchParams();
  const list = useListParams();
  const range = sp.get('range') ?? (sp.get('from') || sp.get('to') ? 'custom' : '');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="drs-range">{label} date</label>
      <select id="drs-range" value={range || 'all'} className={selectClass}
        onChange={(e) => {
          const v = e.target.value;
          // `days` goes too: the pre-F1 key some screens still honour when no
          // range is set, so "All time" would otherwise bring the old N days back.
          list.set(v === 'custom' ? { range: 'custom', days: null } : { range: v === 'all' ? null : v, from: null, to: null, days: null });
        }}>
        {RANGE_PRESETS.map((p) => (
          <option key={p.key} value={p.key}>{label}: {p.label}{p.key === 'all' ? ' (default)' : ''}</option>
        ))}
        <option value="custom">{label}: Custom range…</option>
      </select>
      {range === 'custom' && (
        <>
          <label className="sr-only" htmlFor="drs-from">From</label>
          <input id="drs-from" type="date" value={sp.get('from') ?? ''} className={selectClass}
            onChange={(e) => list.set({ range: 'custom', from: e.target.value || null })} />
          <span className="text-xs text-muted-foreground">to</span>
          <label className="sr-only" htmlFor="drs-to">To</label>
          <input id="drs-to" type="date" value={sp.get('to') ?? ''} className={selectClass}
            onChange={(e) => list.set({ range: 'custom', to: e.target.value || null })} />
        </>
      )}
    </div>
  );
}

/**
 * The range in the address, for a screen that holds all its rows in the
 * browser and filters them there (`inRange(row.date, range)`).
 */
export function useUrlDateRange(): DateRange {
  const sp = useSearchParams();
  const range = sp.get('range');
  const from = sp.get('from');
  const to = sp.get('to');
  return useMemo(() => resolveRange({ range, from, to }, 'all'), [range, from, to]);
}
