'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { heldMessage, newActionId, rupeesText } from '@/server/approval-actions';
import { createLoan, recordLoanRepayment, StaffLoanError, type LoanKind } from '@/server/staff-loans';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

/** `run` may return a message - a loan held for approval says so. */
async function guardManage(run: () => Promise<void | string>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('payroll.process')) return { error: 'You do not have permission to manage loans.' };
    const message = await run();
    revalidatePath('/hrm/loans');
    return message ? { ok: true, message } : { ok: true };
  } catch (err) {
    if (err instanceof StaffLoanError) return { error: err.message };
    console.error('[staff-loans] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function createLoanAction(input: {
  userId: string; principalPaise: number; emiPaise: number; tenureMonths: number;
  startPeriod: string; reason: string | null; method: string;
  /** `loan` or `advance` - same arithmetic, different word on the record. */
  kind?: LoanKind;
}): Promise<ActionState> {
  return guardManage(async () => {
    const ctx = await requireContext();
    if (ctx.scope.kind === 'single') {
      const who = await db.user.findUnique({ where: { id: input.userId }, select: { fullName: true } });
      const held = await heldMessage(ctx.scope, ctx.user.id, {
        type: 'staff_loan', entityId: newActionId(), amountPaise: input.principalPaise,
        title: `${input.kind === 'advance' ? 'Salary advance' : 'Loan'} ${rupeesText(input.principalPaise)} to ${who?.fullName ?? 'an employee'}`,
        summary: `${rupeesText(input.emiPaise)} a month x ${input.tenureMonths}${input.reason ? ` - ${input.reason}` : ''}`,
        payload: { ...input },
      });
      if (held) return held;
    }
    await createLoan(ctx.scope, { ...input, startPeriod: new Date(input.startPeriod) }, ctx.user.id);
  });
}

export async function recordLoanRepaymentAction(
  loanId: string, input: { amountPaise: number; method: string },
): Promise<ActionState> {
  return guardManage(async () => {
    const ctx = await requireContext();
    await recordLoanRepayment(ctx.scope, loanId, input, ctx.user.id);
  });
}

/**
 * Switch salary recovery of plain advances on or off for this branch, and set
 * the most to take in one month (G-19).
 *
 * It moved here from the Staff Account screen on 9 Oct 2026, when that screen
 * became a read. This is where advances are raised, so this is where the rule
 * about collecting them belongs.
 */
export async function setAdvanceRecoveryAction(enabled: boolean, maxRupees: number): Promise<ActionState> {
  return guardManage(async () => {
    const ctx = await requireContext();
    const { setAdvanceRecovery } = await import('@/server/staff-accounts');
    await setAdvanceRecovery(ctx.scope, { enabled, maxPaise: Math.round(maxRupees * 100) }, ctx.user.id);
    revalidatePath('/user/account');
    return enabled ? 'Advances will now be recovered from salary.' : 'Advance recovery switched off.';
  });
}

/**
 * Somebody handed cash back against an advance that has no schedule - one
 * raised before advances lived on `StaffLoan`, or settled off-cycle.
 *
 * A loan or a scheduled advance is repaid from its own row in the list above;
 * this covers the older balances that have no row to press.
 */
export async function recordAdvanceRepaymentAction(
  userId: string, amountRupees: number, method: string,
): Promise<ActionState> {
  return guardManage(async () => {
    const ctx = await requireContext();
    const { createStaffTransaction } = await import('@/server/staff-accounts');
    const amountPaise = Math.round(amountRupees * 100);
    if (amountPaise <= 0) throw new StaffLoanError('Enter an amount greater than zero.');
    await createStaffTransaction(ctx.scope, {
      userId, kind: 'advance_repaid', amountPaise, txnDate: new Date(), method,
    }, ctx.user.id);
    revalidatePath('/user/account');
    return 'Repayment recorded.';
  });
}
