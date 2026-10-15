import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { clockIn, clockOut, AttendanceGeoError, type AttendanceSource } from './attendance-geo';

/**
 * Attendance devices - a physical biometric/punch machine that posts
 * attendance via HTTP with a bearer token, instead of a phone or a browser.
 *
 * SAME TRUST MODEL AS `call-logs.ts`, ON PURPOSE.
 *
 * This also runs unattended for months with nobody to log back in, so the
 * unit of trust is the device, holding a revocable token of its own. The
 * token never appears in the database - only its SHA-256 hash is stored.
 *
 * WHY THIS DOES NOT WRITE ATTENDANCE ROWS ITSELF.
 *
 * `clockIn`/`clockOut` in `attendance-geo.ts` are already the unified,
 * source-agnostic gate that the app and the web both call - idempotent,
 * geofence- and IP-policy-aware. A punch machine is just a third caller of
 * the same two functions, with `source: 'biometric'`. Re-implementing that
 * logic here would be a second place for it to drift from the other two.
 */

export class AttendanceDeviceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttendanceDeviceError';
  }
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------ admin

export interface AttendanceDeviceRow {
  id: string;
  label: string;
  deviceModel: string | null;
  defaultZoneId: string | null;
  defaultZoneLabel: string | null;
  timezoneOffsetMinutes: number;
  fieldMapping: FieldMapping | null;
  isActive: boolean;
  lastPunchAt: Date | null;
  lastCalledAt: Date | null;
  createdAt: Date;
  eventCount: number;
  /**
   * Punches this device has delivered (9 Oct 2026). `eventCount` only counts
   * the older direct route; a BioTime connector posts through the capture
   * route, which writes punches and no events - so the screen showed
   * "0 calls" for a device that was working.
   */
  punchCount: number;
}

export async function listDevices(scope: StoreScope): Promise<AttendanceDeviceRow[]> {
  const rows = await db.attendanceDevice.findMany({
    where: { ...scopeWhere(scope) },
    orderBy: [{ isActive: 'desc' }, { lastCalledAt: 'desc' }],
    select: {
      id: true, label: true, deviceModel: true, defaultZoneId: true,
      timezoneOffsetMinutes: true, fieldMapping: true, isActive: true,
      lastPunchAt: true, lastCalledAt: true, createdAt: true,
      defaultZone: { select: { label: true } },
      _count: { select: { events: true, punches: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    deviceModel: r.deviceModel,
    defaultZoneId: r.defaultZoneId,
    defaultZoneLabel: r.defaultZone?.label ?? null,
    timezoneOffsetMinutes: r.timezoneOffsetMinutes,
    fieldMapping: (r.fieldMapping as FieldMapping | null) ?? null,
    isActive: r.isActive,
    lastPunchAt: r.lastPunchAt,
    lastCalledAt: r.lastCalledAt,
    createdAt: r.createdAt,
    eventCount: r._count.events,
    punchCount: r._count.punches,
  }));
}

export interface CreateDeviceInput {
  label: string;
  deviceModel?: string | null;
  defaultZoneId?: string | null;
  timezoneOffsetMinutes: number;
  fieldMapping?: FieldMapping | null;
}

/** Returns the raw bearer token once. It is never recoverable after this. */
export async function createDevice(
  scope: StoreScope,
  input: CreateDeviceInput,
  createdBy: string,
): Promise<{ id: string; token: string }> {
  const storeId = scopeForWrite(scope);

  if (!input.label.trim()) throw new AttendanceDeviceError('Give the device a name.');
  if (!Number.isInteger(input.timezoneOffsetMinutes) || Math.abs(input.timezoneOffsetMinutes) > 14 * 60) {
    throw new AttendanceDeviceError('That timezone offset is not valid.');
  }

  if (input.defaultZoneId) {
    const zone = await db.attendanceZone.findFirst({ where: { id: input.defaultZoneId, storeId } });
    if (!zone) throw new AttendanceDeviceError('That location is not in your scope.');
  }

  const token = randomBytes(32).toString('hex');

  const device = await db.attendanceDevice.create({
    data: {
      storeId,
      label: input.label.trim(),
      deviceModel: input.deviceModel?.trim() || null,
      defaultZoneId: input.defaultZoneId || null,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      fieldMapping: input.fieldMapping ? (input.fieldMapping as object) : undefined,
      tokenHash: hash(token),
      createdBy,
    },
    select: { id: true },
  });

  return { id: device.id, token };
}

export async function revokeDevice(scope: StoreScope, deviceId: string, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const updated = await db.attendanceDevice.updateMany({
    where: { id: deviceId, storeId },
    data: { isActive: false, revokedAt: new Date(), revokedBy: userId },
  });
  if (updated.count === 0) throw new AttendanceDeviceError('Device not found in your scope.');
  // Punches already recorded are kept - a device being retired must not
  // erase the attendance history it produced.
}

export interface DeviceEventRow {
  id: string;
  accepted: number;
  rejected: number;
  errorMessage: string | null;
  receivedAt: Date;
}

export async function listDeviceEvents(scope: StoreScope, deviceId: string): Promise<DeviceEventRow[]> {
  const rows = await db.attendanceDeviceEvent.findMany({
    where: { deviceId, ...scopeWhere(scope) },
    orderBy: { receivedAt: 'desc' },
    take: 20,
    select: { id: true, accepted: true, rejected: true, errorMessage: true, receivedAt: true },
  });
  return rows;
}

// ----------------------------------------------------------------- ingest

export interface FieldMapping {
  userCodeField?: string;
  timestampField?: string;
  directionField?: string;
  inValue?: string;
  outValue?: string;
}

const DEFAULT_MAPPING: Required<FieldMapping> = {
  userCodeField: 'userCode',
  timestampField: 'timestampMs',
  directionField: 'direction',
  inValue: 'in',
  outValue: 'out',
};

export interface AuthedAttendanceDevice {
  id: string;
  storeId: string;
  timezoneOffsetMinutes: number;
  fieldMapping: FieldMapping | null;
  defaultZone: { lat: number; lng: number } | null;
}

/** Resolve a bearer token to a device. Null for anything not currently valid. */
export async function deviceFromToken(token: string): Promise<AuthedAttendanceDevice | null> {
  if (!token) return null;

  const row = await db.attendanceDevice.findUnique({
    where: { tokenHash: hash(token) },
    select: {
      id: true, storeId: true, isActive: true, timezoneOffsetMinutes: true, fieldMapping: true,
      store: { select: { isActive: true } },
      defaultZone: { select: { lat: true, lng: true, isActive: true } },
    },
  });

  if (!row || !row.isActive || !row.store.isActive) return null;

  return {
    id: row.id,
    storeId: row.storeId,
    timezoneOffsetMinutes: row.timezoneOffsetMinutes,
    fieldMapping: (row.fieldMapping as FieldMapping | null) ?? null,
    defaultZone: row.defaultZone && row.defaultZone.isActive
      ? { lat: Number(row.defaultZone.lat), lng: Number(row.defaultZone.lng) }
      : null,
  };
}

export interface IngestPunchResult {
  accepted: number;
  rejected: number;
  serverTime: string;
}

/**
 * Take a batch of punches from one device.
 *
 * Shaped, not validated hard - a row this device cannot map (unknown user
 * code, garbled direction) is dropped and counted, never allowed to fail
 * the whole batch. The device cannot fix a bad row either way, and the
 * machine is unattended - refusing the batch just means it retries the
 * same bad row forever.
 */
export async function ingestPunches(
  device: AuthedAttendanceDevice,
  rawPunches: unknown,
): Promise<IngestPunchResult> {
  if (!Array.isArray(rawPunches)) {
    throw new AttendanceDeviceError('Send { "punches": [...] }.');
  }
  if (rawPunches.length > 1000) {
    throw new AttendanceDeviceError('Too many punches in one batch. Send at most 1000.');
  }

  const mapping = { ...DEFAULT_MAPPING, ...(device.fieldMapping ?? {}) };
  const source: AttendanceSource = 'biometric';

  let accepted = 0;
  let rejected = 0;
  const errors: string[] = [];

  const fix = device.defaultZone ? { lat: device.defaultZone.lat, lng: device.defaultZone.lng, accuracyM: null } : null;

  for (const raw of rawPunches) {
    if (!raw || typeof raw !== 'object') { rejected += 1; continue; }
    const row = raw as Record<string, unknown>;

    const userCode = String(row[mapping.userCodeField] ?? '').trim();
    const rawTs = Number(row[mapping.timestampField]);
    const rawDirection = String(row[mapping.directionField] ?? '');

    if (!userCode || !Number.isFinite(rawTs) || rawTs <= 0) {
      rejected += 1;
      errors.push(`Unusable row (missing user code or timestamp): ${JSON.stringify(row).slice(0, 200)}`);
      continue;
    }

    const direction = rawDirection === mapping.inValue ? 'in' : rawDirection === mapping.outValue ? 'out' : null;
    if (!direction) {
      rejected += 1;
      errors.push(`Unrecognised direction "${rawDirection}" for ${userCode}`);
      continue;
    }

    const user = await db.user.findFirst({
      where: { userCode, storeRoles: { some: { storeId: device.storeId } } },
      select: { id: true },
    });
    if (!user) {
      rejected += 1;
      errors.push(`Unknown or out-of-store employee code "${userCode}"`);
      continue;
    }

    const punchTime = new Date(rawTs + device.timezoneOffsetMinutes * 60_000);

    try {
      if (direction === 'in') {
        await clockIn({ userId: user.id, storeId: device.storeId, source }, { fix }, punchTime);
      } else {
        await clockOut({ userId: user.id, source }, { fix }, punchTime);
      }
      accepted += 1;
    } catch (e) {
      rejected += 1;
      errors.push(e instanceof AttendanceGeoError ? e.message : 'Could not record that punch.');
    }
  }

  const now = new Date();

  await db.$transaction([
    db.attendanceDeviceEvent.create({
      data: {
        deviceId: device.id,
        storeId: device.storeId,
        rawPayload: rawPunches as object,
        accepted,
        rejected,
        errorMessage: errors.length ? errors.slice(0, 20).join('; ').slice(0, 2000) : null,
      },
    }),
    db.attendanceDevice.update({
      where: { id: device.id },
      data: {
        lastCalledAt: now,
        ...(accepted > 0 ? { lastPunchAt: now } : {}),
      },
    }),
  ]);

  return { accepted, rejected, serverTime: now.toISOString() };
}
