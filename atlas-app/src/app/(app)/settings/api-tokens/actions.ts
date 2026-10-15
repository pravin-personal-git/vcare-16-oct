'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { ApiTokenError, createApiToken, revokeApiToken } from '@/server/api-tokens';
import { friendlyError } from '@/lib/friendly-error';

export interface ApiTokenState {
  ok?: boolean;
  error?: string;
  message?: string;
  token?: string;
}

async function guard() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('settings.edit')) {
    return { error: 'You do not have permission to manage API tokens.' as const };
  }
  return { ctx };
}

function fail(e: unknown): ApiTokenState {
  if (e instanceof ApiTokenError) return { error: e.message };
  console.error('[api-tokens] action failed', e);
  return { error: friendlyError(e, true) };
}

export async function createApiTokenAction(label: string): Promise<ApiTokenState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    const { id, token } = await createApiToken(g.ctx.organization.id, label, g.ctx.user.id);

    await db.activityLog
      .create({
        data: {
          storeId: g.ctx.scope.kind === 'single' ? g.ctx.scope.storeId : g.ctx.stores[0]?.id ?? '',
          userId: g.ctx.user.id,
          activityType: 'create',
          entityType: 'ApiToken',
          entityId: id,
          description: `API token "${label.trim()}" created`,
        },
      })
      .catch((e) => console.error('[api-tokens] audit write failed (non-fatal)', e));

    revalidatePath('/settings/api-tokens');
    return { ok: true, token, message: 'Token created. Copy it now - it will not be shown again.' };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeApiTokenAction(id: string): Promise<ApiTokenState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    await revokeApiToken(g.ctx.organization.id, id, g.ctx.user.id);
    revalidatePath('/settings/api-tokens');
    return { ok: true, message: 'Revoked.' };
  } catch (e) {
    return fail(e);
  }
}
