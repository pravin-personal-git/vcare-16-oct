'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createBankAccount, updateBankAccount, setDefaultBankAccount,
  setBankAccountActive, deleteBankAccount,
  BankAccountError, type BankAccountInput,
} from '@/server/bank-accounts';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function guard(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return { error: 'You do not have permission to change bank accounts.' };
    }
    await run();
    revalidatePath('/bank/accounts');
    return { ok: true };
  } catch (err) {
    if (err instanceof BankAccountError) return { error: err.message };
    console.error('[bank-accounts] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function saveBankAccount(id: string | null, input: BankAccountInput) {
  return guard(async () => {
    const ctx = await requireContext();
    if (id) await updateBankAccount(ctx.scope, id, input);
    else await createBankAccount(ctx.scope, input);
  });
}

export async function makeDefaultBankAccount(id: string) {
  return guard(async () => {
    const ctx = await requireContext();
    await setDefaultBankAccount(ctx.scope, id);
  });
}

export async function toggleBankAccountActive(id: string, isActive: boolean) {
  return guard(async () => {
    const ctx = await requireContext();
    await setBankAccountActive(ctx.scope, id, isActive);
  });
}

export async function removeBankAccount(id: string) {
  return guard(async () => {
    const ctx = await requireContext();
    await deleteBankAccount(ctx.scope, id);
  });
}
