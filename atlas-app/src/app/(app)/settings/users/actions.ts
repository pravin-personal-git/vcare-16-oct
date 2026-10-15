'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import {
  AdminError,
  assignRole,
  createUser,
  removeAssignment,
  issueTemporaryPassword,
  resetUserPassword,
  setUserActive,
  updateUser,
  type UserInput,
} from '@/server/administration';
import { friendlyError } from '@/lib/friendly-error';
import { readPasswordCopy } from '@/server/password-copy';
import { ensureElevated, isElevated } from '@/server/auth/elevation';

export interface UserActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

async function guard(
  run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<string | void>,
): Promise<UserActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('users.edit')) {
      return { error: 'You do not have permission to manage users.' };
    }
    const message = await run(ctx);
    revalidatePath('/settings/users');
    return { ok: true, ...(message ? { message } : {}) };
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    console.error('[users] action failed', err);
    return { error: friendlyError(err) };
  }
}

/**
 * Audit writes land against the store the change concerns.
 *
 * A user is organisation-level but `ActivityLog` is store-scoped, so an
 * organisation-level event has to pick one. It picks the store the acting admin
 * is currently in - which is the store whose audit log they will look in when
 * they come back asking what happened.
 */
async function audit(
  ctx: Awaited<ReturnType<typeof requireContext>>,
  activityType: string,
  description: string,
  entityId?: string,
) {
  if (ctx.scope.kind !== 'single') return;
  await db.activityLog
    .create({
      data: {
        storeId: ctx.scope.storeId,
        userId: ctx.user.id,
        activityType,
        entityType: 'User',
        entityId: entityId ?? null,
        description,
      },
    })
    .catch((e) => console.error('[users] audit write failed (non-fatal)', e));
}

export async function addUser(input: UserInput): Promise<UserActionState> {
  return guard(async (ctx) => {
    const created = await createUser(ctx.organization.id, input);
    await audit(ctx, 'Create', `User '${created.fullName}' created (${created.username})`, created.id);
    return `${created.fullName} can now sign in as "${created.username}".`;
  });
}

export async function editUser(
  userId: string,
  patch: {
    fullName?: string;
    email?: string | null;
    phone?: string | null;
    departmentId?: string | null;
    isSeatLicensed?: boolean;
    avatarColor?: string | null;
  },
): Promise<UserActionState> {
  return guard(async (ctx) => {
    const updated = await updateUser(ctx.organization.id, userId, patch);
    await audit(ctx, 'Update', `User '${updated.fullName}' edited`, userId);
  });
}

export async function toggleUserActive(
  userId: string,
  isActive: boolean,
): Promise<UserActionState> {
  return guard(async (ctx) => {
    const updated = await setUserActive(ctx.organization.id, userId, isActive, ctx.user.id);
    await audit(
      ctx,
      'Update',
      `User '${updated.fullName}' ${isActive ? 'reactivated' : 'deactivated and signed out everywhere'}`,
      userId,
    );
    return isActive
      ? `${updated.fullName} can sign in again.`
      : `${updated.fullName} is deactivated and every open session was ended.`;
  });
}

export async function setPassword(userId: string, password: string): Promise<UserActionState> {
  return guard(async (ctx) => {
    await resetUserPassword(ctx.organization.id, userId, password);
    await audit(ctx, 'Update', 'Password reset by an administrator', userId);
    return 'Password set. Every open session for that user was ended; they sign in with this one.';
  });
}

/**
 * Reset a password without anybody inventing one, and show it ONCE.
 *
 * The answer to "let me see each employee's password". Seeing them is not
 * possible - `passwordHash` is a one-way scrypt fingerprint, there is nothing
 * stored to show - and making it possible would mean one database leak handing
 * over every employee's password in plain text, which people reuse on their
 * bank. lib/password-policy carries the whole reasoning.
 *
 * What the request was really about is solved here: one button, no typing, and
 * the password on screen to read out.
 *
 * Superseded in part on 9 Oct 2026: Vcare still wanted to see passwords, and
 * Pravin chose to build it - see `viewPassword` below and
 * server/password-copy.ts. So a second look no longer needs a second reset.
 *
 * NOT returned through `guard`'s message string - it goes in its own field, so
 * nothing that logs or toasts a message can carry a password by accident.
 */
export async function issuePassword(userId: string): Promise<
  UserActionState & { password?: string; username?: string; fullName?: string }
> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('users.edit')) {
      return { error: 'You do not have permission to reset passwords.' };
    }
    if (userId === ctx.user.id) {
      // Resetting your own this way would show you a password you then have to
      // change anyway, and sign you out of everything else for no reason.
      return { error: 'To change your own password, use Change my password on your account page.' };
    }

    const r = await issueTemporaryPassword(ctx.organization.id, userId);
    await audit(ctx, 'Update', 'Temporary password issued by an administrator', userId);

    return {
      ok: true,
      message: `${r.fullName} is signed out everywhere. Send them the password below.`,
      password: r.password,
      username: r.username,
      fullName: r.fullName,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not reset that password.' };
  }
}

/**
 * Show a user's current password to an admin (Vcare, 9 Oct 2026).
 *
 * Three gates, in order: the `users.viewPasswords` permission; the viewer's
 * OWN password, re-entered within the last 15 minutes (so an admin's laptop
 * left open is not a list of everybody's passwords); and a log line naming
 * who looked at whose. The password goes back in its own field, never in
 * `message`, for the same reason as `issuePassword` above.
 *
 * `myPassword` may be empty when the viewer is still inside the 15-minute
 * window; the screen asks for it only when the reply says so.
 */
export async function viewPassword(userId: string, myPassword: string): Promise<{
  error?: string;
  needsMyPassword?: boolean;
  state?: 'ok' | 'none' | 'no_key' | 'stale';
  password?: string;
  setAt?: string;
}> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('users.viewPasswords')) {
      return { error: 'Only an administrator can see passwords.' };
    }
    if (!myPassword && !(await isElevated(ctx.user.id))) return { needsMyPassword: true };
    const denied = await ensureElevated(ctx.user.id, myPassword);
    if (denied) return { error: denied === 'Incorrect password.' ? 'That is not your password.' : denied, needsMyPassword: true };

    const copy = await readPasswordCopy(ctx.organization.id, userId);
    if (copy.state !== 'ok') return { state: copy.state };

    // NOT the `audit` helper above: that one skips "All Company" mode and
    // swallows failures, which is fine for a role change and not for this.
    // The log line is written first, and if it cannot be, nothing is shown.
    const storeId = ctx.scope.kind === 'single' ? ctx.scope.storeId : ctx.stores[0]?.id;
    if (!storeId) return { error: 'Could not record this view, so the password was not shown.' };
    await db.activityLog.create({
      data: {
        storeId, userId: ctx.user.id, activityType: 'View', entityType: 'User', entityId: userId,
        description: 'Password viewed by an administrator',
      },
    });
    return { state: 'ok', password: copy.password, setAt: copy.setAt.toISOString() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not read that password.' };
  }
}

export async function grantRole(
  userId: string,
  storeId: string,
  roleId: string,
): Promise<UserActionState> {
  return guard(async (ctx) => {
    await assignRole(ctx.organization.id, userId, storeId, roleId);
    await audit(ctx, 'Update', 'Role granted', userId);
  });
}

export async function revokeRole(
  userId: string,
  storeId: string,
  roleId: string,
): Promise<UserActionState> {
  return guard(async (ctx) => {
    await removeAssignment(ctx.organization.id, userId, storeId, roleId, ctx.user.id);
    await audit(ctx, 'Update', 'Role revoked', userId);
  });
}
