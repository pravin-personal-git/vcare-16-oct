'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { heldMessage } from '@/server/approval-actions';
import { monthWindow } from '@/lib/accounting-period';
import { setPeriodLock } from '@/server/accounting-periods';
import { friendlyError } from '@/lib/friendly-error';

export interface PeriodActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * Close a month, or reopen it.
 *
 * `accounts.edit`, the same permission as posting a journal entry by hand -
 * deciding that a month's figures are final is the same kind of authority as
 * writing one of them.
 */
export async function setPeriodLockAction(input: {
  financialYear: number;
  monthIndex: number;
  locked: boolean;
  reason?: string;
}): Promise<PeriodActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('accounts.edit')) {
      return { error: 'You do not have permission to close or reopen a month.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Pick a single branch first. Branches close their books separately.' };
    }

    // Reopening a closed month can need approval: what was filed may change.
    if (!input.locked) {
      const { label } = monthWindow(input.financialYear, input.monthIndex);
      const held = await heldMessage(ctx.scope, ctx.user.id, {
        type: 'period_reopen', entityId: `${input.financialYear}-${input.monthIndex}`, amountPaise: null,
        title: `Reopen ${label}`, summary: input.reason ?? null, payload: { ...input },
      });
      if (held) { revalidatePath('/settings/period-lock'); return { ok: true, message: held }; }
    }
    const r = await setPeriodLock(ctx.scope, ctx.user.id, input);

    revalidatePath('/settings/period-lock');

    return {
      ok: true,
      message: r.locked
        ? `${r.label} is closed. Nothing new can be posted into it - a correction goes into the `
          + 'current month as a reversal.'
        : `${r.label} is open again. Anything posted into it from now on will not be in the `
          + 'figures you already filed.',
    };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
