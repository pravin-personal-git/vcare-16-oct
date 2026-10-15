'use client';

import { ExportButton } from './ExportButton';
import { ServerExportButton } from './ServerExportButton';
import type { CsvColumn } from '@/lib/csv';
import { useEffect, useMemo } from 'react';
import { Icon } from '@/components/ui/Icon';
import { SavedViewsMenu } from '@/components/ui/SavedViewsMenu';
import { useDebouncedSearch, useListParams } from '@/components/ui/useListParams';
import { RANGE_PRESETS, inRange, resolveRange, stretchRange, type DateRange } from '@/lib/date-ranges';

/**
 * Search, filter, count and a saved layout for a list that is NOT a table
 * (F1b, decision D17).
 *
 * WHY THIS EXISTS BESIDE `DataGrid`/`FilterBar` RATHER THAN INSTEAD OF THEM.
 *
 * The F1 standard is written for record lists that are grids: sortable columns,
 * server paging, saved column layouts. Some of the most-used screens are not
 * grids and should not become them - My Desk's "Waiting on me" is a stack of
 * rows each carrying Approve / Reject, and turning it into a table would put
 * the decisions further away, not closer. But D17 says *every* page showing
 * rows of data gets filters and a saved layout, and it means it.
 *
 * So this is the same contract at a smaller size: a visible search box that
 * names what it searches, optional chips with counts, "Showing X of Y", a Clear
 * that clears, and Views.
 *
 * THE STATE LIVES IN THE ADDRESS, NOT IN THIS COMPONENT.
 *
 * It began as local `useState`, which was simpler and wrong. A filter held in a
 * component cannot survive a refresh, cannot be sent to somebody in a link, is
 * lost by the back button - and, the reason this changed, cannot be SAVED,
 * because a saved view is nothing more than the screen's query string under a
 * name. Putting the state in the URL is what lets thirty screens get saved
 * layouts from one change here rather than thirty edits.
 *
 * It deliberately still does NOT do sorting, paging or column choosing. A list
 * that needs those is a grid, and should use `DataGrid`.
 */

export interface ListFilterChip {
  value: string;
  label: string;
  /** Shown beside the label. Omit for chips whose count is not meaningful. */
  count?: number;
}

/** A date a row can be filtered by - "Raised on", "Due on" (9 Oct 2026). */
export interface ListFilterDate<T> {
  key: string;
  label: string;
  of: (row: T) => string | Date | null | undefined;
  /**
   * The date can lie ahead (a reminder's due date). Then "This week", "This
   * month" and "This financial year" run to the END of the period instead of
   * stopping at today - otherwise next Tuesday's reminder is not "this week".
   */
  future?: boolean;
}

/** One way to order the rows. The FIRST is the default (newest first - Pravin, 9 Oct 2026). */
export interface ListFilterSort<T> {
  key: string;
  label: string;
  compare: (a: T, b: T) => number;
}

/** A dropdown filter - "Asked by", "Status". `of` returns the row's value. */
export interface ListFilterSelect<T> {
  key: string;
  label: string;
  of: (row: T) => string | null | undefined;
  options: string[];
}

export interface ListFilterProps<T> {
  rows: T[];
  /** The words each row is searched by. Empty strings and nulls are ignored. */
  searchOn: (row: T) => (string | null | undefined)[];
  /** Names what the box searches, so nobody has to guess. */
  placeholder: string;
  /** Optional single-select chips, e.g. request type. */
  chips?: ListFilterChip[];
  chipOf?: (row: T) => string;
  chipLabel?: string;
  /** What one row is called, for the count line: "3 of 12 requests". */
  noun?: string;
  /**
   * Address key for this instance's search box - `q` unless the screen already
   * uses `q`, or holds more than one list. Two `ListFilter`s sharing a key
   * would filter each other, which is the kind of bug that looks like the data
   * is wrong. The chip is stored at `<paramKey>_c`.
   */
  paramKey?: string;
  /** Set false on a screen where a saved layout means nothing (a single short list). */
  views?: boolean;
  /**
   * Export the rows as filtered (F1b, 6 Oct 2026): a file title and its
   * columns. Shown only to people the app layout allows to export.
   */
  exportAs?: { title: string; columns: CsvColumn<T>[] };
  /**
   * Server mode (F1b, 6 Oct 2026): `rows` are already one filtered page
   * (lib/card-list pageCards on the same address keys). The box and chips
   * still write the address; the page re-renders with the next result.
   */
  server?: { total: number; matched: number; page: number; pageSize: number };
  /** Server mode's export: a LIST_EXPORTS key, run over every page. */
  exportScreen?: string;
  /**
   * DATES, SORT, DROPDOWNS, AMOUNT (My Desk, 9 Oct 2026). All optional, and
   * all kept in the address under this instance's `paramKey`, so a saved View
   * or a shared link keeps them - the same contract as the search box. A
   * screen that passes none of them looks exactly as it did.
   */
  dates?: ListFilterDate<T>[];
  sorts?: ListFilterSort<T>[];
  selects?: ListFilterSelect<T>[];
  /** Amount in RUPEES, for the min/max boxes. A row without one fails a set min or max. */
  amountOf?: (row: T) => number | null | undefined;
  /**
   * Told the active range whenever it changes - for a screen whose rows only
   * reach back so far and has to fetch older ones (My Desk's notifications).
   */
  onRange?: (range: DateRange, dateKey: string | null) => void;
  children: (filtered: T[], state: { query: string; chip: string | null; cleared: boolean }) => React.ReactNode;
}

export function ListFilter<T>({
  rows, searchOn, placeholder, chips, chipOf, chipLabel = 'Type', noun = 'rows',
  paramKey = 'q', views = true, exportAs, server, exportScreen, children,
  dates, sorts, selects, amountOf, onRange,
}: ListFilterProps<T>) {
  const list = useListParams();
  const chipKey = `${paramKey}_c`;
  const { value: typed, setValue: setTyped } = useDebouncedSearch(paramKey);

  const query = (list.get(paramKey) ?? '').trim();
  const chip = list.get(chipKey);

  // --- the 9 Oct additions, each under `<paramKey>_<x>` in the address -----
  const k = (x: string) => `${paramKey}_${x}`;
  const dateField = dates?.find((d) => d.key === list.get(k('d'))) ?? dates?.[0] ?? null;
  const rangeParam = list.get(k('r'));
  const fromParam = list.get(k('f'));
  const toParam = list.get(k('t'));
  const custom = rangeParam === 'custom' || (!rangeParam && Boolean(fromParam || toParam));
  const future = dateField?.future ?? false;
  const range = useMemo(
    () => stretchRange(resolveRange({ range: rangeParam, from: fromParam, to: toParam }, 'all'), future),
    [rangeParam, fromParam, toParam, future],
  );
  const sort = sorts?.find((s) => s.key === list.get(k('s'))) ?? sorts?.[0] ?? null;
  const selectValues = (selects ?? []).map((s) => list.get(k(s.key)));
  const selectKey = selectValues.join('\u0001');
  const minR = Number(list.get(k('min')) ?? '') || null;
  const maxR = Number(list.get(k('max')) ?? '') || null;

  const fromMs = range.from?.getTime() ?? null;
  const toMs = range.to?.getTime() ?? null;
  useEffect(() => {
    onRange?.(range, dateField?.key ?? null);
    // Keyed on the instants, not the object, which is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromMs, toMs, dateField?.key]);

  const filtered = useMemo(() => {
    if (server) return rows;
    const q = query.toLowerCase();
    const out = rows.filter((r) => {
      if (chip && chipOf && chipOf(r) !== chip) return false;
      if (dateField && !inRange(dateField.of(r) ?? null, range)) return false;
      if (selects?.some((s, i) => selectValues[i] && s.of(r) !== selectValues[i])) return false;
      if (amountOf && (minR !== null || maxR !== null)) {
        const a = amountOf(r);
        if (a == null || (minR !== null && a < minR) || (maxR !== null && a > maxR)) return false;
      }
      if (!q) return true;
      return searchOn(r).some((v) => (v ?? '').toLowerCase().includes(q));
    });
    return sort ? [...out].sort(sort.compare) : out;
    // `selectKey` stands for `selectValues`, a fresh array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, chip, searchOn, chipOf, server, dateField, range, sort, selects, selectKey, minR, maxR, amountOf]);

  const rangeOn = range.from !== null || range.to !== null;
  const extraOn = rangeOn || selectValues.some(Boolean) || minR !== null || maxR !== null;
  const active = query !== '' || chip !== null || extraOn;
  const clearAll = () => {
    setTyped('');
    list.set({
      [paramKey]: null, [chipKey]: null, [k('r')]: null, [k('f')]: null, [k('t')]: null,
      [k('min')]: null, [k('max')]: null,
      ...Object.fromEntries((selects ?? []).map((s) => [k(s.key), null])),
    });
  };
  const selectClass = 'h-9 rounded-lg border border-border bg-card px-2 text-xs outline-none focus:border-brand';

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Icon
            name="search"
            className="pointer-events-none absolute inset-inline-start-0 top-1/2 ms-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="h-9 w-full rounded-lg border border-border bg-card ps-8 pe-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>

        {sorts && sorts.length > 1 && (
          <select aria-label="Sort" value={sort?.key} className={selectClass}
            onChange={(e) => list.set({ [k('s')]: e.target.value === sorts[0].key ? null : e.target.value })}>
            {sorts.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
          </select>
        )}
        {chips && chips.length > 1 && (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={chipLabel}>
            {chips.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={chip === c.value}
                onClick={() => list.set({ [chipKey]: chip === c.value ? null : c.value })}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  chip === c.value ? 'bg-brand text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {c.label}
                {typeof c.count === 'number' && <span className="ms-1 opacity-70">{c.count}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
          {/* Always shown, not only when filtering: "12 of 12" is the sentence
              that tells somebody nothing is being hidden from them. */}
          <span role="status">
            {server
              ? <>Showing {server.matched === 0 ? 0 : server.page * server.pageSize + 1}-{server.page * server.pageSize + rows.length} of {server.matched}{server.matched !== server.total ? ` (${server.total} in all)` : ''} {noun}{rangeOn ? ` · ${dateField?.label ?? 'Date'}: ${range.label}` : ''}</>
              : <>Showing {filtered.length} of {rows.length} {noun}{rangeOn ? ` · ${dateField?.label ?? 'Date'}: ${range.label}` : ''}</>}
          </span>
          {server && server.matched > server.pageSize && (
            <span className="flex items-center gap-1">
              <button type="button" disabled={server.page === 0} aria-label="Previous page"
                onClick={() => list.set({ [`${paramKey}_p`]: server.page > 1 ? String(server.page - 1) : null })}
                className="rounded border border-border px-2 py-0.5 disabled:opacity-40">‹</button>
              <button type="button" disabled={(server.page + 1) * server.pageSize >= server.matched} aria-label="Next page"
                onClick={() => list.set({ [`${paramKey}_p`]: String(server.page + 1) })}
                className="rounded border border-border px-2 py-0.5 disabled:opacity-40">›</button>
            </span>
          )}
          {active && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded px-2 py-1 text-brand hover:bg-brand/10"
            >
              {extraOn ? 'Clear all' : 'Clear'}
            </button>
          )}
          {exportScreen ? <ServerExportButton screen={exportScreen} />
            : exportAs && <ExportButton title={exportAs.title} rows={filtered} columns={exportAs.columns} />}
          {views && <SavedViewsMenu />}
        </div>
      </div>

      {(Boolean(dates?.length) || Boolean(selects?.length) || amountOf) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          {dates && dates.length > 0 && (
            <>
              <Icon name="calendar" className="h-4 w-4 text-muted-foreground" />
              {dates.length > 1 ? (
                <select aria-label="Which date" value={dateField?.key} className={selectClass}
                  onChange={(e) => list.set({ [k('d')]: e.target.value === dates[0].key ? null : e.target.value })}>
                  {dates.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              ) : <span className="text-xs text-muted-foreground">{dates[0].label}</span>}
              <select aria-label="Date range" className={selectClass} value={custom ? 'custom' : range.preset}
                onChange={(e) => list.set(e.target.value === 'custom'
                  ? { [k('r')]: 'custom' }
                  : { [k('r')]: e.target.value === 'all' ? null : e.target.value, [k('f')]: null, [k('t')]: null })}>
                <option value="all">All time (default)</option>
                {RANGE_PRESETS.filter((p) => p.key !== 'all').map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                <option value="custom">Custom range…</option>
              </select>
              {custom && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input type="date" aria-label="From" value={fromParam ?? ''} className={selectClass}
                    onChange={(e) => list.set({ [k('r')]: 'custom', [k('f')]: e.target.value || null })} />
                  to
                  <input type="date" aria-label="To" value={toParam ?? ''} className={selectClass}
                    onChange={(e) => list.set({ [k('r')]: 'custom', [k('t')]: e.target.value || null })} />
                </span>
              )}
            </>
          )}
          {selects?.map((s, i) => (
            <select key={s.key} aria-label={s.label} value={selectValues[i] ?? ''} className={selectClass}
              onChange={(e) => list.set({ [k(s.key)]: e.target.value || null })}>
              <option value="">{s.label}: all</option>
              {s.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ))}
          {amountOf && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <AmountBox label="Min ₹" param={k('min')} className={selectClass} />
              to
              <AmountBox label="Max ₹" param={k('max')} className={selectClass} />
            </span>
          )}
        </div>
      )}

      {children(filtered, { query, chip, cleared: !active })}
    </>
  );
}

/** A rupee box that writes the address when typing stops, like the search box. */
function AmountBox({ label, param, className }: { label: string; param: string; className: string }) {
  const { value, setValue } = useDebouncedSearch(param);
  return (
    <input type="number" min={0} inputMode="numeric" aria-label={label} placeholder={label}
      value={value} onChange={(e) => setValue(e.target.value)} className={`${className} w-24`} />
  );
}
