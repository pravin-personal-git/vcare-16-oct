import 'server-only';
import { istClock } from '@/lib/ist';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { CallLogError } from './call-log-error';
import {
  dayStatus, isWeeklyOff, parseClock, totalsFor,
  type DayStatus, type MonthTotals,
} from '@/lib/attendance';
import {
  eachDay, isDayKey, istToday, monthDays, storedBounds, storedDay, toStoredDate, weekdayOf,
} from '@/lib/attendance-day';
import { attendancePolicy, POLICY_DEFAULTS } from './attendance-policy';
import { raiseApproval, openApprovalRequest, decideApprovalStep, HierarchyError } from './hierarchy';
import { assertLeaveNotRestricted } from './leave-types';
import { getShiftScheduleByUser } from './work-schedules';
import { effectiveDayPolicy } from '@/lib/shift-schedule';
import { autoCloseStaleInScope } from './shifts';

/**
 * The month attendance grid.
 *
 * Built from three sources: `AttendanceDay` (one row per person per day,
 * unified across web/app/biometric since 18 Sep 2026 - see the model comment
 * in schema.prisma), leave approved by a manager, and the store's holiday
 * list. `dayStatus` in `lib/attendance.ts` is the only place the precedence
 * between those three is decided.
 *
 * REWRITTEN 18 SEP 2026. Before this date, a day's attendance came from
 * whichever of two separate tables (`Shift`, `WebPresence`) happened to have
 * a row, merged here with a hard-coded "the phone wins" rule - because
 * neither table recorded which source it was, that rule was the only way to
 * pick when both existed. `AttendanceDay.firstInSource` makes that an actual
 * fact on the row instead of an inferred precedence, and is what the grid's
 * Source indicator reads.
 *
 * WHY THE WHOLE MONTH IS COMPUTED IN ONE PASS
 *
 * Thirty days times thirty staff is nine hundred cells. Asking the database per
 * cell would be nine hundred round trips on a pooled connection that allows one
 * query at a time - the page would take minutes. Three queries come back, and
 * the grid is assembled in memory.
 */


export interface GridRow {
  userId: string;
  userName: string;
  departmentName: string | null;
  /** One entry per day of the month, in order. */
  days: {
    date: string;
    status: DayStatus;
    /** Local `HH:MM`, when there was a shift. */
    startedAt: string | null;
    workedMinutes: number | null;
    /** Where the day's first clock-in came from. Null when unmarked. */
    source: 'app' | 'web' | 'biometric' | 'manual' | null;
  }[];
  totals: MonthTotals;
}

export interface AttendanceMonth {
  year: number;
  /** 0-11. */
  month: number;
  dates: string[];
  rows: GridRow[];
  holidays: { date: string; name: string; kind: string }[];
  /** Counts for the summary cards, for TODAY specifically. */
  today: {
    present: number;
    late: number;
    onLeave: number;
    wfh: number;
    unmarked: number;
    halfDay: number;
  };
  /** False when browsing a past or future month - the cards are hidden then. */
  isCurrentMonth: boolean;
  pendingRequests: number;
}

export async function attendanceMonth(
  scope: StoreScope,
  year: number,
  month: number,
  now = new Date(),
  /** Only these people (B4 step 4, server/people-reach) - before the today counts, so the cards agree. Null = everyone. */
  onlyUserIds: ReadonlySet<string> | null = null,
): Promise<AttendanceMonth> {
  // Forgotten shifts closed first - an open 45-hour shift made the dashboard
  // count someone present who had not clocked in today (27 Sep 2026).
  await autoCloseStaleInScope(scope);
  // Every day below is an India day key (lib/attendance-day) - the server runs
  // in UTC, and a day built from its clock ran 05:30 to 05:29 India time.
  const dates = monthDays(year, month);
  const first = dates[0];
  const last = dates[dates.length - 1];
  // Wide enough for a holiday/leave saved at UTC midnight or at India midnight;
  // the exact days are picked out by `storedDay` below.
  const stored = storedBounds(first, last);
  const todayKey = istToday(now);

  /**
   * THE STORE'S OWN RULES, NOT A HARD-CODED GUESS.
   *
   * Until 18 Sep 2026 this function used fixed 10:00/4h constants regardless
   * of what `/settings/attendance` actually had saved - an admin could change
   * Grace from 10 to 30 minutes and the grid would not move. `'all'` scope
   * has no single store's rules to apply, so it falls back to the same
   * defaults a store that has never configured anything gets.
   */
  const policy = scope.kind === 'single'
    ? await attendancePolicy(scope.storeId)
    : { ...POLICY_DEFAULTS, isConfigured: false, updatedAt: null };

  /**
   * WHO APPEARS ON THE GRID: STAFF WITH A PAIRED PHONE, OR WHO PRESSED PRESENT.
   *
   * Originally the paired phone alone, on the reasoning that somebody with no
   * device cannot start a shift and every one of their days would read "absent"
   * for ever. A grid that permanently accuses half the company is a grid nobody
   * opens twice.
   *
   * That reasoning still holds, and the Present button gave it a second half.
   * A manager who marks themselves present from the browser now HAS attendance,
   * so leaving them off the grid would hide a record that exists - and the
   * person who pressed the button would reasonably conclude it did nothing.
   *
   * Anyone with neither is still absent from the grid, which remains correct:
   * nothing is being recorded about them at all.
   */
  const devices = await db.callSyncDevice.findMany({
    where: { ...scopeWhere(scope), isActive: true },
    select: {
      userId: true,
      user: { select: { fullName: true, department: { select: { name: true } } } },
    },
    distinct: ['userId'],
  });

  const [days, leaves, holidays, pendingRequests] = await db.$transaction([
    // The one unified source, 18 Sep 2026 onward - one row per person per
    // day, regardless of whether it came from the phone, the web button, or
    // (in future) a biometric device. `firstInSource` is the fact the old
    // "phone wins" merge used to have to infer from which of two separate
    // tables had a row.
    db.attendanceDay.findMany({
      where: {
        ...scopeWhere(scope),
        // workDate is a `YYYY-MM-DD` string, which sorts identically to a
        // real date range - matched against the same local date keys the
        // day cells themselves are keyed by, below.
        workDate: { gte: first, lte: last },
      },
      select: {
        userId: true, workDate: true, firstInAt: true, firstInSource: true,
        workedMinutes: true, status: true,
        user: { select: { fullName: true, department: { select: { name: true } } } },
      },
      orderBy: { workDate: 'asc' },
    }),

    // Overlap, not containment: a leave from 28 Aug to 3 Sep touches this month
    // even though neither of its dates is inside it.
    db.leaveRequest.findMany({
      where: {
        ...scopeWhere(scope),
        status: 'approved',
        fromDate: { lte: stored.lte },
        toDate: { gte: stored.gte },
      },
      select: { userId: true, kind: true, fromDate: true, toDate: true },
    }),

    db.holiday.findMany({
      where: { ...scopeWhere(scope), date: stored },
      select: { date: true, name: true, kind: true },
      orderBy: { date: 'asc' },
    }),

    db.leaveRequest.count({ where: { ...scopeWhere(scope), status: 'pending' } }),
  ]);

  // Index by user and day so the grid assembly is a lookup, not a scan.
  // Keyed on `workDate` (the business-zone day the row already carries)
  // rather than the server's calendar day - the source of the "usual start
  // 18:11" class of bug this codebase has hit before.
  const dayBy = new Map<string, typeof days[number]>();
  for (const d of days) dayBy.set(`${d.userId}|${d.workDate}`, d);

  /*
    Everyone with a phone, plus everyone with an AttendanceDay this month.

    Keyed by user id so somebody who has both - a manager who carries a
    handset and also clicks the button - appears once rather than twice.
  */
  const participants = new Map<string, { userId: string; fullName: string; departmentName: string | null }>();
  for (const dev of devices) {
    participants.set(dev.userId, {
      userId: dev.userId,
      fullName: dev.user.fullName,
      departmentName: dev.user.department?.name ?? null,
    });
  }
  for (const d of days) {
    if (participants.has(d.userId)) continue;
    participants.set(d.userId, {
      userId: d.userId,
      fullName: d.user.fullName,
      departmentName: d.user.department?.name ?? null,
    });
  }

  const monthHolidays = holidays
    .map((h) => ({ ...h, day: storedDay(h.date) }))
    .filter((h) => h.day >= first && h.day <= last);
  const holidayDates = new Set(monthHolidays.map((h) => h.day));
  const leaveDays = leaves.map((l) => ({ ...l, from: storedDay(l.fromDate), to: storedDay(l.toDate) }));

  // Each participant's own assigned shift, if they have one - see
  // `lib/shift-schedule.ts`'s `effectiveDayPolicy` for how this overrides
  // the store default below.
  const scheduleByUser = await getShiftScheduleByUser([...participants.keys()]);

  const rows: GridRow[] = [...participants.values()]
    .filter((dev) => !onlyUserIds || onlyUserIds.has(dev.userId))
    .map((dev) => {
        const days = dates.map((workDate) => {
          const day = dayBy.get(`${dev.userId}|${workDate}`) ?? null;

          const leave = leaveDays.find((l) =>
            l.userId === dev.userId && workDate >= l.from && workDate <= l.to);

          const mins = day?.status === 'in_progress' && day.firstInAt
            ? Math.max(0, Math.round((now.getTime() - day.firstInAt.getTime()) / 60_000))
            : (day?.workedMinutes ?? null);

          const arrivedAt = day?.firstInAt ?? null;

          const effective = effectiveDayPolicy(scheduleByUser.get(dev.userId) ?? null, weekdayOf(workDate), {
            shiftStart: policy.shiftStart, shiftEnd: policy.shiftEnd, fullDayMinutes: policy.fullDayMinutes,
            isWeeklyOffByDefault: isWeeklyOff(workDate, policy.weekOffDays),
          });

          return {
            date: workDate,
            status: dayStatus({
              date: workDate,
              now,
              shiftStartedAt: arrivedAt,
              workedMinutes: mins,
              leaveKind: (leave?.kind as 'leave' | 'wfh' | 'half_day') ?? null,
              isHoliday: holidayDates.has(workDate),
              isWeeklyOff: effective.isScheduledOff,
              lateAfterMinute: parseClock(effective.shiftStart) + policy.graceMinutes,
              halfDayUnderMinutes: policy.halfDayMinutes,
              inProgress: day?.status === 'in_progress',
              autoAbsentAfterMinute: policy.autoAbsentAfterMinute,
            }),
            startedAt: arrivedAt ? istClock(arrivedAt) : null,
            workedMinutes: mins,
            source: (day?.firstInSource as 'app' | 'web' | 'biometric' | 'manual' | null) ?? null,
          };
        });

      return {
        userId: dev.userId,
        userName: dev.fullName,
        departmentName: dev.departmentName,
        days,
        totals: totalsFor(days.map((d) => d.status)),
      };
    })
    .sort((a, b) => a.userName.localeCompare(b.userName));

  /**
   * The summary cards, for TODAY only.
   *
   * Zero across the board when the user is looking at another month - the
   * cards say "today", and showing September's figures while browsing July
   * would be a quiet lie. The screen hides them rather than showing zeros.
   */
  const todayIndex = dates.indexOf(todayKey);
  const today = { present: 0, late: 0, onLeave: 0, wfh: 0, unmarked: 0, halfDay: 0 };

  if (todayIndex >= 0) {
    for (const row of rows) {
      switch (row.days[todayIndex]?.status) {
        case 'present': today.present += 1; break;
        case 'late': today.late += 1; break;
        case 'leave': today.onLeave += 1; break;
        case 'wfh': today.wfh += 1; break;
        case 'half_day': today.halfDay += 1; break;
        case 'unmarked': today.unmarked += 1; break;
        default: break;
      }
    }
  }

  return {
    year,
    month,
    dates,
    rows,
    holidays: monthHolidays.map((h) => ({
      date: h.day,
      name: h.name,
      kind: h.kind,
    })),
    today,
    /** False when browsing a month that is not the current one. */
    isCurrentMonth: todayIndex >= 0,
    pendingRequests,
  };
}


// ------------------------------------------------------------ leave requests

export interface LeaveRow {
  id: string;
  userId: string;
  userName: string;
  kind: string;
  leaveTypeCode: string | null;
  fromDate: Date;
  toDate: Date;
  reason: string | null;
  status: string;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
}

export async function listLeaveRequests(
  scope: StoreScope,
  opts: { status?: string; take?: number } = {},
): Promise<LeaveRow[]> {
  const rows = await db.leaveRequest.findMany({
    where: {
      ...scopeWhere(scope),
      ...(opts.status ? { status: opts.status } : {}),
    },
    select: {
      id: true, userId: true, kind: true, fromDate: true, toDate: true,
      reason: true, status: true, decidedAt: true, decisionNote: true, createdAt: true,
      user: { select: { fullName: true } },
      leaveType: { select: { code: true } },
    },
    // Pending first, then newest - the thing needing a decision is the reason
    // somebody opened this list.
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: opts.take ?? 200,
  });

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userName: r.user.fullName,
    kind: r.kind,
    leaveTypeCode: r.leaveType?.code ?? null,
    fromDate: r.fromDate,
    toDate: r.toDate,
    reason: r.reason,
    status: r.status,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
  }));
}

export async function createLeaveRequest(
  scope: StoreScope,
  input: {
    userId: string;
    kind: 'leave' | 'wfh' | 'half_day';
    /** Only meaningful for kind='leave' - which quota this draws from once approved. */
    leaveTypeId?: string | null;
    /**
     * India days, `YYYY-MM-DD` - not Dates. Until 9 Oct 2026 this took a Date
     * and rounded it to the SERVER's midnight; My Desk sent midnight India
     * time, which is the evening before in UTC, so every leave raised there on
     * the live site was saved a day early.
     */
    fromDate: string;
    toDate: string;
    reason?: string | null;
  },
): Promise<void> {
  const storeId = scopeForWrite(scope);

  if (!isDayKey(input.fromDate) || !isDayKey(input.toDate)) {
    throw new CallLogError('Choose the first and last day.');
  }
  if (input.toDate < input.fromDate) {
    throw new CallLogError('The last day cannot be before the first day.');
  }
  const fromDate = toStoredDate(input.fromDate);
  const toDate = toStoredDate(input.toDate);

  // A year is not a leave request, it is a typo - almost always a wrong year in
  // a date picker. Refused before it reaches the grid and colours 365 cells.
  const days = eachDay(input.fromDate, input.toDate).length;
  if (days > 90) {
    throw new CallLogError(`That is ${days} days. Check the dates.`);
  }

  // wfh/half_day never draw from a typed quota - only a plain 'leave' does,
  // and only when this store has actually configured the type.
  const leaveTypeId = input.kind === 'leave' && input.leaveTypeId ? input.leaveTypeId : null;
  if (leaveTypeId) {
    const type = await db.leaveType.findFirst({ where: { id: leaveTypeId, storeId, isActive: true } });
    if (!type) throw new CallLogError('That leave type is not in your scope.');
  }

  try {
    await assertLeaveNotRestricted(scope, {
      userId: input.userId, leaveTypeId, fromDate, toDate,
    });
  } catch (e) {
    throw new CallLogError(e instanceof Error ? e.message : 'These dates are restricted.');
  }

  const request = await db.leaveRequest.create({
    data: {
      storeId,
      userId: input.userId,
      kind: input.kind,
      leaveTypeId,
      fromDate,
      toDate,
      reason: input.reason?.trim() || null,
      status: 'pending',
    },
  });

  // 'leave' covers a plain leave request and a half-day; only 'wfh' gets its
  // own, separately configurable chain - see the note on APPROVAL_ENTITIES.
  // A store with no chain configured for this type gets `null` back and
  // nothing else happens - the row already starts 'pending', exactly as it
  // did before the approval engine could do anything with it.
  await raiseApproval(scope, input.kind === 'wfh' ? 'wfh' : 'leave', request.id, input.userId);
}

/**
 * Decide a leave/WFH request.
 *
 * TWO PATHS, DEPENDING ON WHETHER THIS STORE HAS CONFIGURED A CHAIN.
 *
 * If `createLeaveRequest` found a chain for this entity type, a real
 * `ApprovalRequest` has been walking alongside this row since it was
 * raised, and deciding it means stepping THAT forward - `decideApprovalStep`
 * checks the decider holds the role the current level requires, which is a
 * stricter gate than the blanket `attendance.edit` this function's callers
 * already check. `LeaveRequest.status` is only written once the chain
 * reaches a FINAL answer, not on an intermediate level.
 *
 * If no chain was found (the common case today - most stores have not
 * configured one for 'leave'/'wfh'), this falls straight through to the
 * single-step update that is all this function has ever done. Nobody who
 * could decide leave yesterday loses that ability today.
 */
export async function decideLeaveRequest(
  scope: StoreScope,
  requestId: string,
  decision: 'approved' | 'rejected',
  userId: string,
  note?: string | null,
): Promise<void> {
  const existing = await db.leaveRequest.findFirst({
    where: { id: requestId, ...scopeWhere(scope) },
    select: { id: true, status: true, kind: true },
  });
  if (!existing) throw new CallLogError('Request not found in your scope.');

  // Deciding twice is almost always two managers looking at the same list.
  // Refusing tells the second one what happened rather than silently
  // overwriting the first one's decision.
  if (existing.status !== 'pending') {
    throw new CallLogError(`That request was already ${existing.status}.`);
  }

  const entityType = existing.kind === 'wfh' ? 'wfh' : 'leave';
  const openRequest = await openApprovalRequest(scope, entityType, existing.id);

  if (openRequest) {
    let step;
    try {
      step = await decideApprovalStep(scope, openRequest.id, decision, userId, note?.trim() || null);
    } catch (e) {
      if (e instanceof HierarchyError) throw new CallLogError(e.message);
      throw e;
    }
    if (step.final === null) return; // moved to the next level; LeaveRequest itself stays 'pending'

    await db.leaveRequest.update({
      where: { id: existing.id },
      data: {
        status: step.final === 'APPROVED' ? 'approved' : 'rejected',
        decidedBy: userId,
        decidedAt: new Date(),
        decisionNote: step.overrideNote
          ? [step.overrideNote, note?.trim()].filter(Boolean).join('. ')
          : note?.trim() || null,
      },
    });
    return;
  }

  await db.leaveRequest.update({
    where: { id: existing.id },
    data: {
      status: decision,
      decidedBy: userId,
      decidedAt: new Date(),
      decisionNote: note?.trim() || null,
    },
  });
}

// ---------------------------------------------------------------- holidays

export async function listHolidays(scope: StoreScope, year: number) {
  return db.holiday.findMany({
    where: {
      ...scopeWhere(scope),
      // Catches a day saved at UTC midnight or at India midnight (lib/attendance-day).
      date: storedBounds(`${year}-01-01`, `${year}-12-31`),
    },
    select: { id: true, date: true, name: true, kind: true },
    orderBy: { date: 'asc' },
  });
}

export async function addHoliday(
  scope: StoreScope,
  /** The India day, `YYYY-MM-DD`. */
  day: string,
  name: string,
  kind: string,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!name.trim()) throw new CallLogError('Give the holiday a name.');
  if (!isDayKey(day)) throw new CallLogError('Pick the date.');

  await db.holiday.create({
    data: { storeId, date: toStoredDate(day), name: name.trim(), kind, createdBy: userId },
  }).catch((e: unknown) => {
    // The unique index is on (store, date, name) - adding the same holiday
    // twice is a double click, not something to shout about.
    if (typeof e === 'object' && e && 'code' in e && e.code === 'P2002') return;
    throw e;
  });
}

export async function removeHoliday(
  scope: StoreScope, id: string, userId: string | null = null,
): Promise<void> {
  // Tombstoned, not removed (3 Oct 2026). A holiday that resurrects marks a day
  // as not-worked that people were paid for.
  const deleted = await db.holiday.updateMany({
    where: { id, ...scopeWhere(scope), deletedAt: null },
    data: { deletedAt: new Date(), deletedBy: userId },
  });
  if (deleted.count === 0) throw new CallLogError('Holiday not found in your scope.');
}
