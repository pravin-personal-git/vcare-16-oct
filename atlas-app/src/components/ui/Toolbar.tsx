'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { loadMetricsAction } from '@/app/actions/metrics';
import type { MetricsEntity, EntityMetrics } from '@/server/metrics';
import { DialogFrame } from './DialogFrame';

/**
 * The list-screen toolbar.
 *
 * Every grid in the original wears the same strip: the primary create action,
 * module-specific filter chips, a count, a search field that takes the slack,
 * a view preset, and a rail of icon buttons at the end.
 *
 * It is one row because it is one thought - "narrow this list down". Splitting
 * it across two rows, which is the easy thing to do when it gets crowded, is
 * what makes a screen feel like it was assembled rather than designed.
 */
export function Toolbar({
  primary, filters, count, search, onSearch, searchPlaceholder = 'Search…', tools, end,
}: {
  /** The create action. Rendered first, always. */
  primary?: ReactNode;
  /** Module-specific chips - Customers (1), Lead (5), Non-Invoiced… */
  filters?: ReactNode;
  count?: ReactNode;
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  /** View preset, metrics, page toggle. */
  tools?: ReactNode;
  /** The icon rail. */
  end?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-card">
      {primary}
      {filters}
      {count != null && (
        <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-muted-foreground">
          <Icon name="menu" className="h-3.5 w-3.5" />
          {count}
        </span>
      )}

      <div className="relative min-w-[12rem] flex-1">
        <Icon
          name="search"
          className="pointer-events-none absolute start-0 top-1/2 ms-3 h-4 w-4 -translate-y-1/2 text-foreground/70"
        />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-10 w-full rounded-lg border-2 border-border-strong bg-background ps-9 pe-8 text-sm shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch('')}
            aria-label="Clear search"
            className="absolute end-0 top-1/2 me-1 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {tools}
      {end && <div className="flex items-center gap-1">{end}</div>}
    </div>
  );
}

/** A filter chip with a count, e.g. `Customers (12)`. */
export function FilterChip({
  label, count, active = false, icon, onClick,
}: {
  label: string;
  count?: number;
  active?: boolean;
  icon?: Parameters<typeof Icon>[0]['name'];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${
        active
          ? 'border-brand bg-brand/10 text-on-tint-brand'
          : 'border-border bg-card text-foreground hover:bg-muted'
      }`}
    >
      {icon && <Icon name={icon} className="h-3.5 w-3.5" />}
      {label}
      {count != null && <span className="text-muted-foreground">({count})</span>}
    </button>
  );
}

/**
 * A dropdown filter for the toolbar (4 Oct 2026): salesperson, supplier, city,
 * courier - things the KPI cards cannot say. The rule on every list screen is
 * that a card IS a filter, so what is on a card never gets a chip or a
 * dropdown of its own as well; these carry everything else.
 *
 * Draws nothing when there is fewer than two choices - a filter with one
 * option can only ever show the whole list or that same list.
 */
export function FilterSelect({
  id, label, value, onChange, options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  if (options.length < 2 && !value) return null;
  const active = Boolean(value);
  return (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select
        id={id} value={value} onChange={(e) => onChange(e.target.value)}
        className={`h-9 shrink-0 rounded-lg border bg-card px-2.5 text-sm outline-none focus:border-brand ${
          active ? 'border-brand bg-brand/5 font-medium text-on-tint-brand' : 'border-border'
        }`}
      >
        <option value="">{label}: all</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </>
  );
}

/** Distinct, sorted, non-empty values - the options for a FilterSelect. */
export function optionsOf<T>(rows: T[], pick: (r: T) => string | null | undefined): { value: string; label: string }[] {
  return [...new Set(rows.map(pick).filter((v): v is string => Boolean(v)))]
    .sort((a, b) => a.localeCompare(b))
    .map((v) => ({ value: v, label: v }));
}

/**
 * A toolbar control for something not built yet.
 *
 * Present, clickable, and honest about itself. The reference carries History
 * and Metrics on every list screen; leaving them out makes the toolbar look
 * unfinished, and faking them makes the product look unreliable.
 */
export function PendingTool({
  label, icon, detail,
}: {
  label: string;
  icon: Parameters<typeof Icon>[0]['name'];
  detail: string;
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
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${
          open ? 'border-brand bg-brand/10 text-on-tint-brand' : 'border-border bg-card text-muted-foreground hover:bg-muted'
        }`}
      >
        <Icon name={icon} className="h-3.5 w-3.5" />
        {label}
      </button>
      {open && (
        <div className="absolute end-0 z-50 mt-1 w-56 animate-fade-in rounded-lg border border-border bg-card p-3 shadow-raised">
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <Icon name={icon} className="h-3.5 w-3.5 text-muted-foreground" />
            {label}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
        </div>
      )}
    </div>
  );
}

/** An icon-only chrome button for the rail at the end of the toolbar. */
export function ToolbarIcon({
  icon, label, active = false, onClick, disabled,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition disabled:opacity-40 ${
        active
          ? 'border-brand bg-brand/10 text-on-tint-brand'
          : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <Icon name={icon} className="h-4 w-4" />
    </button>
  );
}

/**
 * A small dropdown for toolbar menus - view presets, column chooser.
 * Closes on outside click and on Escape, like every other menu in the app.
 */
export function ToolbarMenu({
  label, icon, children, align = 'end', width = 'w-52',
}: {
  label: string;
  icon?: Parameters<typeof Icon>[0]['name'];
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'start' | 'end';
  width?: string;
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
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${
          open ? 'border-brand bg-brand/10 text-on-tint-brand' : 'border-border bg-card hover:bg-muted'
        }`}
      >
        {icon && <Icon name={icon} className="h-3.5 w-3.5" />}
        {label}
        <Icon name="chevron-down" className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-50 mt-1 ${width} ${
            align === 'end' ? 'end-0' : 'start-0'
          } thin-scroll max-h-80 animate-fade-in overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-raised`}
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

/**
 * The toolbar's "Metrics" button, real as of 18 Sep 2026: a generic
 * new-records-per-day chart, the same shape on every list screen that has
 * one. A bespoke per-module dashboard (a funnel for Leads, aging for
 * Invoices) is still real future work - the summary cards already on each
 * screen remain the place for anything module-specific. See
 * server/metrics.ts.
 */
export function MetricsButton({ entity, label = 'Metrics' }: { entity: MetricsEntity; label?: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<EntityMetrics | null>(null);

  const openPanel = () => {
    setOpen(true);
    if (!data) {
      loadMetricsAction(entity).then(setData).catch(() => undefined);
    }
  };

  const max = data ? Math.max(1, ...data.daily.map((d) => d.count)) : 1;

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition hover:bg-muted"
      >
        <Icon name="bar-chart" className="h-3.5 w-3.5" />
        {label}
      </button>
      {open && (
        <DialogFrame label="Metrics" onClose={() => setOpen(false)} className="fixed inset-0 z-[200] grid place-items-center bg-navy/40 p-4" closeOnBackdrop>
          <div className="w-full max-w-md rounded-lg bg-card shadow-overlay">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Icon name="bar-chart" className="h-4 w-4 text-muted-foreground" />
                Metrics
              </p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                <span className="text-lg leading-none">×</span>
              </button>
            </div>
            {!data ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="p-4">
                <div className="mb-4 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-lg font-bold">{data.total}</p>
                    <p className="text-micro uppercase text-muted-foreground">Total</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold">{data.last30}</p>
                    <p className="text-micro uppercase text-muted-foreground">Last 30 days</p>
                  </div>
                  <div>
                    <p className={`text-lg font-bold ${
                      data.trendPct == null ? '' : data.trendPct >= 0 ? 'text-success' : 'text-danger'
                    }`}>
                      {data.trendPct == null ? '-' : `${data.trendPct > 0 ? '+' : ''}${data.trendPct}%`}
                    </p>
                    <p className="text-micro uppercase text-muted-foreground">vs prior 30 days</p>
                  </div>
                </div>
                <div className="flex h-24 items-end gap-[2px]">
                  {data.daily.map((d) => (
                    <div
                      key={d.date}
                      title={`${d.date}: ${d.count}`}
                      className="min-h-[2px] flex-1 rounded-t bg-brand/70"
                      style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }}
                    />
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">New records per day, last 30 days.</p>
              </div>
            )}
          </div>
        </DialogFrame>
      )}
    </>
  );
}
