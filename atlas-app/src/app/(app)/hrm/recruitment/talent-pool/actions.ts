'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createSkillZone, listSkillZoneCandidates, addCandidateToSkillZone, removeCandidateFromSkillZone,
  RecruitmentError, type SkillZoneCandidateRow,
} from '@/server/recruitment';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function guardEdit(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('hrm.edit')) return { error: 'You do not have permission to manage recruitment.' };
    await run();
    revalidatePath('/hrm/recruitment/talent-pool');
    return { ok: true };
  } catch (err) {
    if (err instanceof RecruitmentError) return { error: err.message };
    console.error('[talent-pool] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function createSkillZoneAction(input: { title: string; description: string | null }): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await createSkillZone(ctx.scope, input);
  });
}

export async function fetchSkillZoneCandidatesAction(
  skillZoneId: string,
): Promise<{ error?: string; data?: (Omit<SkillZoneCandidateRow, 'addedOn'> & { addedOn: string })[] }> {
  try {
    const ctx = await requireContext();
    const rows = await listSkillZoneCandidates(ctx.scope, skillZoneId);
    return { data: rows.map((r) => ({ ...r, addedOn: r.addedOn.toISOString() })) };
  } catch (err) {
    if (err instanceof RecruitmentError) return { error: err.message };
    console.error('[talent-pool] fetch failed', err);
    return { error: friendlyError(err) };
  }
}

export async function addCandidateToSkillZoneAction(input: { skillZoneId: string; candidateId: string; reason: string }): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await addCandidateToSkillZone(ctx.scope, input);
  });
}

export async function removeCandidateFromSkillZoneAction(id: string): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await removeCandidateFromSkillZone(ctx.scope, id);
  });
}
