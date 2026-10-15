'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { createNotice, updateNotice, deleteNotice, NoticeError, type NoticeInput } from '@/server/notices';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function guard(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return { error: 'You do not have permission to post notices.' };
    }
    await run();
    revalidatePath('/notices');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (err) {
    if (err instanceof NoticeError) return { error: err.message };
    console.error('[notices] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function saveNotice(id: string | null, input: NoticeInput) {
  return guard(async () => {
    const ctx = await requireContext();
    if (id) await updateNotice(ctx.scope, id, input);
    else await createNotice(ctx.scope, input, ctx.user.id);
  });
}

export async function removeNotice(id: string) {
  return guard(async () => {
    const ctx = await requireContext();
    await deleteNotice(ctx.scope, id);
  });
}
