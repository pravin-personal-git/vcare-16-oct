import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { attendanceMonth } from './attendance';
import { attendancePolicy } from './attendance-policy';
import { isWeeklyOff, DAY_STATUS_LABEL, type DayStatus } from '@/lib/attendance';
import { monthDays, weekdayOf } from '@/lib/attendance-day';
import { classifyLateEarly } from '@/lib/late-early';
import { effectiveDayPolicy } from '@/lib/shift-schedule';
import { getShiftScheduleByUser } from './work-schedules';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * Attendance's remaining extra screens (roadmap §4.3) - Check-in/Check-out
 * Log, Daily Work Status, Late Arrival & Early Departure, Monthly Summary.
 * All deliberately read from the SAME sources the Monthly Grid and payroll
 * already use (`AttendanceDay`/`AttendanceSession`/`attendanceMonth()`),
 * never a second computation of the same fact.
 */

// ------------------------------------------------------- check-in/out log

export interface CheckInOutEventRow {
  id: string;
  userId: string;
  userName: string;
  eventType: 'Check-in' | 'Check-out';
  source: string;
  recordedAt: Date;
  hasLocation: boolean;
}

export async function listCheckInOutLog(
  scope: StoreScope, range: { from: Date; to: Date },
): Promise<CheckInOutEventRow[]> {
  /*
   * Read from the SESSIONS, not the location events (14 Oct 2026, Vcare).
   * A location event is only written when there is a usable GPS fix, so a
   * biometric punch - which never carries one unless the device has a default
   * location - opened a session and left this log empty: the punches were
   * counted on the grid but "nothing" showed here. Every clock-in and
   * clock-out, from any source, opens or closes a session.
   */
  const sessions = await db.attendanceSession.findMany({
    where: {
      ...scopeWhere(scope),
      OR: [
        { startedAt: { gte: range.from, lte: range.to } },
        { endedAt: { gte: range.from, lte: range.to } },
        { correctedEndedAt: { gte: range.from, lte: range.to } },
      ],
    },
    orderBy: { startedAt: 'desc' },
    take: LIST_MAX_ROWS,
    select: {
      id: true, source: true, startedAt: true, endedAt: true, correctedEndedAt: true,
      startLat: true, endLat: true,
      user: { select: { id: true, fullName: true } },
    },
  });

  const inRange = (d: Date) => d >= range.from && d <= range.to;
  const rows: CheckInOutEventRow[] = [];
  for (const s of sessions) {
    if (inRange(s.startedAt)) {
      rows.push({
        id: `${s.id}:in`, userId: s.user.id, userName: s.user.fullName, eventType: 'Check-in',
        source: s.source, recordedAt: s.startedAt, hasLocation: s.startLat != null,
      });
    }
    const end = s.correctedEndedAt ?? s.endedAt;
    if (end && inRange(end)) {
      rows.push({
        id: `${s.id}:out`, userId: s.user.id, userName: s.user.fullName, eventType: 'Check-out',
        source: s.source, recordedAt: end, hasLocation: s.endLat != null,
      });
    }
  }
  return rows.sort((x, y) => y.recordedAt.getTime() - x.recordedAt.getTime()).slice(0, LIST_MAX_ROWS);
}

// ---------------------------------------------------------- daily work status

export interface DailyWorkStatusRow {
  userId: string;
  userName: string;
  status: DayStatus;
  statusLabel: string;
  startedAt: string | null;
  workedMinutes: number | null;
}

/**
 * `workDate` is the India day (`YYYY-MM-DD`). `now` stays the real clock: until
 * 9 Oct 2026 the picked day itself was passed as "now", so an unfinished day's
 * minutes were counted up to midnight UTC rather than to this moment.
 */
export async function dailyWorkStatus(
  scope: StoreScope, workDate: string, now: Date = new Date(),
): Promise<DailyWorkStatusRow[]> {
  const [y, m] = workDate.split('-').map(Number);
  const month = await attendanceMonth(scope, y, m - 1, now);
  const dayIndex = month.dates.indexOf(workDate);
  if (dayIndex < 0) return [];

  return month.rows.map((row) => {
    const day = row.days[dayIndex];
    return {
      userId: row.userId, userName: row.userName,
      status: day.status, statusLabel: DAY_STATUS_LABEL[day.status],
      startedAt: day.startedAt, workedMinutes: day.workedMinutes,
    };
  });
}

// ------------------------------------------------- late arrival / early departure

export interface LateEarlyRow {
  userId: string;
  userName: string;
  workDate: string;
  firstInAt: Date | null;
  lastOutAt: Date | null;
  isLate: boolean;
  lateByMinutes: number;
  isEarlyDeparture: boolean;
  earlyByMinutes: number;
}

export async function lateEarlyReport(scope: StoreScope, year: number, month: number, onlyUserIds: ReadonlySet<string> | null = null): Promise<LateEarlyRow[]> {
  const dates = monthDays(year, month);
  const from = dates[0];
  const to = dates[dates.length - 1];

  const [days, policy] = await Promise.all([
    db.attendanceDay.findMany({
      where: { ...scopeWhere(scope), workDate: { gte: from, lte: to }, ...(onlyUserIds ? { userId: { in: [...onlyUserIds] } } : {}) },
      select: {
        userId: true, workDate: true, firstInAt: true, lastOutAt: true,
        user: { select: { fullName: true } },
      },
      orderBy: { workDate: 'asc' },
    }),
    scope.kind === 'single' ? attendancePolicy(scope.storeId) : null,
  ]);

  if (!policy) return [];

  const scheduleByUser = await getShiftScheduleByUser([...new Set(days.map((d) => d.userId))]);

  const rows: LateEarlyRow[] = [];
  for (const d of days) {
    const effective = effectiveDayPolicy(scheduleByUser.get(d.userId) ?? null, weekdayOf(d.workDate), {
      shiftStart: policy.shiftStart, shiftEnd: policy.shiftEnd, fullDayMinutes: policy.fullDayMinutes,
      isWeeklyOffByDefault: isWeeklyOff(d.workDate, policy.weekOffDays),
    });
    // A day this person's own shift doesn't run at all has no "late" or
    // "early" to report - there was no expected start/end time to compare.
    if (effective.isScheduledOff) continue;

    const result = classifyLateEarly({
      firstInAt: d.firstInAt, lastOutAt: d.lastOutAt,
      shiftStart: effective.shiftStart, shiftEnd: effective.shiftEnd, graceMinutes: policy.graceMinutes,
    });
    if (!result.isLate && !result.isEarlyDeparture) continue;
    rows.push({
      userId: d.userId, userName: d.user.fullName, workDate: d.workDate,
      firstInAt: d.firstInAt, lastOutAt: d.lastOutAt, ...result,
    });
  }
  return rows;
}

// -------------------------------------------------------------- monthly summary

export interface MonthlySummaryRow {
  userId: string;
  userName: string;
  present: number;
  late: number;
  halfDay: number;
  wfh: number;
  leave: number;
  absent: number;
  unmarked: number;
  workingDays: number;
}

export async function monthlySummary(scope: StoreScope, year: number, month: number, onlyUserIds: ReadonlySet<string> | null = null): Promise<MonthlySummaryRow[]> {
  const data = await attendanceMonth(scope, year, month, new Date(), onlyUserIds);
  return data.rows.map((row) => ({
    userId: row.userId, userName: row.userName,
    present: row.totals.present, late: row.totals.late, halfDay: row.totals.halfDay,
    wfh: row.totals.wfh, leave: row.totals.leave, absent: row.totals.absent,
    unmarked: row.totals.unmarked, workingDays: row.totals.workingDays,
  }));
}
