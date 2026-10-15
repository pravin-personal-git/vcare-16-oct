'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { getSessionToken } from '@/server/auth/session';
import { AdminError, revokeAllForUser, revokeSession, revokePairedDeviceOrgWide } from '@/server/administration';
import { friendlyError } from '@/lib/friendly-error';

export interface SessionActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

async function guard(
  run: (
    ctx: Awaited<ReturnType<typeof requireContext>>,
    token: string | null,
  ) => Promise<string | void>,
): Promise<SessionActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('users.edit')) {
      return { error: 'You do not have permission to end other people’s sessions.' };
    }
    const token = await getSessionToken();
    const message = await run(ctx, token);
    revalidatePath('/settings/login-sessions');
    return { ok: true, ...(message ? { message } : {}) };
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    console.error('[sessions] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function endSession(sessionId: string): Promise<SessionActionState> {
  return guard(async (ctx, token) => {
    await revokeSession(ctx.organization.id, sessionId, token);
    return 'Session ended. That device is signed out on its next request.';
  });
}

export async function endAllForUser(userId: string): Promise<SessionActionState> {
  return guard(async (ctx, token) => {
    const count = await revokeAllForUser(ctx.organization.id, userId, token);
    return count === 0
      ? 'That user had no other open sessions.'
      : `${count} session${count === 1 ? '' : 's'} ended.`;
  });
}

export async function revokePairedDeviceAction(deviceId: string): Promise<SessionActionState> {
  return guard(async (ctx) => {
    await revokePairedDeviceOrgWide(ctx.organization.id, deviceId, ctx.user.id);
    return 'Phone revoked. It can no longer sync calls or attendance.';
  });
}
