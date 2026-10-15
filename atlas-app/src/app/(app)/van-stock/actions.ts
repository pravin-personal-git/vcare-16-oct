'use server';

import { revalidatePath } from 'next/cache';
import { heldMessage, newActionId } from '@/server/approval-actions';
import { requireContext } from '@/server/context';
import {
  createVan, issueToVan, returnFromVan, setVanHolder, vanMovables, writeOffVanShortfall,
  type MovableItem, type VanMoveLine,
} from '@/server/van-stock';

export interface VanState {
  error?: string;
  ok?: boolean;
  message?: string;
}

/**
 * Gated on `stock.adjust`, not `stock.view`.
 *
 * Loading a van moves stock, and a shortfall write-off destroys it. Both are
 * the same authority as adjusting a shelf count, which is exactly what they
 * are: a decision about where physical goods have gone.
 */
async function gate() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('stock.adjust')) {
    throw new Error('You do not have permission to move stock.');
  }
  if (ctx.scope.kind === 'all') {
    throw new Error('Select a single store before moving stock.');
  }
  return ctx;
}

function refresh() {
  revalidatePath('/van-stock');
  revalidatePath('/stock-units');
  revalidatePath('/reports/product-stock');
}

export async function createVanAction(input: {
  name: string; code: string; holderId: string | null;
}): Promise<VanState> {
  try {
    const ctx = await gate();
    const v = await createVan(ctx.scope, input);
    refresh();
    return { ok: true, message: `${v.name} added.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not add the van.' };
  }
}

export async function setVanHolderAction(vanId: string, holderId: string | null): Promise<VanState> {
  try {
    const ctx = await gate();
    await setVanHolder(ctx.scope, vanId, holderId);
    refresh();
    return { ok: true, message: 'Van holder changed.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not change the holder.' };
  }
}

export async function issueToVanAction(input: {
  vanId: string; lines: VanMoveLine[]; note?: string | null;
}): Promise<VanState> {
  try {
    const ctx = await gate();
    const r = await issueToVan(ctx.scope, input, ctx.user.id);
    refresh();
    return { ok: true, message: `${r.lines} line${r.lines === 1 ? '' : 's'} loaded into ${r.vanName}.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not load the van.' };
  }
}

export async function returnFromVanAction(input: {
  vanId: string; lines: VanMoveLine[]; note?: string | null;
}): Promise<VanState> {
  try {
    const ctx = await gate();
    const r = await returnFromVan(ctx.scope, input, ctx.user.id);
    refresh();
    return { ok: true, message: `${r.lines} line${r.lines === 1 ? '' : 's'} back from ${r.vanName}.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not record the return.' };
  }
}

export async function writeOffShortfallAction(input: {
  vanId: string; lines: { productId: string; qty: number }[]; reason: string;
}): Promise<VanState> {
  try {
    const ctx = await gate();
    const held = await heldMessage(ctx.scope, ctx.user.id, {
      type: 'van_writeoff', entityId: newActionId(), amountPaise: null,
      /*
        A held action has no record yet, so `?open=<id>` has nothing to find
        and My Desk's "Open" used to drop the approver on the whole van list
        (8 Oct 2026). The van IS the context - what it is short of, and by how
        much - so the request points straight at it.
      */
      href: `/van-stock?van=${input.vanId}`,
      title: `Write off van shortfall (${input.lines.length} line${input.lines.length === 1 ? '' : 's'})`,
      summary: input.reason, payload: { ...input },
    });
    if (held) { refresh(); return { ok: true, message: held }; }
    await writeOffVanShortfall(ctx.scope, input, ctx.user.id);
    refresh();
    return { ok: true, message: 'Written off. It stays in the stock history with your name on it.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not write it off.' };
  }
}

/** What can be loaded (from the branch) or handed back (from the van). Read-only, same gate. */
export async function vanMovablesAction(input: {
  vanId: string; from: 'branch' | 'van'; q: string | null; code: string | null;
}): Promise<{ items: MovableItem[]; matchedUnitId: string | null } | { error: string }> {
  try {
    const ctx = await gate();
    return await vanMovables(ctx.scope, input);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not look that up.' };
  }
}
