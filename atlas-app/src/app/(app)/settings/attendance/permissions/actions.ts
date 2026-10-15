'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { MarkPolicyError, saveMarkPolicy, type MarkPolicyInput } from '@/server/attendance-mark-policy';
import { RoleError, setRolePermission } from '@/server/roles';
import { friendlyError } from '@/lib/friendly-error';

/**
 * Who may correct attendance for whom, and which roles hold which
 * attendance permissions - two authorities, two guards.
 *
 * The mark-policy rules are `attendance.edit`, the same authority that
 * corrects a shift directly. Moving a permission onto or off a role is
 * `users.edit` - a larger authority than attendance itself, the same gate
 * the full Roles screen already uses.
 */

export interface PermState {
  ok?: boolean;
  error?: string;
  message?: string;
}

function fail(e: unknown): PermState {
  if (e instanceof MarkPolicyError || e instanceof RoleError) return { error: e.message };
  console.error('[attendance-permissions] action failed', e);
  return { error: friendlyError(e, true) };
}

function done(): void {
  revalidatePath('/settings/attendance/permissions');
}

export async function saveMarkPolicyAction(input: MarkPolicyInput): Promise<PermState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('attendance.edit')) {
    return { error: 'You do not have permission to change attendance settings.' };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single branch first - this rule belongs to one branch.' };
  }

  try {
    await saveMarkPolicy(ctx.scope, input, ctx.user.id);

    await db.activityLog
      .create({
        data: {
          storeId: ctx.scope.storeId,
          userId: ctx.user.id,
          activityType: 'updated',
          entityType: 'AttendanceMarkPolicy',
          entityId: ctx.scope.storeId,
          description: input.restrictToRules
            ? 'Attendance mark permissions restricted to configured rules'
            : 'Attendance mark permissions reset to unrestricted',
        },
      })
      .catch((e) => console.error('[attendance-permissions] audit write failed (non-fatal)', e));

    done();
    return { ok: true, message: 'Saved.' };
  } catch (e) {
    return fail(e);
  }
}

export async function setRolePrivilegeAction(
  roleId: string,
  permissionKey: string,
  grant: boolean,
): Promise<PermState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('users.edit')) {
    return { error: 'You do not have permission to edit roles.' };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single branch first - a role belongs to one branch.' };
  }

  try {
    await setRolePermission(ctx.scope, roleId, permissionKey, grant);

    await db.activityLog
      .create({
        data: {
          storeId: ctx.scope.storeId,
          userId: ctx.user.id,
          activityType: 'updated',
          entityType: 'Role',
          entityId: roleId,
          description: `${grant ? 'Granted' : 'Revoked'} ${permissionKey} on role`,
        },
      })
      .catch((e) => console.error('[attendance-permissions] audit write failed (non-fatal)', e));

    done();
    return { ok: true, message: 'Saved.' };
  } catch (e) {
    return fail(e);
  }
}
