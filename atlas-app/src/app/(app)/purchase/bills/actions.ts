'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { heldMessage, newActionId } from '@/server/approval-actions';
import { db } from '@/server/db';
import {
  cancelBill, createBill, paySupplier, postBill, reversePayment,
  type BillLineDraft,
} from '@/server/purchases';
import { friendlyError } from '@/lib/friendly-error';

const WAIT = 'sent for approval - it takes effect once approved. Track it in My Desk';

/**
 * Server actions for purchase bills and supplier payments.
 *
 * TWO PERMISSIONS, NOT ONE.
 *
 * `purchase.edit` enters and posts a bill - which puts stock on the shelf and
 * creates a liability. `purchase.pay` sends money out of the bank. In a shop of
 * any size those are two people, and keeping them apart is the oldest control
 * in accounting: the person who says "these goods arrived" should not also be
 * the person who says "so pay for them".
 *
 * Folding them together would be one line shorter and would make that
 * separation impossible for a client to configure.
 */

export interface PurchaseState {
  ok?: boolean;
  error?: string;
  message?: string;
  id?: string;
}

const CAN_EDIT = 'purchase.edit';
const CAN_PAY = 'purchase.pay';

async function log(
  storeId: string, userId: string, entityId: string, entityType: string,
  activityType: string, description: string, amount?: number,
) {
  await db.activityLog
    .create({ data: { storeId, userId, activityType, entityType, entityId, amount, description } })
    .catch((e) => console.error('[purchases] audit write failed (non-fatal)', e));
}

async function guard(permission: string, what: string) {
  const ctx = await requireContext();
  if (!ctx.permissions.has(permission)) {
    return { error: `You do not have permission to ${what}.` };
  }
  // Purchases write stock and money, and both belong to exactly one store.
  // `scopeForWrite` would throw here anyway; catching it first turns an
  // exception into a sentence.
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single store first.' };
  }
  return { ctx, storeId: ctx.scope.storeId };
}

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

function fail(e: unknown): PurchaseState {
  const message = friendlyError(e, true);
  return { error: message };
}

// -------------------------------------------------------------------- bills

export async function createBillAction(input: {
  partyId: string;
  supplierBillNo: string;
  billDate: string;
  dueDate: string;
  freightPaise: number;
  notes: string | null;
  lines: BillLineDraft[];
  post: boolean;
}): Promise<PurchaseState> {
  const g = await guard(CAN_EDIT, 'enter purchase bills');
  if ('error' in g) return g;

  try {
    const result = await createBill(
      g.ctx.scope,
      {
        partyId: input.partyId,
        supplierBillNo: input.supplierBillNo,
        billDate: new Date(input.billDate),
        dueDate: new Date(input.dueDate),
        freightPaise: input.freightPaise,
        notes: input.notes,
        lines: input.lines,
        post: input.post,
      },
      g.ctx.user.id,
    );

    await log(
      g.storeId, g.ctx.user.id, result.id, 'PurchaseBill', 'created',
      `Purchase bill ${result.billNo} entered`,
    );

    revalidatePath('/purchase/bills');
    revalidatePath('/purchase/payables');
    // Stock changed, so the products screen is stale too.
    if (input.post) revalidatePath('/products');

    return {
      ok: true,
      id: result.id,
      message: input.post && result.awaitingApproval
        ? `${result.billNo} saved and ${WAIT}.`
        : input.post
          ? `${result.billNo} entered and posted. Stock is in.`
          : `${result.billNo} saved as a draft.`,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function postBillAction(billId: string): Promise<PurchaseState> {
  const g = await guard(CAN_EDIT, 'post purchase bills');
  if ('error' in g) return g;

  try {
    const posted = await postBill(g.ctx.scope, billId, g.ctx.user.id);
    if (posted.awaitingApproval) {
      revalidatePath('/purchase/bills');
      return { ok: true, message: `Not posted yet: ${WAIT}.` };
    }
    await log(g.storeId, g.ctx.user.id, billId, 'PurchaseBill', 'posted', 'Purchase bill posted');

    revalidatePath('/purchase/bills');
    revalidatePath(`/purchase/bills/${billId}`);
    revalidatePath('/purchase/payables');
    revalidatePath('/products');

    return { ok: true, message: 'Posted. Stock is in and the bill is now payable.' };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelBillAction(billId: string, reason: string): Promise<PurchaseState> {
  const g = await guard(CAN_EDIT, 'cancel purchase bills');
  if ('error' in g) return g;

  try {
    await cancelBill(g.ctx.scope, billId, reason, g.ctx.user.id);
    await log(
      g.storeId, g.ctx.user.id, billId, 'PurchaseBill', 'cancelled',
      `Purchase bill cancelled: ${reason}`,
    );

    revalidatePath('/purchase/bills');
    revalidatePath(`/purchase/bills/${billId}`);
    revalidatePath('/purchase/payables');
    revalidatePath('/products');

    return { ok: true, message: 'Cancelled. Stock has been taken back out.' };
  } catch (e) {
    return fail(e);
  }
}

// ----------------------------------------------------------------- payments

export async function paySupplierAction(input: {
  partyId: string;
  amountPaise: number;
  method: 'cash' | 'bank' | 'upi' | 'cheque' | 'adjustment';
  paidAt: string;
  reference: string | null;
  note: string | null;
  allocations?: { billId: string; amountPaise: number }[];
}): Promise<PurchaseState> {
  const g = await guard(CAN_PAY, 'pay suppliers');
  if ('error' in g) return g;

  try {
    {
      const sup = await db.party.findFirst({ where: { id: input.partyId, storeId: g.storeId }, select: { companyName: true, firstName: true, lastName: true } });
      const held = sup && await heldMessage(g.ctx.scope, g.ctx.user.id, {
        type: 'supplier_payment', entityId: newActionId(), amountPaise: input.amountPaise,
        title: `Pay supplier ${rupees(input.amountPaise)}`,
        summary: `${sup.companyName || [sup.firstName, sup.lastName].filter(Boolean).join(' ')} - ${input.method}`,
        payload: { ...input },
      });
      if (held) { revalidatePath('/purchase/payables'); return { ok: true, message: held }; }
    }
    const result = await paySupplier(
      g.ctx.scope,
      {
        partyId: input.partyId,
        amountPaise: input.amountPaise,
        method: input.method,
        paidAt: new Date(input.paidAt),
        reference: input.reference,
        note: input.note,
        allocations: input.allocations,
      },
      g.ctx.user.id,
    );

    await log(
      g.storeId, g.ctx.user.id, result.id, 'SupplierPayment', 'paid',
      `Paid ${rupees(input.amountPaise)} - ${result.paymentNo}`,
      input.amountPaise,
    );

    revalidatePath('/purchase/bills');
    revalidatePath('/purchase/payables');

    return {
      ok: true,
      id: result.id,
      message: result.unallocatedPaise > 0
        ? `${result.paymentNo} recorded. ${rupees(result.unallocatedPaise)} is on account `
          + 'as an advance - it is not lost, it just is not against a bill yet.'
        : `${result.paymentNo} recorded.`,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function reversePaymentAction(
  paymentId: string,
  reason: string,
): Promise<PurchaseState> {
  const g = await guard(CAN_PAY, 'reverse supplier payments');
  if ('error' in g) return g;

  try {
    {
      const pay = await db.supplierPayment.findFirst({ where: { id: paymentId, storeId: g.storeId }, select: { paymentNo: true, amountPaise: true } });
      const held = pay && await heldMessage(g.ctx.scope, g.ctx.user.id, {
        type: 'supplier_payment_reverse', entityId: paymentId, amountPaise: pay.amountPaise,
        title: `Reverse supplier payment ${pay.paymentNo} ${rupees(pay.amountPaise)}`, summary: reason,
        payload: { reason },
      });
      if (held) { revalidatePath('/purchase/payables'); return { ok: true, message: held }; }
    }
    await reversePayment(g.ctx.scope, paymentId, reason, g.ctx.user.id);
    await log(
      g.storeId, g.ctx.user.id, paymentId, 'SupplierPayment', 'reversed',
      `Payment reversed: ${reason}`,
    );

    revalidatePath('/purchase/bills');
    revalidatePath('/purchase/payables');

    return { ok: true, message: 'Reversed. The bills it was paying are open again.' };
  } catch (e) {
    return fail(e);
  }
}
