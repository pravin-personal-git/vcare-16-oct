/**
 * Scorecard periods and working time (31 Oct 2026). All in IST: Vcare's
 * month starts at midnight in Durg, not in UTC.
 */

export const PERIODS = { month: 'This month', last_month: 'Last month', '3m': 'Last 3 months', year: 'This year' } as const;
export type PeriodKey = keyof typeof PERIODS;

const IST = 330 * 60_000;
/** Midnight IST on the 1st of the month `m` months from `now`'s month (0-based offset). */
function monthStart(now: Date, offset: number): Date {
  const t = new Date(now.getTime() + IST);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset, 1) - IST);
}

export function periodRange(key: PeriodKey, now = new Date()): { from: Date; to: Date; label: string } {
  const t = new Date(now.getTime() + IST);
  switch (key) {
    case 'last_month': return { from: monthStart(now, -1), to: monthStart(now, 0), label: PERIODS.last_month };
    case '3m': return { from: monthStart(now, -2), to: now, label: PERIODS['3m'] };
    case 'year': return { from: new Date(Date.UTC(t.getUTCFullYear(), 0, 1) - IST), to: now, label: PERIODS.year };
    default: return { from: monthStart(now, 0), to: now, label: PERIODS.month };
  }
}

/** The period before, for "vs last period". */
export function previousRange(key: PeriodKey, now = new Date()): { from: Date; to: Date } {
  const t = new Date(now.getTime() + IST);
  switch (key) {
    case 'last_month': return { from: monthStart(now, -2), to: monthStart(now, -1) };
    case '3m': return { from: monthStart(now, -5), to: monthStart(now, -2) };
    case 'year': return { from: new Date(Date.UTC(t.getUTCFullYear() - 1, 0, 1) - IST), to: new Date(Date.UTC(t.getUTCFullYear(), 0, 1) - IST) };
    default: return { from: monthStart(now, -1), to: monthStart(now, 0) };
  }
}

/** [year, month 1-12] of every IST month the range touches. */
export function monthsIn(from: Date, to: Date): [number, number][] {
  const out: [number, number][] = [];
  const a = new Date(from.getTime() + IST), b = new Date(to.getTime() - 1 + IST);
  let y = a.getUTCFullYear(), m = a.getUTCMonth();
  while (y < b.getUTCFullYear() || (y === b.getUTCFullYear() && m <= b.getUTCMonth())) {
    out.push([y, m + 1]);
    m += 1; if (m === 12) { m = 0; y += 1; }
  }
  return out;
}

/** YYYY-MM-DD in IST. */
export const istDay = (d: Date | number) => new Date((typeof d === 'number' ? d : d.getTime()) + IST).toISOString().slice(0, 10);

/**
 * Minutes between two moments that fall inside office hours: 9 am to 7 pm IST,
 * Monday to Saturday. A job raised at 8 pm and assigned at 9:20 next morning took 20.
 */
export function workingMinutes(a: number, b: number, openH = 9, closeH = 19): number {
  if (b <= a) return 0;
  let total = 0;
  const day = 86_400_000;
  let d = Date.UTC(new Date(a + IST).getUTCFullYear(), new Date(a + IST).getUTCMonth(), new Date(a + IST).getUTCDate()) - IST;
  for (; d < b; d += day) {
    if (new Date(d + IST).getUTCDay() === 0) continue;
    const open = d + openH * 3_600_000, close = d + closeH * 3_600_000;
    const s = Math.max(a, open), e = Math.min(b, close);
    if (e > s) total += e - s;
  }
  return total / 60_000;
}
