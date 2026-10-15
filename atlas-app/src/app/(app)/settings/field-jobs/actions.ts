'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { saveJobSettings } from '@/server/job-settings';
import { friendlyError } from '@/lib/friendly-error';
import type { JobSettingsValue } from '@/lib/job-settings';

export async function saveFieldJobsAction(value: JobSettingsValue): Promise<{ ok?: boolean; error?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) return { error: 'You do not have permission to change settings.' };
    if (ctx.scope.kind !== 'single') return { error: 'Pick a branch first (top bar). Settings belong to one branch.' };
    await saveJobSettings(ctx.scope.storeId, value, ctx.user.id);
    revalidatePath('/settings/field-jobs');
    return { ok: true };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
