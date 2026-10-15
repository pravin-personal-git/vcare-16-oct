'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { setServiceDepartments } from '@/server/service-team';

/** Choose which departments count as the service team (CALL-6). settings.edit, one branch. */
export async function setServiceDepartmentsAction(ids: string[]): Promise<{ error?: string; ok?: boolean }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) return { error: 'You do not have permission to change this.' };
    if (ctx.scope.kind === 'all') return { error: 'Choose a branch first - departments belong to a branch.' };
    await setServiceDepartments(ctx.scope, ids);
    revalidatePath('/service');
    revalidatePath('/services', 'layout');
    return { ok: true };
  } catch (err) {
    console.error('[service] set departments failed', err);
    return { error: 'Could not save. Please try again.' };
  }
}
