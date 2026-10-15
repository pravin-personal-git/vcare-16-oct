'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requirePlatformContext } from '@/server/platform-context';
import { db } from '@/server/db';
import { verifyPassword } from '@/server/auth/password';
import { grantElevation, isElevated } from '@/server/auth/elevation';
import { startTenantAccess, endTenantAccess, ImpersonationError } from '@/server/impersonation';
import { isOrgInMembershipScope } from '@/server/platform-scope';

export interface ElevateState {
  ok?: boolean;
  error?: string;
}

/** D054 - re-entering the current password, establishing a ~15 minute elevated-session marker. */
export async function elevateAction(password: string): Promise<ElevateState> {
  const ctx = await requirePlatformContext();
  if (!password) return { error: 'Enter your password.' };

  const user = await db.user.findUnique({ where: { id: ctx.user.id }, select: { passwordHash: true } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: 'Incorrect password.' };
  }

  await grantElevation(ctx.user.id);
  return { ok: true };
}

export interface AccessTenantState {
  ok?: boolean;
  error?: string;
}

/**
 * `password` is required by the dialog on every call, even though a caller
 * already inside their ~15 minute elevation window (D054) technically
 * doesn't need to re-prove it - Access Tenant is sensitive enough that
 * asking every time is the right default for this one action. The password
 * still ALSO (re-)grants the elevation window here, so a Slice 6/7 action
 * taken right after, in the same visit, does not need to ask again.
 */
export async function startTenantAccessAction(
  organizationId: string, password: string, reason: string,
): Promise<AccessTenantState> {
  const ctx = await requirePlatformContext();
  if (!ctx.permissions.has('platformTenant.access')) {
    return { error: 'You do not have permission to access tenants.' };
  }

  if (!(await isElevated(ctx.user.id))) {
    if (!password) return { error: 'Enter your password to continue.' };
    const user = await db.user.findUnique({ where: { id: ctx.user.id }, select: { passwordHash: true } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return { error: 'Incorrect password.' };
    }
    await grantElevation(ctx.user.id);
  }

  if (!(await isOrgInMembershipScope(ctx.memberships, organizationId))) {
    return { error: 'You do not have access to that tenant.' };
  }

  const h = await headers();
  try {
    await startTenantAccess(ctx.user.id, organizationId, reason, {
      ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: h.get('user-agent') ?? null,
    });
  } catch (e) {
    if (e instanceof ImpersonationError) return { error: e.message };
    console.error('[impersonation] startTenantAccess failed', e);
    return { error: 'Could not access that tenant. Please try again.' };
  }

  redirect('/dashboard');
}

/** "Return to Platform" - ends the impersonation session and its audit event. */
export async function endTenantAccessAction(): Promise<void> {
  await endTenantAccess();
  // The impersonated tenant's theme/menu were injected into this same
  // browser session - purge the router cache so nothing from it survives
  // into the platform shell, same reasoning "Switch Business" already
  // applies to its own identity change (see switchAccountAction).
  revalidatePath('/', 'layout');
  redirect('/platform');
}
