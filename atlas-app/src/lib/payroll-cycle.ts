/**
 * Pure date math for a payroll cycle that starts on a fixed day of the
 * month, 1-28.
 *
 * Restricted to 1-28 because every month has that day - a start day of 29,
 * 30 or 31 would silently land on a different date in February from every
 * other month, which is exactly the kind of thing that only surfaces when
 * somebody's February payslip looks wrong.
 */

export const MIN_CYCLE_START_DAY = 1;
export const MAX_CYCLE_START_DAY = 28;

export function isValidCycleStartDay(day: number): boolean {
  return Number.isInteger(day) && day >= MIN_CYCLE_START_DAY && day <= MAX_CYCLE_START_DAY;
}

/** "Standard calendar month, 1st - last day of each month" or "22nd of each month to 21st of the next". */
export function describeCycle(startDay: number): { title: string; detail: string } {
  if (startDay === 1) {
    return { title: 'Standard calendar month', detail: '1st - last day of each month' };
  }
  const ord = ordinal(startDay);
  const prevOrd = ordinal(startDay - 1);
  return { title: `${ord} to ${prevOrd} of the next month`, detail: `${ord} of each month to ${prevOrd} of the next` };
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export interface PayPeriod {
  /** 0 = the period that starts in January of `year`. */
  cycleIndex: number;
  start: Date;
  /** Inclusive. */
  end: Date;
}

/**
 * The twelve pay periods whose START falls in `year` - i.e. the periods a
 * "2026 calendar" view shows, even though the last one runs into January
 * 2027 when `startDay > 1`.
 */
export function payPeriodsForYear(year: number, startDay: number): PayPeriod[] {
  const periods: PayPeriod[] = [];
  for (let m = 0; m < 12; m++) {
    const start = new Date(year, m, startDay);
    const end = new Date(year, m + 1, startDay - 1);
    periods.push({ cycleIndex: m, start, end });
  }
  return periods;
}

/**
 * Which cycle (as a month-offset from January of the date's own year) a
 * given date falls into - used to alternate colour bands on a calendar
 * grid, not as a payroll-period id on its own.
 */
export function cycleIndexForDate(date: Date, startDay: number): number {
  return date.getDate() >= startDay ? date.getMonth() : date.getMonth() - 1;
}
