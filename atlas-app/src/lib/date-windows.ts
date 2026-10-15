/**
 * TODAY, THIS WEEK, THIS MONTH - for the phone (Vcare, 8 Oct 2026).
 *
 * Pravin asked for date filters on every page, "daily weekly monthly", on the
 * website AND in the app. The website has `lib/date-ranges`, which knows about
 * financial years, custom ranges and the address bar; the phone needs four
 * buttons and one predicate, and none of the rest.
 *
 * It lives here rather than in the app because this is where the app's shared
 * logic lives (metro resolves `@shared/` to this folder) and, more to the
 * point, because here it can be tested. The app has no test runner, and this
 * is the sort of arithmetic that goes quietly wrong at a month boundary.
 *
 * Everything is in the phone's own local time, deliberately. A technician
 * asking for "today" means the day they are standing in. The server's windows
 * are a separate question and `lib/date-ranges` answers it.
 */
export type DateKey = 'all' | 'today' | 'week' | 'month';

export const DATE_KEYS: DateKey[] = ['all', 'today', 'week', 'month'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Is this timestamp inside the chosen window?
 *
 * TWO THINGS ARE ALWAYS KEPT, and both are deliberate:
 *
 *  - A row with NO date. On these lists a missing date is a visit never
 *    scheduled, a task with no due date, a lead nobody set a follow-up on -
 *    exactly the work somebody opens the screen to find. Dropping it would
 *    make the filter hide the thing it was used to look for.
 *
 *  - A date that will not parse. Rather than guess, the row stays visible;
 *    a technician seeing one row too many is a smaller harm than a job that
 *    vanishes because its timestamp arrived malformed.
 *
 * The week starts on MONDAY, which is how a week is talked about here, so
 * Sunday closes it rather than opening it.
 */
export function inDateRange(iso: string | null | undefined, key: DateKey, now: Date = new Date()): boolean {
  if (key === 'all' || !iso) return true;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return true;

  if (key === 'today') {
    const from = startOfDay(now);
    return t >= from && t < new Date(from.getTime() + 86_400_000);
  }

  if (key === 'week') {
    // Monday as day 0.
    const dow = (now.getDay() + 6) % 7;
    const from = new Date(startOfDay(now).getTime() - dow * 86_400_000);
    return t >= from && t < new Date(from.getTime() + 7 * 86_400_000);
  }

  // Built from the calendar rather than by adding 30 days, so February and
  // a 31-day month are both right.
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return t >= from && t < to;
}
