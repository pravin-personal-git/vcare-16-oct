'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requireContext } from '@/server/context';
import { createSession } from '@/server/auth/session';
import {
  listLinkedAccounts, linkAccount, unlinkAccount, canSwitchTo,
  type LinkedAccountRow,
} from '@/server/linked-accounts';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

export async function loadLinkedAccountsAction(): Promise<LinkedAccountRow[]> {
  const ctx = await requireContext();
  return listLinkedAccounts(ctx.user.id);
}

export async function linkAccountAction(username: string, password: string): Promise<ActionState> {
  const ctx = await requireContext();
  // Linking your OWN other logins (you must know that account's password)
  // is open to anyone, as long as the Platform Owner has not switched it off
  // for this tenant (founder decision, 25 Sep 2026). Creating a business is
  // the controlled right - see business-entitlements.ts.
  if (!ctx.organization.allowLinkedAccounts) {
    return { error: 'Linking another account is turned off for your organisation. Contact your account manager.' };
  }
  if (!username.trim() || !password) {
    return { error: 'Enter the other account\'s username and password.' };
  }
  try {
    await linkAccount(ctx.user.id, username.trim(), password);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not link that account.' };
  }
}

export async function unlinkAccountAction(linkedUserId: string): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    await unlinkAccount(ctx.user.id, linkedUserId);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not unlink that account.' };
  }
}

/**
 * Switches the active browser session to a linked account - no password
 * prompt, because linking already proved ownership once. Creates a fresh
 * session for the target rather than reusing anything, same as a normal
 * sign-in.
 */
export async function switchAccountAction(linkedUserId: string): Promise<ActionState> {
  const ctx = await requireContext();
  const allowed = await canSwitchTo(ctx.user.id, linkedUserId);
  if (!allowed) return { error: 'That account is not linked to yours.' };

  const h = await headers();
  await createSession(linkedUserId, {
    userAgent: h.get('user-agent') ?? undefined,
    ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
  });

  // Defensive: this is the one place a session's identity changes without an
  // intervening unauthenticated page (login/logout both redirect through
  // /login, which has nothing sensitive to have cached). Every route the
  // previous identity visited reads cookies() and is already dynamically
  // rendered on that basis, but purging the router cache here removes any
  // dependency on that holding true for every current and future screen.
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
