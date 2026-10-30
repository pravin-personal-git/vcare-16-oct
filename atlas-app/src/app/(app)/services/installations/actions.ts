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
  addInstallationItem, addInstallationRemark, billInstallation, changeInstallationItemQty, installationBillDraft,
  changeInstallationSite, markInstallationWorkDone, removeInstallationItem, sendBackInstallation, setInstallationCustomer, setInstallationTeam, updateInstallationItems,
  waiveInstallationBilling, type InstallationBillDraft,
} from '@/server/installation-page';
import { friendlyError } from '@/lib/friendly-error';
import { InstallationReturnError, receiveInstallationReturn, requestInstallationReturn } from '@/server/installation-returns';
import { ComplaintError } from '@/server/complaints';
import { editJobChallan, raiseInstallationChallan, withdrawJobChallan, type ChallanLineInput } from '@/server/job-challans';

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
): Promise<ActionState & { id?: string }> {
  let id: string | undefined;
  const r = await guard(async () => {
    const ctx = await requireContext();
    id = await createInstallationChallan(ctx.scope, input, ctx.user.id);
  });
  return r.error ? r : { ...r, id };
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
    // The return and material-challan rules speak in their own words (R2, R3).
    if (err instanceof InstallationChallanError || err instanceof InstallationReturnError || err instanceof ComplaintError) return { error: err.message };
    console.error('[installation page] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function installWorkDoneAction(id: string, receivedBy: string | null): Promise<ActionState> {
  return pageGuard(id, (ctx) => markInstallationWorkDone(ctx.scope, id, ctx.user.id, receivedBy));
}
export async function installSendBackAction(id: string, reason: string): Promise<ActionState> {
  return pageGuard(id, (ctx) => sendBackInstallation(ctx.scope, id, reason, ctx.user.id));
}
export async function installItemsAction(id: string, items: { id: string; placement?: string | null; serialNo?: string | null; fitStatus?: string }[]): Promise<ActionState> {
  return pageGuard(id, (ctx) => updateInstallationItems(ctx.scope, id, items, ctx.user.id));
}
export async function installAddItemAction(id: string, productId: string, qty: number, unitIds?: string[]): Promise<ActionState> {
  return pageGuard(id, (ctx) => addInstallationItem(ctx.scope, id, { productId, qty, unitIds }, ctx.user.id));
}
export async function installItemQtyAction(id: string, itemId: string, qty: number): Promise<ActionState> {
  return pageGuard(id, (ctx) => changeInstallationItemQty(ctx.scope, id, itemId, qty, ctx.user.id));
}
export async function installRemoveItemAction(id: string, itemId: string, reason: string): Promise<ActionState> {
  return pageGuard(id, (ctx) => removeInstallationItem(ctx.scope, id, itemId, reason, ctx.user.id));
}

/** What "Bill this installation" would bill - read-only, for the dialog. */
export async function installBillDraftAction(id: string): Promise<{ error?: string; draft?: InstallationBillDraft }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.create')) return { error: 'You do not have permission to raise invoices.' };
    return { draft: JSON.parse(JSON.stringify(await installationBillDraft(ctx.scope, id))) as InstallationBillDraft };
  } catch (err) {
    if (err instanceof InstallationChallanError) return { error: err.message };
    return { error: err instanceof Error ? err.message : 'Could not work out the bill.' };
  }
}

export async function installBillAction(id: string, input: { includeMaterial: boolean; labourRupees: number; labourText: string | null }): Promise<ActionState & { invoiceId?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.create')) return { error: 'You do not have permission to raise invoices.' };
    const inv = await billInstallation(ctx.scope, id, {
      includeMaterial: input.includeMaterial, labourPaise: Math.round((Number(input.labourRupees) || 0) * 100), labourText: input.labourText,
    }, ctx.user.id);
    revalidatePath(`/services/installations/${id}`);
    revalidatePath('/invoices');
    refresh();
    return { ok: true, invoiceId: inv.id, message: `${inv.invoiceNo} raised as a draft - issue it from Invoices.` };
  } catch (err) {
    if (err instanceof InstallationChallanError) return { error: err.message };
    console.error('[installation] bill failed', err);
    return { error: err instanceof Error ? err.message : friendlyError(err) };
  }
}

export async function installSiteAction(id: string, input: { siteId: string | null; otherPlace: boolean; text: string | null }): Promise<ActionState> {
  return pageGuard(id, (ctx) => changeInstallationSite(ctx.scope, id, input, ctx.user.id));
}

export async function installCustomerAction(id: string, customerId: string): Promise<ActionState> {
  return pageGuard(id, (ctx) => setInstallationCustomer(ctx.scope, id, customerId, ctx.user.id));
}

export async function installWaiveAction(id: string, reason: string): Promise<ActionState> {
  return pageGuard(id, (ctx) => waiveInstallationBilling(ctx.scope, id, reason, ctx.user.id));
}
export async function installTeamAction(id: string, assigneeIds: string[], priority: string): Promise<ActionState> {
  return pageGuard(id, (ctx) => setInstallationTeam(ctx.scope, id, { assigneeIds, priority }, ctx.user.id));
}
export async function installRemarkAction(id: string, text: string): Promise<ActionState> {
  return pageGuard(id, (ctx) => addInstallationRemark(ctx.scope, id, text, ctx.user.id));
}

/**
 * N of a line are coming back unused (R2, 22 Oct 2026). A request, from the
 * office as from the phone: stock moves when the store receives them.
 */
export async function installReturnAction(id: string, itemId: string, qty: number): Promise<ActionState> {
  return pageGuard(id, (ctx) => requestInstallationReturn(ctx.scope, itemId, qty, ctx.user.id));
}

/** The store - or the office working on installations (Vcare, 22 Oct 2026) - receives an installation's goods back. */
export async function installReceiveReturnAction(id: string, itemId: string): Promise<ActionState & { qty?: number }> {
  let qty = 0;
  const r = await pageGuard(id, async (ctx) => {
    qty = await receiveInstallationReturn(ctx.scope, itemId, ctx.user.id);
  });
  revalidatePath('/goods-dispatch/job-parts');
  return r.error ? r : { ...r, qty };
}

/** A material challan for what is not on the order - cable, clamps (R3). Same approval as a complaint's. */
export async function installRaiseChallanAction(id: string, input: { type: string; lines: ChallanLineInput[]; note: string | null }): Promise<ActionState> {
  return pageGuard(id, async (ctx) => { await raiseInstallationChallan(ctx.scope, id, input, ctx.user.id, 'office'); });
}

/** Change a material challan not yet approved (or rejected) - it goes for approval again (22 Oct 2026). */
export async function installEditChallanAction(id: string, challanId: string, input: { type: string; lines: ChallanLineInput[]; note: string | null }): Promise<ActionState> {
  return pageGuard(id, async (ctx) => { await editJobChallan(ctx.scope, challanId, { installationChallanId: id }, input, ctx.user.id, 'office'); });
}

/** Take back a material challan nothing was issued on (22 Oct 2026). */
export async function installWithdrawChallanAction(id: string, challanId: string, reason: string | null): Promise<ActionState> {
  return pageGuard(id, async (ctx) => { await withdrawJobChallan(ctx.scope, challanId, { installationChallanId: id }, reason, ctx.user.id, 'office'); });
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
