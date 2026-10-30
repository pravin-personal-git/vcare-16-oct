'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { mergeSettings } from '@/lib/scorecard/settings';

/**
 * Saving the scorecard set-up (31 Oct 2026). Owner-level (`settings.edit`):
 * it decides how people are judged. The form is a convenience; `mergeSettings`
 * re-reads every value and drops anything it does not know.
 */
export async function saveScorecardSettingsAction(input: unknown): Promise<{ ok?: true; error?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) return { error: 'You do not have permission to change the scorecards.' };
    if (ctx.scope.kind !== 'single') return { error: 'Pick a branch first (top bar). Scorecards are set per branch.' };
    const settings = mergeSettings(input) as unknown as Prisma.InputJsonValue;
    await db.scorecardSettings.upsert({
      where: { storeId: ctx.scope.storeId },
      create: { storeId: ctx.scope.storeId, settings, updatedBy: ctx.user.id },
      update: { settings, updatedBy: ctx.user.id },
    });
    revalidatePath('/settings/scorecards');
    return { ok: true };
  } catch (e) {
    console.error('[scorecards] save failed', e);
    return { error: 'Could not save. Please try again.' };
  }
}
