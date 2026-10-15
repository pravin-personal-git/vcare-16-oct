/**
 * The dashboards' time filter (11 Oct 2026, dashboards demo).
 *
 * One period, one comparison and one branch drive every card on every
 * dashboard. The period lives in the address (`?period=mtd&compare=prev`), so a
 * dashboard can be bookmarked, shared and opened from a link exactly as it was.
 *
 * Everything here works on India calendar days ("2026-10-11"), never on the
 * server clock: on Vercel the server runs in UTC, and a "today" read from it
 * was yesterday until 05:30 in the morning (the 9 Oct attendance bug).
 *
 * Pure - shared by the server (which queries with it) and the browser (which
 * draws the chart axes with it), so the two cannot disagree on a bucket.
 */

export type PeriodKey = 'today' | 'yday' | '7d' | 'mtd' | 'lm' | '90d' | 'fy' | 'custom';
export type CompareMode = 'prev' | 'ly' | 'none';
export type Granularity = 'hour' | 'day' | 'week' | 'month';

export const PERIODS: { k: Exclude<PeriodKey, 'custom'>; l: string; key?: string }[] = [
  { k: 'today', l: 'Today', key: 'T' },
  { k: 'yday', l: 'Yesterday' },
  { k: '7d', l: '7 days', key: 'W' },
  { k: 'mtd', l: 'This month', key: 'M' },
  { k: 'lm', l: 'Last month' },
  { k: '90d', l: '90 days', key: 'Q' },
  { k: 'fy', l: 'This FY', key: 'Y' },
];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day as "YYYY-MM-DD". */
export type Day = string;

const pad = (n: number) => String(n).padStart(2, '0');
const parts = (d: Day) => d.split('-').map(Number) as [number, number, number];
const fromUtc = (t: number): Day => {
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
};
const utcOf = (d: Day) => { const [y, m, dd] = parts(d); return Date.UTC(y, m - 1, dd); };

/** The India calendar day an instant falls on. */
export function istDay(at: Date): Day { return fromUtc(at.getTime() + IST_MS); }
/** The India hour (0-23) of an instant. */
export function istHour(at: Date): number { return new Date(at.getTime() + IST_MS).getUTCHours(); }
/** The India weekday (0 = Sunday) of an instant. */
export function istDow(at: Date): number { return new Date(at.getTime() + IST_MS).getUTCDay(); }

export function addDays(d: Day, n: number): Day { return fromUtc(utcOf(d) + n * DAY_MS); }
export function daysBetween(a: Day, b: Day): number { return Math.round((utcOf(b) - utcOf(a)) / DAY_MS) + 1; }
export function dowOf(d: Day): number { return new Date(utcOf(d)).getUTCDay(); }
export function isDay(s: unknown): s is Day {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  return fromUtc(utcOf(s)) === s;
}
/** "11 Oct" */
export function dm(d: Day): string { const [, m, dd] = parts(d); return `${dd} ${MONTHS[m - 1]}`; }
/** Midnight in India at the start of a day, as an instant - the `gte` of a query. */
export function dayStart(d: Day): Date { return new Date(utcOf(d) - IST_MS); }
/** Midnight in India at the end of a day - the `lt` of a query. */
export function dayEnd(d: Day): Date { return new Date(utcOf(d) + DAY_MS - IST_MS); }
/** First day of the month a day is in. */
export function monthStart(d: Day): Day { const [y, m] = parts(d); return `${y}-${pad(m)}-01`; }
/** Last day of the month a day is in. */
export function monthEnd(d: Day): Day { const [y, m] = parts(d); return fromUtc(Date.UTC(y, m, 0)); }
/** The financial year (April-March) a day is in, by its starting year. */
export function fyStartYear(d: Day): number { const [y, m] = parts(d); return m >= 4 ? y : y - 1; }

export interface Range { from: Day; to: Day; label: string }

/** The range a period stands for, on India days, as of `today`. */
export function rangeFor(period: PeriodKey, today: Day, custom?: { from: Day; to: Day } | null): Range {
  const [y, m] = parts(today);
  switch (period) {
    case 'today': return { from: today, to: today, label: `Today, ${dm(today)}` };
    case 'yday': { const d = addDays(today, -1); return { from: d, to: d, label: `Yesterday, ${dm(d)}` }; }
    case '7d': { const f = addDays(today, -6); return { from: f, to: today, label: `${dm(f)} – ${dm(today)}` }; }
    case 'mtd': { const f = monthStart(today); return { from: f, to: today, label: `${parts(f)[2]} – ${dm(today)} ${y}` }; }
    case 'lm': {
      const f = fromUtc(Date.UTC(y, m - 2, 1));
      const [ly, lm] = parts(f);
      return { from: f, to: monthEnd(f), label: `${FULL_MONTHS[lm - 1]} ${ly}` };
    }
    case '90d': { const f = addDays(today, -89); return { from: f, to: today, label: `${dm(f)} – ${dm(today)}` }; }
    case 'fy': {
      const fy = fyStartYear(today);
      return { from: `${fy}-04-01`, to: today, label: `FY ${fy}-${pad((fy + 1) % 100)} · 1 Apr – ${dm(today)}` };
    }
    case 'custom': default: {
      let from = custom?.from ?? monthStart(today);
      let to = custom?.to ?? today;
      if (from > to) [from, to] = [to, from];
      const [fy] = parts(from); const [ty] = parts(to);
      const label = from === to ? `${dm(from)} ${fy}` : `${dm(from)} – ${dm(to)} ${ty}`;
      return { from, to, label };
    }
  }
}
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The range a figure is compared with: the same length just before, or the same dates a year back. */
export function compareRange(r: Range, mode: CompareMode): Range | null {
  if (mode === 'none') return null;
  if (mode === 'ly') {
    const back = (d: Day) => { const [y, m, dd] = parts(d); return fromUtc(Date.UTC(y - 1, m - 1, Math.min(dd, new Date(Date.UTC(y - 1, m, 0)).getUTCDate()))); };
    return { from: back(r.from), to: back(r.to), label: 'same period last year' };
  }
  const n = daysBetween(r.from, r.to);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1), label: `previous ${n} ${n === 1 ? 'day' : 'days'}` };
}

export interface Bucket {
  label: string;
  from: Day;
  to: Day;
  /** Days covered - a bucket clipped by the range is shorter. */
  days: number;
  /** Set on hourly buckets (a single-day range). */
  hour?: number;
  /** Set on daily buckets. */
  dow?: number;
  /** An hour of today that has not happened yet. */
  future?: boolean;
}

/**
 * How the chart axis is cut: hours for one day, days up to 45, weeks up to
 * 120, months beyond. The same rule as the demo Pravin approved.
 */
export function bucketsFor(r: Range, today: Day, nowHour: number): { gran: Granularity; list: Bucket[] } {
  const n = daysBetween(r.from, r.to);
  const list: Bucket[] = [];
  if (n === 1) {
    for (let h = 9; h <= 20; h++) {
      list.push({
        label: `${h > 12 ? h - 12 : h}${h >= 12 ? 'p' : 'a'}`, from: r.from, to: r.to, days: 1 / 12, hour: h,
        future: r.from === today && h > nowHour,
      });
    }
    return { gran: 'hour', list };
  }
  if (n <= 45) {
    for (let i = 0; i < n; i++) {
      const d = addDays(r.from, i); const dow = dowOf(d);
      list.push({ label: n <= 8 ? `${DOW[dow]} ${parts(d)[2]}` : String(parts(d)[2]), from: d, to: d, days: 1, dow });
    }
    return { gran: 'day', list };
  }
  if (n <= 120) {
    for (let d = r.from; d <= r.to; d = addDays(d, 7)) {
      const e = addDays(d, 6) > r.to ? r.to : addDays(d, 6);
      list.push({ label: dm(d), from: d, to: e, days: daysBetween(d, e) });
    }
    return { gran: 'week', list };
  }
  let d = monthStart(r.from);
  while (d <= r.to) {
    const s = d < r.from ? r.from : d;
    const me = monthEnd(d); const e = me > r.to ? r.to : me;
    list.push({ label: MONTHS[parts(d)[1] - 1], from: s, to: e, days: daysBetween(s, e) });
    d = addDays(me, 1);
  }
  return { gran: 'month', list };
}

/** Which bucket an instant belongs in, or -1 when it is outside them all. */
export function bucketOf(list: Bucket[], at: Date): number {
  const d = istDay(at);
  if (list.length && list[0].hour !== undefined) {
    if (d !== list[0].from) return -1;
    const h = istHour(at);
    return Math.min(Math.max(h, 9), 20) - 9;
  }
  for (let i = 0; i < list.length; i++) if (d >= list[i].from && d <= list[i].to) return i;
  return -1;
}

/** Sum values into the buckets by the instant each one happened at. */
export function intoBuckets<T>(list: Bucket[], rows: T[], at: (r: T) => Date | null | undefined, value: (r: T) => number): number[] {
  const out = list.map(() => 0);
  for (const r of rows) {
    const t = at(r); if (!t) continue;
    const i = bucketOf(list, t);
    if (i >= 0) out[i] += value(r);
  }
  return out;
}

export interface DashParams {
  period: PeriodKey;
  from?: Day | null;
  to?: Day | null;
  compare: CompareMode;
  branch: string;
}

/** Read the filter out of the address, refusing anything malformed. */
export function readParams(sp: Record<string, string | string[] | undefined>): DashParams {
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const p = one('period');
  const period: PeriodKey = (['today', 'yday', '7d', 'mtd', 'lm', '90d', 'fy', 'custom'] as const).find((x) => x === p) ?? 'mtd';
  const c = one('compare');
  const compare: CompareMode = c === 'ly' || c === 'none' ? c : 'prev';
  const from = one('from'); const to = one('to');
  return {
    period: period === 'custom' && !(isDay(from) && isDay(to)) ? 'mtd' : period,
    from: isDay(from) ? from : null,
    to: isDay(to) ? to : null,
    compare,
    branch: one('branch') || 'all',
  };
}

/** The address for a filter, keeping only what differs from the defaults. */
export function paramsQuery(p: DashParams & { tab?: string }): string {
  const q = new URLSearchParams();
  if (p.tab && p.tab !== 'business') q.set('tab', p.tab);
  if (p.period !== 'mtd') q.set('period', p.period);
  if (p.period === 'custom' && p.from && p.to) { q.set('from', p.from); q.set('to', p.to); }
  if (p.compare !== 'prev') q.set('compare', p.compare);
  if (p.branch && p.branch !== 'all') q.set('branch', p.branch);
  const s = q.toString();
  return s ? `?${s}` : '';
}
