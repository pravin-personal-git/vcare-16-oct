'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { revokeEverything } from '@/server/people-devices';
import { friendlyError } from '@/lib/friendly-error';

/**
 * Cutting off a lost or stolen phone.
 *
 * Gated on `users.edit`, the same permission that can already deactivate the
 * person entirely - so this grants nobody anything new, it only makes an
 * existing power reachable in one action instead of three screens.
 */
export async function revokeEverythingAction(
  userId: string,
): Promise<{ ok?: true; summary?: string; error?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('users.edit')) {
      return { error: 'You do not have permission to sign people out.' };
    }
    if (ctx.scope.kind !== 'single') {
      return { error: 'Pick a branch first (top bar).' };
    }
    if (userId === ctx.user.id) {
      // Signing yourself out of everything from this screen would log you out
      // mid-action and look like a crash. Use the normal sign-out.
      return { error: 'Use Sign out for your own account.' };
    }

    const r = await revokeEverything(ctx.scope, userId);
    revalidatePath('/settings/people-devices');

    const parts = [
      r.phones && `${r.phones} phone${r.phones === 1 ? '' : 's'} unpaired`,
      r.appSessions && `${r.appSessions} app session${r.appSessions === 1 ? '' : 's'} ended`,
      r.browsers && `${r.browsers} browser session${r.browsers === 1 ? '' : 's'} signed out`,
      r.pushTokens && `${r.pushTokens} notification token${r.pushTokens === 1 ? '' : 's'} removed`,
    ].filter(Boolean);

    return {
      ok: true,
      summary: parts.length ? parts.join(', ') : 'There was nothing left to cut off.',
    };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}


/**
 * Pair a technician's phone, from the screen the manager is already on
 * (workstream I, 1 Oct 2026).
 *
 * Pairing existed, on a different screen, called "Phones", reached from a
 * different part of settings. A manager with a new technician standing in
 * front of them had to know that - and know that "Device Management" was
 * something else entirely. Here it sits next to the person it is for.
 */
export async function pairPhoneAction(userId: string, label: string): Promise<{
  code?: string; expiresAt?: string; error?: string;
}> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('users.edit')) {
      return { error: 'You do not have permission to pair a phone.' };
    }
    if (ctx.scope.kind !== 'single') {
      return { error: 'Pick a branch first (top bar). A phone is paired to one branch.' };
    }

    const { createPairing } = await import('@/server/call-logs');
    const r = await createPairing(
      ctx.scope,
      userId,
      label.trim() || 'Phone',
      ctx.user.id,
    );

    revalidatePath('/settings/people-devices');
    return { code: r.code, expiresAt: r.expiresAt.toISOString() };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
