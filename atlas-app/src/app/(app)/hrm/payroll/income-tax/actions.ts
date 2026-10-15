'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { saveMyDeclaration, setDeclarationProofStatus, IncomeTaxError } from '@/server/income-tax';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

/**
 * The ownership guarantee for this action: there is no target user in the
 * form, because a declaration save only ever targets the caller's own row -
 * `ctx.user.id` comes entirely from the session, never from client input.
 */
async function assertOwned() {
  return requireContext();
}

export async function saveMyDeclarationAction(input: {
  financialYear: number; regime: string; declarations: Record<string, number>;
}): Promise<ActionState> {
  try {
    const ctx = await assertOwned();
    await saveMyDeclaration(ctx.scope, input, ctx.user.id);
    revalidatePath('/hrm/payroll/income-tax');
    return { ok: true };
  } catch (err) {
    if (err instanceof IncomeTaxError) return { error: err.message };
    console.error('[income-tax] save failed', err);
    return { error: friendlyError(err) };
  }
}

export async function setDeclarationProofStatusAction(
  id: string, proofStatus: 'pending' | 'submitted' | 'verified',
): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('payroll.configure')) return { error: 'You do not have permission to verify declarations.' };
    await setDeclarationProofStatus(ctx.scope, id, proofStatus, ctx.user.id);
    revalidatePath('/hrm/payroll/income-tax');
    return { ok: true };
  } catch (err) {
    if (err instanceof IncomeTaxError) return { error: err.message };
    console.error('[income-tax] proof status change failed', err);
    return { error: friendlyError(err) };
  }
}
