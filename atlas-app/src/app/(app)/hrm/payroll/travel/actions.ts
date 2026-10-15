'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { saveTravelSettings, raiseTravelClaims, TravelError } from '@/server/travel-allowance';
import { scopeForWrite } from '@/server/store-scope';
import { friendlyError } from '@/lib/friendly-error';

export interface TravelActionState { error?: string; ok?: boolean; message?: string }

async function guarded(run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<string>): Promise<TravelActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('payroll.process')) return { error: 'You do not have permission to manage the travel allowance.' };
    const message = await run(ctx);
    revalidatePath('/hrm/payroll/travel');
    return { ok: true, message };
  } catch (err) {
    if (err instanceof TravelError || (err instanceof Error && /single branch|one branch|choose a branch/i.test(err.message))) return { error: err.message };
    console.error('[travel] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function saveTravelSettingsAction(value: unknown): Promise<TravelActionState> {
  return guarded(async (ctx) => {
    await saveTravelSettings(scopeForWrite(ctx.scope), value, ctx.user.id);
    return 'Saved.';
  });
}

export async function raiseTravelClaimsAction(month: string, userIds: string[]): Promise<TravelActionState> {
  return guarded(async (ctx) => {
    const n = await raiseTravelClaims(ctx.scope, month, userIds, ctx.user.id);
    return n === 0 ? 'Nothing new to claim - everyone picked is already claimed or has no km.'
      : `${n} travel claim${n === 1 ? '' : 's'} sent for approval. Pay them from Payroll › Claims once approved.`;
  });
}
