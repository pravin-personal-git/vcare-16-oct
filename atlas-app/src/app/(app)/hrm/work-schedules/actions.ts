'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  WorkScheduleError, saveWorkType, removeWorkType, saveShift, removeShift, assignEmployeeSchedule,
  type ShiftDayRow,
} from '@/server/work-schedules';
import { friendlyError } from '@/lib/friendly-error';

export interface WorkScheduleState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function guard() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('hrm.edit')) {
    return { error: 'You do not have permission to change work schedules.' as const };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single branch first.' as const };
  }
  return { ctx };
}

function fail(e: unknown): WorkScheduleState {
  if (e instanceof WorkScheduleError) return { error: e.message };
  console.error('[work-schedules] action failed', e);
  return { error: friendlyError(e, true) };
}

function done(): void {
  revalidatePath('/hrm/work-schedules');
}

export async function saveWorkTypeAction(id: string | null, label: string): Promise<WorkScheduleState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await saveWorkType(g.ctx.scope, id, label);
    done();
    return { ok: true, message: id ? 'Work type updated.' : `${label} added.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeWorkTypeAction(id: string): Promise<WorkScheduleState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await removeWorkType(g.ctx.scope, id);
    done();
    return { ok: true, message: 'Work type deactivated.' };
  } catch (e) {
    return fail(e);
  }
}

export async function saveShiftAction(id: string | null, label: string, schedule: ShiftDayRow[]): Promise<WorkScheduleState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await saveShift(g.ctx.scope, id, { label, schedule });
    done();
    return { ok: true, message: id ? 'Shift updated.' : `${label} added.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeShiftAction(id: string): Promise<WorkScheduleState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await removeShift(g.ctx.scope, id);
    done();
    return { ok: true, message: 'Shift deactivated.' };
  } catch (e) {
    return fail(e);
  }
}

export async function assignEmployeeScheduleAction(
  userId: string, shiftId: string | null, workTypeId: string | null,
): Promise<WorkScheduleState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await assignEmployeeSchedule(g.ctx.scope, userId, { shiftId, workTypeId });
    done();
    return { ok: true, message: 'Assignment saved.' };
  } catch (e) {
    return fail(e);
  }
}
