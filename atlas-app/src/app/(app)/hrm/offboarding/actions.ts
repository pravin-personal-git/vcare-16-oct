'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { submitResignation, decideResignation, completeOffboarding, listOffboardingTasks, OffboardingError } from '@/server/offboarding';
import { createChecklistItem, removeChecklistItem, setTaskStatus, LifecycleError } from '@/server/lifecycle';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

function canViewAll(permissions: Set<string>): boolean {
  return permissions.has('hrm.view') || permissions.has('hrm.edit');
}

async function guardEdit(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('hrm.edit')) return { error: 'You do not have permission to manage offboarding.' };
    await run();
    revalidatePath('/hrm/offboarding');
    return { ok: true };
  } catch (err) {
    if (err instanceof OffboardingError || err instanceof LifecycleError) return { error: err.message };
    console.error('[offboarding] action failed', err);
    return { error: friendlyError(err) };
  }
}

// Deliberately NOT behind the edit guard - resigning your own position
// needs no admin permission, the same as raising a leave request.
export async function submitResignationAction(input: { reason: string | null; noticeDays: number; lastWorkingDay: Date }): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await submitResignation(ctx.scope, input, ctx.user.id);
    revalidatePath('/hrm/offboarding');
    return { ok: true };
  } catch (err) {
    if (err instanceof OffboardingError) return { error: err.message };
    console.error('[offboarding] submit failed', err);
    return { error: friendlyError(err) };
  }
}

export async function decideResignationAction(id: string, decision: 'accepted' | 'rejected', note: string | null): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await decideResignation(ctx.scope, id, decision, ctx.user.id, note);
  });
}

export async function completeOffboardingAction(id: string): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await completeOffboarding(ctx.scope, id);
  });
}

export async function setOffboardingTaskStatusAction(taskId: string, status: 'done' | 'skipped' | 'pending'): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await setTaskStatus(ctx.scope, taskId, status, ctx.user.id, null);
  });
}

export async function createOffboardingStepAction(label: string): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await createChecklistItem(ctx.scope, 'offboarding', label);
  });
}

export async function removeOffboardingStepAction(id: string): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await removeChecklistItem(ctx.scope, id);
  });
}

export async function fetchOffboardingTasksAction(userId: string) {
  try {
    const ctx = await requireContext();
    if (!canViewAll(ctx.permissions) && userId !== ctx.user.id) {
      return { error: 'You can only view your own offboarding checklist.' };
    }
    const rows = await listOffboardingTasks(ctx.scope, userId, 'offboarding');
    return { data: rows.map((r) => ({ ...r, completedAt: r.completedAt ? r.completedAt.toISOString() : null, createdAt: r.createdAt.toISOString() })) };
  } catch {
    return { error: 'Could not load the checklist.' };
  }
}

/** What is still open between the business and somebody who is leaving (G-19). */
export async function loadSettlementAction(userId: string) {
  const ctx = await requireContext();
  if (!ctx.permissions.has('hrm.view') && !ctx.permissions.has('hrm.edit')) {
    return { error: 'You do not have permission to see this.' as string };
  }
  if (ctx.scope.kind !== 'single') return { error: 'Choose a branch first.' };
  try {
    const { settlementFor } = await import('@/server/offboarding');
    return { data: await settlementFor(ctx.scope, userId) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not read the account.' };
  }
}

/** Stop chasing what a leaver owes, with a reason on the record (G-19). */
export async function writeOffDuesAction(userId: string, reason: string) {
  const ctx = await requireContext();
  if (!ctx.permissions.has('hrm.edit')) {
    return { error: 'You do not have permission to write this off.' as string };
  }
  if (ctx.scope.kind !== 'single') return { error: 'Choose a branch first.' };
  if (!reason.trim()) return { error: 'Say why this is being written off.' };
  try {
    const { writeOffStaffDues } = await import('@/server/offboarding');
    const r = await writeOffStaffDues(ctx.scope, userId, reason, ctx.user.id);
    revalidatePath('/hrm/offboarding');
    revalidatePath('/user/account');
    return { ok: true as const, writtenOffPaise: r.writtenOffPaise };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not write it off.' };
  }
}
