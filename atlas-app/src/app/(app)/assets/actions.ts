'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createAsset, updateAsset, assignAsset, returnAsset, setAssetStatus,
  listAssetHistory, listAssignableUsers,
  requestAsset, decideAssetRequest, fulfillAssetRequestWithExisting, fulfillAssetRequestWithNew,
  createAssetBatch,
  AssetError, type AssetInput, type AssetStatus, type AssetBatchInput,
} from '@/server/assets';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function guard(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('assets.edit')) {
      return { error: 'You do not have permission to change assets.' };
    }
    await run();
    revalidatePath('/assets');
    return { ok: true };
  } catch (err) {
    if (err instanceof AssetError) return { error: err.message };
    console.error('[assets] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function saveAsset(id: string | null, input: AssetInput) {
  return guard(async () => {
    const ctx = await requireContext();
    if (id) await updateAsset(ctx.scope, id, input);
    else await createAsset(ctx.scope, input);
  });
}

export async function assign(id: string, userId: string) {
  return guard(async () => {
    const ctx = await requireContext();
    await assignAsset(ctx.scope, id, userId);
  });
}

export async function unassign(id: string) {
  return guard(async () => {
    const ctx = await requireContext();
    await returnAsset(ctx.scope, id);
  });
}

export async function changeStatus(id: string, status: AssetStatus, note: string | null) {
  return guard(async () => {
    const ctx = await requireContext();
    await setAssetStatus(ctx.scope, id, status, note);
  });
}

export async function fetchHistory(id: string) {
  try {
    const ctx = await requireContext();
    const rows = await listAssetHistory(ctx.scope, id);
    return { data: rows.map((r) => ({ ...r, at: r.at.toISOString() })) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not load history.' };
  }
}

export async function fetchAssignableUsers() {
  try {
    const ctx = await requireContext();
    const users = await listAssignableUsers(ctx.scope);
    return { data: users };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not load the user list.' };
  }
}

// ---------------------------------------------------- requests & allocation
// Deliberately NOT behind the `settings.edit` guard above - requesting an
// asset for yourself needs no admin permission, the same way raising a
// leave request doesn't. Deciding and fulfilling a request stay admin-only.

export async function requestAssetAction(input: { assetType: string; reason: string | null }): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await requestAsset(ctx.scope, input, ctx.user.id);
    revalidatePath('/assets');
    return { ok: true };
  } catch (err) {
    if (err instanceof AssetError) return { error: err.message };
    console.error('[assets] request failed', err);
    return { error: friendlyError(err) };
  }
}

export async function decideAssetRequestAction(
  requestId: string, decision: 'approved' | 'rejected', note: string | null,
): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await decideAssetRequest(ctx.scope, requestId, decision, ctx.user.id, note);
  });
}

export async function fulfillWithExistingAction(requestId: string, assetId: string): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await fulfillAssetRequestWithExisting(ctx.scope, requestId, assetId, ctx.user.id);
  });
}

export async function fulfillWithNewAction(requestId: string, input: AssetInput): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await fulfillAssetRequestWithNew(ctx.scope, requestId, input, ctx.user.id);
  });
}

export async function createBatchAction(input: AssetBatchInput): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await createAssetBatch(ctx.scope, input, ctx.user.id);
  });
}
