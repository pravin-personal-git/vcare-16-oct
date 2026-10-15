'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createSalaryContract, deactivateSalaryContract, getContractHistory,
  SalaryContractError, type CreateContractInput, type ContractHistoryRow,
} from '@/server/salary-contracts';
import { friendlyError } from '@/lib/friendly-error';

export interface ContractActionState {
  error?: string;
  ok?: boolean;
}

function guard(ctx: Awaited<ReturnType<typeof requireContext>>): string | null {
  if (!ctx.permissions.has('payroll.configure')) {
    return 'You do not have permission to change salary contracts.';
  }
  return null;
}

export async function createContractAction(input: CreateContractInput): Promise<ContractActionState> {
  const ctx = await requireContext();
  const denied = guard(ctx);
  if (denied) return { error: denied };

  try {
    await createSalaryContract(ctx.scope, input, ctx.user.id);
    revalidatePath('/hrm/payroll/contracts');
    return { ok: true };
  } catch (e) {
    if (e instanceof SalaryContractError) return { error: e.message };
    console.error('[contracts] create failed', e);
    return { error: friendlyError(e) };
  }
}

export async function deactivateContractAction(contractId: string): Promise<ContractActionState> {
  const ctx = await requireContext();
  const denied = guard(ctx);
  if (denied) return { error: denied };

  try {
    await deactivateSalaryContract(ctx.scope, contractId);
    revalidatePath('/hrm/payroll/contracts');
    return { ok: true };
  } catch (e) {
    if (e instanceof SalaryContractError) return { error: e.message };
    console.error('[contracts] deactivate failed', e);
    return { error: friendlyError(e) };
  }
}

export interface HistoryActionState {
  error?: string;
  rows?: ContractHistoryRow[];
}

export async function getContractHistoryAction(userId: string): Promise<HistoryActionState> {
  const ctx = await requireContext();
  try {
    const rows = await getContractHistory(ctx.scope, userId);
    return { rows };
  } catch (e) {
    if (e instanceof SalaryContractError) return { error: e.message };
    console.error('[contracts] history failed', e);
    return { error: friendlyError(e) };
  }
}
