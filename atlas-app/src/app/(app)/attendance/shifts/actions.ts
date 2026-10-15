'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { correctShiftEnd, shiftOwner } from '@/server/shifts';
import { canMarkAttendanceFor } from '@/server/attendance-mark-policy';
import { istWallClock } from '@/lib/date-ranges';

/**
 * Correcting a shift somebody forgot to end.
 *
 * THE ONE WRITE ON THE ATTENDANCE SCREEN, AND IT NEEDS ITS OWN PERMISSION.
 *
 * Everything else here is a read. This changes a number that becomes a wage,
 * so `attendance.edit` is separate from `attendance.view`: plenty of people
 * should be able to see who worked when, and very few should be able to change
 * it after the fact.
 *
 * The original auto-closed time is kept. See `Shift.correctedEndedAt`.
 */

export interface ShiftState {
  ok?: boolean;
  error?: string;
  message?: string;
}

export async function correctShiftAction(
  shiftId: string,
  correctedEnd: string,
  reason: string,
): Promise<ShiftState> {
  const ctx = await requireContext();

  if (!ctx.permissions.has('attendance.edit')) {
    return { error: 'You do not have permission to correct attendance.' };
  }

  const owner = await shiftOwner(ctx.scope, shiftId);
  if (!owner) {
    return { error: 'Shift not found in your scope.' };
  }
  if (!await canMarkAttendanceFor(owner.storeId, ctx.user, owner.userId)) {
    return { error: 'Your store\'s attendance rules do not let you correct this person\'s shifts. Ask someone who can.' };
  }

  try {
    await correctShiftEnd(
      ctx.scope,
      shiftId,
      istWallClock(correctedEnd),
      reason,
      ctx.user.id,
    );

    // Audit trail beyond the columns on the row itself. A wage correction is
    // exactly the kind of thing somebody asks about six months later.
    if (ctx.scope.kind !== 'all') {
      await db.activityLog
        .create({
          data: {
            storeId: ctx.scope.storeId,
            userId: ctx.user.id,
            activityType: 'corrected',
            entityType: 'Shift',
            entityId: shiftId,
            description: `Shift finish time corrected to ${correctedEnd}: ${reason}`,
          },
        })
        .catch((e) => console.error('[shifts] audit write failed (non-fatal)', e));
    }

    revalidatePath('/attendance/shifts');
    return { ok: true, message: 'Corrected. The original time is kept on the record.' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not correct the shift.' };
  }
}
