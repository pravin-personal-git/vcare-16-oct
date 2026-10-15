'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createTransaction, approveTransaction, rejectTransaction, reverseTransaction,
  type TxnType,
} from '@/server/transactions';
import { fieldSetup } from '@/server/custom-fields';
import { fieldsFor, readCustomValues } from '@/lib/custom-fields';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

export async function createTransactionAction(input: {
  txnType: TxnType;
  amountPaise: number;
  txnDate: string;
  categoryAccountCode: string | null;
  method: string | null;
  fromAccountCode: string | null;
  toAccountCode: string | null;
  description: string | null;
  paidToUserId?: string | null;
  /** `cf_<key>` values straight off the form, checked below against this branch's setup. */
  custom?: Record<string, string[]>;
}): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.edit')) {
    return { error: 'You do not have permission to edit accounts.' };
  }

  try {
    const txnDate = new Date(input.txnDate);
    if (Number.isNaN(txnDate.getTime())) return { error: 'That date is not valid.' };

    // The branch's own fields, checked against its own setup rather than
    // trusted from the form - same path customers, leads and products use.
    const setup = await fieldSetup(ctx.scope, 'expense');
    const configs = fieldsFor(setup.custom);
    const custom = input.custom ?? {};
    const read = readCustomValues(configs, (name) => custom[name] ?? []);
    if (read.error) return { error: read.error };

    await createTransaction(ctx.scope, { ...input, txnDate, customFields: read.values }, ctx.user.id);
    revalidatePath('/transactions');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save.' };
  }
}

export async function approveTransactionAction(id: string): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.edit')) {
    return { error: 'You do not have permission to approve expenses.' };
  }
  try {
    await approveTransaction(ctx.scope, id, ctx.user.id);
    revalidatePath('/transactions');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not approve.' };
  }
}

export async function rejectTransactionAction(id: string, reason: string): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.edit')) {
    return { error: 'You do not have permission to reject expenses.' };
  }
  try {
    await rejectTransaction(ctx.scope, id, reason, ctx.user.id);
    revalidatePath('/transactions');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not reject.' };
  }
}

export async function reverseTransactionAction(id: string, reason: string): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.edit')) {
    return { error: 'You do not have permission to edit accounts.' };
  }
  try {
    await reverseTransaction(ctx.scope, id, reason, ctx.user.id);
    revalidatePath('/transactions');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not reverse.' };
  }
}
