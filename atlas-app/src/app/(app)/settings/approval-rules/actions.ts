'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  applyPreset, ApprovalRuleError, resetRule, saveNotificationDefaults, saveRule, type RuleInput,
} from '@/server/approval-rules-admin';
import type { BusinessNotificationSettings } from '@/server/notify';

/** Settings > Approval Rules - owner / admin only, one branch at a time. */
async function guard(run: (storeId: string) => Promise<unknown>): Promise<{ ok?: boolean; error?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) return { error: 'Only an owner or admin can change approval rules.' };
    if (ctx.scope.kind !== 'single') return { error: 'Pick a branch first - each branch keeps its own rules.' };
    await run(ctx.scope.storeId);
    revalidatePath('/settings/approval-rules');
    return { ok: true };
  } catch (e) {
    if (e instanceof ApprovalRuleError) return { error: e.message };
    console.error('[approval-rules] action failed', e);
    return { error: 'Could not save. Please try again.' };
  }
}

export async function saveRuleAction(input: RuleInput) { return guard((s) => saveRule(s, input)); }
export async function resetRuleAction(type: string) { return guard((s) => resetRule(s, type)); }
export async function applyPresetAction(preset: 'strict' | 'balanced' | 'relaxed') { return guard((s) => applyPreset(s, preset)); }
export async function saveDefaultsAction(patch: Partial<Pick<BusinessNotificationSettings, 'channels' | 'renewalOffsets' | 'whatsappTemplate' | 'dailySummary' | 'alertsWhenSignedOut' | 'alarmTone'>>) {
  return guard((s) => saveNotificationDefaults(s, patch));
}
