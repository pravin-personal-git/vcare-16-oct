/**
 * Date ranges for list filters (F1 UI standard, 26 Sep 2026).
 *
 * Every list with a date filter offers the same presets, worked out the same
 * way, in India time: a "today" that flips at midnight UTC would put a 1 AM
 * complaint on yesterday's list. The financial year runs April to March.
 *
 * In the address as ?range=<preset>, plus ?from= &to= (YYYY-MM-DD, both days
 * included) for a custom range. No ?range= means the screen's own default:
 * this financial year for documents, all time for open-work queues (a
 * complaint still open from March must not vanish on 1 April).
 *
 * Pure - `now` is passed in, so it is tested without a clock.
 */

export type RangePreset =
  | 'all' | 'today' | 'yesterday' | 'last_7_days' | 'this_week' | 'last_30_days' | 'this_month' | 'last_month'
  | 'this_fy' | 'last_fy' | 'custom';

export const RANGE_PRESETS: { key: Exclude<RangePreset, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last_7_days', label: 'Last 7 days' },
  { key: 'this_week', label: 'This week' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_fy', label: 'This financial year' },
  { key: 'last_fy', label: 'Last financial year' },
  { key: 'all', label: 'All time' },
];

export interface DateRange {
  preset: RangePreset;
  /** Inclusive start, or null for "no lower bound". */
  from: Date | null;
  /** EXCLUSIVE end, or null for "no upper bound". */
  to: Date | null;
  /** Short words for the filter bar and the export file. */
  label: string;
}

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The India calendar date of `d`. */
function istDay(d: Date) {
  const x = new Date(d.getTime() + IST_MS);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), dow: x.getUTCDay() };
}

/** Midnight in India on y-m-d, as an instant. Month/day may overflow (Date.UTC normalises). */
const istMidnight = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - IST_MS);

/**
 * A browser `datetime-local` value ("2026-09-28T00:45") is India wall-clock
 * time. `new Date()` on it uses the SERVER's zone - UTC on Vercel - which put
 * every such time 5 h 30 min late (found live 28 Sep 2026). A value that
 * already carries a zone (Z or +hh:mm) is taken as it is.
 */
export function istWallClock(s: string): Date {
  const v = String(s ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v)) return new Date(`${v}+05:30`);
  return new Date(v);
}

/** YYYY-MM-DD for the India calendar date of an instant. */
export function istDate(d: Date): string {
  const p = istDay(d);
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

function parseDay(s: string | null | undefined): Date | null {
  if (!s || !DAY_RE.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const t = istMidnight(y, m - 1, d);
  // Rejects 2026-02-31 and the like, which Date.UTC would quietly roll over.
  return istDate(t) === s ? t : null;
}

const fmt = (d: Date) =>
  new Date(d.getTime() + IST_MS).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function presetRange(preset: Exclude<RangePreset, 'custom'>, now: Date): DateRange {
  const t = istDay(now);
  const today = istMidnight(t.y, t.m, t.d);
  const fyStartYear = t.m >= 3 ? t.y : t.y - 1;
  const label = RANGE_PRESETS.find((p) => p.key === preset)!.label;
  switch (preset) {
    case 'all': return { preset, from: null, to: null, label };
    case 'today': return { preset, from: today, to: new Date(today.getTime() + DAY_MS), label };
    case 'yesterday': return { preset, from: new Date(today.getTime() - DAY_MS), to: today, label };
    // Today and the days before it - the rolling windows a call log or a sales review uses.
    case 'last_7_days': return { preset, from: new Date(today.getTime() - 6 * DAY_MS), to: new Date(today.getTime() + DAY_MS), label };
    case 'last_30_days': return { preset, from: new Date(today.getTime() - 29 * DAY_MS), to: new Date(today.getTime() + DAY_MS), label };
    case 'this_week': {
      // Monday start, as Indian offices count a working week.
      const back = (t.dow + 6) % 7;
      return { preset, from: istMidnight(t.y, t.m, t.d - back), to: new Date(today.getTime() + DAY_MS), label };
    }
    case 'this_month': return { preset, from: istMidnight(t.y, t.m, 1), to: new Date(today.getTime() + DAY_MS), label };
    case 'last_month': return { preset, from: istMidnight(t.y, t.m - 1, 1), to: istMidnight(t.y, t.m, 1), label };
    case 'this_fy': return {
      preset, from: istMidnight(fyStartYear, 3, 1), to: new Date(today.getTime() + DAY_MS),
      label: `FY ${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, '0')}`,
    };
    case 'last_fy': return {
      preset, from: istMidnight(fyStartYear - 1, 3, 1), to: istMidnight(fyStartYear, 3, 1),
      label: `FY ${fyStartYear - 1}-${String(fyStartYear % 100).padStart(2, '0')}`,
    };
  }
}

/**
 * The range a list shows. Unknown or broken input falls back to the screen's
 * default rather than to "nothing" - a typo in a shared link should show
 * something sensible, not an empty list that looks like lost data.
 */
export function resolveRange(
  input: { range?: string | null; from?: string | null; to?: string | null },
  fallback: Exclude<RangePreset, 'custom'>,
  now: Date = new Date(),
): DateRange {
  if (input.range === 'custom' || (!input.range && (input.from || input.to))) {
    const from = parseDay(input.from);
    const toDay = parseDay(input.to);
    if (from || toDay) {
      const to = toDay ? new Date(toDay.getTime() + DAY_MS) : null;
      if (from && to && from >= to) return presetRange(fallback, now);
      const label = from && toDay ? `${fmt(from)} – ${fmt(toDay)}` : from ? `From ${fmt(from)}` : `Up to ${fmt(toDay!)}`;
      return { preset: 'custom', from, to, label };
    }
    return presetRange(fallback, now);
  }
  const known = RANGE_PRESETS.some((p) => p.key === input.range);
  return presetRange(known ? (input.range as Exclude<RangePreset, 'custom'>) : fallback, now);
}

/** Is `value` inside the range? A missing date is inside only an unbounded range. */
export function inRange(value: Date | string | null | undefined, r: DateRange): boolean {
  if (!r.from && !r.to) return true;
  if (!value) return false;
  const t = (value instanceof Date ? value : new Date(value)).getTime();
  if (Number.isNaN(t)) return false;
  return (!r.from || t >= r.from.getTime()) && (!r.to || t < r.to.getTime());
}

/** A Prisma-ready `{ gte, lt }` for the range, or undefined for all time. */
export function rangeWhere(r: DateRange): { gte?: Date; lt?: Date } | undefined {
  if (!r.from && !r.to) return undefined;
  return { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lt: r.to } : {}) };
}

/**
 * A date that can lie ahead: "this week / month / FY" runs to the END of the
 * period rather than to the end of today - for due dates (ListFilter's
 * `future` dates, and the server card lists). Moved here 9 Oct 2026 so the
 * screen and the server stretch the same way.
 */
export function stretchRange(r: DateRange, future: boolean): DateRange {
  if (!future || !r.from) return r;
  const IST = 5.5 * 3_600_000;
  const f = new Date(r.from.getTime() + IST);
  const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - IST);
  if (r.preset === 'this_week') return { ...r, to: new Date(r.from.getTime() + 7 * 86_400_000) };
  if (r.preset === 'this_month') return { ...r, to: at(f.getUTCFullYear(), f.getUTCMonth() + 1, 1) };
  if (r.preset === 'this_fy') return { ...r, to: at(f.getUTCFullYear() + 1, 3, 1) };
  return r;
}

/**
 * The first and last instant of an India calendar day, from "YYYY-MM-DD"
 * (9 Oct 2026). For report pages that take ?from= &to= - the server runs in
 * UTC, where `new Date("2026-10-01")` starts at 05:30 India time and
 * `"2026-10-31T23:59:59"` ends at 05:29 the next morning. Null for anything
 * that is not a real day, so the caller decides between a default and a 400.
 */
export function istDayStart(s: string | null | undefined): Date | null {
  return parseDay(s);
}
export function istDayEnd(s: string | null | undefined): Date | null {
  const d = parseDay(s);
  return d ? new Date(d.getTime() + DAY_MS - 1) : null;
}
