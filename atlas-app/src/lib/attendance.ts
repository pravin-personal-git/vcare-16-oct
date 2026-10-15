/**
 * What one day, for one person, actually was.
 *
 * The month grid is a wall of coloured boxes. Every box is a claim about
 * somebody's working day, and the rules that produce it decide whether a
 * manager trusts the wall or ignores it.
 *
 * Pure - no database, no clock of its own. `today` is always passed in, because
 * "is this day in the future" is the difference between an empty cell meaning
 * "did not turn up" and meaning "has not happened yet", and a rule you cannot
 * move the clock on is a rule you cannot test.
 */

import { istMinuteOfDay } from './ist';
import { istToday, weekdayOf } from './attendance-day';

export type DayStatus =
  | 'present'
  | 'late'
  | 'half_day'
  | 'wfh'
  | 'leave'
  | 'holiday'
  | 'weekend'
  | 'absent'
  | 'unmarked'
  | 'future';

export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  present: 'Present',
  late: 'Late',
  half_day: 'Half day',
  wfh: 'Work from home',
  leave: 'On leave',
  holiday: 'Holiday',
  weekend: 'Weekend',
  absent: 'Absent',
  unmarked: 'Not marked',
  future: '',
};

/** One letter for the dense grid, where a word will not fit. */
export const DAY_STATUS_SHORT: Record<DayStatus, string> = {
  present: 'P',
  late: 'L',
  half_day: 'H',
  wfh: 'W',
  leave: 'Lv',
  holiday: 'Ho',
  weekend: '',
  absent: 'A',
  unmarked: '·',
  future: '',
};

export interface DayInput {
  /** The India calendar day being judged, `YYYY-MM-DD`. */
  date: string;
  /** The real instant now. Today and the time of day are read in India time from it. */
  now: Date;
  /** When that person's day started, as a real instant, if they turned up. */
  shiftStartedAt: Date | null;
  /** Minutes worked. Null when a shift was never closed and never corrected. */
  workedMinutes: number | null;
  /** An APPROVED leave/WFH covering this day, if any. */
  leaveKind: 'leave' | 'wfh' | 'half_day' | null;
  isHoliday: boolean;
  isWeeklyOff: boolean;
  /** Minutes past midnight (India) after which arrival counts as late. */
  lateAfterMinute: number;
  /** Below this many minutes, a worked day counts as a half day. */
  halfDayUnderMinutes: number;
  /**
   * The shift is still open (15 Oct 2026). Its minutes so far are not a day's
   * work yet: somebody in at 9:03 read "Half day" at 10:42 while still on shift.
   */
  inProgress?: boolean;
  /**
   * Minutes past midnight after which, on TODAY specifically, no shift and no
   * explanation stops being "not marked yet" and starts being an absence.
   * Null (the default) keeps the existing rule below: today is never absent.
   */
  autoAbsentAfterMinute?: number | null;
}

/**
 * Same calendar day, in the server's local time. Kept for lead-metrics; the
 * attendance code compares India day keys (lib/attendance-day) instead.
 */
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * The one function the whole grid rests on.
 *
 * ORDER MATTERS AND IS NOT ARBITRARY.
 *
 * 1. FUTURE first. A day that has not happened cannot be an absence, and
 *    colouring next Tuesday red would make the grid useless from the 1st.
 *
 * 2. ACTUAL WORK beats every excuse. If somebody worked on a public holiday or
 *    during approved leave, the grid says they worked - because they did, and
 *    because that is exactly the day they will later ask to be paid for.
 *
 * 3. HOLIDAY and WEEKEND before leave. Somebody whose leave spans a Sunday has
 *    not spent a leave day on it, and counting it would quietly bill them for
 *    days they never took.
 *
 * 4. Only then is a blank an absence - and only for a working day in the past
 *    with no explanation at all.
 */
export function dayStatus(i: DayInput): DayStatus {
  // India day keys sort as dates, so a string comparison is a date comparison.
  const today = istToday(i.now);
  if (i.date > today) return 'future';

  // Worked. Rank the QUALITY of the day before anything else can override it.
  if (i.shiftStartedAt) {
    if (!i.inProgress && i.workedMinutes !== null && i.workedMinutes < i.halfDayUnderMinutes) {
      return 'half_day';
    }
    const arrival = istMinuteOfDay(i.shiftStartedAt);
    if (arrival > i.lateAfterMinute) return 'late';
    // Working from home while on an approved WFH is still working from home -
    // the manager wants to see WHERE, not just that hours happened.
    if (i.leaveKind === 'wfh') return 'wfh';
    return 'present';
  }

  if (i.isHoliday) return 'holiday';
  if (i.isWeeklyOff) return 'weekend';

  if (i.leaveKind === 'leave') return 'leave';
  if (i.leaveKind === 'half_day') return 'half_day';
  // Approved WFH with no shift started is not proof of work, but it is not an
  // absence either - the person was authorised to be elsewhere. It shows as
  // WFH and is deliberately NOT counted as a present day.
  if (i.leaveKind === 'wfh') return 'wfh';

  /**
   * TODAY IS NEVER "ABSENT" - UNLESS AUTO-ABSENT SAYS OTHERWISE.
   *
   * At 09:30 nobody has failed to come to work - they might be on the way, or
   * on a site visit, or about to open the app. Marking them absent while the
   * day is still running is how a manager ends up ringing somebody who is
   * standing in a customer's warehouse. Auto-absent is an explicit, opt-in
   * override of that caution: a store can decide "no punch by 11am means
   * absent", and only once that specific clock time has actually passed
   * today - never earlier, never on a past day (which already falls through
   * to 'absent' below regardless).
   */
  if (i.date === today) {
    if (i.autoAbsentAfterMinute != null) {
      if (istMinuteOfDay(i.now) >= i.autoAbsentAfterMinute) return 'absent';
    }
    return 'unmarked';
  }

  return 'absent';
}

/** Counts the summary row shows. */
export interface MonthTotals {
  present: number;
  late: number;
  halfDay: number;
  wfh: number;
  leave: number;
  absent: number;
  unmarked: number;
  /** Days the business was open - the denominator worth comparing against. */
  workingDays: number;
}

export function totalsFor(statuses: DayStatus[]): MonthTotals {
  const t: MonthTotals = {
    present: 0, late: 0, halfDay: 0, wfh: 0,
    leave: 0, absent: 0, unmarked: 0, workingDays: 0,
  };

  for (const s of statuses) {
    if (s === 'future') continue;
    // Holidays and weekends are not working days, so they are excluded from
    // the denominator as well as from every count. "Present 18 of 22" means
    // something; "18 of 30" does not.
    if (s !== 'holiday' && s !== 'weekend') t.workingDays += 1;

    if (s === 'present') t.present += 1;
    else if (s === 'late') t.late += 1;
    else if (s === 'half_day') t.halfDay += 1;
    else if (s === 'wfh') t.wfh += 1;
    else if (s === 'leave') t.leave += 1;
    else if (s === 'absent') t.absent += 1;
    else if (s === 'unmarked') t.unmarked += 1;
  }

  return t;
}

/**
 * Days a person is treated as having worked, for a wage.
 *
 * A half day counts as half. WFH with no recorded shift counts as nothing here
 * - it is authorised, not evidenced, and paying from an authorisation rather
 * than from evidence is a decision for a person, not for this function.
 */
export function payableDays(t: MonthTotals): number {
  return t.present + t.late + t.wfh + t.halfDay * 0.5;
}

/** `09:30` from minutes past midnight. */
export function minuteToClock(m: number): string {
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Minutes past midnight from `09:30`. The inverse of `minuteToClock`. */
export function parseClock(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Minutes worked beyond a full day, once that excess clears the store's own
 * qualifying threshold - below the threshold it is not overtime, it is just
 * staying a bit late, and showing "12m OT" on every third row would make the
 * figure meaningless the first time someone actually worked a real extra
 * shift.
 *
 * `minExtraMinutes` null means overtime is not tracked at all here (the
 * store has not configured a threshold) - returns 0 rather than counting
 * every excess minute as OT nobody asked to see.
 */
export function overtimeMinutes(
  workedMinutes: number | null,
  fullDayMinutes: number,
  minExtraMinutes: number | null,
): number {
  if (workedMinutes === null || minExtraMinutes === null) return 0;
  const extra = workedMinutes - fullDayMinutes;
  return extra >= minExtraMinutes ? extra : 0;
}

/** Sunday only, by default - the common Indian six-day week. `day` is `YYYY-MM-DD`. */
export function isWeeklyOff(day: string, offDays: number[] = [0]): boolean {
  return offDays.includes(weekdayOf(day));
}
