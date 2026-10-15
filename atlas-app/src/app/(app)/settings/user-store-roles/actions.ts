'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { AdminError, assignRole, removeAssignment } from '@/server/administration';
import { friendlyError } from '@/lib/friendly-error';

/**
 * Grant and revoke a role in a store.
 *
 * The server functions behind these already existed and are already used by the
 * Users screen - this screen is a second way in, not a second implementation.
 * That matters because `removeAssignment` carries two guards that must never be
 * bypassed: you cannot remove your own last role, and you cannot remove the last
 * administrator of a store. Either would leave somebody locked out with no way
 * back in, and a matrix screen makes both far easier to do by accident.
 */

export interface MatrixState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function run(
  fn: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<string>,
): Promise<MatrixState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('users.edit')) {
      return { error: 'You do not have permission to change role assignments.' };
    }
    const message = await fn(ctx);
    revalidatePath('/settings/user-store-roles');
    revalidatePath('/settings/users');
    return { ok: true, message };
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    console.error('[user-store-roles] action failed', err);
    return { error: friendlyError(err) };
  }
}

async function audit(
  ctx: Awaited<ReturnType<typeof requireContext>>,
  storeId: string,
  activityType: string,
  userId: string,
  description: string,
) {
  await db.activityLog
    .create({
      data: {
        storeId,
        userId: ctx.user.id,
        activityType,
        entityType: 'UserStoreRole',
        entityId: userId,
        description,
      },
    })
    .catch((e) => console.error('[user-store-roles] audit write failed (non-fatal)', e));
}

export async function grantAction(
  userId: string,
  storeId: string,
  roleId: string,
): Promise<MatrixState> {
  return run(async (ctx) => {
    await assignRole(ctx.organization.id, userId, storeId, roleId);

    const [user, role, store] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
      db.role.findUnique({ where: { id: roleId }, select: { name: true } }),
      db.store.findUnique({ where: { id: storeId }, select: { name: true } }),
    ]);

    await audit(ctx, storeId, 'Role Granted', userId,
      `${user?.fullName ?? 'Someone'} was given ${role?.name ?? 'a role'} in ${store?.name ?? 'a store'}`);

    return `${user?.fullName ?? 'They'} now hold ${role?.name ?? 'that role'} in ${store?.name ?? 'that store'}.`;
  });
}

export async function revokeAction(
  userId: string,
  storeId: string,
  roleId: string,
): Promise<MatrixState> {
  return run(async (ctx) => {
    await removeAssignment(ctx.organization.id, userId, storeId, roleId, ctx.user.id);

    const [user, role, store] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
      db.role.findUnique({ where: { id: roleId }, select: { name: true } }),
      db.store.findUnique({ where: { id: storeId }, select: { name: true } }),
    ]);

    await audit(ctx, storeId, 'Role Revoked', userId,
      `${user?.fullName ?? 'Someone'} lost ${role?.name ?? 'a role'} in ${store?.name ?? 'a store'}`);

    return `${role?.name ?? 'That role'} removed from ${user?.fullName ?? 'them'} in ${store?.name ?? 'that store'}.`;
  });
}
