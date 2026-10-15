'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  ChartOfAccountsError, createAccount, updateAccount, deactivateAccount,
  type AccountInput,
} from '@/server/chart-of-accounts';
import { setAmcRevenueMode } from '@/server/amc-revenue';
import { friendlyError } from '@/lib/friendly-error';

export interface ChartOfAccountsState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function guard() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.edit')) {
    return { error: 'You do not have permission to change the chart of accounts.' as const };
  }
  return { ctx };
}

function fail(e: unknown): ChartOfAccountsState {
  if (e instanceof ChartOfAccountsError) return { error: e.message };
  console.error('[chart-of-accounts] action failed', e);
  return { error: friendlyError(e, true) };
}

function done(): void {
  revalidatePath('/settings/chart-of-accounts');
}

export async function createAccountAction(input: AccountInput): Promise<ChartOfAccountsState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await createAccount(g.ctx.organization.id, input);
    done();
    return { ok: true, message: `${input.code} - ${input.name} added.` };
  } catch (e) {
    return fail(e);
  }
}

export async function updateAccountAction(
  id: string, patch: { name?: string; subType?: string | null },
): Promise<ChartOfAccountsState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await updateAccount(g.ctx.organization.id, id, patch);
    done();
    return { ok: true, message: 'Saved.' };
  } catch (e) {
    return fail(e);
  }
}

export async function deactivateAccountAction(id: string): Promise<ChartOfAccountsState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await deactivateAccount(g.ctx.organization.id, id);
    done();
    return { ok: true, message: 'Removed.' };
  } catch (e) {
    return fail(e);
  }
}

/** How AMC fees become income, for this business (decision 3, 25 Sep 2026). */
export async function setAmcRevenueModeAction(mode: 'spread' | 'at_invoice'): Promise<{ error?: string; ok?: boolean }> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.edit')) return { error: 'You do not have permission to change accounting settings.' };
  if (mode !== 'spread' && mode !== 'at_invoice') return { error: 'Choose one of the two options.' };
  await setAmcRevenueMode(ctx.organization.id, mode);
  revalidatePath('/settings/chart-of-accounts');
  return { ok: true };
}
