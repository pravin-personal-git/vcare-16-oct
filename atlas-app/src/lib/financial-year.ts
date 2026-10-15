/**
 * The Indian financial year runs April to March.
 * Every chart, report and document sequence depends on this.
 */

/** India is +05:30 all year (no daylight saving). See the note on financialYearRange. */
const IST_MS = 330 * 60_000;

export function getFinancialYear(date: Date = new Date()): number {
  // Jan-Mar belong to the FY that started the previous April - read on the
  // India calendar, not the server's (UTC on Vercel), so 00:30 on 1 April in
  // India is already the new year.
  const w = new Date(date.getTime() + IST_MS);
  return w.getUTCMonth() < 3 ? w.getUTCFullYear() - 1 : w.getUTCFullYear();
}

export function formatFinancialYear(fy: number): string {
  return `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

/**
 * The range a financial year covers. `fy` is the STARTING calendar year, so
 * 2026 means 1 April 2026 to 31 March 2027 - the same convention
 * `getFinancialYear` returns.
 *
 * Not built from the server's clock: `new Date(fy, 3, 1)` uses the server's
 * zone, so a Vercel function in UTC and a laptop in IST would disagree about
 * where the year starts and the same query would return different totals.
 *
 * INDIA MIDNIGHT, NOT UTC MIDNIGHT (9 Oct 2026). This was UTC midnight, with a
 * note that a document made between 00:00 and 05:30 IST on 1 April landed in
 * the previous year, to be fixed once `Store.timezone` was wired up. Every
 * client is in India and the rest of Atlas now counts India days, so the year
 * runs from 00:00 IST on 1 April to the last millisecond of 31 March IST. If a
 * client outside India ever arrives, this is where Store.timezone goes.
 */
export function financialYearRange(fy: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(fy, 3, 1) - IST_MS),                  // 1 April, 00:00 IST
    end: new Date(Date.UTC(fy + 1, 3, 1) - IST_MS - 1),            // 31 March, 23:59:59.999 IST
  };
}

/** Chart axis order: Apr -> Mar */
export const FY_MONTHS = [
  'Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar',
] as const;
