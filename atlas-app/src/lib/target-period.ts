/**
 * Target periods, on the Indian financial year.
 *
 * A target belongs to a period, and the period has to be an explicit start and
 * end rather than "August" - because August 2026 falls in FY 2026-27, and Q1 is
 * April to June, not January to March. Every one of those is a place where a
 * naive calendar assumption quietly produces the wrong number.
 *
 * Pure - no database. The tests run it without one.
 *
 * Spec: 05-sales-orders-invoices.md §3
 */

import {
  financialYearRange, formatFinancialYear, getFinancialYear,
} from './financial-year';

/*
 * INDIA MIDNIGHT (9 Oct 2026). Periods were UTC midnight, so on Vercel a
 * month began at 05:30 India time and an order at 00:30 on the 1st counted to
 * the month before. They start at 00:00 IST now and end at the last
 * millisecond of their last India day - the same convention as
 * financialYearRange. Stored targets were moved to match in migration
 * 20261015010000_user_target_ist_periods; a saved target is found by its
 * exact `periodStart`, so the code and the rows had to move together.
 */
const IST_MS = 330 * 60_000;
const istMidnight = (year: number, monthIndex: number, day: number) =>
  new Date(Date.UTC(year, monthIndex, day) - IST_MS);
/** The India calendar reading of an instant: month 0-11 and year. */
const istCalendar = (d: Date) => {
  const w = new Date(d.getTime() + IST_MS);
  return { year: w.getUTCFullYear(), month: w.getUTCMonth() };
};

export type PeriodType = 'month' | 'quarter' | 'fy';

export interface Period {
  type: PeriodType;
  start: Date;
  end: Date;
  label: string;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Last millisecond of a month, so a range comparison needs no `< nextMonth`. */
function endOfMonth(year: number, monthIndex: number): Date {
  return new Date(istMidnight(year, monthIndex + 1, 1).getTime() - 1);
}

/**
 * A calendar month, labelled with its own year.
 * @param monthIndex 0 = January
 */
export function monthPeriod(year: number, monthIndex: number): Period {
  return {
    type: 'month',
    start: istMidnight(year, monthIndex, 1),
    end: endOfMonth(year, monthIndex),
    label: `${MONTH_NAMES[monthIndex]} ${year}`,
  };
}

/**
 * A financial quarter. Q1 is April–June, NOT January–March.
 *
 * This is the single most common place an Indian reporting bug hides: a
 * `Math.floor(month / 3)` gives calendar quarters and everyone downstream
 * believes them.
 *
 * @param fy the financial year by its STARTING calendar year - 2026 means
 *           FY 2026-27, April 2026 to March 2027. That is the convention
 *           `getFinancialYear` already uses, and mixing the two is how a
 *           report ends up a full year out.
 * @param q  1..4
 */
export function quarterPeriod(fy: number, q: 1 | 2 | 3 | 4): Period {
  const startMonth = (q - 1) * 3 + 3;           // Q1 -> 3 (April)
  const startYear = fy + Math.floor(startMonth / 12);
  const m = startMonth % 12;

  const start = istMidnight(startYear, m, 1);
  const endMonthAbs = startMonth + 2;
  const endYear = fy + Math.floor(endMonthAbs / 12);
  const end = endOfMonth(endYear, endMonthAbs % 12);

  return { type: 'quarter', start, end, label: `Q${q} ${formatFinancialYear(fy)}` };
}

/**
 * The whole financial year, April to March.
 *
 * Delegates to `financialYearRange` rather than repeating the date maths.
 */
export function fyPeriod(fy: number): Period {
  // financialYearRange again: both are India midnight now, so a target year
  // and the dashboard's year are the same instants (see the note at the top).
  const { start, end } = financialYearRange(fy);
  return { type: 'fy', start, end, label: formatFinancialYear(fy) };
}

/**
 * Which financial quarter a date falls in.
 * April–June is Q1, and that is the whole point of this function existing.
 */
export function quarterOf(date: Date): 1 | 2 | 3 | 4 {
  const m = istCalendar(date).month;             // 0 = Jan, India calendar
  const fyMonth = (m + 9) % 12;                  // April -> 0
  return (Math.floor(fyMonth / 3) + 1) as 1 | 2 | 3 | 4;
}

/**
 * Every period a target could be set for, in the given financial year.
 * Twelve months, four quarters, and the year itself - in the order a person
 * would look for them.
 */
export function periodsForFy(fy: number): Period[] {
  const months: Period[] = [];
  for (let i = 0; i < 12; i += 1) {
    const abs = 3 + i;                           // April onwards
    months.push(monthPeriod(fy + Math.floor(abs / 12), abs % 12));
  }

  return [
    fyPeriod(fy),
    ...([1, 2, 3, 4] as const).map((q) => quarterPeriod(fy, q)),
    ...months,
  ];
}

/** The period that contains a date, for a given granularity. */
export function periodContaining(date: Date, type: PeriodType): Period {
  const fy = getFinancialYear(date);
  if (type === 'fy') return fyPeriod(fy);
  if (type === 'quarter') return quarterPeriod(fy, quarterOf(date));
  const { year, month } = istCalendar(date);
  return monthPeriod(year, month);
}

export function isWithin(date: Date, p: { start: Date; end: Date }): boolean {
  return date >= p.start && date <= p.end;
}

/**
 * Incentive earned.
 *
 * Paid on achievement, not on target - you earn on what you sold. Below target
 * still earns; the target is a goal, not a gate, unless a tenant configures
 * slabs later.
 */
export function incentivePaise(achievedPaise: number, pct: number): number {
  if (achievedPaise <= 0 || pct <= 0) return 0;
  return Math.round((achievedPaise * pct) / 100);
}

/** Achievement as a percentage. A zero target is not 100% - it is unset. */
export function achievementPct(achievedPaise: number, targetPaise: number): number | null {
  if (targetPaise <= 0) return null;
  return (achievedPaise / targetPaise) * 100;
}
