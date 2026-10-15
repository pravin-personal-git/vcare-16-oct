'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { saveOpeningBalance } from '@/server/balance-sheet';

/**
 * The one place a person types figures the documents cannot supply.
 *
 * Gated on `accounts.edit`. These numbers change every total on the balance
 * sheet, and getting them wrong is not obvious afterwards - a bank balance
 * entered with an extra zero looks exactly like a prosperous business.
 */

export interface OpeningState {
  ok?: boolean;
  error?: string;
  message?: string;
}

export async function saveOpeningBalanceAction(input: {
  asOfDate: string;
  cashPaise: number;
  bankPaise: number;
  capitalPaise: number;
  fixedAssetsPaise: number;
  loansPaise: number;
  note: string | null;
}): Promise<OpeningState> {
  const ctx = await requireContext();

  if (!ctx.permissions.has('accounts.edit')) {
    return { error: 'You do not have permission to set opening balances.' };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single branch first - opening balances belong to one branch.' };
  }

  const asOf = new Date(input.asOfDate);
  if (Number.isNaN(asOf.getTime())) return { error: 'That date is not valid.' };

  // A date in the future would mean cash movement is counted from a day that
  // has not happened, so every receipt and payment recorded so far silently
  // drops out of the sheet.
  if (asOf.getTime() > Date.now()) {
    return { error: 'The opening date cannot be in the future.' };
  }

  const values = [
    input.cashPaise, input.bankPaise, input.capitalPaise,
    input.fixedAssetsPaise, input.loansPaise,
  ];
  if (values.some((v) => !Number.isFinite(v) || v < 0)) {
    return { error: 'Amounts cannot be negative. Loans and capital are entered as positives.' };
  }

  try {
    await saveOpeningBalance(ctx.scope, ctx.scope.storeId, {
      asOfDate: asOf,
      cashPaise: Math.round(input.cashPaise),
      bankPaise: Math.round(input.bankPaise),
      capitalPaise: Math.round(input.capitalPaise),
      fixedAssetsPaise: Math.round(input.fixedAssetsPaise),
      loansPaise: Math.round(input.loansPaise),
      note: input.note,
    }, ctx.user.id);

    await db.activityLog
      .create({
        data: {
          storeId: ctx.scope.storeId,
          userId: ctx.user.id,
          activityType: 'updated',
          entityType: 'OpeningBalance',
          entityId: ctx.scope.storeId,
          description: `Opening balances set as at ${input.asOfDate}`,
        },
      })
      .catch((e) => console.error('[opening-balance] audit write failed (non-fatal)', e));

    revalidatePath('/reports/balance-sheet');
    revalidatePath('/settings/opening-balance');

    return { ok: true, message: 'Saved. The balance sheet now reflects these.' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save.' };
  }
}
