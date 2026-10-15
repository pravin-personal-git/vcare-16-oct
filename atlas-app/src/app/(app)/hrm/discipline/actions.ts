'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  DisciplineError, saveActionType, removeActionType, createDisciplinaryAction,
  type ActionTypeInput, type ActionKind,
} from '@/server/discipline';
import { friendlyError } from '@/lib/friendly-error';

export interface DisciplineState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function guard() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('hrm.edit')) {
    return { error: 'You do not have permission to change discipline settings.' as const };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single branch first.' as const };
  }
  return { ctx };
}

function fail(e: unknown): DisciplineState {
  if (e instanceof DisciplineError) return { error: e.message };
  console.error('[discipline] action failed', e);
  return { error: friendlyError(e, true) };
}

function done(): void {
  revalidatePath('/hrm/discipline');
}

export async function saveActionTypeAction(id: string | null, input: ActionTypeInput): Promise<DisciplineState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await saveActionType(g.ctx.scope, id, input);
    done();
    return { ok: true, message: id ? 'Action type updated.' : `${input.title} added.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeActionTypeAction(id: string): Promise<DisciplineState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await removeActionType(g.ctx.scope, id);
    done();
    return { ok: true, message: 'Action type deactivated.' };
  } catch (e) {
    return fail(e);
  }
}

export async function createDisciplinaryActionAction(input: {
  userId: string; actionTypeId: string; description: string; startDate: string; durationDays: number | null;
}): Promise<DisciplineState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await createDisciplinaryAction(
      g.ctx.scope,
      { ...input, startDate: new Date(input.startDate) },
      g.ctx.user.id,
    );
    done();
    return { ok: true, message: 'Recorded.' };
  } catch (e) {
    return fail(e);
  }
}

export type { ActionKind };
