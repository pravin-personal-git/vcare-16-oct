/**
 * "How long until this runs out, and should somebody be told yet."
 *
 * One rule, two callers: the company's own policies and licences (HRM ->
 * Insurance & Policy) and customer AMC contracts. The roadmap's Phase 4 said
 * to reuse the existing PolicyRenewal reminder rather than build a second one,
 * and this is that reuse - the RULE is shared, the tables are not.
 *
 * Sharing the table would have been wrong: PolicyRenewal is store-scoped with
 * no customer, no amount and no covered equipment, so customer contracts filed
 * in it would appear on the HRM screen next to the office fire insurance with
 * most of their fields missing. Sharing the arithmetic gets the actual benefit
 * - "due" means the same thing in both places, forever - without that.
 *
 * WHY WHOLE DAYS FROM MIDNIGHT
 *
 * A contract expiring today has not expired. If this measured from the current
 * instant, a contract ending 30 September would read as overdue from 00:01 on
 * the 30th onwards for anyone whose expiry timestamp was stored at midnight -
 * telling a technician a customer is uncovered on a day they are still
 * covered, which is the kind of error that gets argued about at a counter.
 * So both sides are floored to local midnight and the result is whole days.
 */

export interface ExpiryWindow {
  expiryDate: Date;
  /** How many days before expiry to start warning. */
  reminderDays: number;
}

export interface ExpiryState {
  /** Whole days from today to expiry. 0 = expires today, negative = expired. */
  daysToExpiry: number;
  /** Inside the reminder window and not yet expired - act now. */
  isDue: boolean;
  /** Past its expiry date. */
  isOverdue: boolean;
}

/*
 * INDIA DAYS, NOT THE SERVER'S (9 Oct 2026). "Local midnight" below used to
 * mean the server's midnight - IST on a laptop in India, but UTC on Vercel,
 * so on the live site a contract or warranty ticked over at 05:30 in the
 * morning India time, and "expires today" read as expired from 05:30 on the
 * previous evening's instant. Every function here now works in India
 * calendar days whatever zone it runs in. India has no daylight saving, so a
 * fixed +05:30 is exact. Same rule as lib/expiry-policy (stock batches) and
 * lib/ist (attendance).
 */
const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Midnight India time, so comparisons are day-to-day rather than instant-to-instant. */
export function startOfDay(d: Date): Date {
  return new Date(Math.floor((d.getTime() + IST_MS) / DAY_MS) * DAY_MS - IST_MS);
}

/** Whole days from `from` to `to`, both floored to midnight first. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

export function expiryState(w: ExpiryWindow, now: Date = new Date()): ExpiryState {
  const daysToExpiry = daysBetween(now, w.expiryDate);
  return {
    daysToExpiry,
    isOverdue: daysToExpiry < 0,
    // Not overdue AND inside the window. A negative reminderDays would
    // otherwise make an expired row read as neither due nor overdue.
    isDue: daysToExpiry >= 0 && daysToExpiry <= Math.max(0, w.reminderDays),
  };
}

/**
 * Add whole months, clamping the day rather than rolling into the next month.
 *
 * JavaScript's `setMonth` rolls over: 31 January plus one month is 3 March,
 * because 31 February does not exist. For a contract or a warranty that is
 * wrong in the one direction that matters - it silently grants two extra days
 * of cover, and on a 24-month warranty sold on the 31st it grants them twice.
 * Clamped to the last day of the target month instead: 31 January + 1 month is
 * 28 February.
 */
export function addMonths(d: Date, months: number): Date {
  // Worked on the India calendar (see the note above startOfDay): shift into
  // India wall-clock time, do the month arithmetic with the UTC getters, which
  // ignore the server's zone, and shift back. The time of day is kept.
  const w = new Date(d.getTime() + IST_MS);
  const targetDay = w.getUTCDate();
  w.setUTCDate(1);
  w.setUTCMonth(w.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth() + 1, 0)).getUTCDate();
  w.setUTCDate(Math.min(targetDay, lastDayOfTargetMonth));
  return new Date(w.getTime() - IST_MS);
}

/** The same instant one India calendar day earlier or later (no daylight saving, so exact). */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}
