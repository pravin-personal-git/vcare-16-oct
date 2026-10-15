'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { EmployeeError, updateEmployee, type EmployeeInput } from '@/server/employees';

/** Save an employee's details (users.edit or hrm.edit; bank details need payroll.process). */
export async function updateEmployeeAction(userId: string, input: EmployeeInput): Promise<{ error?: string; ok?: boolean }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('users.edit') && !ctx.permissions.has('hrm.edit')) return { error: 'You do not have permission to change employee details.' };
    const canEditBank = ctx.permissions.has('payroll.process') || ctx.permissions.has('payroll.configure');
    await updateEmployee(ctx.scope, ctx.organization.id, userId, input, ctx.user.id, canEditBank);
    revalidatePath('/settings/employees');
    return { ok: true };
  } catch (e) {
    if (e instanceof EmployeeError) return { error: e.message };
    console.error('[employees] update failed', e);
    return { error: 'Could not save. Please try again.' };
  }
}
