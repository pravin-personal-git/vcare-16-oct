'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { saveIncentiveRule } from '@/server/incentive-settings';
import { friendlyError } from '@/lib/friendly-error';

/**
 * Saving the incentive scheme.
 *
 * `settings.edit`, not a sales permission: this decides what the business
 * pays out, so it belongs with the owner rather than with the people earning
 * from it. The value is re-validated server-side by `parseIncentiveRule` -
 * the form is a convenience, never the authority.
 */
export async function saveIncentiveRuleAction(
  rule: unknown,
): Promise<{ ok?: true; error?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return { error: 'You do not have permission to change the incentive scheme.' };
    }
    if (ctx.scope.kind !== 'single') {
      return { error: 'Pick a branch first (top bar). The scheme belongs to one branch.' };
    }
    await saveIncentiveRule(ctx.scope.storeId, rule, ctx.user.id);
    revalidatePath('/settings/incentive');
    return { ok: true };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
