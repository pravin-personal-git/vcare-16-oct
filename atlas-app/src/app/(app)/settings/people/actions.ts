'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { AdminError } from '@/server/administration';
import { addPerson, type AddPersonInput } from '@/server/add-person';
import { friendlyError } from '@/lib/friendly-error';

/**
 * Add a person (B3 part 2, 11 Oct 2026): login + roles + employee record in
 * one go, manager straight after. The password comes back once, to show and
 * send - an admin-readable copy is kept the same way User List keeps one.
 */
export async function addPersonAction(input: AddPersonInput): Promise<{
  error?: string; userId?: string; username?: string; password?: string; warning?: string | null;
}> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('users.edit')) return { error: 'You do not have permission to add people.' };
    const r = await addPerson(ctx.scope, ctx.organization.id, input, ctx.user.id);
    if (ctx.scope.kind === 'single') {
      await db.activityLog.create({
        data: { storeId: ctx.scope.storeId, userId: ctx.user.id, activityType: 'Create', entityType: 'User', entityId: r.userId, description: `Person '${input.fullName.trim()}' added (${r.username}) with an employee record` },
      }).catch((e) => console.error('[people] activity write failed (non-fatal)', e));
    }
    revalidatePath('/settings/people');
    revalidatePath('/settings/users');
    return r;
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    console.error('[people] add failed', err);
    return { error: friendlyError(err) };
  }
}
