'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { setTeamAssignment, type TeamAssignmentInput } from '@/server/team-setup';
import { HierarchyError } from '@/server/hierarchy';
import { friendlyError } from '@/lib/friendly-error';

export interface TeamSetupState {
  ok?: boolean;
  error?: string;
  message?: string;
}

export async function setTeamAssignmentAction(
  userId: string,
  input: TeamAssignmentInput,
): Promise<TeamSetupState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('users.edit')) {
    return { error: 'You do not have permission to edit users and roles.' };
  }

  try {
    await setTeamAssignment(ctx.organization.id, userId, input, ctx.user.id);
    revalidatePath('/hierarchy/team-setup');
    revalidatePath('/hierarchy');
    return { ok: true, message: 'Saved.' };
  } catch (e) {
    if (e instanceof HierarchyError) return { error: e.message };
    console.error('[team-setup] action failed', e);
    return { error: friendlyError(e, true) };
  }
}
