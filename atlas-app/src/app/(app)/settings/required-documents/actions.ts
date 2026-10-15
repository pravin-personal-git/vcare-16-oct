'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { saveRequiredRules } from '@/server/attachments';
import { friendlyError } from '@/lib/friendly-error';

/** Settings › Required documents (11 Oct 2026). Admins only, one branch at a time. */
export async function saveRequiredDocsAction(raw: unknown): Promise<{ ok?: true; error?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) return { error: 'Only an admin can change the required documents.' };
    if (ctx.scope.kind !== 'single') return { error: 'Pick a branch first (top bar). Each branch keeps its own list.' };
    await saveRequiredRules(ctx.scope, raw);
    revalidatePath('/settings/required-documents');
    return { ok: true };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
