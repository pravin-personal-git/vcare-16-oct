'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { heldMessage, rupeesText } from '@/server/approval-actions';
import { db } from '@/server/db';
import {
  createReceipt, openInvoicesFor, reverseReceipt, unapplyAllocation,
  type ReceiptMethod,
} from '@/server/receipts';
import { autoAllocate, type Allocation } from '@/lib/allocation';
import { daysBetween } from '@/lib/expiry';

export interface ReceiptFormState {
  error?: string;
  ok?: boolean;
  message?: string;
  id?: string;
}

async function log(
  storeId: string, userId: string, entityId: string,
  activityType: string, description: string, amount?: number,
) {
  await db.activityLog
    .create({
      data: { storeId, userId, activityType, entityType: 'Receipt', entityId, amount, description },
    })
    .catch((e) => console.error('[receipt] audit write failed (non-fatal)', e));
}

export interface OpenInvoiceOption {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  grandTotalPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  daysOverdue: number;
}

/**
 * What a customer still owes, oldest first, with a suggested split.
 *
 * Both are returned together so the form cannot show one without the other.
 * The suggestion is the server's own `autoAllocate`, so what the user is shown
 * before saving is what would happen if they saved without touching it.
 */
export async function loadOpenInvoices(
  partyId: string,
  amountPaise: number,
): Promise<{ invoices: OpenInvoiceOption[]; suggested: Allocation[]; error?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('accounts.view')) {
      return { invoices: [], suggested: [], error: 'You do not have permission to view accounts.' };
    }

    const open = await openInvoicesFor(ctx.scope, partyId);
    const now = Date.now();

    return {
      invoices: open.map((i) => ({
        id: i.id,
        invoiceNo: i.invoiceNo,
        invoiceDate: i.invoiceDate.toISOString(),
        dueDate: i.dueDate.toISOString(),
        grandTotalPaise: i.grandTotalPaise,
        paidPaise: i.paidPaise,
        outstandingPaise: Math.max(0, i.grandTotalPaise - i.paidPaise),
        daysOverdue: Math.max(0, daysBetween(i.dueDate, new Date(now))),
      })),
      suggested: amountPaise > 0 ? autoAllocate(amountPaise, open).allocations : [],
    };
  } catch (e) {
    return { invoices: [], suggested: [], error: (e as Error).message };
  }
}

export async function recordReceipt(input: {
  partyId: string;
  amountPaise: number;
  method: ReceiptMethod;
  receivedAt: string;
  reference: string | null;
  note: string | null;
  allocations: Allocation[];
}): Promise<ReceiptFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('accounts.edit')) {
      return { error: 'You do not have permission to record receipts.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store before recording a receipt.' };
    }

    const r = await createReceipt(
      ctx.scope,
      {
        partyId: input.partyId,
        amountPaise: input.amountPaise,
        method: input.method,
        receivedAt: new Date(input.receivedAt),
        reference: input.reference,
        note: input.note,
        allocations: input.allocations,
      },
      ctx.user.id,
    );

    await log(
      ctx.scope.storeId, ctx.user.id, r.id, 'create',
      r.unallocatedPaise > 0
        ? `${r.receiptNo} received, ₹${(r.unallocatedPaise / 100).toLocaleString('en-IN')} left on account`
        : `${r.receiptNo} received and fully applied`,
      input.amountPaise,
    );

    revalidatePath('/receipts');
    revalidatePath('/invoices');
    revalidatePath('/customers');
    revalidatePath('/dashboard');

    return {
      ok: true,
      id: r.id,
      message: r.unallocatedPaise > 0
        ? `${r.receiptNo} recorded. ₹${(r.unallocatedPaise / 100).toLocaleString('en-IN')} is on account and can be applied later.`
        : `${r.receiptNo} recorded and applied in full.`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function markReceiptFailed(
  receiptId: string,
  status: 'bounced' | 'reversed',
  reason: string,
): Promise<ReceiptFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('accounts.edit')) {
      return { error: 'You do not have permission to reverse receipts.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store first.' };
    }

    {
      const rc = await db.receipt.findFirst({
        where: { id: receiptId, storeId: ctx.scope.storeId },
        select: { receiptNo: true, amountPaise: true, party: { select: { companyName: true, firstName: true, lastName: true } } },
      });
      const held = rc && await heldMessage(ctx.scope, ctx.user.id, {
        type: 'receipt_reverse', entityId: receiptId, amountPaise: rc.amountPaise,
        title: `Mark receipt ${rc.receiptNo} ${status} - ${rupeesText(rc.amountPaise)}`,
        summary: `${rc.party.companyName || [rc.party.firstName, rc.party.lastName].filter(Boolean).join(' ')} - ${reason}`,
        payload: { status, reason },
      });
      if (held) { revalidatePath('/receipts'); return { ok: true, message: held }; }
    }
    await reverseReceipt(ctx.scope, receiptId, status, reason, ctx.user.id);
    await log(
      ctx.scope.storeId, ctx.user.id, receiptId, 'update',
      `Receipt marked ${status} - ${reason}`,
    );

    revalidatePath('/receipts');
    revalidatePath('/invoices');
    revalidatePath('/customers');
    revalidatePath('/dashboard');

    return {
      ok: true,
      message: status === 'bounced'
        ? 'Marked as bounced. Every invoice it was settling is outstanding again.'
        : 'Reversed. Every invoice it was settling is outstanding again.',
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function takeBackAllocation(
  receiptId: string,
  invoiceId: string,
  amountPaise: number,
  reason: string,
): Promise<ReceiptFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('accounts.edit')) {
      return { error: 'You do not have permission to change allocations.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store first.' };
    }

    await unapplyAllocation(ctx.scope, receiptId, invoiceId, amountPaise, reason, ctx.user.id);
    await log(
      ctx.scope.storeId, ctx.user.id, receiptId, 'update',
      `₹${(amountPaise / 100).toLocaleString('en-IN')} unapplied - ${reason}`,
      amountPaise,
    );

    revalidatePath('/receipts');
    revalidatePath('/invoices');
    revalidatePath('/customers');

    return { ok: true, message: 'Taken back. It is on account and can be applied elsewhere.' };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
