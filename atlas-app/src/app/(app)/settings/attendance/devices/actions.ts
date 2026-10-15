'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import {
  AttendanceDeviceError, createDevice, listDeviceEvents, revokeDevice,
  type CreateDeviceInput,
} from '@/server/attendance-devices';
import { friendlyError } from '@/lib/friendly-error';

/**
 * Registering and revoking biometric/punch devices.
 *
 * `attendance.edit`, not a separate key - this is configuration, the same
 * authority that corrects a shift or sets the shift start time.
 */

export interface DeviceState {
  ok?: boolean;
  error?: string;
  message?: string;
  deviceId?: string;
  token?: string;
}

async function guard() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('attendance.edit')) {
    return { error: 'You do not have permission to manage attendance devices.' as const };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single branch first - a device belongs to one branch.' as const };
  }
  return { ctx, storeId: ctx.scope.storeId };
}

function fail(e: unknown): DeviceState {
  if (e instanceof AttendanceDeviceError) return { error: e.message };
  console.error('[attendance-devices] action failed', e);
  return { error: friendlyError(e, true) };
}

function done(): void {
  revalidatePath('/settings/attendance/devices');
}

export async function createDeviceAction(input: CreateDeviceInput): Promise<DeviceState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    const { id, token } = await createDevice(g.ctx.scope, input, g.ctx.user.id);

    await db.activityLog
      .create({
        data: {
          storeId: g.storeId,
          userId: g.ctx.user.id,
          activityType: 'create',
          entityType: 'AttendanceDevice',
          entityId: id,
          description: `Attendance device "${input.label.trim()}" registered`,
        },
      })
      .catch((e) => console.error('[attendance-devices] audit write failed (non-fatal)', e));

    done();
    return {
      ok: true,
      deviceId: id,
      token,
      message: 'Device registered. Copy the token now - it will not be shown again.',
    };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeDeviceAction(deviceId: string): Promise<DeviceState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await revokeDevice(g.ctx.scope, deviceId, g.ctx.user.id);

    await db.activityLog
      .create({
        data: {
          storeId: g.storeId,
          userId: g.ctx.user.id,
          activityType: 'update',
          entityType: 'AttendanceDevice',
          entityId: deviceId,
          description: 'Attendance device revoked',
        },
      })
      .catch((e) => console.error('[attendance-devices] audit write failed (non-fatal)', e));

    done();
    return { ok: true, message: 'Revoked. Punches already recorded are kept.' };
  } catch (e) {
    return fail(e);
  }
}

export interface DeviceEventsState {
  events?: { id: string; accepted: number; rejected: number; errorMessage: string | null; receivedAt: string }[];
  error?: string;
}

export async function loadDeviceEventsAction(deviceId: string): Promise<DeviceEventsState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    const events = await listDeviceEvents(g.ctx.scope, deviceId);
    return { events: events.map((e) => ({ ...e, receivedAt: e.receivedAt.toISOString() })) };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------- F2.5 capture

export interface VendorState { ok?: boolean; error?: string; message?: string }

/**
 * Choose the adapter for a machine, and store its non-secret settings.
 *
 * `setDeviceVendor` refuses anything the adapter marks secret, and the refusal
 * reaches the admin rather than being stripped quietly - somebody who typed a
 * password into the wrong box must be told, or they will believe the connector
 * is configured when it is not.
 */
export async function setDeviceVendorAction(
  deviceId: string,
  input: { vendor: string; directionMode: 'from_state' | 'first_last'; config: Record<string, string> },
): Promise<VendorState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    const { setDeviceVendor } = await import('@/server/attendance-capture/setup');
    await setDeviceVendor(g.ctx.scope, deviceId, input);
    done();
    return { ok: true, message: 'Saved. Follow the connector steps below.' };
  } catch (e) {
    return fail(e);
  }
}

export interface MapState { ok?: boolean; error?: string; message?: string }

export async function mapCodeAction(employeeCode: string, userId: string): Promise<MapState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    const { mapCode } = await import('@/server/attendance-capture/mapping');
    const r = await mapCode(g.ctx.scope, employeeCode, userId, g.ctx.user.id);

    await db.activityLog
      .create({
        data: {
          storeId: g.storeId,
          userId: g.ctx.user.id,
          activityType: 'update',
          entityType: 'AttendancePunch',
          entityId: employeeCode,
          description: `Attendance code ${employeeCode} mapped to a person; ${r.applied} waiting punches applied`,
        },
      })
      .catch((e) => console.error('[attendance-devices] audit write failed (non-fatal)', e));

    done();
    return {
      ok: true,
      message: r.applied > 0
        ? `Mapped. ${r.applied} punch${r.applied === 1 ? '' : 'es'} that were waiting have been counted.`
        : 'Mapped. New punches for this code will count from now on.',
    };
  } catch (e) {
    return fail(e);
  }
}

export async function unmapCodeAction(employeeCode: string): Promise<MapState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    const { unmapCode } = await import('@/server/attendance-capture/mapping');
    const n = await unmapCode(g.ctx.scope, employeeCode);
    done();
    return { ok: true, message: `Unmapped. ${n} punch${n === 1 ? '' : 'es'} kept, but no longer counted for anybody.` };
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------- the office connector (9 Oct 2026)

export interface AgentState { ok?: boolean; error?: string; message?: string }

/**
 * Change a connector's settings from Atlas. It picks them up at its next
 * check-in (within its poll interval) - no visit to the client's PC.
 */
export async function saveAgentSettingsAction(
  deviceId: string,
  input: { clockOffsetMinutes: number; pollSeconds: number; overlapMinutes: number },
): Promise<AgentState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    const { cleanAgentSettings } = await import('@/lib/attendance-capture/agent-protocol');
    const settings = cleanAgentSettings(input);
    const updated = await db.attendanceDevice.updateMany({
      where: { id: deviceId, storeId: g.storeId },
      data: { agentSettings: settings as object },
    });
    if (updated.count === 0) return { error: 'Device not found in your branch.' };

    await db.activityLog
      .create({
        data: {
          storeId: g.storeId, userId: g.ctx.user.id, activityType: 'update',
          entityType: 'AttendanceDevice', entityId: deviceId,
          description: `Attendance connector settings: clock offset ${settings.clockOffsetMinutes} min, `
            + `poll every ${settings.pollSeconds} s, re-read ${settings.overlapMinutes} min`,
        },
      })
      .catch((e) => console.error('[attendance-devices] audit write failed (non-fatal)', e));

    done();
    return { ok: true, message: 'Saved. The connector uses these from its next check-in.' };
  } catch (e) {
    return fail(e);
  }
}

/**
 * "Test now": the connector runs a test poll at its next check-in and reports
 * whether it reached BioTime, how many punches BioTime holds for the last
 * week, and which terminals BioTime knows - the answers a site visit was for.
 */
export async function requestAgentTestAction(deviceId: string): Promise<AgentState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    const updated = await db.attendanceDevice.updateMany({
      where: { id: deviceId, storeId: g.storeId, isActive: true },
      data: { testRequestedAt: new Date() },
    });
    if (updated.count === 0) return { error: 'Device not found in your branch, or it has been revoked.' };
    done();
    return { ok: true, message: 'Test requested. The connector runs it at its next check-in - refresh in a few minutes.' };
  } catch (e) {
    return fail(e);
  }
}
