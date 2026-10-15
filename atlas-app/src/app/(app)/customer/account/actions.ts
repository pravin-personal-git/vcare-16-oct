'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { setFollowUpDate, setBadDebt } from '@/server/customer-accounts';

export interface AccountActionState {
  ok?: boolean;
  error?: string;
}

export async function setFollowUpAction(
  partyId: string,
  followUpDate: string | null,
): Promise<AccountActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.edit')) {
    return { error: 'You do not have permission to edit accounts.' };
  }

  try {
    const parsed = followUpDate ? new Date(followUpDate) : null;
    if (parsed && Number.isNaN(parsed.getTime())) return { error: 'That date is not valid.' };
    await setFollowUpDate(ctx.scope, partyId, parsed);
    revalidatePath('/customer/account');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save.' };
  }
}

export async function setBadDebtAction(
  partyId: string,
  isBadDebt: boolean,
): Promise<AccountActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.edit')) {
    return { error: 'You do not have permission to edit accounts.' };
  }

  try {
    await setBadDebt(ctx.scope, partyId, isBadDebt);
    revalidatePath('/customer/account');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save.' };
  }
}
