'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { payIncentive, reverseIncentivePayment } from '@/server/incentives';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

export async function payIncentiveAction(quotationId: string, method: string): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.edit')) {
    return { error: 'You do not have permission to edit accounts.' };
  }
  try {
    await payIncentive(ctx.scope, quotationId, method, ctx.user.id);
    revalidatePath('/employee/incentive');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not pay.' };
  }
}

export async function reverseIncentiveAction(quotationId: string, reason: string): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.edit')) {
    return { error: 'You do not have permission to edit accounts.' };
  }
  try {
    await reverseIncentivePayment(ctx.scope, quotationId, reason, ctx.user.id);
    revalidatePath('/employee/incentive');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not reverse.' };
  }
}
