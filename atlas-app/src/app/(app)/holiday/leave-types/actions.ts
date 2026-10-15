'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  LeaveTypeError, saveLeaveType, removeLeaveType, saveAllocation, addCompOffEntry,
  requestCompOff, decideCompOffRequest, requestLeaveAllocation, decideLeaveAllocationRequest,
  saveRestrictedPeriod, removeRestrictedPeriod,
  type LeaveTypeInput, type RestrictedPeriodInput,
} from '@/server/leave-types';
import { friendlyError } from '@/lib/friendly-error';

export interface LeaveTypesState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function guard() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('attendance.edit')) {
    return { error: 'You do not have permission to change leave settings.' as const };
  }
  if (ctx.scope.kind === 'all') {
    return {
      error: 'Select a single branch first. Leave quotas are set per branch.' as const,
    };
  }
  return { ctx };
}

function fail(e: unknown): LeaveTypesState {
  if (e instanceof LeaveTypeError) return { error: e.message };
  console.error('[leave-types] action failed', e);
  return { error: friendlyError(e, true) };
}

function done(): void {
  revalidatePath('/holiday/leave-types');
  revalidatePath('/attendance/grid');
}

export async function saveLeaveTypeAction(id: string | null, input: LeaveTypeInput): Promise<LeaveTypesState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await saveLeaveType(g.ctx.scope, id, input, g.ctx.user.id);
    done();
    return { ok: true, message: id ? 'Leave type updated.' : `${input.code.toUpperCase()} added.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeLeaveTypeAction(id: string): Promise<LeaveTypesState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await removeLeaveType(g.ctx.scope, id);
    done();
    return { ok: true, message: 'Leave type removed.' };
  } catch (e) {
    return fail(e);
  }
}

export async function saveAllocationAction(
  userId: string, leaveTypeId: string, year: number, allowedDays: number,
): Promise<LeaveTypesState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await saveAllocation(g.ctx.scope, { userId, leaveTypeId, year, allowedDays }, g.ctx.user.id);
    done();
    return { ok: true, message: 'Allocation saved.' };
  } catch (e) {
    return fail(e);
  }
}

export async function addCompOffEntryAction(
  userId: string, days: number, reason: string | null,
): Promise<LeaveTypesState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await addCompOffEntry(g.ctx.scope, { userId, days, reason }, g.ctx.user.id);
    done();
    return { ok: true, message: days > 0 ? `${days} comp-off day(s) granted.` : `${Math.abs(days)} comp-off day(s) deducted.` };
  } catch (e) {
    return fail(e);
  }
}

/** An employee redeeming their own comp-off - unlike the grant/deduct above, this starts a request, not an immediate change. */
export async function requestCompOffAction(days: number, reason: string | null): Promise<LeaveTypesState> {
  const ctx = await requireContext();
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single branch first.' };
  }
  try {
    await requestCompOff(ctx.scope, { userId: ctx.user.id, days, reason });
    revalidatePath('/holiday/leave-types');
    return { ok: true, message: 'Request sent. It is pending a decision.' };
  } catch (e) {
    return fail(e);
  }
}

export async function decideCompOffRequestAction(
  entryId: string, decision: 'approved' | 'rejected', note: string | null,
): Promise<LeaveTypesState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await decideCompOffRequest(g.ctx.scope, entryId, decision, g.ctx.user.id, note);
    done();
    return { ok: true, message: `Request ${decision}.` };
  } catch (e) {
    return fail(e);
  }
}

/** An employee asking for extra days beyond their normal quota - self-service, same shape as `requestCompOffAction`. */
export async function requestLeaveAllocationAction(
  leaveTypeId: string, requestedDays: number, description: string,
): Promise<LeaveTypesState> {
  const ctx = await requireContext();
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single branch first.' };
  }
  try {
    await requestLeaveAllocation(ctx.scope, { leaveTypeId, requestedDays, description }, ctx.user.id);
    revalidatePath('/holiday/leave-types');
    return { ok: true, message: 'Request sent. It is pending a decision.' };
  } catch (e) {
    return fail(e);
  }
}

export async function decideLeaveAllocationRequestAction(
  requestId: string, decision: 'approved' | 'rejected', note: string | null,
): Promise<LeaveTypesState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await decideLeaveAllocationRequest(g.ctx.scope, requestId, decision, g.ctx.user.id, note);
    done();
    return { ok: true, message: `Request ${decision}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function saveRestrictedPeriodAction(
  id: string | null, input: Omit<RestrictedPeriodInput, 'startDate' | 'endDate'> & { startDate: string; endDate: string },
): Promise<LeaveTypesState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await saveRestrictedPeriod(
      g.ctx.scope, id, { ...input, startDate: new Date(input.startDate), endDate: new Date(input.endDate) }, g.ctx.user.id,
    );
    done();
    return { ok: true, message: id ? 'Restricted period updated.' : `${input.title} added.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeRestrictedPeriodAction(id: string): Promise<LeaveTypesState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await removeRestrictedPeriod(g.ctx.scope, id);
    done();
    return { ok: true, message: 'Restricted period removed.' };
  } catch (e) {
    return fail(e);
  }
}
