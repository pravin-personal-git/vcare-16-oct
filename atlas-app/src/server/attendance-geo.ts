import 'server-only';
import { db } from './db';
import { BUSINESS_TZ, SHIFT_MAX_HOURS, isUsableFix, type Fix } from '@/lib/shift';
import { ipAllowed, nearestZoneMatch } from '@/lib/geofence';

/**
 * The unified attendance gate - clock-in, clock-out, and the "have they
 * already marked today" check, source-agnostic.
 *
 * Both the web (via a server action) and the paired app (via the existing
 * bearer-token API route, see server/shifts.ts) call these same functions.
 * That is the entire mechanism behind "clock in from the app, open the web,
 * and it already knows" - there is only ever one place this decision is
 * made, not two implementations that have to be kept in sync by hand.
 *
 * See `AttendanceDay`/`AttendanceSession` in schema.prisma for the full
 * history of why this replaced the old separate Shift/WebPresence split.
 */

const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export function businessDay(now: Date = new Date()): string {
  return DAY_FMT.format(now);
}

export type AttendanceSource = 'app' | 'web' | 'biometric' | 'manual';

export interface TodayStatus {
  workDate: string;
  status: 'not_marked' | 'in_progress' | 'completed';
  firstInAt: Date | null;
  firstInSource: AttendanceSource | null;
  lastOutAt: Date | null;
  lastOutSource: AttendanceSource | null;
  workedMinutes: number | null;
  openSessionId: string | null;
}

export async function getTodayStatus(userId: string, now: Date = new Date()): Promise<TodayStatus> {
  const workDate = businessDay(now);
  const day = await db.attendanceDay.findUnique({
    where: { userId_workDate: { userId, workDate } },
    include: { sessions: { where: { endedAt: null }, select: { id: true }, take: 1 } },
  });

  if (!day) {
    return {
      workDate, status: 'not_marked', firstInAt: null, firstInSource: null,
      lastOutAt: null, lastOutSource: null, workedMinutes: null, openSessionId: null,
    };
  }

  return {
    workDate: day.workDate,
    status: day.status as TodayStatus['status'],
    firstInAt: day.firstInAt,
    firstInSource: day.firstInSource as AttendanceSource | null,
    lastOutAt: day.lastOutAt,
    lastOutSource: day.lastOutSource as AttendanceSource | null,
    workedMinutes: day.workedMinutes,
    openSessionId: day.sessions[0]?.id ?? null,
  };
}

export class AttendanceGeoError extends Error {}

/** What the caller reports about where and how the punch happened. */
export interface PunchContext {
  fix?: Fix | null;
  ipAddress?: string | null;
  /** A place check already made by the caller (the per-employee rule, lib/attendance-rule) - used instead of the store geofence. */
  geo?: GeoCheckResult;
  /** Android flagged the fix as simulated. */
  mocked?: boolean;
}

export interface GeoCheckResult {
  withinPolicy: boolean | null; // null = policy not enabled, nothing was checked
  matchedZoneId: string | null;
  distanceMeters: number | null;
}

/**
 * Checks a fix against the store's geofence zones, if geofencing is on.
 *
 * Deliberately never blocks a clock-in on a failed match - see the note on
 * `checkInRadiusMeters`/the field brief this was built from: the daily
 * attendance button must keep working even when nobody has configured a
 * zone, or configured it too tightly. The result is recorded, not enforced,
 * so an owner can see "3 late check-ins, all 400m from the nearest zone"
 * and decide what to do about it, rather than the app silently refusing
 * someone who is honestly at work.
 */
async function checkGeofence(storeId: string, fix: Fix | null): Promise<GeoCheckResult> {
  const policy = await db.attendancePolicy.findUnique({ where: { storeId } });
  if (!policy?.geofencingEnabled) return { withinPolicy: null, matchedZoneId: null, distanceMeters: null };
  if (!fix) return { withinPolicy: false, matchedZoneId: null, distanceMeters: null };

  const zones = await db.attendanceZone.findMany({
    where: { storeId, isActive: true },
    select: { id: true, lat: true, lng: true, radiusMeters: true },
  });
  if (zones.length === 0) return { withinPolicy: null, matchedZoneId: null, distanceMeters: null };

  const match = nearestZoneMatch(
    fix,
    zones.map((z) => ({ id: z.id, lat: Number(z.lat), lng: Number(z.lng), radiusMeters: z.radiusMeters })),
  );

  return match
    ? { withinPolicy: true, matchedZoneId: match.zoneId, distanceMeters: match.distanceMeters }
    : { withinPolicy: false, matchedZoneId: null, distanceMeters: null };
}

export interface ClockInResult {
  sessionId: string;
  attendanceDayId: string;
  geo: GeoCheckResult;
  /** True when this call found an already-open session and returned it as-is - not an error, a retry-safe no-op. */
  alreadyOpen: boolean;
}

/**
 * Open a session for today, or hand back the one already open.
 *
 * Idempotent on purpose - a retried request (a flaky connection, a phone
 * that resent because the first response was lost) must not produce a
 * second clock-in, and neither should opening the web after clocking in
 * from the app. This IS the "won't have to punch in again" behaviour.
 */
export async function clockIn(
  input: { userId: string; storeId: string; source: AttendanceSource; deviceId?: string | null },
  ctx: PunchContext = {},
  now: Date = new Date(),
): Promise<ClockInResult> {
  const workDate = businessDay(now);
  const usable = ctx.fix && isUsableFix(ctx.fix) ? ctx.fix : null;

  const existingDay = await db.attendanceDay.findUnique({
    where: { userId_workDate: { userId: input.userId, workDate } },
    include: { sessions: { where: { endedAt: null }, take: 1 } },
  });

  const openSession = existingDay?.sessions[0];
  if (openSession) {
    return {
      sessionId: openSession.id,
      attendanceDayId: openSession.attendanceDayId,
      geo: { withinPolicy: openSession.startWithinPolicy, matchedZoneId: openSession.startMatchedZoneId, distanceMeters: openSession.startDistanceM },
      alreadyOpen: true,
    };
  }

  const geo = ctx.geo ?? await checkGeofence(input.storeId, usable);

  const ipPolicy = await db.attendancePolicy.findUnique({ where: { storeId: input.storeId } });
  if (ipPolicy?.ipRestrictionEnabled && !ipAllowed(ctx.ipAddress ?? null, ipPolicy.allowedIpRanges)) {
    throw new AttendanceGeoError('This network is not allowed for attendance. Check with your admin.');
  }

  const result = await db.$transaction(async (tx) => {
    const day = await tx.attendanceDay.upsert({
      where: { userId_workDate: { userId: input.userId, workDate } },
      create: {
        storeId: input.storeId, userId: input.userId, workDate,
        firstInAt: now, firstInSource: input.source, status: 'in_progress',
      },
      // `status` always flips back to `in_progress` - a second session opening
      // this same day (back from a lunch break, say) means work has resumed,
      // whatever an earlier session's clock-out set it to. `firstInAt`/
      // `firstInSource` are left alone when the day already exists: the
      // FIRST arrival of the day must never be overwritten by a later one,
      // which is the whole reason this branches on `existingDay` at all.
      update: existingDay
        ? { status: 'in_progress' }
        : { firstInAt: now, firstInSource: input.source, status: 'in_progress' },
    });

    /**
     * A shift still open from an EARLIER day is closed now (15 Oct 2026).
     * Nothing else closes it until the 16-hour ceiling, and until then it
     * also "covers" today - Mayank's evening shift of 14 Oct took every point
     * of his 15 Oct morning. It ends at its own last point from its own day
     * (or its start), never at `now`, so nobody is credited hours the phone
     * did not see, and it is flagged autoClosed ("Not ended") for a manager.
     */
    const dayStart = new Date(`${workDate}T00:00:00+05:30`);
    const leftOpen = await tx.attendanceSession.findMany({
      where: { storeId: input.storeId, userId: input.userId, endedAt: null, attendanceDayId: { not: day.id } },
      select: { id: true, startedAt: true },
    });
    for (const s of leftOpen) {
      const last = await tx.attendanceEvent.findFirst({
        where: { storeId: input.storeId, sessionId: s.id, recordedAt: { lt: dayStart } },
        orderBy: { recordedAt: 'desc' },
        select: { recordedAt: true },
      });
      const ceiling = s.startedAt.getTime() + SHIFT_MAX_HOURS * 3_600_000;
      const endedAt = new Date(Math.min(Math.max((last?.recordedAt ?? s.startedAt).getTime(), s.startedAt.getTime()), ceiling));
      await tx.attendanceSession.update({ where: { id: s.id }, data: { endedAt, autoClosed: true } });
    }

    const session = await tx.attendanceSession.create({
      data: {
        storeId: input.storeId, userId: input.userId, source: input.source,
        deviceId: input.deviceId ?? null,
        attendanceDayId: day.id,
        startedAt: now,
        startLat: usable?.lat ?? null, startLng: usable?.lng ?? null, startAccuracyM: usable?.accuracyM ?? null,
        startWithinPolicy: geo.withinPolicy, startMatchedZoneId: geo.matchedZoneId, startDistanceM: geo.distanceMeters,
      },
    });

    if (usable) {
      await tx.attendanceEvent.create({
        data: {
          storeId: input.storeId, userId: input.userId, deviceId: input.deviceId ?? null,
          sessionId: session.id, lat: usable.lat, lng: usable.lng, accuracyM: usable.accuracyM ?? null,
          mocked: ctx.mocked === true, source: 'session_start', recordedAt: now,
        },
      });
    }

    return { sessionId: session.id, attendanceDayId: day.id };
  });

  return { ...result, geo, alreadyOpen: false };
}

export interface ClockOutResult {
  sessionId: string;
  workedMinutes: number | null;
}

export async function clockOut(
  input: { userId: string; source: AttendanceSource; note?: string | null },
  ctx: PunchContext = {},
  now: Date = new Date(),
): Promise<ClockOutResult> {
  const workDate = businessDay(now);
  const usable = ctx.fix && isUsableFix(ctx.fix) ? ctx.fix : null;

  const day = await db.attendanceDay.findUnique({
    where: { userId_workDate: { userId: input.userId, workDate } },
    include: { sessions: { where: { endedAt: null }, orderBy: { startedAt: 'desc' }, take: 1 } },
  });
  const open = day?.sessions[0];
  if (!day || !open) throw new AttendanceGeoError('You have not clocked in today.');

  // storeId comes from the day being closed, not a fresh input - closing
  // out must target wherever the person actually clocked in, even if their
  // active store selection has since changed.
  const storeId = day.storeId;

  const minutes = Math.max(0, Math.round((now.getTime() - open.startedAt.getTime()) / 60_000));

  await db.$transaction(async (tx) => {
    await tx.attendanceSession.update({
      where: { id: open.id },
      data: {
        endedAt: now, note: input.note?.trim() || null,
        endLat: usable?.lat ?? null, endLng: usable?.lng ?? null, endAccuracyM: usable?.accuracyM ?? null,
      },
    });

    if (usable) {
      await tx.attendanceEvent.create({
        data: {
          storeId, userId: input.userId, sessionId: open.id,
          lat: usable.lat, lng: usable.lng, accuracyM: usable.accuracyM ?? null,
          mocked: ctx.mocked === true, source: 'session_end', recordedAt: now,
        },
      });
    }

    await tx.attendanceDay.update({
      where: { id: day.id },
      data: {
        lastOutAt: now, lastOutSource: input.source,
        workedMinutes: (day.workedMinutes ?? 0) + minutes,
        status: 'completed',
      },
    });
  });

  return { sessionId: open.id, workedMinutes: minutes };
}
