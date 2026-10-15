'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  EmployeeConfigError, saveEmployeeType, removeEmployeeType, saveEmployeeTag, removeEmployeeTag,
  assignEmployeeConfig,
} from '@/server/employee-config';
import { friendlyError } from '@/lib/friendly-error';

export interface EmployeeConfigState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function guard() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('hrm.edit')) {
    return { error: 'You do not have permission to change employee configuration.' as const };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single branch first.' as const };
  }
  return { ctx };
}

function fail(e: unknown): EmployeeConfigState {
  if (e instanceof EmployeeConfigError) return { error: e.message };
  console.error('[employee-config] action failed', e);
  return { error: friendlyError(e, true) };
}

function done(): void {
  revalidatePath('/hrm/employee-config');
}

export async function saveEmployeeTypeAction(id: string | null, label: string): Promise<EmployeeConfigState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await saveEmployeeType(g.ctx.scope, id, label);
    done();
    return { ok: true, message: id ? 'Employee type updated.' : `${label} added.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeEmployeeTypeAction(id: string): Promise<EmployeeConfigState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await removeEmployeeType(g.ctx.scope, id);
    done();
    return { ok: true, message: 'Employee type deactivated.' };
  } catch (e) {
    return fail(e);
  }
}

export async function saveEmployeeTagAction(id: string | null, label: string, color: string): Promise<EmployeeConfigState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await saveEmployeeTag(g.ctx.scope, id, { label, color });
    done();
    return { ok: true, message: id ? 'Tag updated.' : `${label} added.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeEmployeeTagAction(id: string): Promise<EmployeeConfigState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await removeEmployeeTag(g.ctx.scope, id);
    done();
    return { ok: true, message: 'Tag deactivated.' };
  } catch (e) {
    return fail(e);
  }
}

export async function assignEmployeeConfigAction(
  userId: string, employeeTypeTagId: string | null, tagIds: string[],
): Promise<EmployeeConfigState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await assignEmployeeConfig(g.ctx.scope, userId, { employeeTypeTagId, tagIds });
    done();
    return { ok: true, message: 'Assignment saved.' };
  } catch (e) {
    return fail(e);
  }
}
