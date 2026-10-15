'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { scopeForWrite } from '@/server/store-scope';
import { currentPayrollPeriod, generatePayrollRun, PayrollRunError } from '@/server/payroll-run';

export interface PayrollActionState {
  error?: string;
  ok?: boolean;
  runId?: string;
}

/**
 * Generate (or regenerate, if still draft) this store's CURRENT pay period.
 *
 * Deliberately not parameterised by an arbitrary period yet - the dashboard
 * only ever offers "this period", the one thing every store needs on a
 * repeating cadence. Running an old period by hand is real backlog, not
 * something to half-build behind a date picker nobody asked for.
 */
export async function generateCurrentPayrollRunAction(): Promise<PayrollActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('payroll.process')) {
    return { error: 'You do not have permission to run payroll.' };
  }
  if (ctx.scope.kind !== 'single') {
    return { error: 'Choose a branch first - payroll runs per branch.' };
  }

  try {
    const storeId = scopeForWrite(ctx.scope);
    const period = await currentPayrollPeriod(storeId);
    const result = await generatePayrollRun(ctx.scope, period.periodStart, period.periodEnd, ctx.user.id);
    revalidatePath('/hrm/payroll');
    return { ok: true, runId: result.runId };
  } catch (e) {
    if (e instanceof PayrollRunError) return { error: e.message };
    console.error('[payroll] generate run failed', e);
    return { error: 'Something went wrong generating payroll. Please try again.' };
  }
}
