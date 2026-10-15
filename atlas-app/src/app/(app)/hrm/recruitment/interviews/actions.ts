'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { scheduleInterview, markInterviewCompleted, RecruitmentError, type ScheduleInterviewInput } from '@/server/recruitment';
import { friendlyError } from '@/lib/friendly-error';
import { istWallClock } from '@/lib/date-ranges';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function guardEdit(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('hrm.edit')) return { error: 'You do not have permission to manage recruitment.' };
    await run();
    revalidatePath('/hrm/recruitment/interviews');
    return { ok: true };
  } catch (err) {
    if (err instanceof RecruitmentError) return { error: err.message };
    console.error('[interviews] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function scheduleInterviewAction(input: Omit<ScheduleInterviewInput, 'scheduledAt'> & { scheduledAt: string }): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await scheduleInterview(ctx.scope, { ...input, scheduledAt: istWallClock(input.scheduledAt) }, ctx.user.id);
  });
}

export async function markInterviewCompletedAction(id: string, feedback: string | null): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await markInterviewCompleted(ctx.scope, id, feedback);
  });
}
