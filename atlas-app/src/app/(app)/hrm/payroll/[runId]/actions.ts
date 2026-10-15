'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { heldMessage, rupeesText } from '@/server/approval-actions';
import { processPayrollRun, markPayrollRunPaid, revertPayrollRun, PayrollRunError } from '@/server/payroll-run';
import { LedgerError, LedgerValidationError } from '@/server/ledger';

const TITLE: Record<string, string> = {
  payroll_process: 'Process payroll',
  payroll_paid: 'Mark payroll paid',
  payroll_revert: 'Take payroll back to draft',
};

export interface RunActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

/** Held for approval? (Settings > Approval Rules > Payroll.) */
async function heldRun(scope: Parameters<typeof processPayrollRun>[0], userId: string, runId: string, type: 'payroll_process' | 'payroll_paid' | 'payroll_revert', payload: Record<string, unknown>) {
  if (scope.kind !== 'single') return null;
  const run = await db.payrollRun.findFirst({ where: { id: runId, storeId: scope.storeId }, select: { label: true, payslips: { select: { netPaise: true } } } });
  if (!run) return null;
  const net = run.payslips.reduce((n, p) => n + p.netPaise, 0);
  return heldMessage(scope, userId, {
    type, entityId: runId, amountPaise: net,
    title: `${TITLE[type]} - ${run.label}, ${rupeesText(net)}`,
    summary: `${run.payslips.length} payslip${run.payslips.length === 1 ? '' : 's'}`,
    payload,
  });
}

/** Every error these two actions can throw that has a message safe to show as-is - anything else is logged and given a generic message instead. */
function messageFor(e: unknown, fallback: string): string {
  if (e instanceof PayrollRunError || e instanceof LedgerError || e instanceof LedgerValidationError) {
    return e.message;
  }
  console.error('[payroll]', e);
  return fallback;
}

export async function processPayrollRunAction(runId: string): Promise<RunActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('payroll.process')) {
    return { error: 'You do not have permission to process payroll.' };
  }
  if (ctx.scope.kind !== 'single') return { error: 'Choose a branch first.' };

  try {
    const held = await heldRun(ctx.scope, ctx.user.id, runId, 'payroll_process', {});
    if (held) { revalidatePath(`/hrm/payroll/${runId}`); return { ok: true, message: held }; }
    await processPayrollRun(ctx.scope, runId, ctx.user.id);
    revalidatePath(`/hrm/payroll/${runId}`);
    revalidatePath('/hrm/payroll');
    return { ok: true };
  } catch (e) {
    return { error: messageFor(e, 'Something went wrong processing this run.') };
  }
}

export async function markPayrollRunPaidAction(runId: string, method: string): Promise<RunActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('payroll.process')) {
    return { error: 'You do not have permission to process payroll.' };
  }
  if (ctx.scope.kind !== 'single') return { error: 'Choose a branch first.' };

  try {
    const held = await heldRun(ctx.scope, ctx.user.id, runId, 'payroll_paid', { method });
    if (held) { revalidatePath(`/hrm/payroll/${runId}`); return { ok: true, message: held }; }
    await markPayrollRunPaid(ctx.scope, runId, method, ctx.user.id);
    revalidatePath(`/hrm/payroll/${runId}`);
    revalidatePath('/hrm/payroll');
    return { ok: true };
  } catch (e) {
    return { error: messageFor(e, 'Something went wrong marking this run paid.') };
  }
}

/**
 * Take a processed run back to draft so the month can be corrected and built
 * again. Reverses the ledger entries, removes the loan EMI this run
 * collected, and unlocks the run - see `revertPayrollRun`.
 */
export async function revertPayrollRunAction(runId: string, reason: string): Promise<RunActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('payroll.process')) {
    return { error: 'You do not have permission to process payroll.' };
  }
  if (ctx.scope.kind !== 'single') return { error: 'Choose a branch first.' };
  if (!reason.trim()) return { error: 'Say why this run is being taken back.' };

  try {
    const held = await heldRun(ctx.scope, ctx.user.id, runId, 'payroll_revert', { reason: reason.trim() });
    if (held) { revalidatePath(`/hrm/payroll/${runId}`); return { ok: true, message: held }; }
    await revertPayrollRun(ctx.scope, runId, reason.trim(), ctx.user.id);
    revalidatePath(`/hrm/payroll/${runId}`);
    revalidatePath('/hrm/payroll');
    return { ok: true, message: 'Taken back to draft. Generate it again from the Payroll screen once the figures are fixed.' };
  } catch (e) {
    return { error: messageFor(e, 'Something went wrong taking this run back.') };
  }
}
