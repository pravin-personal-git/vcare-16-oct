import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { CallLogError } from './call-log-error';
import { parseCallSyncState,
  clockSkewed, deviceChanged, deviceStatus, parsePermissionState, permissionEvents,
  type DeviceEventKind, type PermissionState,
} from '@/lib/device-trust';
import { mobileHomeFor, OWNER_PERMISSION } from '@/lib/mobile-home';

/**
 * A Vcare phone checking in, and the rule that ties an employee's login
 * to their own paired phone. Rules live in lib/device-trust; this file only
 * reads and writes.
 */

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

async function logEvents(
  tx: Prisma.TransactionClient,
  device: { id: string; storeId: string; userId: string },
  kinds: DeviceEventKind[],
  detail?: Prisma.InputJsonValue,
) {
  if (!kinds.length) return;
  await tx.deviceEvent.createMany({
    data: kinds.map((kind) => ({ storeId: device.storeId, deviceId: device.id, userId: device.userId, kind, detail })),
  });
}

export interface CheckInReport {
  androidId?: string | null;
  permissions?: unknown;
  /** The phone's own clock, epoch ms. */
  clientTime?: number | null;
  appVersion?: string | null;
  /** Whether the app believes a shift is running (for the silence threshold). */
  onShift?: boolean;
  /** Where the phone's last call sync stopped (Vcare 1.0.4+). */
  callSync?: unknown;
}

export interface CheckInResult {
  serverTime: string;
  /** The phone is no longer the one that was paired - it must be paired again. */
  mustRepair: boolean;
  revoked: boolean;
}

/**
 * Record a check-in. Transitions become events once (lib/device-trust), a
 * different ANDROID_ID is refused, and a phone that had gone quiet or had
 * been reported removed is marked as reporting again.
 */
export async function checkInDevice(token: string, report: CheckInReport, ip: string | null): Promise<CheckInResult> {
  const now = new Date();
  const d = token
    ? await db.callSyncDevice.findUnique({
      where: { tokenHash: hash(token) },
      select: {
        id: true, storeId: true, userId: true, isActive: true, androidId: true, lastSyncedAt: true,
        appRemovedAt: true, pairedAt: true, permissionState: true,
        user: { select: { isActive: true } },
      },
    })
    : null;
  if (!d) throw new CallLogError('This phone is not paired. Ask your admin for a pairing code.');
  if (!d.isActive || !d.user.isActive) {
    return { serverTime: now.toISOString(), mustRepair: true, revoked: true };
  }

  const androidId = typeof report.androidId === 'string' ? report.androidId.trim().slice(0, 64) : null;
  if (deviceChanged(d.androidId, androidId)) {
    await db.$transaction(async (tx) => {
      await tx.callSyncDevice.update({ where: { id: d.id }, data: { isActive: false, revokedAt: now } });
      await logEvents(tx, d, ['device_changed'], { paired: d.androidId, reported: androidId });
    });
    return { serverTime: now.toISOString(), mustRepair: true, revoked: true };
  }

  const next = parsePermissionState(report.permissions);
  const prev = parsePermissionState(d.permissionState);
  const skew = typeof report.clientTime === 'number' && Number.isFinite(report.clientTime)
    ? Math.round(report.clientTime - now.getTime())
    : null;

  const kinds: DeviceEventKind[] = [];
  const before = deviceStatus(d, !!report.onShift, now);
  if (before === 'not_reporting' || before === 'app_removed') kinds.push('reporting_again');
  if (next) kinds.push(...permissionEvents(prev, next));
  if (clockSkewed(skew)) kinds.push('clock_changed');

  await db.$transaction(async (tx) => {
    await tx.callSyncDevice.update({
      where: { id: d.id },
      data: {
        lastSyncedAt: now,
        lastIp: ip,
        appRemovedAt: null,
        clockSkewMs: skew,
        ...(androidId && !d.androidId ? { androidId } : {}),
        ...(next ? { permissionState: next as unknown as Prisma.InputJsonValue } : {}),
        ...(parseCallSyncState(report.callSync) ? { callSyncState: parseCallSyncState(report.callSync) as unknown as Prisma.InputJsonValue } : {}),
        ...(report.appVersion ? { appVersion: String(report.appVersion).slice(0, 40) } : {}),
      },
    });
    await logEvents(tx, d, kinds, skew !== null && kinds.includes('clock_changed') ? { skewMs: skew } : undefined);
  });
  // The day's phone health for the scorecard (31 Oct 2026): every flag seen today, kept.
  await recordHealthDay(d.storeId, d.userId, now, next ?? prev, skew).catch((e) => console.error('[device] health day failed', e));

  return { serverTime: now.toISOString(), mustRepair: false, revoked: false };
}

export type PhoneLoginCheck =
  | { ok: true }
  | { ok: false; code: 'pair_required' | 'paired_to_other'; message: string };

/**
 * Employees sign in only on the phone paired to them (decided 24 Sep 2026).
 * Owners - whoever may change settings, lib/mobile-home - sign in anywhere:
 * they are the ones issuing the pairing codes.
 */
export async function checkPhoneForLogin(userId: string, deviceToken: string | null): Promise<PhoneLoginCheck> {
  const keys = await db.rolePermission.findMany({
    where: { role: { userStoreRoles: { some: { userId } } }, permission: { key: OWNER_PERMISSION } },
    select: { permission: { select: { key: true } } },
    take: 1,
  });
  if (mobileHomeFor(keys.map((k) => k.permission.key)) === 'owner') return { ok: true };

  const device = deviceToken
    ? await db.callSyncDevice.findUnique({
      where: { tokenHash: hash(deviceToken) },
      select: { userId: true, isActive: true, user: { select: { fullName: true } } },
    })
    : null;
  if (!device || !device.isActive) {
    return { ok: false, code: 'pair_required', message: 'Pair this phone first. Ask your admin for a pairing code.' };
  }
  if (device.userId !== userId) {
    return { ok: false, code: 'paired_to_other', message: `This phone is paired to ${device.user.fullName}. Sign in with that account, or ask your admin to pair it to you.` };
  }
  return { ok: true };
}

export type { PermissionState };

/**
 * One row per person per IST day with every flag the phone reported that day
 * (scorecard Phone pillar, 31 Oct 2026). A flag once seen stays for the day:
 * a phone that had location off at 11 and on at 4 had a bad day.
 */
async function recordHealthDay(storeId: string, userId: string, now: Date, p: PermissionState | null, skew: number | null) {
  const flags: string[] = [];
  if (p) {
    if (p.location !== 'always' || !p.locationServices) flags.push('location_off');
    if (!p.callLog || !p.notifications) flags.push('permissions_missing');
    if (!p.batteryUnrestricted) flags.push('battery_restricted');
  }
  if (clockSkewed(skew)) flags.push('clock_changed');
  const day = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const had = await db.deviceHealthDay.findUnique({ where: { userId_day: { userId, day } }, select: { flags: true } });
  const all = [...new Set([...(had?.flags ?? []), ...flags])];
  await db.deviceHealthDay.upsert({
    where: { userId_day: { userId, day } },
    create: { storeId, userId, day, flags: all },
    update: { flags: all },
  });
}
