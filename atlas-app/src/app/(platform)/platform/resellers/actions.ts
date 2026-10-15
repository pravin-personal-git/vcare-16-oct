'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformContext } from '@/server/platform-context';
import {
  createReseller, suspendReseller, reactivateReseller, PlatformAdminError, type CreateResellerInput,
} from '@/server/platform-admin';
import { requireRootPlatformOwner, RootPlatformOwnerRequiredError } from '@/server/platform-scope';
import { ensureElevated } from '@/server/auth/elevation';

export interface CreateResellerState {
  ok?: boolean;
  error?: string;
  adminUsername?: string;
}

export async function createResellerAction(
  parentAccountId: string, input: CreateResellerInput,
): Promise<CreateResellerState> {
  const ctx = await requirePlatformContext();
  if (!ctx.permissions.has('platformReseller.create')) {
    return { error: 'You do not have permission to create resellers.' };
  }
  const owns = ctx.memberships.some((m) => m.platformAccountId === parentAccountId);
  if (!owns) {
    return { error: 'You do not have access to that platform account.' };
  }

  try {
    const result = await createReseller(parentAccountId, input);
    revalidatePath('/platform/resellers');
    return { ok: true, adminUsername: result.adminUsername };
  } catch (e) {
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/resellers] createReseller failed', e);
    return { error: 'Could not create that reseller. Please try again.' };
  }
}

// ===========================================================================
// RESELLER LIFECYCLE (superadmin-roadmap Slice 6/9 parity, D055)
//
// Root-gated: a Reseller Owner managing their own subtree has no route to
// this action at all (no UI calls it outside `/platform/resellers/[id]`,
// itself only reachable with `platformReseller.suspend` - see below), but
// if a second platform-tier role is ever introduced, only the root account
// may suspend a reseller outright.
// ===========================================================================

export interface ResellerLifecycleState {
  ok?: boolean;
  error?: string;
}

export async function suspendResellerAction(
  platformAccountId: string, reason: string, password: string,
): Promise<ResellerLifecycleState> {
  try {
    const ctx = await requirePlatformContext();
    if (!ctx.permissions.has('platformReseller.suspend')) {
      return { error: 'You do not have permission to change a reseller\'s status.' };
    }
    await requireRootPlatformOwner(ctx.user.id);
    const elevationError = await ensureElevated(ctx.user.id, password);
    if (elevationError) return { error: elevationError };
    await suspendReseller(ctx.user.id, platformAccountId, reason);
  } catch (e) {
    if (e instanceof RootPlatformOwnerRequiredError) return { error: e.message };
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/resellers] suspendReseller failed', e);
    return { error: 'Could not suspend that reseller. Please try again.' };
  }
  revalidatePath('/platform/resellers');
  return { ok: true };
}

export async function reactivateResellerAction(
  platformAccountId: string, reason: string, password: string,
): Promise<ResellerLifecycleState> {
  try {
    const ctx = await requirePlatformContext();
    if (!ctx.permissions.has('platformReseller.suspend')) {
      return { error: 'You do not have permission to change a reseller\'s status.' };
    }
    await requireRootPlatformOwner(ctx.user.id);
    const elevationError = await ensureElevated(ctx.user.id, password);
    if (elevationError) return { error: elevationError };
    await reactivateReseller(ctx.user.id, platformAccountId, reason);
  } catch (e) {
    if (e instanceof RootPlatformOwnerRequiredError) return { error: e.message };
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/resellers] reactivateReseller failed', e);
    return { error: 'Could not reactivate that reseller. Please try again.' };
  }
  revalidatePath('/platform/resellers');
  return { ok: true };
}
