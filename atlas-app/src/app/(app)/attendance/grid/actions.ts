'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import {
  addHoliday, createLeaveRequest, decideLeaveRequest, removeHoliday,
} from '@/server/attendance';
import { friendlyError } from '@/lib/friendly-error';

/**
 * Attendance writes: leave decisions and the holiday calendar.
 *
 * `attendance.edit` gates all of it - the same permission that corrects a
 * forgotten shift. Approving leave and setting a holiday both change what the
 * grid says somebody was owed for a day, which is the same authority.
 */

export interface AttState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function guard() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('attendance.edit')) {
    return { error: 'You do not have permission to change attendance.' };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single store first - holidays and leave belong to one branch.' };
  }
  return { ctx, storeId: ctx.scope.storeId };
}

function fail(e: unknown): AttState {
  return { error: friendlyError(e, true) };
}

export async function requestLeaveAction(input: {
  userId: string;
  kind: 'leave' | 'wfh' | 'half_day';
  leaveTypeId?: string | null;
  fromDate: string;
  toDate: string;
  reason: string | null;
}): Promise<AttState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await createLeaveRequest(g.ctx.scope, {
      userId: input.userId,
      kind: input.kind,
      leaveTypeId: input.leaveTypeId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      reason: input.reason,
    });
    revalidatePath('/attendance/grid');
    return { ok: true, message: 'Request recorded. It is pending a decision.' };
  } catch (e) {
    return fail(e);
  }
}

export async function decideLeaveAction(
  requestId: string,
  decision: 'approved' | 'rejected',
  note: string | null,
): Promise<AttState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await decideLeaveRequest(g.ctx.scope, requestId, decision, g.ctx.user.id, note);

    // A leave decision changes what somebody is paid for a day. That belongs
    // in the audit log, not only in the row's own columns.
    await db.activityLog
      .create({
        data: {
          storeId: g.storeId,
          userId: g.ctx.user.id,
          activityType: decision,
          entityType: 'LeaveRequest',
          entityId: requestId,
          description: `Leave request ${decision}${note ? `: ${note}` : ''}`,
        },
      })
      .catch((e) => console.error('[attendance] audit write failed (non-fatal)', e));

    revalidatePath('/attendance/grid');
    revalidatePath('/attendance/shifts');
    return { ok: true, message: `Request ${decision}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function addHolidayAction(
  date: string,
  name: string,
  kind: string,
): Promise<AttState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await addHoliday(g.ctx.scope, date, name, kind, g.ctx.user.id);
    revalidatePath('/attendance/grid');
    return { ok: true, message: `${name} added to the calendar.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeHolidayAction(id: string): Promise<AttState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await removeHoliday(g.ctx.scope, id);
    revalidatePath('/attendance/grid');
    return { ok: true, message: 'Removed.' };
  } catch (e) {
    return fail(e);
  }
}
