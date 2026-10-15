'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { DOC_TYPES, saveCustomOptions, saveTemplateChoice, type DocType } from '@/server/document-templates';
import { friendlyError } from '@/lib/friendly-error';

/** Settings > Document layouts (workstream C). */
export async function saveDocumentsAction(input: {
  picks: Record<string, string>;
  options: unknown;
}): Promise<{ ok?: true; error?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return { error: 'You do not have permission to change document layouts.' };
    }
    if (ctx.scope.kind !== 'single') {
      return { error: 'Pick a branch first (top bar). Each branch prints its own way.' };
    }

    const storeId = ctx.scope.storeId;

    // Options first: the client's own look is shared across document types,
    // so writing it before the picks means a document switched to "custom" in
    // the same save already has the right options behind it.
    await saveCustomOptions(storeId, input.options, ctx.user.id);

    for (const docType of DOC_TYPES) {
      const pick = input.picks[docType];
      if (pick) await saveTemplateChoice(storeId, docType as DocType, pick, input.options, ctx.user.id);
    }

    revalidatePath('/settings/documents');
    return { ok: true };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
