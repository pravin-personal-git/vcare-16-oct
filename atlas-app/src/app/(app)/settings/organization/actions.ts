'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import {
  AdminError, setThemeTokens, updateOrganization, updateStore,
  type OrgPatch, type StorePatch,
} from '@/server/administration';
import { createBranch, ProvisioningError, type CreateBranchInput } from '@/server/provisioning';
import { ScanError, setAiScanSettings } from '@/server/scan';
import { friendlyError } from '@/lib/friendly-error';

export interface OrgActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

async function guard(
  run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<string | void>,
): Promise<OrgActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return { error: 'You do not have permission to change organisation settings.' };
    }
    const message = await run(ctx);
    revalidatePath('/settings/organization');
    // The palette and the org name are injected by the app layout, so every
    // screen has to be revalidated - not just this one.
    revalidatePath('/', 'layout');
    return { ok: true, ...(message ? { message } : {}) };
  } catch (err) {
    if (err instanceof AdminError || err instanceof ScanError) return { error: err.message };
    console.error('[organization] action failed', err);
    return { error: friendlyError(err) };
  }
}

const audit = (
  ctx: Awaited<ReturnType<typeof requireContext>>,
  description: string,
) => {
  if (ctx.scope.kind !== 'single') return Promise.resolve();
  return db.activityLog
    .create({
      data: {
        storeId: ctx.scope.storeId,
        userId: ctx.user.id,
        activityType: 'Update',
        entityType: 'Organization',
        entityId: ctx.organization.id,
        description,
      },
    })
    .catch((e) => console.error('[organization] audit write failed (non-fatal)', e));
};

export async function saveOrganization(patch: OrgPatch): Promise<OrgActionState> {
  return guard(async (ctx) => {
    await updateOrganization(ctx.organization.id, patch);
    await audit(ctx, 'Organisation profile updated');
    return 'Saved.';
  });
}

/** The camera scanner's AI reading: on or off for this business, and its monthly cap. */
export async function saveAiScan(input: { enabled: boolean; monthlyLimit: string }): Promise<OrgActionState> {
  return guard(async (ctx) => {
    await setAiScanSettings(ctx.organization.id, input);
    await audit(ctx, `AI scanning ${input.enabled ? 'turned on' : 'turned off'}, limit ${input.monthlyLimit} a month`);
    return input.enabled ? 'AI scanning is on.' : 'AI scanning is off.';
  });
}

export async function saveTheme(tokens: Record<string, string>): Promise<OrgActionState> {
  return guard(async (ctx) => {
    await setThemeTokens(ctx.organization.id, tokens);
    await audit(ctx, Object.keys(tokens).length === 0
      ? 'Palette reset to the product default'
      : 'Brand palette updated');
    return Object.keys(tokens).length === 0
      ? 'Palette reset to the product default.'
      : 'Palette saved. It applies everywhere immediately.';
  });
}

export async function saveStore(storeId: string, patch: StorePatch): Promise<OrgActionState> {
  return guard(async (ctx) => {
    const store = await updateStore(ctx.organization.id, storeId, patch);
    await audit(ctx, `Branch '${store.name}' updated`);
    return 'Saved.';
  });
}

export async function addBranch(input: CreateBranchInput): Promise<OrgActionState> {
  return guard(async (ctx) => {
    try {
      const { branchCode } = await createBranch(ctx.organization.id, ctx.user.id, input);
      await audit(ctx, `Branch '${input.name.trim()}' (${branchCode}) created`);
      return `Branch "${branchCode}" created. You already have access to it.`;
    } catch (e) {
      if (e instanceof ProvisioningError) throw new AdminError(e.message);
      throw e;
    }
  });
}
