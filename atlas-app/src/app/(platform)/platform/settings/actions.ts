'use server';

import { revalidatePath } from 'next/cache';
import { requirePlatformContext } from '@/server/platform-context';
import { updateMaxResellerDepth, PlatformAdminError } from '@/server/platform-admin';
import { requireRootPlatformOwner, RootPlatformOwnerRequiredError } from '@/server/platform-scope';

export interface SettingsState {
  ok?: boolean;
  error?: string;
}

/** Root-gated (D055) - a config value every reseller-depth check in `createReseller` depends on. */
export async function updateMaxResellerDepthAction(maxResellerDepth: number): Promise<SettingsState> {
  try {
    const ctx = await requirePlatformContext();
    if (!ctx.permissions.has('platformConfig.edit')) {
      return { error: 'You do not have permission to edit platform settings.' };
    }
    await requireRootPlatformOwner(ctx.user.id);
    await updateMaxResellerDepth(ctx.user.id, maxResellerDepth);
  } catch (e) {
    if (e instanceof RootPlatformOwnerRequiredError) return { error: e.message };
    if (e instanceof PlatformAdminError) return { error: e.message };
    console.error('[platform/settings] updateMaxResellerDepth failed', e);
    return { error: 'Could not update that setting. Please try again.' };
  }
  revalidatePath('/platform/settings');
  return { ok: true };
}
