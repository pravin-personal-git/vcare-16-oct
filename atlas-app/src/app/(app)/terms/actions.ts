'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createPolicy, updatePolicy, setPolicyActive, acknowledgePolicy,
  PolicyError, type PolicyInput,
} from '@/server/internal-policies';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function guard(run: () => Promise<void>, requireEdit = true): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (requireEdit && !ctx.permissions.has('settings.edit')) {
      return { error: 'You do not have permission to change internal policies.' };
    }
    await run();
    revalidatePath('/terms');
    return { ok: true };
  } catch (err) {
    if (err instanceof PolicyError) return { error: err.message };
    console.error('[terms] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function savePolicy(id: string | null, input: PolicyInput) {
  return guard(async () => {
    const ctx = await requireContext();
    if (id) await updatePolicy(ctx.scope, id, input);
    else await createPolicy(ctx.scope, input);
  });
}

export async function togglePolicyActive(id: string, isActive: boolean) {
  return guard(async () => {
    const ctx = await requireContext();
    await setPolicyActive(ctx.scope, id, isActive);
  });
}

/** Anyone in the store can acknowledge - this is not an admin action. */
export async function acknowledge(id: string) {
  return guard(async () => {
    const ctx = await requireContext();
    await acknowledgePolicy(ctx.scope, id, ctx.user.id);
  }, false);
}
