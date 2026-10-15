'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  AppAccessError, roleAccessView, saveRoleAccess, saveUserAccess, userAccessView,
} from '@/server/app-access';
import type { AccessSettings } from '@/lib/app-access';

/**
 * Settings > Roles > Phone app, and the per-person override on Settings >
 * Users (26 Sep 2026, PHONE-APP-ACCESS-SPEC.md). Changing either needs the
 * same right as editing roles and users.
 */
const canChange = (p: Set<string>) => p.has('users.edit') || p.has('settings.edit');

export async function loadRoleAccessAction(roleId: string) {
  const ctx = await requireContext();
  const view = await roleAccessView(ctx.scope, roleId);
  return view ? { ...view, canEdit: canChange(ctx.permissions) } : null;
}

export async function saveRoleAccessAction(roleId: string, settings: AccessSettings): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  if (!canChange(ctx.permissions)) return { error: 'You do not have permission to change roles.' };
  try {
    await saveRoleAccess(ctx.scope, roleId, settings);
    revalidatePath('/settings/roles');
    return { ok: true };
  } catch (e) {
    if (e instanceof AppAccessError) return { error: e.message };
    console.error('[app-access] save role failed', e);
    return { error: 'Could not save. Please try again.' };
  }
}

export async function loadUserAccessAction(userId: string, storeId: string) {
  const ctx = await requireContext();
  if (!ctx.stores.some((s) => s.id === storeId)) return null;
  const view = await userAccessView(storeId, userId);
  return view ? { ...view, canEdit: canChange(ctx.permissions) } : null;
}

export async function saveUserAccessAction(userId: string, storeId: string, override: AccessSettings): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  if (!canChange(ctx.permissions)) return { error: 'You do not have permission to change users.' };
  if (!ctx.stores.some((s) => s.id === storeId)) return { error: 'That branch is not one of yours.' };
  try {
    await saveUserAccess(storeId, userId, override);
    revalidatePath('/settings/users');
    return { ok: true };
  } catch (e) {
    if (e instanceof AppAccessError) return { error: e.message };
    console.error('[app-access] save user failed', e);
    return { error: 'Could not save. Please try again.' };
  }
}
