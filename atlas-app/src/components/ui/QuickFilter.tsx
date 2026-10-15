'use client';

import { Icon } from './Icon';

/**
 * A small search box and one choice, for a list that sits inside a section
 * card rather than owning the page (G-07, 6 Oct 2026) - Payables "By
 * supplier", payslips of one run, team calls. Screens that own the page use
 * FilterBar or Toolbar; this is their in-card cousin, so these lists stop
 * being the only ones you cannot narrow down.
 */
export function QuickFilter({
  search, onSearch, placeholder, choice, shown, total,
}: {
  search: string;
  onSearch: (v: string) => void;
  /** Say what it searches: "Supplier name". */
  placeholder: string;
  choice?: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] };
  shown?: number;
  total?: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} aria-label={placeholder}
          className="h-8 w-44 rounded border border-border bg-card ps-7 pe-2 text-xs outline-none focus:border-brand"
        />
      </div>
      {choice && (
        <select aria-label={choice.label} value={choice.value} onChange={(e) => choice.onChange(e.target.value)}
          className="h-8 rounded border border-border bg-card px-2 text-xs outline-none focus:border-brand">
          {choice.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {shown != null && total != null && shown !== total && (
        <span className="text-xs text-muted-foreground">{shown} of {total}</span>
      )}
    </div>
  );
}

/** Case-insensitive "does any of these contain the query". */
export const matches = (q: string, ...values: (string | null | undefined)[]) => {
  const s = q.trim().toLowerCase();
  return !s || values.some((v) => (v ?? '').toLowerCase().includes(s));
};
