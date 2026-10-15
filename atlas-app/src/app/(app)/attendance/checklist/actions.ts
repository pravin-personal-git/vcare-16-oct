'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { addItem, saveChecklist, updateItem, ChecklistError } from '@/server/staff-checklist';

export interface ChecklistActionState { ok?: boolean; error?: string }

async function guard(run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<void>): Promise<ChecklistActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('attendance.edit') && !ctx.permissions.has('hrm.edit')) {
      return { error: 'Marking the checklist needs the attendance edit permission.' };
    }
    if (ctx.scope.kind !== 'single') return { error: 'Select a single branch first.' };
    await run(ctx);
    revalidatePath('/attendance/checklist');
    return { ok: true };
  } catch (e) {
    if (e instanceof ChecklistError) return { error: e.message };
    console.error('[checklist] action failed', e);
    return { error: 'Could not save. Please try again.' };
  }
}

export async function saveChecklistAction(userId: string, workDate: string, values: Record<string, boolean>, note: string | null) {
  return guard((ctx) => saveChecklist(ctx.scope, { userId, workDate, values, note }, ctx.user.id));
}

export async function addItemAction(label: string) {
  return guard((ctx) => addItem(ctx.scope, label));
}

export async function updateItemAction(id: string, patch: { label?: string; isActive?: boolean }) {
  return guard((ctx) => updateItem(ctx.scope, id, patch));
}
