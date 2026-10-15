'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformContext } from '@/server/platform-context';
import {
  createTenant, suspendTenant, reactivateTenant, scheduleLock, cancelScheduledLock,
  PlatformAdminError, type CreateTenantInput,
} from '@/server/platform-admin';
import { isOrgInMembershipScope } from '@/server/platform-scope';
import { ensureElevated } from '@/server/auth/elevation';

export interface CreateTenantState {
  ok?: boolean;
  error?: string;
  adminUsername?: string;
}

export async function createTenantAction(
  platformAccountId: string, input: CreateTenantInput,
): Promise<CreateTenantState> {
  const ctx = await requirePlatformContext();
  if (!ctx.permissions.has('platformTenant.create')) {
    return { error: 'You do not have permission to create tenants.' };
  }
  // Never trust the client-supplied platformAccountId on its own - it must
  // be one this caller actually holds a membership over, or a reseller
  // could pass another reseller's id and create a tenant under a subtree
  // they don't own.
  const owns = ctx.memberships.some((m) => m.platformAccountId === platformAccountId);
  if (!owns) {
    return { error: 'You do not have access to that platform account.' };
  }

  try {
    const result = await createTenant(platformAccountId, input);
    revalidatePath('/platform/tenants');
    return { ok: true, adminUsername: result.adminUsername };
  } catch (e) {
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/tenants] createTenant failed', e);
    return { error: 'Could not create that tenant. Please try again.' };
  }
}

// ===========================================================================
// TENANT LIFECYCLE (superadmin-roadmap Slice 6, D054 reauth added 22 Sep 2026
// per D057 - the shipped version originally lacked it; see that decision's
// note for why it was flagged rather than silently changed at the time)
// ===========================================================================

export interface LifecycleState {
  ok?: boolean;
  error?: string;
}

async function assertCanManageLifecycle(organizationId: string, password: string) {
  const ctx = await requirePlatformContext();
  if (!ctx.permissions.has('platformTenant.suspend')) {
    throw new PlatformAdminError('You do not have permission to change a tenant\'s status.');
  }
  if (!(await isOrgInMembershipScope(ctx.memberships, organizationId))) {
    throw new PlatformAdminError('You do not have access to that tenant.');
  }
  const elevationError = await ensureElevated(ctx.user.id, password);
  if (elevationError) throw new PlatformAdminError(elevationError);
  return ctx;
}

export async function suspendTenantAction(
  organizationId: string, reason: string, password: string,
): Promise<LifecycleState> {
  try {
    const ctx = await assertCanManageLifecycle(organizationId, password);
    await suspendTenant(ctx.user.id, organizationId, reason);
  } catch (e) {
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/tenants] suspendTenant failed', e);
    return { error: 'Could not suspend that tenant. Please try again.' };
  }
  revalidatePath('/platform/tenants');
  return { ok: true };
}

export async function reactivateTenantAction(
  organizationId: string, reason: string, password: string,
): Promise<LifecycleState> {
  try {
    const ctx = await assertCanManageLifecycle(organizationId, password);
    await reactivateTenant(ctx.user.id, organizationId, reason);
  } catch (e) {
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/tenants] reactivateTenant failed', e);
    return { error: 'Could not reactivate that tenant. Please try again.' };
  }
  revalidatePath('/platform/tenants');
  return { ok: true };
}

export async function scheduleLockAction(
  organizationId: string, atIso: string, reason: string, password: string,
): Promise<LifecycleState> {
  try {
    const ctx = await assertCanManageLifecycle(organizationId, password);
    const at = new Date(atIso);
    if (Number.isNaN(at.getTime())) throw new PlatformAdminError('Enter a valid date.');
    await scheduleLock(ctx.user.id, organizationId, at, reason);
  } catch (e) {
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/tenants] scheduleLock failed', e);
    return { error: 'Could not schedule that lock. Please try again.' };
  }
  revalidatePath('/platform/tenants');
  return { ok: true };
}

export async function cancelScheduledLockAction(organizationId: string, password: string): Promise<LifecycleState> {
  try {
    const ctx = await assertCanManageLifecycle(organizationId, password);
    await cancelScheduledLock(ctx.user.id, organizationId);
  } catch (e) {
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/tenants] cancelScheduledLock failed', e);
    return { error: 'Could not cancel the scheduled lock. Please try again.' };
  }
  revalidatePath('/platform/tenants');
  return { ok: true };
}
