'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createJobOpening, setJobOpeningStatus, addCandidate, moveCandidateStage, addCandidateNote,
  listCandidateActivity, linkHiredCandidate, listLinkableUsers,
  RecruitmentError, type JobOpeningInput, type CandidateInput, type CandidateStage,
} from '@/server/recruitment';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function guard(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('hrm.edit')) return { error: 'You do not have permission to manage recruitment.' };
    await run();
    revalidatePath('/hrm/recruitment');
    return { ok: true };
  } catch (err) {
    if (err instanceof RecruitmentError) return { error: err.message };
    console.error('[recruitment] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function createJobOpeningAction(input: JobOpeningInput): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await createJobOpening(ctx.scope, input, ctx.user.id);
  });
}

export async function setJobOpeningStatusAction(id: string, status: 'open' | 'on_hold' | 'closed'): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await setJobOpeningStatus(ctx.scope, id, status);
  });
}

export async function addCandidateAction(input: CandidateInput): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await addCandidate(ctx.scope, input, ctx.user.id);
  });
}

export async function moveCandidateStageAction(candidateId: string, toStage: CandidateStage, note: string | null): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await moveCandidateStage(ctx.scope, candidateId, toStage, ctx.user.id, note);
  });
}

export async function addCandidateNoteAction(candidateId: string, body: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await addCandidateNote(ctx.scope, candidateId, body, ctx.user.id);
  });
}

export async function linkHiredCandidateAction(candidateId: string, userId: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await linkHiredCandidate(ctx.scope, candidateId, userId);
  });
}

export async function fetchCandidateActivityAction(candidateId: string) {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('hrm.view') && !ctx.permissions.has('hrm.edit')) {
      return { error: 'You do not have permission to view recruitment.' };
    }
    const rows = await listCandidateActivity(ctx.scope, candidateId);
    return { data: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  } catch (err) {
    if (err instanceof RecruitmentError) return { error: err.message };
    return { error: 'Could not load activity.' };
  }
}

export async function fetchLinkableUsersAction() {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('hrm.edit')) return { error: 'You do not have permission to manage recruitment.' };
    const users = await listLinkableUsers(ctx.scope);
    return { data: users };
  } catch {
    return { error: 'Could not load the user list.' };
  }
}
