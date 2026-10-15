'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { startOnboarding, markConfirmed, listOnboardingTasks, OnboardingError, type OnboardingDetailsInput } from '@/server/onboarding';
import { listChecklistItems, createChecklistItem, removeChecklistItem, setTaskStatus, LifecycleError } from '@/server/lifecycle';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function guard(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('hrm.edit')) return { error: 'You do not have permission to manage onboarding.' };
    await run();
    revalidatePath('/hrm/onboarding');
    return { ok: true };
  } catch (err) {
    if (err instanceof OnboardingError || err instanceof LifecycleError) return { error: err.message };
    console.error('[onboarding] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function startOnboardingAction(userId: string, input: OnboardingDetailsInput): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await startOnboarding(ctx.scope, userId, input);
  });
}

export async function markConfirmedAction(userId: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await markConfirmed(ctx.scope, userId);
  });
}

export async function setOnboardingTaskStatusAction(taskId: string, status: 'done' | 'skipped' | 'pending'): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await setTaskStatus(ctx.scope, taskId, status, ctx.user.id, null);
  });
}

export async function createOnboardingStepAction(label: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await createChecklistItem(ctx.scope, 'onboarding', label);
  });
}

export async function removeOnboardingStepAction(id: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await removeChecklistItem(ctx.scope, id);
  });
}

export async function fetchOnboardingTasksAction(userId: string) {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('hrm.edit') && !ctx.permissions.has('hrm.view')) {
      return { error: 'You do not have permission to view onboarding.' };
    }
    const rows = await listOnboardingTasks(ctx.scope, userId, 'onboarding');
    return { data: rows.map((r) => ({ ...r, completedAt: r.completedAt ? r.completedAt.toISOString() : null, createdAt: r.createdAt.toISOString() })) };
  } catch {
    return { error: 'Could not load the checklist.' };
  }
}

export async function fetchOnboardingStepsAction() {
  try {
    const ctx = await requireContext();
    const rows = await listChecklistItems(ctx.scope, 'onboarding');
    return { data: rows };
  } catch {
    return { error: 'Could not load onboarding steps.' };
  }
}
