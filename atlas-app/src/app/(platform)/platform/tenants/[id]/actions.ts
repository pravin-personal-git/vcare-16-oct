'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformContext } from '@/server/platform-context';
import {
  resetTenantAdminPassword, changeTenantAdminUsername, forceLogoutUser, setTenantFlags, setTenantPlan,
  PlatformAdminError, type TenantFlags,
} from '@/server/platform-admin';
import { isOrgInMembershipScope, requireRootPlatformOwner, RootPlatformOwnerRequiredError } from '@/server/platform-scope';
import { ensureElevated } from '@/server/auth/elevation';

export interface CredentialActionState {
  ok?: boolean;
  error?: string;
}

/**
 * Superadmin-roadmap Slice 7 - "the single most sensitive slice in the
 * whole roadmap." Every action below is gated three ways: the ordinary
 * `platformTenant.manageCredentials` permission, `isOrgInMembershipScope`
 * (never act on a tenant outside the caller's own scope), and D054's reauth
 * elevation (re-entering the current password within the last ~15 minutes).
 * Password reset and username change additionally require
 * `requireRootPlatformOwner()` per D055 - resetting a tenant admin's login
 * must never become available to a second platform-tier account without a
 * deliberate decision to extend it. Force logout does not carry that extra
 * guard, per the roadmap's own scoping ("a lighter action... useful on its
 * own").
 */
async function assertCanManageCredentials(organizationId: string) {
  const ctx = await requirePlatformContext();
  if (!ctx.permissions.has('platformTenant.manageCredentials')) {
    throw new PlatformAdminError('You do not have permission to manage tenant credentials.');
  }
  if (!(await isOrgInMembershipScope(ctx.memberships, organizationId))) {
    throw new PlatformAdminError('You do not have access to that tenant.');
  }
  return ctx;
}

export async function resetTenantAdminPasswordAction(
  organizationId: string, userId: string, newPassword: string, password: string, reason: string,
): Promise<CredentialActionState> {
  try {
    const ctx = await assertCanManageCredentials(organizationId);
    await requireRootPlatformOwner(ctx.user.id);
    const elevationError = await ensureElevated(ctx.user.id, password);
    if (elevationError) return { error: elevationError };
    await resetTenantAdminPassword(ctx.user.id, organizationId, userId, newPassword, reason);
  } catch (e) {
    if (e instanceof RootPlatformOwnerRequiredError) return { error: e.message };
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/tenants] resetTenantAdminPassword failed', e);
    return { error: 'Could not reset that password. Please try again.' };
  }
  revalidatePath(`/platform/tenants/${organizationId}`);
  return { ok: true };
}

export async function changeTenantAdminUsernameAction(
  organizationId: string, userId: string, newUsername: string, password: string, reason: string,
): Promise<CredentialActionState> {
  try {
    const ctx = await assertCanManageCredentials(organizationId);
    await requireRootPlatformOwner(ctx.user.id);
    const elevationError = await ensureElevated(ctx.user.id, password);
    if (elevationError) return { error: elevationError };
    await changeTenantAdminUsername(ctx.user.id, organizationId, userId, newUsername, reason);
  } catch (e) {
    if (e instanceof RootPlatformOwnerRequiredError) return { error: e.message };
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/tenants] changeTenantAdminUsername failed', e);
    return { error: 'Could not change that username. Please try again.' };
  }
  revalidatePath(`/platform/tenants/${organizationId}`);
  return { ok: true };
}

export async function forceLogoutUserAction(
  organizationId: string, userId: string, password: string, reason: string,
): Promise<CredentialActionState> {
  try {
    const ctx = await assertCanManageCredentials(organizationId);
    const elevationError = await ensureElevated(ctx.user.id, password);
    if (elevationError) return { error: elevationError };
    await forceLogoutUser(ctx.user.id, organizationId, userId, reason);
  } catch (e) {
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/tenants] forceLogoutUser failed', e);
    return { error: 'Could not force a logout for that user. Please try again.' };
  }
  revalidatePath(`/platform/tenants/${organizationId}`);
  return { ok: true };
}

// ===========================================================================
// TENANT CAPABILITY FLAGS (Slice 8)
// ===========================================================================

export interface FlagsActionState {
  ok?: boolean;
  error?: string;
}

/**
 * Put a tenant on a plan (workstream F).
 *
 * Same permission as the other plan controls: deciding what a client may have
 * is one job, and splitting it across two permissions would mean somebody who
 * can raise a branch limit cannot raise a user limit.
 */
export async function setTenantPlanAction(organizationId: string, input: {
  planId: string;
  userLimit: number | null;
  excludedModules: string[] | null;
  /** Individual pages switched off for this client, as routes (F-01, 10 Oct 2026). */
  excludedPages: string[];
  trialEndsAt: string | null;
  enabledFeatures: string[];
}): Promise<FlagsActionState> {
  try {
    const ctx = await requirePlatformContext();
    if (!ctx.permissions.has('platformTenant.manageFlags')) {
      return { error: "You do not have permission to change a tenant's plan." };
    }
    if (!(await isOrgInMembershipScope(ctx.memberships, organizationId))) {
      return { error: 'You do not have access to that tenant.' };
    }
    const trial = input.trialEndsAt ? new Date(input.trialEndsAt) : null;
    if (trial && Number.isNaN(trial.getTime())) return { error: 'That trial end date is not a date.' };

    await setTenantPlan(ctx.user.id, organizationId, {
      planId: input.planId,
      userLimit: input.userLimit,
      excludedModules: input.excludedModules,
      excludedPages: input.excludedPages ?? [],
      trialEndsAt: trial,
      enabledFeatures: input.enabledFeatures,
    });
  } catch (e) {
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/tenants] setTenantPlan failed', e);
    return { error: 'Could not change that plan. Please try again.' };
  }
  revalidatePath(`/platform/tenants/${organizationId}`);
  return { ok: true };
}

export async function setTenantFlagsAction(organizationId: string, flags: TenantFlags): Promise<FlagsActionState> {
  try {
    const ctx = await requirePlatformContext();
    if (!ctx.permissions.has('platformTenant.manageFlags')) {
      return { error: 'You do not have permission to change a tenant\'s feature flags.' };
    }
    if (!(await isOrgInMembershipScope(ctx.memberships, organizationId))) {
      return { error: 'You do not have access to that tenant.' };
    }
    await setTenantFlags(ctx.user.id, organizationId, flags);
  } catch (e) {
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/tenants] setTenantFlags failed', e);
    return { error: 'Could not update those flags. Please try again.' };
  }
  revalidatePath(`/platform/tenants/${organizationId}`);
  return { ok: true };
}

/**
 * The business's shop address (3 Oct 2026). Gated like feature flags: it is a
 * setting the platform owner holds for a client, not a credential.
 */
export async function setTenantShopSlugAction(organizationId: string, slug: string): Promise<FlagsActionState> {
  try {
    const ctx = await requirePlatformContext();
    if (!ctx.permissions.has('platformTenant.manageFlags')) {
      return { error: 'You do not have permission to change a tenant\'s shop address.' };
    }
    if (!(await isOrgInMembershipScope(ctx.memberships, organizationId))) {
      return { error: 'You do not have access to that tenant.' };
    }
    const { setTenantShopSlug } = await import('@/server/platform-admin');
    await setTenantShopSlug(ctx.user.id, organizationId, slug);
  } catch (e) {
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/tenants] setTenantShopSlug failed', e);
    return { error: 'Could not change the shop address. Please try again.' };
  }
  revalidatePath(`/platform/tenants/${organizationId}`);
  return { ok: true };
}
