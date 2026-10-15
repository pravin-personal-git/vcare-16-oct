'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import {
  AdminError,
  createMaster,
  deleteMaster,
  updateMaster,
  type MasterKind,
} from '@/server/administration';
import { friendlyError } from '@/lib/friendly-error';

export interface AdminActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

/**
 * Every admin action funnels through here.
 *
 * Three things happen in one place rather than fourteen: the permission is
 * checked, `AdminError` is turned into a message a person can act on, and
 * anything else is logged and reported as a generic failure. A caught
 * `AdminError` is a rule the user tripped; an uncaught anything-else is a bug,
 * and telling the two apart in the UI is the difference between "you cannot do
 * that because…" and "something went wrong".
 */
async function guard<T>(
  run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<T>,
  opts: { permission?: string; needsSingleStore?: boolean } = {},
): Promise<AdminActionState> {
  try {
    const ctx = await requireContext();

    const permission = opts.permission ?? 'settings.edit';
    if (!ctx.permissions.has(permission)) {
      return { error: 'You do not have permission to change settings.' };
    }
    if (opts.needsSingleStore && ctx.scope.kind === 'all') {
      return { error: 'Select a single store first - these settings are per branch.' };
    }

    await run(ctx);
    return { ok: true };
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    console.error('[admin] action failed', err);
    return { error: friendlyError(err) };
  }
}

const audit = (
  storeId: string,
  userId: string,
  activityType: string,
  entityType: string,
  description: string,
  entityId?: string,
) =>
  db.activityLog
    .create({
      data: { storeId, userId, activityType, entityType, entityId: entityId ?? null, description },
    })
    .catch((e) => console.error('[admin] audit write failed (non-fatal)', e));

export async function addMaster(
  kind: MasterKind,
  input: { name: string; detail: string | null; parentId: string | null; body: string | null; hsnPattern?: string | null; defaultFor?: string[] },
): Promise<AdminActionState> {
  return guard(
    async (ctx) => {
      const created = await createMaster(ctx.scope, kind, input);
      if (ctx.scope.kind === 'single') {
        await audit(
          ctx.scope.storeId, ctx.user.id, 'Create', 'Master',
          `${kind} "${input.name}" created`, created.id,
        );
      }
      revalidatePath('/settings/masters');
    },
    { needsSingleStore: true },
  );
}

export async function editMaster(
  kind: MasterKind,
  id: string,
  patch: { name?: string; detail?: string | null; isActive?: boolean; body?: string | null; hsnPattern?: string | null; defaultFor?: string[] },
): Promise<AdminActionState> {
  return guard(
    async (ctx) => {
      await updateMaster(ctx.scope, kind, id, patch);
      if (ctx.scope.kind === 'single') {
        const what = patch.isActive === undefined
          ? 'edited'
          : patch.isActive ? 'reactivated' : 'deactivated';
        await audit(
          ctx.scope.storeId, ctx.user.id, 'Update', 'Master',
          `${kind} ${what}${patch.name ? `: "${patch.name}"` : ''}`, id,
        );
      }
      revalidatePath('/settings/masters');
    },
    { needsSingleStore: true },
  );
}

export async function removeMaster(kind: MasterKind, id: string): Promise<AdminActionState> {
  return guard(
    async (ctx) => {
      await deleteMaster(ctx.scope, kind, id, ctx.user.id);
      if (ctx.scope.kind === 'single') {
        await audit(ctx.scope.storeId, ctx.user.id, 'Delete', 'Master', `${kind} deleted`, id);
      }
      revalidatePath('/settings/masters');
    },
    { needsSingleStore: true },
  );
}
