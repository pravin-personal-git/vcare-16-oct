'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createFaqCategory, removeFaqCategory, saveFaq, removeFaq,
  HelpdeskError, type FaqInput,
} from '@/server/helpdesk';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function guardEdit(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('helpdesk.edit')) return { error: 'You do not have permission to manage FAQs.' };
    await run();
    revalidatePath('/helpdesk/faqs');
    return { ok: true };
  } catch (err) {
    if (err instanceof HelpdeskError) return { error: err.message };
    console.error('[helpdesk-faqs] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function createFaqCategoryAction(title: string): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await createFaqCategory(ctx.scope, title);
  });
}

export async function removeFaqCategoryAction(id: string): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await removeFaqCategory(ctx.scope, id);
  });
}

export async function saveFaqAction(id: string | null, input: FaqInput): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await saveFaq(ctx.scope, id, input);
  });
}

export async function removeFaqAction(id: string): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await removeFaq(ctx.scope, id);
  });
}
