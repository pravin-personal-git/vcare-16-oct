'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { friendlyError } from '@/lib/friendly-error';
import { saveAccessChanges, UserAccessError, type AccessChange } from '@/server/user-access';
import { ApprovalRuleError, saveApprovalChoices, type ApprovalChoice } from '@/server/approval-rules-admin';

/** Save each person's own access switches (Settings > Operations & approvals). */
export async function saveAccessAction(changes: AccessChange[]): Promise<{ ok: true; saved: number } | { error: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) return { error: 'Sirf owner (Settings: Edit) access badal sakte hain.' };
    if (ctx.scope.kind !== 'single') return { error: 'Upar ek branch chuniye.' };
    const r = await saveAccessChanges(ctx.scope, ctx.user.id, changes);
    revalidatePath('/settings/operations');
    return { ok: true, saved: r.saved };
  } catch (e) {
    return { error: friendlyError(e, e instanceof UserAccessError) };
  }
}

/** Save the approval switches (Settings > Operations & approvals). */
export async function saveApprovalsAction(choices: ApprovalChoice[]): Promise<{ ok: true; saved: number } | { error: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) return { error: 'Sirf owner (Settings: Edit) approvals badal sakte hain.' };
    if (ctx.scope.kind !== 'single') return { error: 'Upar ek branch chuniye.' };
    const r = await saveApprovalChoices(ctx.scope.storeId, choices);
    revalidatePath('/settings/operations');
    revalidatePath('/settings/approval-rules');
    return { ok: true, saved: r.saved };
  } catch (e) {
    return { error: friendlyError(e, e instanceof ApprovalRuleError) };
  }
}
