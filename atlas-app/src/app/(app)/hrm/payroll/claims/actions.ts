'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  requestLeaveEncashment, decideEncashment, payEncashment,
  requestReimbursement, decideReimbursement, payReimbursement,
  StaffClaimError,
} from '@/server/staff-claims';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function guardManage(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('payroll.process')) return { error: 'You do not have permission to manage claims.' };
    await run();
    revalidatePath('/hrm/payroll/claims');
    return { ok: true };
  } catch (err) {
    if (err instanceof StaffClaimError) return { error: err.message };
    console.error('[staff-claims] action failed', err);
    return { error: friendlyError(err) };
  }
}

// Self-service - raising your own claim needs no admin permission.
export async function requestEncashmentAction(input: { leaveTypeId: string; days: number }): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await requestLeaveEncashment(ctx.scope, input, ctx.user.id);
    revalidatePath('/hrm/payroll/claims');
    return { ok: true };
  } catch (err) {
    if (err instanceof StaffClaimError) return { error: err.message };
    console.error('[staff-claims] encashment request failed', err);
    return { error: friendlyError(err) };
  }
}

export async function requestReimbursementAction(input: {
  category: string; amountPaise: number; expenseDate: string; description: string | null;
}): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await requestReimbursement(ctx.scope, { ...input, expenseDate: new Date(input.expenseDate) }, ctx.user.id);
    revalidatePath('/hrm/payroll/claims');
    return { ok: true };
  } catch (err) {
    if (err instanceof StaffClaimError) return { error: err.message };
    console.error('[staff-claims] reimbursement request failed', err);
    return { error: friendlyError(err) };
  }
}

export async function decideEncashmentAction(id: string, decision: 'approved' | 'rejected'): Promise<ActionState> {
  return guardManage(async () => {
    const ctx = await requireContext();
    await decideEncashment(ctx.scope, id, decision, ctx.user.id);
  });
}

export async function payEncashmentAction(id: string, method: string): Promise<ActionState> {
  return guardManage(async () => {
    const ctx = await requireContext();
    await payEncashment(ctx.scope, id, method, ctx.user.id);
  });
}

export async function decideReimbursementAction(id: string, decision: 'approved' | 'rejected'): Promise<ActionState> {
  return guardManage(async () => {
    const ctx = await requireContext();
    await decideReimbursement(ctx.scope, id, decision, ctx.user.id);
  });
}

export async function payReimbursementAction(id: string, method: string): Promise<ActionState> {
  return guardManage(async () => {
    const ctx = await requireContext();
    await payReimbursement(ctx.scope, id, method, ctx.user.id);
  });
}
