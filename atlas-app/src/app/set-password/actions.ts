'use server';

import { redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { changeOwnPassword } from '@/server/administration';
import { friendlyError } from '@/lib/friendly-error';

export interface SetPasswordState { error?: string }

/**
 * Somebody chooses their own password, ending the temporary one.
 *
 * Outside `(app)` on purpose: the app layout sends anybody with
 * `mustChangePassword` here, so a page inside that layout would redirect to
 * itself forever.
 */
export async function setOwnPassword(
  _prev: SetPasswordState, formData: FormData,
): Promise<SetPasswordState> {
  const current = String(formData.get('currentPassword') ?? '');
  const next = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirmPassword') ?? '');

  if (!current || !next) return { error: 'Fill in both boxes.' };
  if (next !== confirm) {
    return { error: 'The two new passwords are not the same. Type the second one again.' };
  }

  try {
    const ctx = await requireContext();
    await changeOwnPassword(ctx.user.id, current, next);
  } catch (e) {
    return { error: friendlyError(e) };
  }

  // Outside the try - redirect() signals by throwing, and a catch would swallow
  // it and leave the person staring at a form that appeared to do nothing.
  redirect('/dashboard');
}
