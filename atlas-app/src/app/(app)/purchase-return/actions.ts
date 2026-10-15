'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { heldMessage, rupeesText } from '@/server/approval-actions';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import {
  createPurchaseReturn, dispatchPurchaseReturn, cancelPurchaseReturn,
  issueDebitNote, cancelDebitNote, getBillForReturn, type ProposedReturnLine,
} from '@/server/purchase-returns';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

/** Received bills, for the "return against which bill" picker. */
export async function loadReceivedBills() {
  const ctx = await requireContext();
  const bills = await db.purchaseBill.findMany({
    where: { ...scopeWhere(ctx.scope), lifecycle: 'received' },
    select: { id: true, billNo: true, supplierBillNo: true, supplierName: true, billDate: true },
    orderBy: { billDate: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return bills;
}

export async function loadBillDetail(billId: string) {
  const ctx = await requireContext();
  return getBillForReturn(ctx.scope, billId);
}

export async function createReturnAction(input: {
  billId: string;
  lines: ProposedReturnLine[];
  reason: string;
  dispatchNow: boolean;
  notes: string | null;
}): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('purchase.edit')) {
    return { error: 'You do not have permission to edit purchases.' };
  }
  try {
    await createPurchaseReturn(ctx.scope, {
      billId: input.billId,
      lines: input.lines,
      reason: input.reason,
      dispatchNow: input.dispatchNow,
      notes: input.notes,
    }, ctx.user.id);
    revalidatePath('/purchase-return');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save.' };
  }
}

export async function dispatchReturnAction(id: string): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('purchase.edit')) {
    return { error: 'You do not have permission to edit purchases.' };
  }
  try {
    await dispatchPurchaseReturn(ctx.scope, id, ctx.user.id);
    revalidatePath('/purchase-return');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not dispatch.' };
  }
}

export async function cancelReturnAction(id: string, reason: string): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('purchase.edit')) {
    return { error: 'You do not have permission to edit purchases.' };
  }
  try {
    await cancelPurchaseReturn(ctx.scope, id, reason, ctx.user.id);
    revalidatePath('/purchase-return');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not cancel.' };
  }
}

export async function issueDebitNoteAction(
  purchaseReturnId: string, reason: string,
): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.edit')) {
    return { error: 'You do not have permission to edit accounts.' };
  }
  try {
    if (ctx.scope.kind === 'single') {
      const pr = await db.purchaseReturn.findFirst({
        where: { id: purchaseReturnId, storeId: ctx.scope.storeId },
        select: { returnNo: true, supplierName: true, items: { select: { qty: true, unitCostPaise: true } } },
      });
      const value = pr ? pr.items.reduce((n, i) => n + i.qty * i.unitCostPaise, 0) : 0;
      const held = pr && await heldMessage(ctx.scope, ctx.user.id, {
        type: 'debit_note', entityId: purchaseReturnId, amountPaise: value,
        title: `Debit note for ${pr.returnNo} ${rupeesText(value)}`, summary: `${pr.supplierName} - ${reason}`,
        payload: { reason },
      });
      if (held) { revalidatePath('/purchase-return'); return { ok: true, message: held }; }
    }
    await issueDebitNote(ctx.scope, { purchaseReturnId, reason }, ctx.user.id);
    revalidatePath('/purchase-return');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not issue the debit note.' };
  }
}

export async function cancelDebitNoteAction(id: string, reason: string): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.edit')) {
    return { error: 'You do not have permission to edit accounts.' };
  }
  try {
    await cancelDebitNote(ctx.scope, id, reason, ctx.user.id);
    revalidatePath('/purchase-return');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not cancel.' };
  }
}
