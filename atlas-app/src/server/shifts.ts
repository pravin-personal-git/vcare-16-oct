import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { CallLogError } from './call-log-error';
// TYPE-ONLY, deliberately. `call-logs.ts` imports functions from this file, so a
// value import back would be a runtime cycle. `import type` is erased.
import type { AuthedDevice } from './call-logs';
import {
  SHIFT_MAX_HOURS,
  covers,
  isUsableFix,
  metresBetween,
  minutesPastMidnight,
  shiftForCall,
  validateCorrection,
  workedMinutes,
  type Fix,
  type ShiftWindow,
} from '@/lib/shift';
import { businessDay, clockIn as geoClockIn } from './attendance-geo';
import { attendancePolicy, POLICY_DEFAULTS } from './attendance-policy';
import { overtimeMinutes as computeOvertimeMinutes } from '@/lib/attendance';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * Shifts and location, server side - now backed by `AttendanceSession`/
 * `AttendanceEvent`, unified 18 Sep 2026 with the web/app attendance system
 * (see the model comments in schema.prisma and server/attendance-geo.ts).
 *
 * Everything a phone can do lives here and is authenticated by a device token,
 * never a session cookie - same as `call-logs.ts`, and for the same reason:
 * this runs unattended on a handset for months and there is nobody to log in
 * again. The store comes out of the device, so there is no scope to be passed
 * in and none to forget.
 *
 * The manager-facing reads are the other half, and those DO take a `StoreScope`
 * like every other read in the product.
 *
 * Exported function names and shapes are unchanged from before the
 * unification, on purpose - `app/api/call-logs/shift/route.ts` (the Android
 * app's contract) calls these exactly as it always did and needed zero
 * changes for any of this.
 */

const HOUR_MS = 3_600_000;

// ------------------------------------------------------------ phone side

export interface ShiftState {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  autoClosed: boolean;
}

/**
 * The device's currently open shift, if any.
 *
 * Closes anything overdue first, so a phone that was switched off for two days
 * is told the truth - "you have no open shift" - rather than being handed a
 * stale one it would then append today's calls to.
 */
export async function currentShift(device: AuthedDevice): Promise<ShiftState | null> {
  await autoCloseOverdue(device.id);

  const open = await db.attendanceSession.findFirst({
    // `storeId` is redundant next to `deviceId` - a device belongs to exactly
    // one store, so this can never change the result. It is here because the
    // coverage test cannot see that, and the alternative was an exemption.
    // For staff location data, a free predicate beats an exemption.
    where: { storeId: device.storeId, deviceId: device.id, endedAt: null },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true, endedAt: true, autoClosed: true },
  });

  return open;
}

/**
 * Close any shift this device left open past the ceiling.
 *
 * WHY THIS RUNS ON EVERY CHECK-IN RATHER THAN ON A CRON.
 *
 * There is no scheduler in this deployment - Vercel's cron would work but is
 * one more thing to configure, monitor and forget. Every phone contacts the
 * server at least every fifteen minutes while it is alive, and a phone that is
 * NOT contacting us has no calls to misfile anyway, so the lazy path covers
 * every case that matters.
 *
 * The consequence to know: a shift left open by a phone that is then switched
 * off forever stays open in the database until that phone comes back. The
 * manager's screen handles this by treating an overdue shift as overdue on
 * read, so it never *displays* as still running.
 */
export async function autoCloseOverdue(deviceId: string): Promise<number> {
  return closeStale({ deviceId });
}

/**
 * The same close, for every shift in scope - whatever started it (27 Sep 2026).
 *
 * The lazy per-phone path above never reaches a shift started with the
 * website's Present button, or one from a phone that has gone quiet: live
 * showed shifts "On shift" for 43, 45 and 121 hours, and the dashboard
 * counting one of them as present. Every screen that reads shifts (Shift Log,
 * Team Today, the monthly grid and the dashboards built on it) now closes
 * the overdue ones first, with the same ceiling and the same "Not ended" flag.
 */
export async function autoCloseStaleInScope(scope: StoreScope): Promise<number> {
  return closeStale(scopeWhere(scope));
}

async function closeStale(where: { deviceId?: string; storeId?: string | { in: string[] } }): Promise<number> {
  const cutoff = new Date(Date.now() - SHIFT_MAX_HOURS * HOUR_MS);

  const stale = await db.attendanceSession.findMany({
    where: { ...where, endedAt: null, startedAt: { lt: cutoff } },
    select: { id: true, startedAt: true, storeId: true, attendanceDayId: true },
  });
  if (stale.length === 0) return 0;

  await db.$transaction([
    ...stale.map((s) =>
      db.attendanceSession.update({
        where: { id: s.id },
        data: {
          // The ceiling, not `now`. Using now would silently credit the
          // employee for every hour their phone was switched off, and would
          // make two identical forgotten shifts get different durations
          // depending on when someone happened to look.
          endedAt: new Date(s.startedAt.getTime() + SHIFT_MAX_HOURS * HOUR_MS),
          autoClosed: true,
        },
      }),
    ),
    // An auto-closed session is NOT attendance evidence - the day it belongs
    // to must not silently read "completed" with a plausible worked-minutes
    // figure. Left as 'in_progress' (a question, not an answer) until either
    // a manager corrects it or another session that day genuinely closes.
    ...stale.map((s) =>
      db.attendanceDay.updateMany({
        where: { id: s.attendanceDayId, status: 'in_progress' },
        data: { lastOutAt: null },
      }),
    ),
  ]);

  return stale.length;
}

export interface StartShiftResult {
  shift: ShiftState;
  /** True when we closed a forgotten one to make room. Shown on the phone. */
  closedPrevious: boolean;
}

export async function startShift(
  device: AuthedDevice,
  fix: Fix | null,
): Promise<StartShiftResult> {
  const closed = await autoCloseOverdue(device.id);

  const existing = await db.attendanceSession.findFirst({
    where: { storeId: device.storeId, deviceId: device.id, endedAt: null },
    select: { id: true, startedAt: true, endedAt: true, autoClosed: true },
  });

  // Not an error. The phone may retry a request whose response was lost on a
  // bad connection, and a second tap must not produce a second shift - or
  // worse, an error the employee reads as "clock-in failed" when they are
  // already clocked in.
  // Only TODAY's open shift is handed back (15 Oct 2026). One left open from
  // an earlier day is closed by the clock-in below instead of being reused.
  if (existing && businessDay(existing.startedAt) === businessDay()) return { shift: existing, closedPrevious: closed > 0 };

  // Delegates to the same clockIn every source goes through - this is the
  // web/app sync mechanism. If the employee already clocked in from the web
  // today, this returns that same open session rather than opening a second
  // one; otherwise it opens a fresh one, source='app', with this device
  // attached (which is what makes it phone evidence rather than web evidence).
  const result = await geoClockIn(
    { userId: device.userId, storeId: device.storeId, source: 'app', deviceId: device.id },
    { fix: fix && isUsableFix(fix) ? fix : null },
  );

  const shift = await db.attendanceSession.findUniqueOrThrow({
    where: { id: result.sessionId },
    select: { id: true, startedAt: true, endedAt: true, autoClosed: true },
  });

  return { shift, closedPrevious: closed > 0 };
}

export interface EndShiftResult {
  shift: ShiftState;
  workedMinutes: number | null;
}

/**
 * Close the open shift.
 *
 * The phone calls this only AFTER a successful call sync - see the note in the
 * route. Ending a shift is the one moment the employee wants something from the
 * app, which makes it the only place a hard requirement will hold rather than
 * being worked around.
 */
export async function endShift(
  device: AuthedDevice,
  fix: Fix | null,
  note?: string,
): Promise<EndShiftResult> {
  const open = await db.attendanceSession.findFirst({
    where: { storeId: device.storeId, deviceId: device.id, endedAt: null },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true },
  });

  if (!open) throw new CallLogError('No shift is open on this phone.');

  const usable = fix && isUsableFix(fix) ? fix : null;
  const endedAt = new Date();

  const shift = await db.attendanceSession.update({
    where: { id: open.id },
    data: {
      endedAt,
      endLat: usable ? usable.lat : null,
      endLng: usable ? usable.lng : null,
      endAccuracyM: usable?.accuracyM ?? null,
      note: note?.trim() || null,
    },
    select: { id: true, startedAt: true, endedAt: true, autoClosed: true, attendanceDayId: true },
  });

  const worked = workedMinutes(shift, endedAt);
  await db.attendanceDay.update({
    where: { id: shift.attendanceDayId },
    data: {
      lastOutAt: endedAt, lastOutSource: 'app',
      workedMinutes: worked !== null ? worked : undefined,
      status: 'completed',
    },
  });

  if (usable) await recordPing(device, usable, 'session_end', shift.id);

  // Calls for this shift may already be in the database, filed as after-hours
  // because the shift had not been created yet when they arrived. Re-file them.
  await reattributeCalls(device, shift);

  return { shift, workedMinutes: worked };
}

export type PingSource = 'session_start' | 'session_end' | 'sync' | 'manual';

export async function recordPing(
  device: AuthedDevice,
  fix: Fix,
  source: PingSource,
  shiftId?: string | null,
): Promise<void> {
  if (!isUsableFix(fix)) return;

  let target = shiftId ?? null;
  if (target === undefined || target === null) {
    const open = await db.attendanceSession.findFirst({
      where: { storeId: device.storeId, deviceId: device.id, endedAt: null },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    target = open?.id ?? null;
  }

  // DO NOT RECORD THE SAME PLACE TWICE.
  //
  // A phone sends a fix on shift start, on shift end, and alongside every
  // sync. A person sitting at one desk therefore produces a column of
  // identical coordinates one minute apart, which is what the first trail
  // looked like: five entries, same position, nothing learned.
  //
  // The trail is meant to answer "where did this person go", so a fix that
  // says "still here" adds nothing and costs a row. Movement, a new shift, or
  // a long gap all get through; standing still does not.
  //
  // Shift start and shift end are never dropped. They are the two moments the
  // record has to be able to show, even if somebody clocks on and off from the
  // same chair.
  const now = new Date();
  if (source === 'sync' || source === 'manual') {
    const last = await db.attendanceEvent.findFirst({
      where: { storeId: device.storeId, deviceId: device.id, sessionId: target },
      orderBy: { recordedAt: 'desc' },
      select: { lat: true, lng: true, recordedAt: true },
    });

    if (last) {
      // `Number(...)`: latitude and longitude are Decimal columns, so Prisma
      // hands back Decimal objects rather than numbers. Arithmetic on them
      // would compile against `any` in some call sites and silently produce
      // NaN here, which compares false against every threshold -- every ping
      // would have been kept and this de-duplication would have done nothing.
      const movedM = metresBetween(
        { lat: Number(last.lat), lng: Number(last.lng) },
        { lat: fix.lat, lng: fix.lng },
      );
      const sinceMs = now.getTime() - last.recordedAt.getTime();
      if (movedM < PING_MIN_MOVE_M && sinceMs < PING_MAX_GAP_MS) return;
    }
  }

  await db.attendanceEvent.create({
    data: {
      storeId: device.storeId,
      userId: device.userId,
      deviceId: device.id,
      sessionId: target,
      lat: fix.lat,
      lng: fix.lng,
      accuracyM: fix.accuracyM ?? null,
      source,
      recordedAt: now,
    },
  });
}

/**
 * How far a phone must move before a routine fix is worth recording.
 *
 * 150 m rather than 50: these positions come from wifi and cell towers and
 * wander by a hundred metres while the phone sits on a desk. A smaller
 * threshold would record that wandering and present it as movement.
 */
const PING_MIN_MOVE_M = 150;

/**
 * How long a stationary phone can go unrecorded before one is kept anyway.
 *
 * Without this, a phone that never moves would show one position at the start
 * of the shift and nothing after, which reads as "the app stopped working".
 * One an hour is enough to show it was still reporting.
 */
const PING_MAX_GAP_MS = 60 * 60 * 1000;

// --------------------------------------------------------- attribution

/**
 * Which shift each of a batch of calls belongs to.
 *
 * Called from `ingestCalls`. Returns a map from call start time (ms) to shift
 * id, plus the set that fell outside every shift.
 *
 * The window fetched is deliberately wider than the batch: an OPEN shift covers
 * up to `SHIFT_MAX_HOURS` past its start, so a shift that began well before the
 * oldest call in this batch can still be the right answer.
 */
export async function shiftsCovering(
  deviceId: string,
  from: Date,
  to: Date,
): Promise<(ShiftWindow & { id: string })[]> {
  return db.attendanceSession.findMany({
    where: {
      deviceId,
      startedAt: {
        gte: new Date(from.getTime() - SHIFT_MAX_HOURS * HOUR_MS),
        lte: to,
      },
    },
    select: { id: true, startedAt: true, endedAt: true },
    orderBy: { startedAt: 'desc' },
    // A device cannot plausibly have more than a handful of shifts touching one
    // sync window. The cap is a guard against a pathological query, not a
    // pagination scheme.
    take: 50,
  });
}

/**
 * Re-file calls that arrived before their shift was known about.
 *
 * The ordering problem is real and routine: the phone syncs calls every fifteen
 * minutes, but a shift row only exists once the employee taps Start Shift. A
 * call made at 09:58 and synced at 10:00, with the shift started at 10:01,
 * lands as after-hours and stays wrong forever unless something goes back.
 *
 * Bounded to the shift's own window, so this can never reach a call that
 * genuinely belongs to somebody else's day.
 */
async function reattributeCalls(
  device: AuthedDevice,
  shift: { id: string; startedAt: Date; endedAt: Date | null },
): Promise<number> {
  const from = shift.startedAt;
  const to = shift.endedAt ?? new Date(shift.startedAt.getTime() + SHIFT_MAX_HOURS * HOUR_MS);

  const res = await db.callLog.updateMany({
    where: {
      storeId: device.storeId,
      deviceId: device.id,
      sessionId: null,
      startedAt: { gte: from, lte: to },
    },
    data: { sessionId: shift.id, outsideShift: false },
  });

  return res.count;
}

// ------------------------------------------------------- manager side

/**
 * A manager states what time a forgotten shift actually finished.
 *
 * Requires `attendance.edit`, checked by the caller - this is the one thing on
 * this screen that changes a number somebody gets paid from.
 *
 * The original `endedAt` is deliberately NOT overwritten. Both versions stay
 * visible, with who corrected it and why, so the row can never be mistaken for
 * an employee having actually clocked off.
 */
/**
 * Whose shift this is, and which branch it belongs to - looked up before a
 * correction is attempted, so the caller can check `canMarkAttendanceFor`
 * against the record's own store rather than the actor's ambient scope.
 */
export async function shiftOwner(
  scope: StoreScope,
  shiftId: string,
): Promise<{ userId: string; storeId: string } | null> {
  const shift = await db.attendanceSession.findFirst({
    where: { id: shiftId, ...scopeWhere(scope) },
    select: { userId: true, storeId: true },
  });
  return shift;
}

export async function correctShiftEnd(
  scope: StoreScope,
  shiftId: string,
  correctedEnd: Date,
  reason: string,
  userId: string,
): Promise<void> {
  if (!reason.trim()) {
    throw new CallLogError('Say why the time is being corrected. It goes on the record.');
  }

  const shift = await db.attendanceSession.findFirst({
    where: { id: shiftId, ...scopeWhere(scope) },
    select: { id: true, startedAt: true, endedAt: true, attendanceDayId: true },
  });
  if (!shift) throw new CallLogError('Shift not found in your scope.');

  const problem = validateCorrection(shift.startedAt, correctedEnd);
  if (problem) throw new CallLogError(problem);

  await db.$transaction(async (tx) => {
    await tx.attendanceSession.update({
      where: { id: shift.id },
      data: {
        correctedEndedAt: correctedEnd,
        correctedBy: userId,
        correctedAt: new Date(),
        correctionReason: reason.trim(),
      },
    });

    // A correction is a human saying what time this genuinely finished -
    // it counts as real attendance now, so the day comes out of the
    // "question, not an answer" state autoCloseOverdue left it in.
    const worked = workedMinutes(
      { startedAt: shift.startedAt, endedAt: shift.endedAt, correctedEndedAt: correctedEnd },
      new Date(),
    );
    await tx.attendanceDay.update({
      where: { id: shift.attendanceDayId },
      data: {
        lastOutAt: correctedEnd, lastOutSource: 'manual',
        workedMinutes: worked !== null ? worked : undefined,
        status: 'completed',
      },
    });
  });
}

export interface ShiftRow {
  id: string;
  userId: string;
  userName: string;
  startedAt: Date;
  endedAt: Date | null;
  autoClosed: boolean;
  /** Set when a manager stated the real finish time. Original kept alongside. */
  correctedEndedAt: Date | null;
  correctionReason: string | null;
  workedMinutes: number | null;
  startLat: number | null;
  startLng: number | null;
  /** True when startLat/Lng came from a mid-shift ping, not the clock-in itself. */
  startLatIsApprox: boolean;
  endLat: number | null;
  endLng: number | null;
  note: string | null;
  callCount: number;
  pingCount: number;
  /** 0 when overtime isn't configured for this store, or the shift didn't qualify. */
  overtimeMinutes: number;
  /** Where the check-in came from: app (phone), web (the Present button), biometric, manual. */
  source: string;
}

export async function listShifts(
  scope: StoreScope,
  opts: { from: Date; to: Date; userId?: string; id?: string },
): Promise<ShiftRow[]> {
  // 'all' scope has no single store's overtime threshold to apply - falls
  // back to "not configured" (0 for everyone) rather than guessing whose.
  const policy = scope.kind === 'single'
    ? await attendancePolicy(scope.storeId)
    : { ...POLICY_DEFAULTS, isConfigured: false, updatedAt: null };
  await autoCloseStaleInScope(scope);

  const rows = await db.attendanceSession.findMany({
    where: {
      ...scopeWhere(scope),
      // Every source since 26 Sep 2026. It was the phone app only, so a day
      // checked in with the website Present button was missing here while Team
      // Today counted it - and Team Today's Route link then opened a 404.
      ...(opts.id ? { id: opts.id } : { startedAt: { gte: opts.from, lte: opts.to } }),
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    select: {
      id: true, userId: true, startedAt: true, endedAt: true, autoClosed: true, source: true,
      correctedEndedAt: true, correctionReason: true,
      startLat: true, startLng: true, endLat: true, endLng: true, note: true,
      user: { select: { fullName: true } },
      _count: { select: { calls: true, events: true } },
      // Fallback for when the clock-in itself didn't capture a fix (GPS not
      // ready yet) but a later ping during the same shift did - without this,
      // the list says "Not shared" for a shift the detail page can clearly
      // show a location for, which reads as a bug even though startLat/Lng
      // is, narrowly, telling the truth.
      events: {
        orderBy: { recordedAt: 'asc' },
        take: 1,
        select: { lat: true, lng: true },
      },
    },
    orderBy: { startedAt: 'desc' },
    take: LIST_MAX_ROWS,
  });

  const now = new Date();

  return rows.map((r) => {
    const fallback = r.events[0];
    const mins = workedMinutes(r, now);
    return {
      id: r.id,
      userId: r.userId,
      userName: r.user.fullName,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      autoClosed: r.autoClosed,
      correctedEndedAt: r.correctedEndedAt,
      correctionReason: r.correctionReason,
      workedMinutes: mins,
      // Prisma returns Decimal. The screen wants a number, and a coordinate has
      // six decimal places - nowhere near the precision where a float would
      // start lying, unlike money.
      startLat: r.startLat ? Number(r.startLat) : (fallback ? Number(fallback.lat) : null),
      startLng: r.startLng ? Number(r.startLng) : (fallback ? Number(fallback.lng) : null),
      startLatIsApprox: r.startLat === null && !!fallback,
      endLat: r.endLat ? Number(r.endLat) : null,
      endLng: r.endLng ? Number(r.endLng) : null,
      note: r.note,
      callCount: r._count.calls,
      pingCount: r._count.events,
      overtimeMinutes: computeOvertimeMinutes(mins, policy.fullDayMinutes, policy.overtimeMinMinutes),
      source: r.source,
    };
  });
}

export interface TrailPoint {
  lat: number;
  lng: number;
  accuracyM: number | null;
  source: string;
  recordedAt: Date;
  mocked: boolean;
  speedMps: number | null;
}

/** Every location fix recorded during one shift, oldest first. */
export async function shiftTrail(scope: StoreScope, shiftId: string): Promise<TrailPoint[]> {
  // Scoped through the shift rather than on the ping directly, so a shift id
  // guessed from another tenant returns nothing rather than their movements.
  const shift = await db.attendanceSession.findFirst({
    where: { id: shiftId, ...scopeWhere(scope) },
    select: { id: true },
  });
  if (!shift) throw new CallLogError('Shift not found in your scope.');

  const pings = await db.attendanceEvent.findMany({
    where: { sessionId: shift.id, ...scopeWhere(scope) },
    select: { lat: true, lng: true, accuracyM: true, source: true, recordedAt: true, mocked: true, speedMps: true },
    orderBy: { recordedAt: 'asc' },
    // The GPS trace of ONE shift, drawn on a map. A shift is capped at
    // SHIFT_MAX_HOURS and the app pings every few minutes, so 500 is already
    // well past any real shift - a guard against a runaway device, not a
    // pagination scheme, and nothing downstream pages through it.
    take: 500,
  });

  return pings.map((p) => ({
    lat: Number(p.lat),
    lng: Number(p.lng),
    accuracyM: p.accuracyM,
    source: p.source,
    recordedAt: p.recordedAt,
    mocked: p.mocked,
    speedMps: p.speedMps,
  }));
}

export interface AttendanceRow {
  userId: string;
  userName: string;
  /** Shifts that were properly started AND ended. */
  daysWorked: number;
  /** Started but never ended, closed by the server. Not evidence of hours. */
  daysUnclosed: number;
  /** Total across closed shifts only. Null when nothing is countable. */
  totalMinutes: number | null;
  /** Average clock-on, as minutes past midnight local. Null with no data. */
  avgStartMinute: number | null;
  callsOnShift: number;
  callsAfterHours: number;
  lastSeenAt: Date | null;
}

/**
 * Attendance per employee for a window.
 *
 * THE NUMBERS ARE DELIBERATELY NOT COMBINED.
 *
 * `daysWorked` counts only shifts somebody actually ended. `daysUnclosed`
 * counts the ones the server closed at the ceiling because nobody pressed the
 * button, and their hours are excluded from `totalMinutes` entirely rather than
 * being estimated.
 *
 * That will look wrong to somebody expecting the two to add up, and it is the
 * whole point. An unclosed shift means "started work, never said they stopped"
 * - that is unknown, and unknown must not arrive at a wage calculation wearing
 * a plausible sixteen hours. Showing them separately makes the manager ask the
 * employee, which is the correct outcome.
 */
export async function attendanceSummary(
  scope: StoreScope,
  from: Date,
  to: Date,
): Promise<AttendanceRow[]> {
  const shifts = await db.attendanceSession.findMany({
    // Every source, like listShifts (26 Sep 2026).
    where: { ...scopeWhere(scope), startedAt: { gte: from, lte: to } },
    select: {
      id: true, userId: true, startedAt: true, endedAt: true, autoClosed: true,
      correctedEndedAt: true,
      user: { select: { fullName: true } },
    },
    orderBy: { startedAt: 'asc' },
    take: LIST_MAX_ROWS,
  });

  const calls = await db.callLog.groupBy({
    by: ['userId', 'outsideShift'],
    where: { ...scopeWhere(scope), startedAt: { gte: from, lte: to } },
    _count: { _all: true },
  });

  const byUser = new Map<string, AttendanceRow>();
  // Minutes-past-midnight for each closed shift, so the average can be taken
  // without a second pass.
  const starts = new Map<string, number[]>();

  for (const s of shifts) {
    const row = byUser.get(s.userId) ?? {
      userId: s.userId,
      userName: s.user.fullName,
      daysWorked: 0,
      daysUnclosed: 0,
      totalMinutes: null,
      avgStartMinute: null,
      callsOnShift: 0,
      callsAfterHours: 0,
      lastSeenAt: null,
    };

    // A corrected shift counts as worked, even though it was auto-closed - a
    // manager has since said what time it finished, and that is a better answer
    // than the machine's ceiling. Checked FIRST, because `autoClosed` is still
    // true on a corrected row and testing it first would keep the shift in the
    // "unknown" bucket for ever, which is exactly what the correction exists to
    // get it out of.
    if (s.correctedEndedAt) {
      row.daysWorked += 1;
      const mins = workedMinutes(s, new Date());
      if (mins !== null) row.totalMinutes = (row.totalMinutes ?? 0) + mins;
      const list = starts.get(s.userId) ?? [];
      // `getHours()` here would be the SERVER's hours, and the server runs in
      // UTC. That is what put "usual start 18:11" against a team that clocks
      // on at 23:41 -- the same shift, five and a half hours early.
      list.push(minutesPastMidnight(s.startedAt));
      starts.set(s.userId, list);
    } else if (s.autoClosed) {
      row.daysUnclosed += 1;
    } else if (s.endedAt) {
      row.daysWorked += 1;
      const mins = workedMinutes(s, new Date());
      if (mins !== null) row.totalMinutes = (row.totalMinutes ?? 0) + mins;
      const list = starts.get(s.userId) ?? [];
      // `getHours()` here would be the SERVER's hours, and the server runs in
      // UTC. That is what put "usual start 18:11" against a team that clocks
      // on at 23:41 -- the same shift, five and a half hours early.
      list.push(minutesPastMidnight(s.startedAt));
      starts.set(s.userId, list);
    }
    // An OPEN shift - someone is at work right now - is counted in neither.
    // It is not a completed day and it is not a failure, and inventing a
    // third bucket for "today, so far" would be more confusing than useful.

    if (!row.lastSeenAt || s.startedAt > row.lastSeenAt) row.lastSeenAt = s.startedAt;
    byUser.set(s.userId, row);
  }

  for (const c of calls) {
    const row = byUser.get(c.userId);
    if (!row) continue;
    if (c.outsideShift) row.callsAfterHours += c._count._all;
    else row.callsOnShift += c._count._all;
  }

  for (const [userId, list] of starts) {
    const row = byUser.get(userId);
    if (!row || list.length === 0) continue;
    row.avgStartMinute = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  }

  return [...byUser.values()].sort((a, b) => a.userName.localeCompare(b.userName));
}

/** Re-exported so callers do not need two imports to classify one call. */
export { covers, shiftForCall };
