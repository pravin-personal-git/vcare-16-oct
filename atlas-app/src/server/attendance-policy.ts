import 'server-only';
import { db } from './db';
import { type StoreScope, scopeForWrite } from './store-scope';
import { isValidCycleStartDay } from '@/lib/payroll-cycle';
import { parseClock } from '@/lib/attendance';

/**
 * THE RULES THAT DECIDE WHETHER SOMEBODY WAS LATE.
 *
 * Every number here is the subject of an argument with a real employee at some
 * point - "I was four minutes late", "that was a half day, not an absence". A
 * number somebody can point at, with a date it changed and a name against it,
 * ends the argument. A number compiled into a deployment does not.
 *
 * WHY A MISSING ROW IS NOT AN ERROR.
 *
 * A store that has never opened this screen still has to produce an attendance
 * grid. So the defaults below are the answer until somebody sets otherwise, and
 * they are the same defaults the database column defaults carry, so a row that
 * is created later changes nothing until it is edited.
 */

export interface AttendancePolicyView {
  /** Sunday = 0, matching JavaScript's getDay(). */
  weekOffDays: number[];
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  /** `HH:MM`, local. */
  shiftStart: string;
  shiftEnd: string;
  /** Off by default - every one of these is an add-on, never a requirement
   * the clock-in button depends on. See AttendanceZone in schema.prisma. */
  geofencingEnabled: boolean;
  ipRestrictionEnabled: boolean;
  allowedIpRanges: string;
  defaultRadiusMeters: number;
  /** Day of the month, 1-28, a payroll cycle starts on. 1 = a plain calendar month. */
  payrollCycleStartDay: number;
  /** Minutes past midnight after which TODAY, with no punch and no excuse,
   * counts as absent rather than not-yet-marked. Null = that override is off. */
  autoAbsentAfterMinute: number | null;
  /** Minutes beyond fullDayMinutes required before the excess counts as
   * overtime. Null = overtime is not tracked. */
  overtimeMinMinutes: number | null;
  /** False when nothing has been saved and these are the defaults. */
  isConfigured: boolean;
  updatedAt: Date | null;
}

export const POLICY_DEFAULTS: Omit<AttendancePolicyView, 'isConfigured' | 'updatedAt'> = {
  weekOffDays: [0],
  graceMinutes: 10,
  fullDayMinutes: 480,
  halfDayMinutes: 240,
  shiftStart: '09:30',
  shiftEnd: '18:30',
  geofencingEnabled: false,
  ipRestrictionEnabled: false,
  allowedIpRanges: '',
  defaultRadiusMeters: 150,
  payrollCycleStartDay: 1,
  autoAbsentAfterMinute: null,
  overtimeMinMinutes: null,
};

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

export async function attendancePolicy(storeId: string): Promise<AttendancePolicyView> {
  const row = await db.attendancePolicy.findUnique({ where: { storeId } });
  if (!row) return { ...POLICY_DEFAULTS, isConfigured: false, updatedAt: null };

  return {
    weekOffDays: row.weekOffDays,
    graceMinutes: row.graceMinutes,
    fullDayMinutes: row.fullDayMinutes,
    halfDayMinutes: row.halfDayMinutes,
    shiftStart: row.shiftStart,
    shiftEnd: row.shiftEnd,
    geofencingEnabled: row.geofencingEnabled,
    ipRestrictionEnabled: row.ipRestrictionEnabled,
    allowedIpRanges: row.allowedIpRanges ?? '',
    defaultRadiusMeters: row.defaultRadiusMeters,
    payrollCycleStartDay: row.payrollCycleStartDay,
    autoAbsentAfterMinute: row.autoAbsentAfterMinute,
    overtimeMinMinutes: row.overtimeMinMinutes,
    isConfigured: true,
    updatedAt: row.updatedAt,
  };
}

export interface PolicyInput {
  weekOffDays: number[];
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  shiftStart: string;
  shiftEnd: string;
  geofencingEnabled: boolean;
  ipRestrictionEnabled: boolean;
  allowedIpRanges: string;
  defaultRadiusMeters: number;
  /** `HH:MM`, or null to leave auto-absent off. */
  autoAbsentAfterTime: string | null;
  /** Or null to leave overtime untracked. */
  overtimeMinMinutes: number | null;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Validated here rather than only in the form.
 *
 * A form is a convenience; this is the boundary. Everything below refuses a
 * value that would make the attendance grid produce a number nobody can
 * defend - a half-day threshold above the full-day one would quietly mark a
 * full day as an absence, and it would look like a bug in the grid rather than
 * a setting somebody typed.
 */
export async function saveAttendancePolicy(
  scope: StoreScope,
  input: PolicyInput,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);

  const weekOffDays = [...new Set(input.weekOffDays)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (weekOffDays.length >= 7) {
    throw new PolicyError('Every day cannot be a week-off. Leave at least one working day.');
  }

  if (!HHMM.test(input.shiftStart) || !HHMM.test(input.shiftEnd)) {
    throw new PolicyError('Shift start and end must be a time like 09:30.');
  }

  const grace = Math.trunc(input.graceMinutes);
  if (!Number.isFinite(grace) || grace < 0 || grace > 240) {
    throw new PolicyError('Grace must be between 0 and 240 minutes.');
  }

  const full = Math.trunc(input.fullDayMinutes);
  const half = Math.trunc(input.halfDayMinutes);
  if (!Number.isFinite(full) || full < 60 || full > 24 * 60) {
    throw new PolicyError('A full day must be between 1 and 24 hours.');
  }
  if (!Number.isFinite(half) || half < 15 || half >= full) {
    throw new PolicyError('A half day must be at least 15 minutes and less than a full day.');
  }

  const radius = Math.trunc(input.defaultRadiusMeters);
  if (!Number.isFinite(radius) || radius < 10 || radius > 5000) {
    throw new PolicyError('The check-in radius must be between 10 and 5000 metres.');
  }

  const ranges = input.allowedIpRanges.trim();
  if (input.ipRestrictionEnabled && !ranges) {
    throw new PolicyError('Add at least one IP address or range before turning restriction on.');
  }

  let autoAbsentAfterMinute: number | null = null;
  if (input.autoAbsentAfterTime) {
    if (!HHMM.test(input.autoAbsentAfterTime)) {
      throw new PolicyError('Auto-absent time must be a time like 11:00.');
    }
    autoAbsentAfterMinute = parseClock(input.autoAbsentAfterTime);
  }

  let overtimeMinMinutes: number | null = null;
  if (input.overtimeMinMinutes !== null) {
    const ot = Math.trunc(input.overtimeMinMinutes);
    if (!Number.isFinite(ot) || ot < 0 || ot > 12 * 60) {
      throw new PolicyError('The overtime threshold must be between 0 and 12 hours.');
    }
    overtimeMinMinutes = ot;
  }

  const data = {
    weekOffDays,
    graceMinutes: grace,
    fullDayMinutes: full,
    halfDayMinutes: half,
    shiftStart: input.shiftStart,
    shiftEnd: input.shiftEnd,
    geofencingEnabled: input.geofencingEnabled,
    ipRestrictionEnabled: input.ipRestrictionEnabled,
    allowedIpRanges: ranges || null,
    defaultRadiusMeters: radius,
    autoAbsentAfterMinute,
    overtimeMinMinutes,
    updatedBy: userId,
  };

  await db.attendancePolicy.upsert({
    where: { storeId },
    create: { storeId, ...data },
    update: data,
  });
}

/**
 * Kept separate from `saveAttendancePolicy` - a payroll cycle is a
 * different concern from what counts as late, saved on its own from its
 * own card, and shouldn't require re-submitting the whole working-hours
 * form (or risk clobbering it) just to change one number.
 */
export async function savePayrollCycleStartDay(
  scope: StoreScope,
  startDay: number,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!isValidCycleStartDay(startDay)) {
    throw new PolicyError('The cycle must start on a day between 1 and 28.');
  }

  await db.attendancePolicy.upsert({
    where: { storeId },
    create: { storeId, payrollCycleStartDay: startDay, updatedBy: userId },
    update: { payrollCycleStartDay: startDay, updatedBy: userId },
  });
}

/** `09:30` and 480 minutes read as "09:30 to 17:30, 8h". */
export function describePolicy(p: AttendancePolicyView): string {
  const hours = Math.floor(p.fullDayMinutes / 60);
  const mins = p.fullDayMinutes % 60;
  const day = mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
  return `${p.shiftStart} to ${p.shiftEnd}, ${day} counts as a full day, ${p.graceMinutes} min grace`;
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// --------------------------------------------------------- geofence zones

export interface ZoneRow {
  id: string;
  label: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  isActive: boolean;
}

/** A store's attendance zones - deliberately many, unlike Atlas-HRNS's one
 * circle per company. Scoped by storeId directly, not through the policy
 * row, so zones can be added before anyone has touched the rest of the
 * policy form. */
export async function listZones(storeId: string): Promise<ZoneRow[]> {
  const rows = await db.attendanceZone.findMany({
    where: { storeId, isActive: true },
    orderBy: { label: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id, label: r.label, lat: Number(r.lat), lng: Number(r.lng),
    radiusMeters: r.radiusMeters, isActive: r.isActive,
  }));
}

export interface ZoneInput {
  label: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

export async function saveZone(scope: StoreScope, id: string | null, input: ZoneInput): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!input.label.trim()) throw new PolicyError('Give the location a name.');
  if (!Number.isFinite(input.lat) || Math.abs(input.lat) > 90) throw new PolicyError('That latitude is not valid.');
  if (!Number.isFinite(input.lng) || Math.abs(input.lng) > 180) throw new PolicyError('That longitude is not valid.');
  const radius = Math.trunc(input.radiusMeters);
  if (!Number.isFinite(radius) || radius < 10 || radius > 5000) {
    throw new PolicyError('The radius must be between 10 and 5000 metres.');
  }

  const data = { label: input.label.trim(), lat: input.lat, lng: input.lng, radiusMeters: radius };

  if (id) {
    const found = await db.attendanceZone.findFirst({ where: { id, storeId } });
    if (!found) throw new PolicyError('That location is not in your scope.');
    await db.attendanceZone.update({ where: { id }, data });
    return;
  }

  await db.attendanceZone.create({ data: { storeId, ...data } });
}

export async function removeZone(scope: StoreScope, id: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const found = await db.attendanceZone.findFirst({ where: { id, storeId } });
  if (!found) throw new PolicyError('That location is not in your scope.');
  // Deactivated, not deleted - a past check-in's `startMatchedZoneId` should
  // keep meaning something when someone looks back at it later.
  await db.attendanceZone.update({ where: { id }, data: { isActive: false } });
}
