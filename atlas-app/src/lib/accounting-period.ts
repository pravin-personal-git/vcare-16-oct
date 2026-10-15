/**
 * THE TWELVE MONTHS OF A FINANCIAL YEAR (3 Oct 2026).
 *
 * April to March (CLAUDE.md, decision 8). Pure, so the window arithmetic is
 * tested without a database - and because the screen needs the labels and
 * `server/*.ts` is server-only.
 *
 * WHY THESE ARE DERIVED AND NOT STORED. There is nothing a person could usefully
 * configure about when April starts. Twelve rows per branch per year would mean a
 * migration, a backfill for every past year, and a screen asking somebody to
 * "set up periods" before they can use a lock they did not ask for. A row exists
 * only once a month has actually been closed; no row means open.
 */

/** Indexed as the financial year runs, so index 0 is April. */
export const FY_MONTHS = [
  'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March',
] as const;

export interface PeriodMonth {
  /** 0 = April, 11 = March. */
  monthIndex: number;
  /** "April 2026", "January 2027" - the calendar year, which differs after Dec. */
  label: string;
  startDate: Date;
  /** Inclusive, and the last instant of the month - see below. */
  endDate: Date;
}

/**
 * The window for one month of a financial year.
 *
 * `endDate` is 23:59:59.999 on the last day, not midnight on the 1st of the
 * next month. The lock query is `startDate <= date && endDate >= date`, so a
 * midnight end would leave everything after 00:00 on the 31st postable into a
 * month somebody had closed - a whole day's hole in the one guarantee this
 * feature exists to give.
 *
 * Built with `Date.UTC` and read in UTC throughout, matching how
 * `getFinancialYear` and every stored `entryDate` already work. Not IST: a month
 * boundary is a calendar fact about the books, not a clock reading, and the
 * server stores dates in UTC.
 */
export function monthWindow(financialYear: number, monthIndex: number): PeriodMonth {
  const i = Math.max(0, Math.min(11, Math.trunc(monthIndex)));
  // April is calendar month 3. Indexes 9-11 (Jan-Mar) fall in the NEXT calendar
  // year, which is the thing an off-by-one here would get wrong silently.
  const calendarMonth = (3 + i) % 12;
  const calendarYear = financialYear + (3 + i >= 12 ? 1 : 0);

  const startDate = new Date(Date.UTC(calendarYear, calendarMonth, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(calendarYear, calendarMonth + 1, 0, 23, 59, 59, 999));

  return {
    monthIndex: i,
    label: `${FY_MONTHS[i]} ${calendarYear}`,
    startDate,
    endDate,
  };
}

/** Which month of which financial year a date falls in. */
export function monthOf(date: Date): { financialYear: number; monthIndex: number } {
  const m = date.getUTCMonth();
  const y = date.getUTCFullYear();
  // Jan-Mar belong to the financial year that started the previous April.
  const financialYear = m >= 3 ? y : y - 1;
  const monthIndex = m >= 3 ? m - 3 : m + 9;
  return { financialYear, monthIndex };
}
