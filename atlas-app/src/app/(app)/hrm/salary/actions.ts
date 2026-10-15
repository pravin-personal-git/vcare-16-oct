'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { upsertEmployeeSalary, setEmployeeSalaryActive, type SalaryStructureInput } from '@/server/payroll';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

export async function saveSalaryStructureAction(input: SalaryStructureInput): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('hrm.edit')) {
    return { error: 'You do not have permission to edit HRM.' };
  }
  try {
    await upsertEmployeeSalary(ctx.scope, input, ctx.user.id);
    revalidatePath('/hrm/salary');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save.' };
  }
}

export async function setSalaryActiveAction(userId: string, isActive: boolean): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('hrm.edit')) {
    return { error: 'You do not have permission to edit HRM.' };
  }
  try {
    await setEmployeeSalaryActive(ctx.scope, userId, isActive);
    revalidatePath('/hrm/salary');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not update.' };
  }
}
