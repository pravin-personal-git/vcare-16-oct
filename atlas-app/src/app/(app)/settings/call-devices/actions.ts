'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { createPairing, revokeDevice, setCaptureMode } from '@/server/call-logs';
import type { CaptureMode } from '@/lib/call-log';
import { canPairPhones } from '@/lib/device-trust';

/**
 * Pairing and revoking phones.
 *
 * `calls.manage`, not `calls.view`. Reading a team's call figures is a manager's
 * report; deciding which handset is trusted to post them is a different and
 * larger authority - a paired device can write call history for that employee
 * until somebody revokes it.
 */

export interface DeviceState {
  ok?: boolean;
  error?: string;
  message?: string;
  code?: string;
  expiresAt?: string;
}

const CAN_MANAGE = 'calls.manage';

/**
 * Pairing and switching phones off: the admin, or anyone given "Pair phones"
 * (devices.pair). Which calls are collected stays with calls.manage.
 */
async function guard(needs: 'pair' | 'manage' = 'pair') {
  const ctx = await requireContext();
  const allowed = needs === 'pair' ? canPairPhones(ctx.permissions) : ctx.permissions.has(CAN_MANAGE);
  if (!allowed) {
    return { error: needs === 'pair' ? 'You do not have permission to pair phones.' : 'You do not have permission to change which calls are collected.' };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single store first - a phone belongs to one branch.' };
  }
  return { ctx, storeId: ctx.scope.storeId };
}

async function log(
  storeId: string, userId: string, entityId: string,
  activityType: string, description: string,
) {
  await db.activityLog
    .create({
      data: {
        storeId, userId, activityType,
        entityType: 'CallSyncDevice', entityId, description,
      },
    })
    .catch((e) => console.error('[call-devices] audit write failed (non-fatal)', e));
}

export async function pairDevice(
  targetUserId: string,
  label: string | null,
): Promise<DeviceState> {
  try {
    const g = await guard();
    if ('error' in g) return g;

    const r = await createPairing(g.ctx.scope, targetUserId, label, g.ctx.user.id);

    await log(
      g.storeId, g.ctx.user.id, r.id, 'create',
      `Pairing code issued for a call sync device`,
    );

    revalidatePath('/settings/call-devices');
    return {
      ok: true,
      code: r.code,
      expiresAt: r.expiresAt.toISOString(),
      message: 'Type this code into the Vcare app on the phone (Business login → Pair this phone).',
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function revoke(deviceId: string): Promise<DeviceState> {
  try {
    const g = await guard();
    if ('error' in g) return g;

    await revokeDevice(g.ctx.scope, deviceId, g.ctx.user.id);
    await log(g.storeId, g.ctx.user.id, deviceId, 'update', 'Call sync device revoked');

    revalidatePath('/settings/call-devices');
    revalidatePath('/call-logs');
    return {
      ok: true,
      message: 'Revoked. The phone stops reporting on its next sync. '
        + 'Calls it already sent are kept - they are a record of work that happened.',
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function changeCaptureMode(mode: CaptureMode): Promise<DeviceState> {
  try {
    const g = await guard('manage');
    if ('error' in g) return g;

    await setCaptureMode(g.ctx.scope, mode);
    await log(
      g.storeId, g.ctx.user.id, g.storeId, 'update',
      `Call capture mode set to ${mode}`,
    );

    revalidatePath('/settings/call-devices');
    revalidatePath('/call-logs');
    return {
      ok: true,
      message: mode === 'all'
        ? 'Now capturing every call. This takes effect on the next sync - it does not '
          + 'reach back and collect calls the phones never sent. Tell your staff.'
        : 'Now capturing only calls to numbers in the CRM. Personal calls will not be '
          + 'sent from this point on.',
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
