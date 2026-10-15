'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { HierarchyError, setReportsTo } from '@/server/hierarchy';
import { friendlyError } from '@/lib/friendly-error';

/**
 * The reporting line, behind `users.edit` - it decides whose leave and claims
 * reach whom. The approval-chain actions that lived here were removed on
 * 5 Oct 2026: approvals are set in Settings > Approval Rules only.
 */

export interface HierarchyState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function guard(): Promise<{ ctx: Awaited<ReturnType<typeof requireContext>> } | { error: string }> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('users.edit')) {
    return { error: 'You do not have permission to change the reporting structure.' };
  }
  return { ctx };
}

function fail(e: unknown): HierarchyState {
  if (e instanceof HierarchyError) return { error: e.message };
  console.error('[hierarchy] action failed', e);
  return { error: friendlyError(e, true) };
}

export async function setManagerAction(
  userId: string,
  managerId: string | null,
): Promise<HierarchyState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await setReportsTo(g.ctx.organization.id, userId, managerId);

    const [person, manager] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
      managerId
        ? db.user.findUnique({ where: { id: managerId }, select: { fullName: true } })
        : Promise.resolve(null),
    ]);

    const storeId = g.ctx.activeStoreId ?? g.ctx.stores[0]?.id;
    if (storeId) {
      await db.activityLog
        .create({
          data: {
            storeId,
            userId: g.ctx.user.id,
            activityType: 'updated',
            entityType: 'ReportingLine',
            entityId: userId,
            description: manager
              ? `${person?.fullName ?? 'Someone'} now reports to ${manager.fullName}`
              : `${person?.fullName ?? 'Someone'} no longer reports to anybody`,
          },
        })
        .catch((e) => console.error('[hierarchy] audit write failed (non-fatal)', e));
    }

    revalidatePath('/hierarchy');
    return {
      ok: true,
      message: manager
        ? `${person?.fullName ?? 'They'} now report to ${manager.fullName}.`
        : `${person?.fullName ?? 'They'} sit at the top of the chart.`,
    };
  } catch (e) {
    return fail(e);
  }
}
