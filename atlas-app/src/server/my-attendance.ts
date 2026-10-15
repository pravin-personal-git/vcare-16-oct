import 'server-only';
import { db } from './db';
import { businessDay } from './presence';
import { monthDays, storedBounds, storedDay, storedDays, weekdayOf } from '@/lib/attendance-day';
import { attendancePolicy, type AttendancePolicyView } from './attendance-policy';

/**
 * ONE PERSON'S OWN ATTENDANCE.
 *
 * Deliberately separate from the manager's grid. The grid answers "who is in
 * today" across a store and only lists people with a paired phone; this answers
 * "what does my record say", for anybody, phone or no phone.
 *
 * REWRITTEN 18 SEP 2026 to read `AttendanceDay` directly. Before this date it
 * read two separate tables (shifts from the field app, presses of the
 * Present button) and folded them by hand with a "the phone wins" rule - the
 * same merge `attendance.ts`'s grid used to do. `AttendanceDay.firstInSource`
 * makes that a fact on the row now, not something this function infers.
 */

export type DaySource = 'phone' | 'web' | 'biometric' | 'manual' | 'holiday' | 'week-off' | 'leave' | 'none';

const SOURCE_LABEL: Record<string, DaySource> = {
  app: 'phone', web: 'web', biometric: 'biometric', manual: 'manual',
};

export interface MyDay {
  /** `YYYY-MM-DD` in the business's zone. */
  date: string;
  source: DaySource;
  /** Local `HH:MM`, when there was a start. */
  startedAt: string | null;
  endedAt: string | null;
  workedMinutes: number | null;
  /** Holiday name, leave kind, or the reason a day is blank. */
  note: string | null;
  /** True when the record is open - started and never finished. */
  unfinished: boolean;
}

export interface MyMonth {
  year: number;
  /** 0-11. */
  month: number;
  days: MyDay[];
  policy: AttendancePolicyView;
  totals: {
    present: number;
    halfDay: number;
    absent: number;
    weekOff: number;
    holiday: number;
    leave: number;
    minutes: number;
  };
}

const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function hhmm(at: Date | null): string | null {
  return at ? TIME_FMT.format(at) : null;
}

export async function myMonth(
  userId: string,
  storeId: string,
  year: number,
  month: number,
  now = new Date(),
): Promise<MyMonth> {
  // India days throughout (lib/attendance-day) - the server runs in UTC.
  const keys = monthDays(year, month);
  const fromDate = keys[0];
  const toDate = keys[keys.length - 1];
  const stored = storedBounds(fromDate, toDate);

  const [attendanceDays, holidays, leaves, policy] = await Promise.all([
    db.attendanceDay.findMany({
      where: { userId, storeId, workDate: { gte: fromDate, lte: toDate } },
      orderBy: { workDate: 'asc' },
    }),
    db.holiday.findMany({
      where: { storeId, date: stored },
      select: { date: true, name: true, kind: true },
    }),
    db.leaveRequest.findMany({
      where: { userId, storeId, status: 'approved', fromDate: { lte: stored.lte }, toDate: { gte: stored.gte } },
      select: { fromDate: true, toDate: true, kind: true },
    }),
    attendancePolicy(storeId),
  ]);

  type HolidayRow = (typeof holidays)[number];
  const holidayOn = new Map<string, HolidayRow>(
    holidays.map((h): [string, HolidayRow] => [storedDay(h.date), h]),
  );

  const leaveOn = new Map<string, string>();
  for (const l of leaves) {
    for (const key of storedDays(l.fromDate, l.toDate)) leaveOn.set(key, l.kind);
  }

  const byDay = new Map(attendanceDays.map((d) => [d.workDate, d]));

  const days: MyDay[] = [];
  const totals = { present: 0, halfDay: 0, absent: 0, weekOff: 0, holiday: 0, leave: 0, minutes: 0 };
  const today = businessDay(now);

  for (const key of keys) {
    const worked = byDay.get(key);

    if (worked) {
      const open = worked.status === 'in_progress';
      // An open day's minutes are "so far", computed live rather than read
      // from the stored (necessarily stale) figure - same reasoning as
      // workedMinutes() in lib/shift.ts treating an open shift's duration as
      // the one place "now" is the honest answer.
      const minutes = open && worked.firstInAt
        ? Math.max(0, Math.round((now.getTime() - worked.firstInAt.getTime()) / 60_000))
        : (worked.workedMinutes ?? 0);

      days.push({
        date: key,
        source: SOURCE_LABEL[worked.firstInSource ?? ''] ?? 'none',
        startedAt: hhmm(worked.firstInAt),
        endedAt: hhmm(worked.lastOutAt),
        workedMinutes: minutes,
        note: null,
        unfinished: open,
      });
      totals.minutes += minutes;
      if (minutes >= policy.fullDayMinutes) totals.present += 1;
      else if (minutes >= policy.halfDayMinutes) totals.halfDay += 1;
      else if (!open) totals.absent += 1;
      else totals.present += 1; // still going; not an absence yet
      continue;
    }

    const holiday = holidayOn.get(key);
    if (holiday) {
      days.push({ date: key, source: 'holiday', startedAt: null, endedAt: null, workedMinutes: null, note: holiday.name, unfinished: false });
      totals.holiday += 1;
      continue;
    }

    const leave = leaveOn.get(key);
    if (leave) {
      days.push({ date: key, source: 'leave', startedAt: null, endedAt: null, workedMinutes: null, note: leave, unfinished: false });
      totals.leave += 1;
      continue;
    }

    if (policy.weekOffDays.includes(weekdayOf(key))) {
      days.push({ date: key, source: 'week-off', startedAt: null, endedAt: null, workedMinutes: null, note: null, unfinished: false });
      totals.weekOff += 1;
      continue;
    }

    /*
      A FUTURE DAY IS NOT AN ABSENCE.

      Counting the rest of the month as absent would tell somebody on the first
      of the month that they had missed thirty days, which is both wrong and
      the kind of wrong that generates a support call.
    */
    const isFuture = key > today;
    days.push({
      date: key,
      source: 'none',
      startedAt: null,
      endedAt: null,
      workedMinutes: null,
      note: isFuture ? null : 'Nothing recorded',
      unfinished: false,
    });
    if (!isFuture) totals.absent += 1;
  }

  return { year, month, days, policy, totals };
}
