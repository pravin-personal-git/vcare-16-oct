'use server';

import { redirect } from 'next/navigation';
import { db } from '@/server/db';
import { hashPassword } from '@/server/auth/password';
import { requirePortalContext } from '@/server/portal-context';

export interface ResetPasswordState {
  error?: string;
}

const MIN_LENGTH = 8;

/**
 * The ownership guarantee for this action: there is no id in the form to
 * check against, because a password change only ever targets the caller's
 * own account - `ctx.party.id` comes entirely from the session, never from
 * client input. `assertOwned` is what makes that a real gate rather than an
 * assumption: no valid, non-revoked portal session means no party, means
 * this throws before any write happens.
 */
async function assertOwned() {
  return requirePortalContext();
}

export async function setPortalPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password.length < MIN_LENGTH) {
    return { error: `Password must be at least ${MIN_LENGTH} characters.` };
  }
  if (password !== confirm) {
    return { error: 'Passwords do not match.' };
  }

  const ctx = await assertOwned();

  const portalPasswordHash = await hashPassword(password);
  await db.party.update({
    where: { id: ctx.party.id },
    data: { portalPasswordHash, portalMustReset: false },
  });

  redirect('/portal');
}
