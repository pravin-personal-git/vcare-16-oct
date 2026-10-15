'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createRmaCase, moveRmaCase, addRmaNote, getRmaCase, updateRmaCase, RmaError, type CreateRmaInput, type EditRmaInput,
} from '@/server/rma';
import { StockUnitError } from '@/server/stock-units';
import { friendlyError } from '@/lib/friendly-error';

export interface RmaActionState { ok?: boolean; error?: string; message?: string; id?: string }

/**
 * Reading a case is open to the service desk (`complaints.view` - all staff in
 * the migrated tenant, because "where is my camera" is asked of whoever picks
 * up the phone). Changing one needs `complaints.edit`, the permission that
 * already governs moving a complaint along.
 */
async function guard<T>(run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<T>): Promise<RmaActionState & { data?: T }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.edit')) return { error: 'You do not have permission to change replacement cases.' };
    if (ctx.scope.kind === 'all') return { error: 'Select a single store first.' };
    const data = await run(ctx);
    revalidatePath('/services/replacements');
    revalidatePath('/stock-units');
    return { ok: true, data };
  } catch (err) {
    if (err instanceof RmaError || err instanceof StockUnitError) return { error: err.message };
    console.error('[rma] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function createRmaAction(input: CreateRmaInput): Promise<RmaActionState> {
  const r = await guard((ctx) => createRmaCase(ctx.scope, input, ctx.user.id));
  return r.error ? r : { ok: true, id: r.data?.id, message: `${r.data?.caseNo} logged. Send it when it leaves the office.` };
}

export async function moveRmaAction(id: string, input: {
  to: string; supplierId: string | null; supplierName: string | null; serviceCentre: string | null;
  courier: string | null; docketNo: string | null; expectedBackAt: string | null;
  outcome: string | null; replacementSerialNo: string | null; note: string | null;
  creditNoteNo?: string | null; creditAmount?: string | null;
}): Promise<RmaActionState> {
  const r = await guard((ctx) => moveRmaCase(ctx.scope, id, {
    ...input,
    expectedBackAt: input.expectedBackAt ? new Date(`${input.expectedBackAt}T00:00:00+05:30`) : null,
    creditAmountPaise: input.creditAmount ? Math.round(Number(input.creditAmount) * 100) || null : null,
  }, ctx.user.id));
  return r.error ? r : { ok: true, message: r.data?.warning ?? 'Updated.' };
}

export async function updateRmaAction(id: string, input: Omit<EditRmaInput, 'expectedBackAt'> & { expectedBackAt: string | null }): Promise<RmaActionState> {
  const r = await guard((ctx) => updateRmaCase(ctx.scope, id, {
    ...input,
    expectedBackAt: input.expectedBackAt ? new Date(`${input.expectedBackAt}T00:00:00+05:30`) : null,
  }, ctx.user.id));
  return r.error ? r : { ok: true, message: 'Saved.' };
}

export async function addRmaNoteAction(id: string, note: string): Promise<RmaActionState> {
  const r = await guard((ctx) => addRmaNote(ctx.scope, id, note, ctx.user.id));
  return r.error ? r : { ok: true };
}

export async function loadRmaAction(id: string) {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.view') && !ctx.permissions.has('complaints.edit')) return { error: 'No access.' };
    return { detail: JSON.parse(JSON.stringify(await getRmaCase(ctx.scope, id))) as Awaited<ReturnType<typeof getRmaCase>> };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not load the case.' };
  }
}
