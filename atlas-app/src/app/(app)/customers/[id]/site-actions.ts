'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { saveSite, setSiteActive, SiteError } from '@/server/sites';
import type { SiteInput } from '@/lib/sites';
import { friendlyError } from '@/lib/friendly-error';

export interface SiteActionState { ok?: boolean; error?: string }

/** On `customers.edit`, like every other change to a customer's record. */
async function guard(partyId: string, run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<void>): Promise<SiteActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('customers.edit')) return { error: 'You do not have permission to change customers.' };
    if (ctx.scope.kind === 'all') return { error: 'Select a single store first.' };
    await run(ctx);
    revalidatePath(`/customers/${partyId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof SiteError) return { error: err.message };
    console.error('[sites] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function saveSiteAction(partyId: string, input: SiteInput, siteId: string | null): Promise<SiteActionState> {
  return guard(partyId, (ctx) => saveSite(ctx.scope, partyId, input, siteId));
}

export async function setSiteActiveAction(partyId: string, siteId: string, isActive: boolean): Promise<SiteActionState> {
  return guard(partyId, (ctx) => setSiteActive(ctx.scope, siteId, isActive));
}
