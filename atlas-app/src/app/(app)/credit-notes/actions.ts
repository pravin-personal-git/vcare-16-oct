'use server';

import { revalidatePath } from 'next/cache';
import { heldMessage } from '@/server/approval-actions';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import {
  applyCredit, cancelCreditNote, createAllowance, issueCreditNote,
  recordRefund, reverseRefund, unapplyCredit,
} from '@/server/credit-notes';
import { getInvoiceForReturn } from '@/server/sales-returns';
import { settlementByInvoice } from '@/server/settlement';
import { scopeWhere } from '@/server/store-scope';
import type { CreditReason } from '@/lib/returns';

const WAIT = 'sent for approval - it takes effect once approved. Track it in My Desk';

/**
 * Server actions for credit notes and refunds.
 *
 * `returns.credit` gates all of it, including refunds. Issuing a credit note
 * and paying one out are both "money going back to the customer", and splitting
 * them into two permissions creates a distinction no shop owner could explain
 * to their staff. The refund path carries the extra checks in the server module
 * instead - it cannot exceed the unused credit, and it cannot draw on a note
 * that is still a draft.
 */

export interface CreditState {
  ok?: boolean;
  error?: string;
  message?: string;
  id?: string;
}

const CAN_CREDIT = 'returns.credit';

async function log(
  storeId: string, userId: string, entityId: string, entityType: string,
  activityType: string, description: string, amount?: number,
) {
  await db.activityLog
    .create({ data: { storeId, userId, activityType, entityType, entityId, amount, description } })
    .catch((e) => console.error('[credit-notes] audit write failed (non-fatal)', e));
}

async function guard() {
  const ctx = await requireContext();
  if (!ctx.permissions.has(CAN_CREDIT)) {
    return { error: 'You do not have permission to issue or apply credit notes.' };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single store first.' };
  }
  return { ctx, storeId: ctx.scope.storeId };
}

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

/** Invoices a credit note could be applied to, with what each still owes. */
export async function loadOpenInvoicesFor(partyId: string) {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('returns.view')) {
      return { invoices: [], error: 'You do not have permission to view credit notes.' };
    }

    const invoices = await db.invoice.findMany({
      where: { ...scopeWhere(ctx.scope), partyId, lifecycle: 'sent' },
      orderBy: { dueDate: 'asc' },
      select: { id: true, invoiceNo: true, dueDate: true, grandTotalPaise: true },
    });

    const settled = await settlementByInvoice(ctx.scope, invoices.map((i) => i.id));

    return {
      invoices: invoices
        .map((i) => {
          const s = settled.get(i.id);
          return {
            id: i.id,
            invoiceNo: i.invoiceNo,
            dueDate: i.dueDate.toISOString(),
            grandTotalPaise: i.grandTotalPaise,
            paidPaise: s?.paidPaise ?? 0,
            creditedPaise: s?.creditedPaise ?? 0,
            outstandingPaise: Math.max(0, i.grandTotalPaise - (s?.settledPaise ?? 0)),
          };
        })
        .filter((i) => i.outstandingPaise > 0),
    };
  } catch (e) {
    return { invoices: [], error: (e as Error).message };
  }
}

/** An invoice's lines, for raising an allowance against it. */
export async function loadInvoiceForAllowance(invoiceId: string) {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('returns.view')) return { error: 'Not permitted.' };

    const inv = await getInvoiceForReturn(ctx.scope, invoiceId);
    if (!inv) return { error: 'Invoice not found.' };

    return {
      invoice: {
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        invoiceDate: inv.invoiceDate.toISOString(),
        customerName: inv.customerName,
        lifecycle: inv.lifecycle,
        taxMode: inv.taxMode,
        grandTotalPaise: inv.grandTotalPaise,
        lines: inv.lines,
      },
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function raiseAllowance(input: {
  invoiceId: string;
  reason: Exclude<CreditReason, 'goods_returned'>;
  lines: { invoiceItemId: string; qty: number }[];
  flatTaxablePaise: number | null;
  reasonNote: string | null;
  creditNoteDate: string | null;
}): Promise<CreditState> {
  try {
    const g = await guard();
    if ('error' in g) return g;

    const cn = await createAllowance(
      g.ctx.scope,
      {
        invoiceId: input.invoiceId,
        reason: input.reason,
        lines: input.lines,
        flatTaxablePaise: input.flatTaxablePaise,
        reasonNote: input.reasonNote,
        creditNoteDate: input.creditNoteDate ? new Date(input.creditNoteDate) : null,
        issueNow: true,
      },
      g.ctx.user.id,
    );

    await log(
      g.storeId, g.ctx.user.id, cn.id, 'CreditNote', 'create',
      `${cn.creditNoteNo} ${cn.awaitingApproval ? 'raised, awaiting approval' : 'issued'} - ${input.reason}`, cn.grandTotalPaise,
    );

    revalidateAll();
    if (cn.awaitingApproval) {
      return { ok: true, id: cn.id, message: `${cn.creditNoteNo} for ${rupees(cn.grandTotalPaise)} ${WAIT}.` };
    }
    return {
      ok: true,
      id: cn.id,
      message: `${cn.creditNoteNo} issued for ${rupees(cn.grandTotalPaise)}`
        + (cn.appliedPaise > 0
          ? ` - ${rupees(cn.appliedPaise)} applied to outstanding invoices.`
          : ' and sitting on the customer’s account.'),
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function issue(id: string): Promise<CreditState> {
  try {
    const g = await guard();
    if ('error' in g) return g;

    const r = await issueCreditNote(g.ctx.scope, id, g.ctx.user.id);
    if (r.awaitingApproval) {
      revalidateAll();
      return { ok: true, message: `${r.creditNoteNo} is not issued yet: ${WAIT}.` };
    }
    await log(g.storeId, g.ctx.user.id, id, 'CreditNote', 'update', `${r.creditNoteNo} issued`);

    revalidateAll();
    return {
      ok: true,
      message: r.appliedPaise > 0
        ? `${r.creditNoteNo} issued - ${rupees(r.appliedPaise)} applied.`
        : `${r.creditNoteNo} issued and held on the customer’s account.`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function apply(
  creditNoteId: string, invoiceId: string, amountPaise: number,
): Promise<CreditState> {
  try {
    const g = await guard();
    if ('error' in g) return g;

    await applyCredit(g.ctx.scope, creditNoteId, invoiceId, amountPaise, g.ctx.user.id);
    await log(
      g.storeId, g.ctx.user.id, creditNoteId, 'CreditNote', 'update',
      `${rupees(amountPaise)} of credit applied`, amountPaise,
    );

    revalidateAll();
    return { ok: true, message: `${rupees(amountPaise)} applied. The invoice owes that much less.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function unapply(
  creditNoteId: string, invoiceId: string, amountPaise: number, reason: string,
): Promise<CreditState> {
  try {
    const g = await guard();
    if ('error' in g) return g;

    await unapplyCredit(g.ctx.scope, creditNoteId, invoiceId, amountPaise, reason, g.ctx.user.id);
    await log(
      g.storeId, g.ctx.user.id, creditNoteId, 'CreditNote', 'update',
      `${rupees(amountPaise)} of credit taken back - ${reason}`, amountPaise,
    );

    revalidateAll();
    return { ok: true, message: 'Taken back. The credit is available again and the invoice is outstanding once more.' };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function voidCreditNote(id: string, reason: string): Promise<CreditState> {
  try {
    const g = await guard();
    if ('error' in g) return g;

    await cancelCreditNote(g.ctx.scope, id, reason, g.ctx.user.id);
    await log(g.storeId, g.ctx.user.id, id, 'CreditNote', 'update', `Credit note cancelled - ${reason}`);

    revalidateAll();
    return {
      ok: true,
      message: 'Cancelled. Every invoice it was settling is outstanding again. The document and its number stay on the record.',
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function refund(input: {
  creditNoteId: string;
  amountPaise: number;
  method: string;
  refundedAt: string | null;
  reference: string | null;
  note: string | null;
}): Promise<CreditState> {
  try {
    const g = await guard();
    if ('error' in g) return g;

    {
      const cn = await db.creditNote.findFirst({ where: { id: input.creditNoteId, storeId: g.storeId }, select: { creditNoteNo: true, customerName: true } });
      const held = cn && await heldMessage(g.ctx.scope, g.ctx.user.id, {
        type: 'refund', entityId: input.creditNoteId, amountPaise: input.amountPaise,
        title: `Refund ${rupees(input.amountPaise)} on ${cn.creditNoteNo}`, summary: `${cn.customerName} - ${input.method}`,
        payload: { ...input },
      });
      if (held) { revalidateAll(); return { ok: true, message: held }; }
    }
    const r = await recordRefund(
      g.ctx.scope,
      {
        creditNoteId: input.creditNoteId,
        amountPaise: input.amountPaise,
        method: input.method,
        refundedAt: input.refundedAt ? new Date(input.refundedAt) : null,
        reference: input.reference,
        note: input.note,
      },
      g.ctx.user.id,
    );

    await log(
      g.storeId, g.ctx.user.id, r.id, 'Refund', 'create',
      `${r.refundNo} - ${rupees(input.amountPaise)} refunded`, input.amountPaise,
    );

    revalidateAll();
    return { ok: true, message: `${r.refundNo} recorded. ${rupees(input.amountPaise)} paid back.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function undoRefund(refundId: string, reason: string): Promise<CreditState> {
  try {
    const g = await guard();
    if ('error' in g) return g;

    await reverseRefund(g.ctx.scope, refundId, reason, g.ctx.user.id);
    await log(g.storeId, g.ctx.user.id, refundId, 'Refund', 'update', `Refund reversed - ${reason}`);

    revalidateAll();
    return { ok: true, message: 'Reversed. The credit is usable again.' };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function revalidateAll() {
  for (const p of ['/credit-notes', '/sales-return', '/invoices', '/customers', '/receipts', '/dashboard']) {
    revalidatePath(p);
  }
}
