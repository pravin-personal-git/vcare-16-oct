'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  listInstallationChallans, getInstallationChallanDetail,
  setInstallationChallanStatus, updateInstallationChallanPaperwork,
  createInstallationChallan, updateInstallationChallan, InstallationChallanError,
  recordChallanAdvance, challanAdvances,
  type StatusChangeInput, type PaperSlipInput, type CreateInstallationChallanInput, type UpdateInstallationChallanInput,
} from '@/server/installation-challans';
import type { ReceiptMethod } from '@/server/receipts';
import {
  addInstallationRemark, decideInstallation, handoverInstallation, saveInstallationChecklist, saveInstallationMaterials,
  setInstallationStage, setInstallationTeam, updateInstallationItems,
} from '@/server/installation-page';
import type { MaterialRow } from '@/lib/installation-stages';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

function refresh() {
  revalidatePath('/services/installations');
  revalidatePath('/sales/orders');
}

/**
 * Gated on `complaints.edit`, the same permission the rest of the services
 * module uses. An installation challan is field work signed off at a customer's
 * site - the same people who handle repair challans handle these, so inventing
 * a separate permission would mean every role that can do one job silently
 * cannot do the other.
 */
async function guard(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('installations.edit')) {
      return { error: 'You do not have permission to manage installation challans.' };
    }
    await run();
    refresh();
    return { ok: true };
  } catch (err) {
    if (err instanceof InstallationChallanError) return { error: err.message };
    console.error('[installations] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function loadInstallationChallansAction(status?: string) {
  const ctx = await requireContext();
  return listInstallationChallans(ctx.scope, { status });
}

export async function loadInstallationChallanDetailAction(id: string) {
  const ctx = await requireContext();
  return getInstallationChallanDetail(ctx.scope, id);
}

export async function setChallanStatusAction(input: StatusChangeInput): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await setInstallationChallanStatus(ctx.scope, input, ctx.user.id);
  });
}

export async function updatePaperworkAction(input: PaperSlipInput): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await updateInstallationChallanPaperwork(ctx.scope, input);
  });
}

export async function createInstallationChallanAction(
  input: CreateInstallationChallanInput,
): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await createInstallationChallan(ctx.scope, input, ctx.user.id);
  });
}

/** Correct everything on a saved challan (health check SVC-3). */
export async function updateInstallationChallanAction(
  input: Omit<UpdateInstallationChallanInput, 'dispatchedAt'> & { dispatchedAt: string },
): Promise<ActionState> {
  return guard(async () => {
    const ctx = await requireContext();
    await updateInstallationChallan(ctx.scope, { ...input, dispatchedAt: new Date(input.dispatchedAt) }, ctx.user.id);
  });
}

/* -------------------------------------------------------------------------- */
/*  Money collected on site                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Gated on `invoice.create`, not on the challan permissions.
 *
 * Taking money is a different authority from recording that a job was done.
 * Plenty of technicians should be able to close a challan and should not be
 * able to raise a receipt in the company's name.
 */
export async function recordChallanAdvanceAction(input: {
  challanId: string;
  amountRupees: number;
  method: ReceiptMethod;
  reference?: string | null;
  note?: string | null;
}): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.create')) {
      return { error: 'You do not have permission to record money received.' };
    }
    if (!Number.isFinite(input.amountRupees) || input.amountRupees <= 0) {
      return { error: 'Enter an amount greater than zero.' };
    }

    const r = await recordChallanAdvance(ctx.scope, {
      challanId: input.challanId,
      amountPaise: Math.round(input.amountRupees * 100),
      method: input.method,
      reference: input.reference ?? null,
      note: input.note ?? null,
    }, ctx.user.id);

    revalidatePath('/services/installations');
    revalidatePath('/invoices');
    return { ok: true, message: `Receipt ${r.receiptNo} raised and held against this challan.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not record the money.' };
  }
}

export async function loadChallanAdvancesAction(challanId: string) {
  const ctx = await requireContext();
  if (!ctx.permissions.has('invoice.view')) return [];
  return challanAdvances(ctx.scope, challanId);
}

/* -------------------------------------------------------------------------- */
/*  The installation page (11 Oct 2026, ops-pages demo tab 1)                 */
/* -------------------------------------------------------------------------- */

async function pageGuard(id: string, run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('installations.edit')) return { error: 'You do not have permission to work on installations.' };
    await run(ctx);
    revalidatePath(`/services/installations/${id}`);
    refresh();
    return { ok: true };
  } catch (err) {
    if (err instanceof InstallationChallanError) return { error: err.message };
    console.error('[installation page] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function installStageAction(id: string, to: string, reason?: string | null): Promise<ActionState> {
  return pageGuard(id, (ctx) => setInstallationStage(ctx.scope, id, to, ctx.user.id, reason));
}
export async function installHandoverAction(id: string, to: string, note: string | null): Promise<ActionState> {
  return pageGuard(id, (ctx) => handoverInstallation(ctx.scope, id, { to, note }, ctx.user.id, ctx.user.fullName));
}
export async function installDecideAction(id: string, decision: 'approved' | 'rejected', reason: string | null): Promise<ActionState> {
  return pageGuard(id, (ctx) => decideInstallation(ctx.scope, id, decision, ctx.user.id, reason));
}
export async function installItemsAction(id: string, items: { id: string; placement?: string | null; serialNo?: string | null; fitStatus?: string }[]): Promise<ActionState> {
  return pageGuard(id, (ctx) => updateInstallationItems(ctx.scope, id, items, ctx.user.id));
}
export async function installChecklistAction(id: string, which: 'survey' | 'testing', values: Record<string, boolean | string | number>): Promise<ActionState> {
  return pageGuard(id, (ctx) => saveInstallationChecklist(ctx.scope, id, which, values, ctx.user.id));
}
export async function installMaterialsAction(id: string, rows: MaterialRow[]): Promise<ActionState> {
  return pageGuard(id, (ctx) => saveInstallationMaterials(ctx.scope, id, rows, ctx.user.id));
}
export async function installTeamAction(id: string, assigneeIds: string[], priority: string): Promise<ActionState> {
  return pageGuard(id, (ctx) => setInstallationTeam(ctx.scope, id, { assigneeIds, priority }, ctx.user.id));
}
export async function installRemarkAction(id: string, text: string): Promise<ActionState> {
  return pageGuard(id, (ctx) => addInstallationRemark(ctx.scope, id, text, ctx.user.id));
}

/**
 * The customer's no-login link to this installation, /c/<token> (A2, 11 Oct
 * 2026): items, stage, fitted, handover and warranty - no prices.
 */
export async function getInstallationShareLink(id: string): Promise<{ error?: string; url?: string }> {
  try {
    const ctx = await requireContext();
    const { ensureInstallationShareToken } = await import('@/server/customer-links');
    const token = await ensureInstallationShareToken(ctx.scope, id);
    const h = await (await import('next/headers')).headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    return { url: `${proto}://${host}/c/${token}` };
  } catch (err) {
    const { CustomerLinkError } = await import('@/server/customer-links');
    console.error('[installation] share link failed', err);
    return { error: err instanceof CustomerLinkError ? err.message : 'Could not create a link to this installation.' };
  }
}
