'use client';

import { RANGE_PRESETS, istDate, presetRange, type RangePreset } from '@/lib/date-ranges';

/**
 * Period presets for a report that works in plain `from` / `to` dates
 * (F1b, F1-SPEC §3.1 Tier B: "date range with presets").
 *
 * WHY THIS EXISTS BESIDE `FilterBar`'s OWN DATE CONTROL.
 *
 * `FilterBar` writes `range` / `from` / `to` into the address and expects the
 * screen's loader to read them back through `resolveRange`. The financial
 * statements do not work that way: P&L, the Balance Sheet and GST each hold two
 * dates in local state and recompute when you press Show. Rewriting three
 * working statements to adopt the list plumbing would be a large change to earn
 * one dropdown.
 *
 * So this converts a preset into the two dates the statement already
 * understands and hands them back. Same words, same financial year, same
 * `lib/date-ranges` - a "This FY" here and a "This FY" on a list screen cannot
 * drift apart, because both resolve through `presetRange`.
 *
 * The point is small and dull: knowing the current financial year runs 1 April
 * to 31 March, and typing both dates, is not something anybody should have to
 * do to see this quarter's profit.
 */
export function DateRangePresets({
  onPick,
  label = 'Period',
  className = '',
}: {
  /** Receives ISO `yyyy-mm-dd` dates, ready for a date input. */
  onPick: (from: string, to: string) => void;
  label?: string;
  className?: string;
}) {
  const pick = (key: string) => {
    if (!key) return;
    const r = presetRange(key as Exclude<RangePreset, 'custom'>, new Date());
    // `presetRange` returns a half-open range [from, to) so day-boundary maths
    // stays correct; a date input wants the last day that is actually included.
    const last = r.to ? new Date(r.to.getTime() - 86_400_000) : null;
    onPick(r.from ? istDate(r.from) : '', last ? istDate(last) : '');
  };

  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        aria-label={`${label} preset`}
        defaultValue=""
        onChange={(e) => { pick(e.target.value); e.currentTarget.value = ''; }}
        className="h-[34px] rounded-md border border-border bg-card px-2 text-sm outline-none focus:border-brand"
      >
        <option value="">Choose a period…</option>
        {RANGE_PRESETS.filter((p) => p.key !== 'all').map((p) => (
          <option key={p.key} value={p.key}>{p.label}</option>
        ))}
      </select>
    </label>
  );
}
