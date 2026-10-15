/**
 * What "a day" means in attendance: an India calendar date, `YYYY-MM-DD`
 * (9 Oct 2026).
 *
 * THE BUG THIS EXISTS FOR. The punches were always filed under the India day
 * (`businessDay()` in attendance-geo), but the screens that read them built
 * their days from the SERVER's clock - and Vercel runs in UTC. So on the live
 * site a day ran from 05:30 to 05:29 India time: the check-in log put a 00:30
 * check-in on the day before, Daily Work Status showed yesterday until 05:30,
 * and leave raised from My Desk was saved a day early.
 *
 * The rule now, everywhere in attendance and in what payroll reads from it:
 *
 * - A day is a `YYYY-MM-DD` string. Never a Date built with `new Date(y, m, d)`
 *   or `new Date("2026-10-01T00:00:00")` - those land on the server's midnight.
 * - A real instant (now, a check-in) becomes a day through `istToday` /
 *   `storedDay`, and a time of day through `istMinuteOfDay` (lib/ist).
 * - Date-only columns (Holiday.date, LeaveRequest.fromDate/toDate) are WRITTEN
 *   at UTC midnight of the day (`toStoredDate`) - what the live site has always
 *   written from the grid and Settings - and READ with `storedDay`, which also
 *   reads a row saved at midnight India time (laptop-made demo data, the old
 *   My Desk leave) as the same day. So no stored row has to be rewritten.
 *
 * Pure, and the same answer on any server zone.
 */
import { istDate, istDayStart } from './date-ranges';

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number) => String(n).padStart(2, '0');
const keyOfUtc = (t: number) => {
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
};
const utcOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** A real calendar day, `YYYY-MM-DD` - 2026-02-31 is not one. */
export function isDayKey(s: unknown): s is string {
  return typeof s === 'string' && DAY_RE.test(s) && keyOfUtc(utcOf(s)) === s;
}

/** Today in India. */
export function istToday(now: Date): string {
  return istDate(now);
}

/** The India year and month (0-11) `now` falls in. */
export function istYearMonth(now: Date): { year: number; month: number } {
  const [y, m] = istDate(now).split('-').map(Number);
  return { year: y, month: m - 1 };
}

/** Every day of a month (month 0-11), in order. */
export function monthDays(year: number, month: number): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(year, month, 1); new Date(t).getUTCMonth() === ((month % 12) + 12) % 12; t += DAY_MS) {
    out.push(keyOfUtc(t));
  }
  return out;
}

/** `key` moved by `n` days (negative goes back). */
export function addDays(key: string, n: number): string {
  return keyOfUtc(utcOf(key) + n * DAY_MS);
}

/** Every day from `from` to `to`, both included. Empty when `to` is before `from`. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = utcOf(from), end = utcOf(to); t <= end; t += DAY_MS) out.push(keyOfUtc(t));
  return out;
}

/** 0 = Sunday ... 6 = Saturday, the same numbering `weekOffDays` uses. */
export function weekdayOf(key: string): number {
  return new Date(utcOf(key)).getUTCDay();
}

/** The day a stored date-only column (Holiday.date, LeaveRequest.fromDate...) means. */
export function storedDay(d: Date): string {
  return istDate(d);
}

/** What to save in a date-only column for `key`: UTC midnight of that day. */
export function toStoredDate(key: string): Date {
  return new Date(utcOf(key));
}

/**
 * Query bounds for date-only columns covering `first`..`last`, catching a row
 * saved either way: UTC midnight, or midnight India time (18:30 UTC the evening
 * before). Exact for those two; anything else saved at an odd hour is sorted out
 * by reading the rows with `storedDay`.
 */
export function storedBounds(first: string, last: string): { gte: Date; lte: Date } {
  return { gte: istDayStart(first)!, lte: new Date(utcOf(last)) };
}

/** Days (inclusive) a stored leave covers, as day keys. */
export function storedDays(from: Date, to: Date): string[] {
  return eachDay(storedDay(from), storedDay(to));
}
