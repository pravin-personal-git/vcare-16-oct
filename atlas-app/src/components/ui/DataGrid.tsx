'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon, type IconName } from './Icon';
import { EmptyState } from './Layout';
import { ExportButton } from './ExportButton';

/**
 * The shared data grid.
 *
 * Fifteen of the ~50 screens in the specification are this component with
 * different columns. Building it once, properly, is the difference between
 * Phase 1 taking six weeks and taking sixteen.
 *
 * Matches the original's grid anatomy: per-column sort control AND a separate
 * per-column filter, a pinned actions column, a grouped row menu, and a footer
 * carrying page size, range and first/prev/next/last.
 *
 * ## Paging the whole result set
 *
 * Screens hand this component every row in scope (see lib/list-limits), not a
 * slice, and it pages through them here. That is what makes the footer's
 * "1-50 of 4,556" and the page jump honest - the denominator is the real total,
 * and the last page is the last record, not the end of an arbitrary 500.
 *
 * Only `pageRows` is ever rendered into the DOM, so the row count drives the
 * network payload and one array pass per keystroke, not the size of the table.
 * That is why virtualisation is still not needed: 50 <tr> elements is 50
 * elements whether the set behind them holds 500 rows or 20,000.
 *
 * Server-side pagination (A022) is still the answer past the low tens of
 * thousands. It stays additive: it replaces `rows: T[]` with a page plus a
 * total, and every control below already reads from `sorted.length` rather
 * than assuming it holds everything.
 */

export interface Column<T> {
  key: string;
  header: string;
  /**
   * Keep the cell on one line. Defaults to on for amounts (align end) and for
   * columns whose header names a date, number, code or phone - so "19 Sept
   * 2026" never stacks one word per line (UI refresh, 4 Oct 2026).
   */
  nowrap?: boolean;
  /** Cell renderer. Keep it pure - this runs on every row. */
  render: (row: T) => ReactNode;
  /** Value used for sorting, searching and column filtering. Omit to make the column inert. */
  sortValue?: (row: T) => string | number | null;
  align?: 'start' | 'end' | 'center';
  width?: string;
  /** Hidden by default but offered in the column chooser. */
  optional?: boolean;
}

export interface RowAction<T> {
  label: string;
  onSelect: (row: T) => void;
  icon?: IconName;
  tone?: 'default' | 'danger' | 'success';
  /**
   * Colours only the icon, leaving the label plain. Lets WhatsApp read green
   * and PDF read brand without shouting the whole row.
   */
  iconTone?: 'default' | 'danger' | 'success' | 'warning' | 'brand';
  /** Draws a divider above this item - used to group related actions. */
  separatorBefore?: boolean;
  /** Return false to grey the item out for this row. */
  enabled?: (row: T) => boolean;
}

/**
 * A one-tap action shown on the row itself (UI refresh, 4 Oct 2026): on hover
 * at a desk, always on a phone. WhatsApp / Call / Message plus the one thing
 * the list exists for. A screen passes only what this person may do - the
 * grid adds no permission of its own.
 */
export interface QuickAction {
  label: string;
  icon: IconName;
  /** A link (wa.me, tel:, a page). Opens in a new tab when it is http(s). */
  href?: string;
  onClick?: () => void;
  tone?: 'whatsapp' | 'call' | 'brand' | 'default';
}

const QUICK_TONE: Record<NonNullable<QuickAction['tone']>, string> = {
  whatsapp: 'text-success hover:bg-success/10 hover:border-success/40',
  call: 'text-info hover:bg-info/10 hover:border-info/40',
  brand: 'text-brand hover:bg-brand/10 hover:border-brand/40',
  default: 'text-muted-foreground hover:bg-muted hover:text-foreground',
};

function QuickActions({ items, always = false }: { items: QuickAction[]; always?: boolean }) {
  if (items.length === 0) return null;
  return (
    <span
      className={`flex items-center gap-1 transition ${
        always ? '' : '[@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
      }`}
    >
      {items.map((q) => {
        const cls = `grid ${always ? 'h-9 w-9' : 'h-10 w-10 sm:h-7 sm:w-7'} place-items-center rounded-sm border border-border bg-card transition ${QUICK_TONE[q.tone ?? 'default']}`;
        const icon = <Icon name={q.icon} className="h-3.5 w-3.5" />;
        return q.href ? (
          <a
            key={q.label}
            href={q.href}
            title={q.label}
            aria-label={q.label}
            className={cls}
            {...(/^https?:/.test(q.href) ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            {icon}
          </a>
        ) : (
          <button key={q.label} type="button" title={q.label} aria-label={q.label} onClick={q.onClick} className={cls}>
            {icon}
          </button>
        );
      })}
    </span>
  );
}

const NOWRAP_HEADER = /date|due|time|created|updated|amount|total|balance|paid|value|price|qty|quantity|phone|mobile|code|no\.?$|#|gstin|status/i;
const keepOnOneLine = (c: { header: string; align?: string; nowrap?: boolean }) =>
  c.nowrap ?? (c.align === 'end' || NOWRAP_HEADER.test(c.header));

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  actions?: RowAction<T>[];
  emptyMessage?: string;
  emptyHint?: ReactNode;
  emptyIcon?: IconName;
  pageSizes?: number[];
  /** Text typed into the toolbar search, applied across all sortable columns. */
  search?: string;
  /** Called when the selection changes, for bulk actions. */
  onSelectionChange?: (ids: string[]) => void;
  /** Rendered above the table when at least one row is selected. */
  bulkActions?: (ids: string[], clear: () => void) => ReactNode;
  /**
   * Footer summary for the rows currently on screen - the reference app's
   * "Sales Count / Page Total" line. Summing the *page* rather than the whole
   * result set is deliberate: it is the number a person can check against what
   * they are looking at.
   */
  pageSummary?: (pageRows: T[], allRows: T[]) => ReactNode;
  /** Rows are already one server-side page - see ServerPaging. */
  server?: ServerPaging;
  /**
   * Phone layout (F1 UI standard): below 640 px each row is drawn as this card
   * instead of a table row - title, status, two or three key facts. Omit it and
   * the table scrolls sideways as before.
   */
  mobileCard?: (row: T) => ReactNode;
  /**
   * Export the rows as filtered and sorted (F1b, 6 Oct 2026), for a grid that
   * holds its whole list. Every column with a sortValue becomes a column of the
   * file. Who may export comes from the app layout. Ignored on a
   * server-paged grid, which exports through FilterBar instead.
   */
  exportAs?: { title: string; allowed?: boolean };
  /** One-tap actions on the row - see QuickAction. */
  quickActions?: (row: T) => QuickAction[];
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

/**
 * Server paging (health check PERF-1, 25 Sep 2026). The page filters, sorts
 * and slices on the server (lib/server-grid) and hands over only the rows on
 * screen plus the real total; page, size and sort live in the address
 * (?page= &size= &sort= &dir=) so back/forward and shared links work.
 */
export interface ServerPaging {
  total: number;
  page: number;
  pageSize: number;
  sort: SortState;
}

interface MenuAnchor { id: string; x: number; y: number; placeAbove: boolean }

/**
 * Row menus render into document.body rather than inside the cell.
 *
 * The table sits in an `overflow-x-auto` wrapper so wide column sets scroll.
 * An absolutely-positioned menu inside that wrapper gets clipped by it - the
 * menu opened but was cut off and unusable. A portal escapes the clipping
 * context entirely; position is computed from the button's bounding rect and
 * the menu flips upward when there is not enough room below.
 */
function RowMenu<T>({
  anchor, row, actions, onClose,
}: {
  anchor: MenuAnchor; row: T; actions: RowAction<T>[]; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // Any scroll would leave the menu floating away from its row.
    const onScroll = () => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [onClose]);

  return createPortal(
    <>
      <div aria-hidden="true" className="fixed inset-0 z-[100]" onClick={onClose} />
      <div
        role="menu"
        style={{
          position: 'fixed',
          top: anchor.placeAbove ? undefined : anchor.y,
          bottom: anchor.placeAbove ? window.innerHeight - anchor.y : undefined,
          left: Math.max(8, anchor.x - 232),
          width: 232,
        }}
        className="z-[101] animate-fade-in overflow-hidden rounded border border-border bg-card p-1.5 shadow-overlay"
      >
        {actions.map((a) => {
          const disabled = a.enabled ? !a.enabled(row) : false;
          // The icon carries the tone even when the label does not - the
          // reference tints the WhatsApp icon green and the delete icon red
          // while leaving most labels in plain text, which is what makes the
          // dangerous item findable without making the menu loud.
          const iconTone = a.iconTone ?? a.tone;
          return (
            <div key={a.label}>
              {a.separatorBefore && <div className="my-1.5 h-px bg-border" />}
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => { onClose(); a.onSelect(row); }}
                className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-start text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  a.tone === 'danger'
                    ? 'text-danger hover:bg-danger/10'
                    : 'text-foreground hover:bg-brand/10 hover:text-brand'
                }`}
              >
                {a.icon && (
                  <Icon
                    name={a.icon}
                    className={`h-4 w-4 shrink-0 ${
                      iconTone === 'danger'
                        ? 'text-danger'
                        : iconTone === 'success'
                          ? 'text-success'
                          : iconTone === 'warning'
                            ? 'text-warning'
                            : iconTone === 'brand'
                              ? 'text-brand'
                              : 'text-muted-foreground'
                    }`}
                  />
                )}
                {a.label}
              </button>
            </div>
          );
        })}
      </div>
    </>,
    document.body,
  );
}

/** Per-column contains-filter, the funnel next to each header. */
function ColumnFilter({
  value, onChange, header,
}: {
  value: string; onChange: (v: string) => void; header: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        title={`Filter ${header}`}
        aria-label={`Filter ${header}`}
        className={`grid h-5 w-5 place-items-center rounded transition ${
          value ? 'bg-brand/15 text-on-tint-brand' : 'text-muted-foreground/50 hover:bg-muted hover:text-foreground'
        }`}
      >
        <Icon name="filter" className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute start-0 z-50 mt-1 w-52 animate-fade-in rounded-lg border border-border bg-card p-2 shadow-raised">
          <input
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Contains…`}
            className="h-8 w-full rounded border border-border bg-card px-2 text-xs outline-none focus:border-brand"
          />
          {value && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="mt-1.5 w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function DataGrid<T>({
  rows,
  columns,
  rowKey,
  actions,
  emptyMessage = 'No records found.',
  emptyHint,
  emptyIcon = 'folder',
  /**
   * Default 50 rather than 10. Screens now load the whole set, and 4,556
   * customers at ten a page is 456 pages - a pagination control nobody can
   * reach the end of is not much better than a truncated list. 500 is offered
   * for the "let me scroll the lot" case.
   */
  pageSizes = [25, 50, 100, 250, 500],
  search = '',
  onSelectionChange,
  bulkActions,
  pageSummary,
  server,
  mobileCard, quickActions, exportAs,
}: Props<T>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navigating, startNav] = useTransition();
  const pushParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v); }
    startNav(() => router.push(`?${next.toString()}`, { scroll: false }));
  };
  const [localSort, setLocalSort] = useState<SortState>(null);
  const sort = server ? server.sort : localSort;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.optional).map((c) => c.key)),
  );

  // Column visibility survives navigation and refresh, per viewer per screen -
  // keyed by route so each grid remembers its own choice independently. This
  // is a per-browser convenience (not synced anywhere), so it is read after
  // mount rather than in the lazy initializer above, which must stay
  // SSR-safe and return the same thing on the server and on first hydration.
  const pathname = usePathname();
  const storageKey = `atlas:grid-columns:${pathname}`;
  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
      } catch {
        // Private window, cleared storage, etc. - keep the default.
      }
    };
    load();
    // A saved view (FilterBar's Views menu) writes the key, then says so.
    window.addEventListener('atlas:grid-columns', load);
    return () => window.removeEventListener('atlas:grid-columns', load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...hidden]));
    } catch {
      // Storage may be full or blocked - the column choice just won't persist.
    }
  }, [storageKey, hidden]);

  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  /**
   * Opens on the option nearest 50, not on `pageSizes[0]`.
   *
   * Most screens declare their own sizes starting at 10, which was fine when
   * they were handed 500 rows and reasonable when handed 50. Now that they
   * receive the whole set, `pageSizes[0]` means Invoices opens at ten rows a
   * page - 338 pages - and every one of those screens would need editing to
   * fix it. Deriving the opening size here fixes them all, and still respects
   * a screen that genuinely offers only small pages.
   */
  const [pageSize, setPageSize] = useState(
    () => [...pageSizes].sort((a, b) => Math.abs(a - 50) - Math.abs(b - 50))[0],
  );
  const [page, setPage] = useState(0);
  /**
   * The page-jump box holds its own text while being typed.
   *
   * Committing on every keystroke makes "12" unreachable - the "1" jumps to
   * page 1 and re-renders the input from `safePage`, clobbering the second
   * digit. So it is a free text field until Enter or blur, and empty means
   * "showing whatever page we are on".
   */
  const [pageDraft, setPageDraft] = useState('');
  const [menu, setMenu] = useState<MenuAnchor | null>(null);

  const visibleColumns = columns.filter((c) => !hidden.has(c.key));
  const activeFilters = Object.entries(colFilters).filter(([, v]) => v.trim());

  const filtered = useMemo(() => {
    if (server) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (q) {
        const hit = columns.some((c) => {
          const v = c.sortValue?.(row);
          return v != null && String(v).toLowerCase().includes(q);
        });
        if (!hit) return false;
      }
      return activeFilters.every(([key, needle]) => {
        const col = columns.find((c) => c.key === key);
        const v = col?.sortValue?.(row);
        return v != null && String(v).toLowerCase().includes(needle.trim().toLowerCase());
      });
    });
    // activeFilters is derived from colFilters; depending on it directly would
    // rebuild the array identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, search, colFilters, server]);

  const sorted = useMemo(() => {
    if (server || !sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;   // nulls always last, regardless of direction
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sort, columns, server]);

  const effectiveSize = server ? server.pageSize : pageSize;
  const total = server ? server.total : sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / effectiveSize));
  const safePage = server ? Math.min(server.page, pageCount - 1) : Math.min(page, pageCount - 1);
  const pageRows = server ? rows : sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const goPage = (n: number) => (server ? pushParams({ page: n > 0 ? String(n) : null }) : setPage(n));

  /** Clamps rather than rejects: typing 900 of 92 pages means "the last one". */
  const commitPage = () => {
    const n = Number(pageDraft);
    if (pageDraft !== '' && Number.isFinite(n) && n >= 1) {
      goPage(Math.min(Math.trunc(n), pageCount) - 1);
    }
    setPageDraft('');
  };

  const toggleSort = (key: string) => {
    const next: SortState = sort?.key !== key ? { key, dir: 'asc' } : sort.dir === 'asc' ? { key, dir: 'desc' } : null;
    if (server) pushParams({ sort: next?.key ?? null, dir: next?.dir ?? null, page: null });
    else setLocalSort(next);
  };

  const setSelection = (next: Set<string>) => {
    setSelected(next);
    onSelectionChange?.([...next]);
  };

  const allOnPageSelected =
    pageRows.length > 0 && pageRows.every((r) => selected.has(rowKey(r)));

  const toggleAll = () => {
    const next = new Set(selected);
    pageRows.forEach((r) =>
      allOnPageSelected ? next.delete(rowKey(r)) : next.add(rowKey(r)),
    );
    setSelection(next);
  };

  const alignClass = (a?: Column<T>['align']) =>
    a === 'end' ? 'text-end' : a === 'center' ? 'text-center' : 'text-start';

  return (
    <div className="overflow-hidden rounded border border-border bg-card shadow-card">
      {/* utility bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="text-xs text-muted-foreground">
          <strong className="font-semibold text-foreground">{total.toLocaleString('en-IN')}</strong>{' '}
          record{total === 1 ? '' : 's'}
          {!server && sorted.length !== rows.length && ` of ${rows.length.toLocaleString('en-IN')}`}
          {navigating && <span className="ms-2 text-brand">Loading…</span>}
          {selected.size > 0 && ` · ${selected.size} selected`}
        </span>

        {activeFilters.length > 0 && (
          <button
            type="button"
            onClick={() => setColFilters({})}
            className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-on-tint-brand"
          >
            <Icon name="x" className="h-3 w-3" />
            {activeFilters.length} column filter{activeFilters.length === 1 ? '' : 's'}
          </button>
        )}

        <div className="flex-1" />

        {selected.size > 0 && bulkActions?.([...selected], () => setSelection(new Set()))}

        {exportAs && !server && (
          <ExportButton
            title={exportAs.title}
            allowed={exportAs.allowed}
            rows={sorted}
            columns={columns.filter((c) => c.sortValue).map((c) => ({ header: c.header, value: (r: T) => c.sortValue!(r) }))}
          />
        )}

        <ColumnChooser
          columns={columns}
          hidden={hidden}
          onToggle={(key) =>
            setHidden((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
        />
      </div>

      {/* table */}
      <div
        className={`thin-scroll max-h-[calc(100dvh-12rem)] min-h-[10rem] overflow-auto transition-opacity ${navigating ? 'opacity-60' : ''} ${mobileCard ? 'hidden sm:block' : ''}`}
        aria-busy={navigating}
      >
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-[3]">
            <tr className="bg-surface">
              <th className="sticky z-[4] w-10 border-b border-border bg-surface px-3 py-2.5" style={{ insetInlineStart: 0 }}>
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAll}
                  aria-label="Select all rows on this page"
                  className="h-5 w-5 accent-[hsl(var(--brand-primary))] sm:h-3.5 sm:w-3.5"
                />
              </th>
              {visibleColumns.map((c, ci) => (
                <th
                  key={c.key}
                  // Screen readers hear which column the list is sorted by (Impeccable review, 13 Oct 2026).
                  aria-sort={c.sortValue ? (sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                  style={{ ...(c.width ? { width: c.width } : {}), ...(ci === 0 ? { insetInlineStart: '2.5rem' } : {}) }}
                  className={`whitespace-nowrap border-b border-border bg-surface px-3 py-2.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground ${ci === 0 ? 'sticky z-[4] shadow-[1px_0_0_hsl(var(--border))]' : ''} ${alignClass(c.align)}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className="inline-flex items-center gap-1 transition hover:text-foreground"
                      >
                        {c.header || <span className="sr-only">{c.key}</span>}
                        <Icon
                          name={
                            sort?.key === c.key
                              ? sort.dir === 'asc' ? 'chevron-up' : 'chevron-down'
                              : 'chevron-down'
                          }
                          className={`h-3 w-3 ${sort?.key === c.key ? 'text-brand' : 'opacity-40'}`}
                        />
                      </button>
                    ) : (
                      c.header || <span className="sr-only">{c.key}</span>
                    )}
                    {c.sortValue && !server && (
                      <ColumnFilter
                        header={c.header}
                        value={colFilters[c.key] ?? ''}
                        onChange={(v) => {
                          setColFilters((f) => ({ ...f, [c.key]: v }));
                          setPage(0);
                        }}
                      />
                    )}
                  </span>
                </th>
              ))}
              {actions && (
                <th className={`sticky end-0 z-[4] border-b border-border bg-surface px-3 py-2.5 text-end text-micro font-semibold uppercase tracking-wide text-muted-foreground ${quickActions ? '' : 'w-14'}`}>
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const id = rowKey(row);
              const isSelected = selected.has(id);
              return (
                <tr
                  key={id}
                  /*
                    The row says which record it is, so a `?open=<id>` link can
                    find it (OpenTarget, 7 Oct 2026). One attribute here gives
                    every DataGrid screen deep links; none of them had to be
                    touched.
                  */
                  data-row-id={id}
                  className={`group transition ${isSelected ? 'bg-brand/[0.07]' : 'hover:bg-brand/[0.035]'}`}
                >
                  <td className="sticky z-[1] border-b border-border/70 bg-card px-3 py-[var(--row-py)]" style={{ insetInlineStart: 0 }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      aria-label="Select row"
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        setSelection(next);
                      }}
                      className="h-5 w-5 accent-[hsl(var(--brand-primary))] sm:h-3.5 sm:w-3.5"
                    />
                  </td>
                  {visibleColumns.map((c, ci) => (
                    <td
                      key={c.key}
                      style={ci === 0 ? { insetInlineStart: '2.5rem' } : undefined}
                      className={`border-b border-border/70 px-3 py-[var(--row-py)] ${keepOnOneLine(c) ? 'whitespace-nowrap' : ''} ${ci === 0 ? 'sticky z-[1] bg-card shadow-[1px_0_0_hsl(var(--border))]' : ''} ${alignClass(c.align)}`}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                  {actions && (
                    <td
                      className={`sticky end-0 z-[1] border-b border-border/70 px-3 py-[var(--row-py)] ${
                        isSelected ? 'bg-[hsl(var(--card))]' : 'bg-card'
                      }`}
                    >
                      <span className="flex items-center justify-end gap-1">
                      {quickActions && <QuickActions items={quickActions(row)} />}
                      <button
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={menu?.id === id}
                        aria-label="Row actions"
                        onClick={(e) => {
                          if (menu?.id === id) return setMenu(null);
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const estimatedHeight = actions.length * 38 + 16;
                          const roomBelow = window.innerHeight - r.bottom;
                          const placeAbove = roomBelow < estimatedHeight && r.top > estimatedHeight;
                          setMenu({
                            id,
                            x: r.right,
                            y: placeAbove ? r.top - 4 : r.bottom + 4,
                            placeAbove,
                          });
                        }}
                        className="grid h-10 w-10 sm:h-7 sm:w-7 place-items-center rounded border border-border text-muted-foreground transition hover:border-border-strong hover:bg-muted hover:text-foreground"
                      >
                        <Icon name="more-vertical" className="h-4 w-4" />
                      </button>
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}

            {pageRows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + (actions ? 2 : 1)}>
                  <EmptyState icon={emptyIcon} title={emptyMessage} hint={emptyHint} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {mobileCard && (
        <ul className={`divide-y divide-border sm:hidden ${navigating ? 'opacity-60' : ''}`} aria-busy={navigating}>
          {pageRows.map((row) => {
            const id = rowKey(row);
            return (
              <li key={id} data-row-id={id} className="flex items-start gap-2 px-3 py-3">
                <div className="min-w-0 flex-1">
                  {mobileCard(row)}
                  {quickActions && (
                    <div className="mt-2"><QuickActions items={quickActions(row)} always /></div>
                  )}
                </div>
                {actions && (
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-label="Row actions"
                    onClick={(e) => {
                      if (menu?.id === id) return setMenu(null);
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const estimatedHeight = actions.length * 38 + 16;
                      const placeAbove = window.innerHeight - r.bottom < estimatedHeight && r.top > estimatedHeight;
                      setMenu({ id, x: r.right, y: placeAbove ? r.top - 4 : r.bottom + 4, placeAbove });
                    }}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded border border-border text-muted-foreground"
                  >
                    <Icon name="more-vertical" className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
          {pageRows.length === 0 && (
            <li><EmptyState icon={emptyIcon} title={emptyMessage} hint={emptyHint} /></li>
          )}
        </ul>
      )}

      {menu && actions && (() => {
        const row = pageRows.find((r) => rowKey(r) === menu.id);
        return row ? (
          <RowMenu anchor={menu} row={row} actions={actions} onClose={() => setMenu(null)} />
        ) : null;
      })()}

      {pageSummary && pageRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border bg-brand/[0.04] px-3 py-2 text-xs">
          {pageSummary(pageRows, rows)}
        </div>
      )}

      {/* pagination */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface px-3 py-2 text-xs">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Page size
          <select
            value={effectiveSize}
            onChange={(e) => {
              if (server) { pushParams({ size: e.target.value, page: null }); return; }
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            className="h-10 sm:h-7 rounded border border-border bg-card px-1.5 text-xs outline-none focus:border-brand"
          >
            {pageSizes.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <div className="flex-1" />

        <span className="text-muted-foreground">
          {total === 0 ? 0 : (safePage * effectiveSize + 1).toLocaleString('en-IN')}–
          {Math.min((safePage + 1) * effectiveSize, total).toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}
        </span>

        <div className="flex items-center gap-1">
          {([
            ['chevrons-left', 'First page', () => goPage(0), safePage === 0],
            ['chevron-left', 'Previous page', () => goPage(safePage - 1), safePage === 0],
          ] as const).map(([icon, label, onClick, disabled]) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={onClick}
              title={label}
              aria-label={label}
              className="grid h-10 w-10 sm:h-7 sm:w-7 place-items-center rounded border border-border bg-card text-muted-foreground transition hover:bg-muted disabled:opacity-35"
            >
              <Icon name={icon} className="h-3.5 w-3.5" />
            </button>
          ))}

          <span className="flex items-center gap-1 px-1 text-muted-foreground">
            Page
            <input
              type="text"
              inputMode="numeric"
              aria-label={`Page number, 1 to ${pageCount}`}
              value={pageDraft === '' ? String(safePage + 1) : pageDraft}
              onChange={(e) => setPageDraft(e.target.value.replace(/[^\d]/g, ''))}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { commitPage(); e.currentTarget.blur(); }
                if (e.key === 'Escape') { setPageDraft(''); e.currentTarget.blur(); }
              }}
              onBlur={commitPage}
              className="h-10 sm:h-7 w-12 rounded border border-border bg-card px-1 text-center text-xs tabular-nums outline-none focus:border-brand"
            />
            of {pageCount}
          </span>

          {([
            ['chevron-right', 'Next page', () => goPage(safePage + 1), safePage >= pageCount - 1],
            ['chevrons-right', 'Last page', () => goPage(pageCount - 1), safePage >= pageCount - 1],
          ] as const).map(([icon, label, onClick, disabled]) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={onClick}
              title={label}
              aria-label={label}
              className="grid h-10 w-10 sm:h-7 sm:w-7 place-items-center rounded border border-border bg-card text-muted-foreground transition hover:bg-muted disabled:opacity-35"
            >
              <Icon name={icon} className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ColumnChooser<T>({
  columns, hidden, onToggle,
}: {
  columns: Column<T>[]; hidden: Set<string>; onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="inline-flex h-10 sm:h-7 items-center gap-1.5 rounded border border-border bg-card px-2 text-xs font-medium transition hover:bg-muted"
      >
        <Icon name="columns" className="h-3.5 w-3.5" />
        Columns
        <span className="text-muted-foreground">
          ({columns.length - hidden.size}/{columns.length})
        </span>
      </button>
      {open && (
        <div className="thin-scroll absolute end-0 z-50 mt-1 max-h-80 w-56 animate-fade-in overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-raised">
          {columns.map((c) => (
            <label
              key={c.key}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={!hidden.has(c.key)}
                onChange={() => onToggle(c.key)}
                className="h-5 w-5 accent-[hsl(var(--brand-primary))] sm:h-3.5 sm:w-3.5"
              />
              {c.header || <span className="sr-only">{c.key}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
