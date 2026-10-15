'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { setTarget, removeTarget } from '@/server/targets';
import type { PeriodType } from '@/lib/target-period';

export interface TargetFormState {
  error?: string;
  ok?: boolean;
  message?: string;
}

export async function saveTarget(input: {
  userId: string;
  periodType: PeriodType;
  periodStartIso: string;
  periodEndIso: string;
  periodLabel: string;
  targetRupees: number;
  incentivePct: number;
  note?: string;
}): Promise<TargetFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('settings.edit')) {
      return { error: 'Setting targets needs the settings permission.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store before setting a target.' };
    }
    if (!Number.isFinite(input.targetRupees) || input.targetRupees < 0) {
      return { error: 'Enter a target of zero or more.' };
    }

    const t = await setTarget(
      ctx.scope,
      {
        userId: input.userId,
        periodType: input.periodType,
        periodStart: new Date(input.periodStartIso),
        periodEnd: new Date(input.periodEndIso),
        periodLabel: input.periodLabel,
        targetPaise: Math.round(input.targetRupees * 100),
        incentivePct: input.incentivePct,
        note: input.note?.trim() || null,
      },
      ctx.user.id,
    );

    await db.activityLog
      .create({
        data: {
          storeId: t.storeId, userId: ctx.user.id,
          activityType: 'Update', entityType: 'UserTarget', entityId: t.id,
          amount: input.targetRupees,
          description: `Target for ${input.periodLabel} set to ₹${input.targetRupees.toLocaleString('en-IN')}`,
        },
      })
      .catch(() => undefined);

    revalidatePath('/settings/user-target');
    return { ok: true, message: `Target saved for ${input.periodLabel}.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not save the target.';
    console.error('[target] save failed', err);
    return { error: msg };
  }
}

export async function deleteTarget(id: string): Promise<TargetFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return { error: 'Removing a target needs the settings permission.' };
    }
    await removeTarget(ctx.scope, id);
    revalidatePath('/settings/user-target');
    return { ok: true, message: 'Target removed.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not remove the target.';
    return { error: msg };
  }
}
