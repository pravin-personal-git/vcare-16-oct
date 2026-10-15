'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createTask, updateTask, setTaskStatus, deleteTask,
  TaskError, type TaskInput, type TaskStatus,
} from '@/server/tasks';
import { listAssignableUsers } from '@/server/assets';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

// Its own `tasks.edit` rather than `settings.edit` - this is a day-to-day
// work tool, not an admin screen, so an org can hand it to every role without
// also handing out Settings.
async function guard(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('tasks.edit')) {
      return { error: 'You do not have permission to change tasks.' };
    }
    await run();
    revalidatePath('/tasks');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (err) {
    if (err instanceof TaskError) return { error: err.message };
    console.error('[tasks] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function saveTask(id: string | null, input: TaskInput) {
  return guard(async () => {
    const ctx = await requireContext();
    if (id) await updateTask(ctx.scope, id, input);
    else await createTask(ctx.scope, input, ctx.user.id);
  });
}

export async function moveTask(id: string, status: TaskStatus) {
  return guard(async () => {
    const ctx = await requireContext();
    await setTaskStatus(ctx.scope, id, status);
  });
}

export async function removeTask(id: string) {
  return guard(async () => {
    const ctx = await requireContext();
    await deleteTask(ctx.scope, id);
  });
}

export async function fetchAssignableUsers() {
  try {
    const ctx = await requireContext();
    const users = await listAssignableUsers(ctx.scope);
    return { data: users };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not load the user list.' };
  }
}
