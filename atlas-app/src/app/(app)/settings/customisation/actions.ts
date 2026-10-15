'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { Prisma } from '@prisma/client';
import { saveStoreConfig, ConfigError, FlowConfigError } from '@/server/config';
import { friendlyError } from '@/lib/friendly-error';

/**
 * Saving a customisation. The flow half is validated in `server/config.ts`
 * (`checkedFlow` → `validateStep`), so a step switched off without a legal
 * fallback comes back as a sentence the client can act on rather than being
 * stored and discovered later by a stranded job (D16).
 */
export async function saveCustomisationAction(input: {
  values: Record<string, boolean | string>;
  flow: Record<string, { on: boolean; fallback: string }>;
  labels: Record<string, { en?: string; hi?: string }>;
}): Promise<{ ok?: boolean; error?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return { error: 'You do not have permission to change settings.' };
    }
    if (ctx.scope.kind !== 'single') {
      return { error: 'Pick a branch first (top bar). Settings belong to one branch.' };
    }
    await saveStoreConfig(ctx.scope, input, ctx.user.id);
    revalidatePath('/settings/customisation');
    return { ok: true };
  } catch (e) {
    // The rule-book refusals are written for people - show them. Until 6 Oct
    // they were swallowed into "Something went wrong", so a refused step and a
    // real failure looked the same and nobody could tell which.
    if (e instanceof FlowConfigError || e instanceof ConfigError) return { error: e.message };
    console.error('[customisation] save failed', e);
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? ` (${e.code})` : '';
    return { error: `${friendlyError(e)}${code}` };
  }
}
