/**
 * India time for attendance (26 Sep 2026).
 *
 * THE BUG THIS EXISTS FOR. Attendance rules read clock times with
 * `getHours()`, which uses the SERVER's zone. On a laptop in India that is
 * IST and everything looked right; on Vercel the server runs in UTC, so a
 * 09:45 arrival was read as 04:15 - never late - grid start times showed 5h30
 * early, and "today" changed at 05:30 in the morning. Every place that turns a
 * real instant (a clock-in, "now") into a time of day goes through here.
 *
 * India has no daylight saving, so a fixed +05:30 is exact.
 */
const IST_MS = 330 * 60_000;

/** Minutes after midnight, India time. */
export function istMinuteOfDay(d: Date): number {
  const x = new Date(d.getTime() + IST_MS);
  return x.getUTCHours() * 60 + x.getUTCMinutes();
}

/**
 * The India wall-clock reading of an instant, as a Date whose LOCAL getters
 * (getHours, getDate, getDay...) return India time on any server. Use it to
 * feed instants into code that compares against calendar dates built with
 * `new Date(y, m, d)`. Do not store it or send it to the database - it is a
 * reading, not an instant.
 */
export function istWall(d: Date): Date {
  const x = new Date(d.getTime() + IST_MS);
  return new Date(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), x.getUTCHours(), x.getUTCMinutes(), x.getUTCSeconds(), x.getUTCMilliseconds());
}

/** "HH:MM" in India time. */
export function istClock(d: Date): string {
  const m = istMinuteOfDay(d);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The instant India's day `YYYY-MM-DD` begins. */
export function istDayStart(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_MS);
}
