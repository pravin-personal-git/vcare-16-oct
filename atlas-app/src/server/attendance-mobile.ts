import 'server-only';
import { db } from './db';
import type { AuthedDevice } from './call-logs';
import { autoCloseOverdue } from './shifts';
import { AttendanceGeoError, businessDay, clockIn, clockOut, getTodayStatus, type TodayStatus } from './attendance-geo';
import {
  acceptedEventTime, evaluateClockIn, thinTrack, ALLOW_MODES, OUTSIDE_MODES,
  type AllowMode, type OutsideMode, type Place, type RuleResult,
} from '@/lib/attendance-rule';
import { isUsableFix, type Fix } from '@/lib/shift';
import { resolveForUser } from './app-access';

/**
 * Vcare attendance - clock in/out and shift tracking from the paired
 * phone. Authenticated by the device token, so the store and the person come
 * from the pairing and nothing the phone sends can change who is clocking in.
 *
 * The decisions themselves live in lib/attendance-rule (where) and
 * attendance-geo (the one clock-in/out every source shares).
 */

export interface RuleSetting { allow: AllowMode; outside: OutsideMode; zoneIds: string[] }

export async function ruleSettingFor(storeId: string, userId: string): Promise<RuleSetting> {
  const r = await db.employeeAttendanceRule.findUnique({ where: { storeId_userId: { storeId, userId } } });
  return {
    allow: (ALLOW_MODES as readonly string[]).includes(r?.allow ?? '') ? (r!.allow as AllowMode) : 'store_default',
    outside: (OUTSIDE_MODES as readonly string[]).includes(r?.outside ?? '') ? (r!.outside as OutsideMode) : 'flag',
    zoneIds: r?.zoneIds ?? [],
  };
}

/**
 * The rule a clock-in is judged by: the employee's own rule when one is set,
 * otherwise their role's "Clock in from" default (Settings > Roles > Phone
 * app, 26 Sep 2026), otherwise the branch setting.
 */
export async function effectiveRule(storeId: string, userId: string): Promise<RuleSetting> {
  const own = await ruleSettingFor(storeId, userId);
  if (own.allow !== 'store_default') return own;
  const access = await resolveForUser(userId, [storeId]);
  return { allow: access.clockIn.allow, outside: access.clockIn.outside, zoneIds: own.zoneIds };
}

/** Open complaints assigned to this person with a known site - the "job sites" of zones_or_sites. */
async function jobSites(storeId: string, userId: string): Promise<Place[]> {
  const rows = await db.complaint.findMany({
    where: {
      storeId, assignedTechnicianId: userId, siteLat: { not: null }, siteLng: { not: null },
      status: { in: ['assigned', 'in_progress'] },
    },
    select: { id: true, complaintNo: true, siteLat: true, siteLng: true, customer: { select: { companyName: true, firstName: true } } },
    take: 50,
  });
  return rows.map((c) => ({
    id: c.id, kind: 'site' as const,
    name: c.customer.companyName || c.customer.firstName || c.complaintNo,
    lat: Number(c.siteLat), lng: Number(c.siteLng), radiusMeters: 250,
  }));
}

export async function evaluateFor(device: AuthedDevice, fix: Fix | null): Promise<RuleResult & { rule: RuleSetting }> {
  const [rule, policy, zones] = await Promise.all([
    effectiveRule(device.storeId, device.userId),
    db.attendancePolicy.findUnique({ where: { storeId: device.storeId }, select: { geofencingEnabled: true } }),
    db.attendanceZone.findMany({
      where: { storeId: device.storeId, isActive: true },
      select: { id: true, label: true, lat: true, lng: true, radiusMeters: true },
    }),
  ]);
  const zonePlaces: Place[] = zones
    .filter((z) => rule.allow === 'store_default' || rule.zoneIds.length === 0 || rule.zoneIds.includes(z.id))
    .map((z) => ({ id: z.id, kind: 'zone', name: z.label, lat: Number(z.lat), lng: Number(z.lng), radiusMeters: z.radiusMeters }));
  const sites = rule.allow === 'zones_or_sites' ? await jobSites(device.storeId, device.userId) : [];
  const r = evaluateClockIn({
    allow: rule.allow, outside: rule.outside, storeGeofencing: !!policy?.geofencingEnabled,
    zones: zonePlaces, sites, fix,
  });
  return { ...r, rule };
}

async function logDeviceEvent(device: AuthedDevice, kind: 'mock_location', detail: Record<string, unknown>) {
  await db.$transaction([
    db.callSyncDevice.update({ where: { id: device.id }, data: { mockLocationSeenAt: new Date() } }),
    db.deviceEvent.create({ data: { storeId: device.storeId, deviceId: device.id, userId: device.userId, kind, detail: detail as object } }),
  ]);
}

export interface PhoneToday extends Omit<TodayStatus, 'firstInAt' | 'lastOutAt'> {
  firstInAt: string | null;
  lastOutAt: string | null;
  openSince: string | null;
  rule: RuleSetting;
}

export async function phoneToday(device: AuthedDevice): Promise<PhoneToday> {
  await autoCloseOverdue(device.id);
  const [t, rule] = await Promise.all([getTodayStatus(device.userId), effectiveRule(device.storeId, device.userId)]);
  const open = t.openSessionId
    ? await db.attendanceSession.findUnique({ where: { id: t.openSessionId }, select: { startedAt: true } })
    : null;
  return {
    ...t,
    firstInAt: t.firstInAt?.toISOString() ?? null,
    lastOutAt: t.lastOutAt?.toISOString() ?? null,
    openSince: open?.startedAt.toISOString() ?? null,
    rule,
  };
}

export interface PunchInput {
  action: 'in' | 'out';
  fix: Fix | null;
  mocked: boolean;
  /** When the phone says it happened (offline punches), epoch ms. */
  clientTime: number | null;
  note?: string | null;
  ip: string | null;
}

export interface PunchResult {
  ok: true;
  at: string;
  /**
   * The shift this punch opened or closed. The clock-in photo is filed
   * against it, so the shift trail can show the face beside the times
   * instead of a loose photograph dated to the same afternoon.
   */
  sessionId: string;
  /** The phone's time was refused (future or over a day old) and the server's used. */
  timeAdjusted: boolean;
  withinPolicy: boolean | null;
  message: string | null;
  workedMinutes?: number | null;
}

export class PunchBlocked extends Error {}

export async function punch(device: AuthedDevice, input: PunchInput): Promise<PunchResult> {
  const { at, trusted } = acceptedEventTime(input.clientTime);
  const fix = input.fix && isUsableFix(input.fix) ? input.fix : null;
  if (input.mocked && input.fix) {
    await logDeviceEvent(device, 'mock_location', { during: input.action === 'in' ? 'clock_in' : 'clock_out', lat: input.fix.lat, lng: input.fix.lng });
  }

  if (input.action === 'in') {
    // A simulated location is never a place check that passed.
    const r = await evaluateFor(device, input.mocked ? null : fix);
    if (r.blocked) throw new PunchBlocked(r.message ?? 'You are outside the places you may clock in from.');
    const res = await clockIn(
      { userId: device.userId, storeId: device.storeId, source: 'app', deviceId: device.id },
      {
        fix, ipAddress: input.ip, mocked: input.mocked,
        geo: { withinPolicy: input.mocked ? false : r.withinPolicy, matchedZoneId: r.matchedZoneId, distanceMeters: r.distanceMeters },
      },
      at,
    );
    return { ok: true, at: at.toISOString(), sessionId: res.sessionId, timeAdjusted: !trusted && input.clientTime != null, withinPolicy: res.geo.withinPolicy, message: r.withinPolicy === false ? r.message : null };
  }

  try {
    const res = await clockOut({ userId: device.userId, source: 'app', note: input.note }, { fix, mocked: input.mocked }, at);
    return { ok: true, at: at.toISOString(), sessionId: res.sessionId, timeAdjusted: !trusted && input.clientTime != null, withinPolicy: null, message: null, workedMinutes: res.workedMinutes };
  } catch (e) {
    // An offline clock-out that arrives after midnight belongs to the day it was opened.
    if (e instanceof AttendanceGeoError) {
      const open = await db.attendanceSession.findFirst({
        where: { storeId: device.storeId, userId: device.userId, endedAt: null },
        orderBy: { startedAt: 'desc' }, include: { attendanceDay: true },
      });
      if (!open || businessDay(open.startedAt) === businessDay(at)) throw e;
      const minutes = Math.max(0, Math.round((at.getTime() - open.startedAt.getTime()) / 60_000));
      await db.$transaction([
        db.attendanceSession.update({ where: { id: open.id }, data: { endedAt: at, endLat: fix?.lat ?? null, endLng: fix?.lng ?? null, endAccuracyM: fix?.accuracyM ?? null } }),
        db.attendanceDay.update({
          where: { id: open.attendanceDayId },
          data: { lastOutAt: at, lastOutSource: 'app', workedMinutes: (open.attendanceDay.workedMinutes ?? 0) + minutes, status: 'completed' },
        }),
      ]);
      return { ok: true, at: at.toISOString(), sessionId: open.id, timeAdjusted: !trusted, withinPolicy: null, message: null, workedMinutes: minutes };
    }
    throw e;
  }
}

export interface TrackPoint extends Fix { at: number; mocked?: boolean; speedMps?: number | null }

/**
 * A batch of shift-tracking fixes (the phone sends every few minutes, or all
 * at once after being offline). Every usable point is kept apart from jitter;
 * a simulated one is kept too, marked, and raises a device event once.
 */
export async function recordTrack(device: AuthedDevice, points: TrackPoint[]): Promise<{ stored: number }> {
  const now = Date.now();
  const valid = points
    .filter((p) => Number.isFinite(p.at) && p.at <= now + 5 * 60_000 && p.at >= now - 48 * 3_600_000)
    .slice(0, 500);
  if (valid.length === 0) return { stored: 0 };

  const last = await db.attendanceEvent.findFirst({
    where: { storeId: device.storeId, deviceId: device.id },
    orderBy: { recordedAt: 'desc' },
    select: { lat: true, lng: true, recordedAt: true },
  });
  const kept = thinTrack(valid, last ? { lat: Number(last.lat), lng: Number(last.lng), at: last.recordedAt.getTime() } : null);
  if (kept.length === 0) return { stored: 0 };

  // Each point belongs to whichever session was open at its own time.
  const from = new Date(kept[0].at - 30 * 3_600_000);
  const sessions = await db.attendanceSession.findMany({
    where: { storeId: device.storeId, userId: device.userId, startedAt: { gte: from } },
    select: { id: true, startedAt: true, endedAt: true },
  });
  // The LATEST shift covering the time, not the first (15 Oct 2026): a shift
  // left open from the evening before also "covers" this morning, and every
  // point of the new shift went onto the old one - the trail looked empty.
  const sessionAt = (t: number) =>
    sessions
      .filter((s) => s.startedAt.getTime() <= t && (!s.endedAt || s.endedAt.getTime() >= t))
      .sort((x, y) => y.startedAt.getTime() - x.startedAt.getTime())[0]?.id ?? null;

  await db.attendanceEvent.createMany({
    data: kept.map((p) => ({
      storeId: device.storeId, userId: device.userId, deviceId: device.id, sessionId: sessionAt(p.at),
      lat: p.lat, lng: p.lng, accuracyM: p.accuracyM != null ? Math.round(p.accuracyM) : null,
      mocked: p.mocked === true, speedMps: typeof p.speedMps === 'number' && Number.isFinite(p.speedMps) ? p.speedMps : null,
      source: 'sync', recordedAt: new Date(p.at),
    })),
  });

  const fake = kept.find((p) => p.mocked);
  if (fake) await logDeviceEvent(device, 'mock_location', { during: 'tracking', lat: fake.lat, lng: fake.lng });
  return { stored: kept.length };
}

/** Parse a fix from untrusted JSON. */
export function fixFromBody(v: unknown): Fix | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const lat = Number(o.lat), lng = Number(o.lng), acc = Number(o.accuracyM);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, accuracyM: Number.isFinite(acc) ? Math.round(acc) : null };
}
