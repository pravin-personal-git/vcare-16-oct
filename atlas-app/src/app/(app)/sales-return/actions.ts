'use server';

import { revalidatePath } from 'next/cache';
import { heldMessage, rupeesText } from '@/server/approval-actions';
import { approvalNeeded } from '@/server/approvals';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import {
  cancelReturn, createReturn, getInvoiceForReturn, receiveReturn,
} from '@/server/sales-returns';
import { createCreditFromReturn } from '@/server/credit-notes';
import type { Disposition } from '@/lib/returns';

const WAIT = 'sent for approval - it takes effect once approved. Track it in My Desk';

/**
 * Server actions for returns.
 *
 * Every one of these re-resolves the context and re-checks the permission. The
 * browser deciding it may do something is a suggestion; this is the boundary
 * that actually decides.
 *
 * `returns.*`, not `invoice.edit`. Taking goods back is a different authority
 * from raising an invoice, and giving money back is different again - in most
 * shops the person at the counter can accept a return and only a manager can
 * credit it. `returns.edit` moves goods; `returns.credit` moves money.
 */

export interface ReturnState {
  ok?: boolean;
  error?: string;
  message?: string;
  id?: string;
}

const CAN_VIEW = 'returns.view';
const CAN_EDIT = 'returns.edit';
const CAN_CREDIT = 'returns.credit';

async function log(
  storeId: string, userId: string, entityId: string, entityType: string,
  activityType: string, description: string, amount?: number,
) {
  await db.activityLog
    .create({ data: { storeId, userId, activityType, entityType, entityId, amount, description } })
    .catch((e) => console.error('[returns] audit write failed (non-fatal)', e));
}

/** Guarded once, so no action below can forget one of the three checks. */
async function guard(permission: string) {
  const ctx = await requireContext();
  if (!ctx.permissions.has(permission)) {
    return {
      error: permission === CAN_CREDIT
        ? 'You can record returns, but issuing a credit note needs the returns.credit permission.'
        : 'You do not have permission to work with returns.',
    };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single store before recording a return.' as const };
  }
  return { ctx, storeId: ctx.scope.storeId };
}

/** The invoice's lines with what is still returnable on each. */
export async function loadInvoiceLines(invoiceId: string) {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has(CAN_VIEW)) {
      return { error: 'You do not have permission to view returns.' };
    }
    const inv = await getInvoiceForReturn(ctx.scope, invoiceId);
    if (!inv) return { error: 'Invoice not found.' };

    return {
      invoice: {
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        invoiceDate: inv.invoiceDate.toISOString(),
        lifecycle: inv.lifecycle,
        customerName: inv.customerName,
        taxMode: inv.taxMode,
        grandTotalPaise: inv.grandTotalPaise,
        fullyReturned: inv.fullyReturned,
        lines: inv.lines,
      },
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function saveReturn(input: {
  invoiceId: string;
  lines: { invoiceItemId: string; qty: number; disposition: Disposition }[];
  reason: string;
  returnedAt: string | null;
  notes: string | null;
  receiveNow: boolean;
  /** Raise the credit note in the same step. Only valid when receiving. */
  creditNow: boolean;
}): Promise<ReturnState> {
  try {
    const g = await guard(CAN_EDIT);
    if ('error' in g) return g;

    // Taking goods back can need approval (Settings > Approval Rules > Sales
    // return). Then the return is saved as a draft and received once approved.
    const gateNeeded = input.receiveNow && await returnNeedsApproval(g.ctx.scope, g.ctx.user.id, input.invoiceId, input.lines);
    const r = await createReturn(
      g.ctx.scope,
      {
        invoiceId: input.invoiceId,
        lines: input.lines,
        reason: input.reason,
        returnedAt: input.returnedAt ? new Date(input.returnedAt) : null,
        notes: input.notes,
        receiveNow: input.receiveNow && !gateNeeded,
      },
      g.ctx.user.id,
    );
    if (gateNeeded) {
      const held = await heldReturn(g.ctx.scope, g.ctx.user.id, r.id);
      revalidateAll();
      return { ok: true, id: r.id, message: `${r.returnNo} saved as a draft. ${held ?? 'Taking the goods back was sent for approval.'}` };
    }

    await log(
      g.storeId, g.ctx.user.id, r.id, 'SalesReturn', 'create',
      `${r.returnNo} raised${r.movedStock ? ' and goods received' : ''}`,
    );

    let message = input.receiveNow
      ? `${r.returnNo} recorded and the goods are back in stock.`
      : `${r.returnNo} saved as a draft. Mark it received when the goods arrive.`;

    // The credit note is raised only after the return is safely written. If it
    // fails, the return still stands and can be credited from its own screen -
    // far better than losing both because the second half went wrong.
    if (input.creditNow && input.receiveNow) {
      if (!g.ctx.permissions.has(CAN_CREDIT)) {
        return {
          ok: true,
          id: r.id,
          message: `${message} A credit note was not raised - that needs the returns.credit`
            + ' permission. Someone who has it can issue one from this return.',
        };
      }
      try {
        const cn = await createCreditFromReturn(
          g.ctx.scope, { salesReturnId: r.id, issueNow: true }, g.ctx.user.id,
        );
        await log(
          g.storeId, g.ctx.user.id, cn.id, 'CreditNote', 'create',
          `${cn.creditNoteNo} ${cn.awaitingApproval ? 'raised, awaiting approval,' : 'issued'} for ${r.returnNo}`, cn.grandTotalPaise,
        );
        message = cn.awaitingApproval
          ? `${r.returnNo} recorded and goods back in stock. Credit note ${cn.creditNoteNo} is ${WAIT}.`
          : `${r.returnNo} recorded, goods back in stock, and ${cn.creditNoteNo} issued`
          + (cn.appliedPaise > 0
            ? ` - ₹${(cn.appliedPaise / 100).toLocaleString('en-IN')} set against their outstanding invoices.`
            : ' and sitting on the customer’s account.');
      } catch (e) {
        message = `${r.returnNo} recorded, but the credit note could not be raised: `
          + `${(e as Error).message} You can raise it from the return.`;
      }
    }

    revalidateAll();
    return { ok: true, id: r.id, message };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function markReceived(id: string): Promise<ReturnState> {
  try {
    const g = await guard(CAN_EDIT);
    if ('error' in g) return g;

    const held = await heldReturn(g.ctx.scope, g.ctx.user.id, id);
    if (held) { revalidateAll(); return { ok: true, message: held }; }
    const r = await receiveReturn(g.ctx.scope, id, g.ctx.user.id);
    await log(g.storeId, g.ctx.user.id, id, 'SalesReturn', 'update', `${r.returnNo} received`);

    revalidateAll();
    return {
      ok: true,
      message: r.restocked > 0
        ? `${r.returnNo} received. ${r.restocked} item${r.restocked === 1 ? '' : 's'} back in stock.`
        : `${r.returnNo} received. Nothing was restocked - every line was damaged or scrapped.`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function voidReturn(id: string, reason: string): Promise<ReturnState> {
  try {
    const g = await guard(CAN_EDIT);
    if ('error' in g) return g;

    await cancelReturn(g.ctx.scope, id, reason, g.ctx.user.id);
    await log(g.storeId, g.ctx.user.id, id, 'SalesReturn', 'update', `Return cancelled - ${reason}`);

    revalidateAll();
    return {
      ok: true,
      message: 'Cancelled. Any stock it put back has been taken out again, and the invoice can be returned against once more.',
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function creditReturn(salesReturnId: string): Promise<ReturnState> {
  try {
    const g = await guard(CAN_CREDIT);
    if ('error' in g) return g;

    const cn = await createCreditFromReturn(
      g.ctx.scope, { salesReturnId, issueNow: true }, g.ctx.user.id,
    );
    await log(
      g.storeId, g.ctx.user.id, cn.id, 'CreditNote', 'create',
      `${cn.creditNoteNo} ${cn.awaitingApproval ? 'raised, awaiting approval' : 'issued'}`, cn.grandTotalPaise,
    );

    revalidateAll();
    return {
      ok: true,
      id: cn.id,
      message: cn.awaitingApproval
        ? `${cn.creditNoteNo} for ₹${(cn.grandTotalPaise / 100).toLocaleString('en-IN')} ${WAIT}.`
        : cn.appliedPaise > 0
        ? `${cn.creditNoteNo} issued for ₹${(cn.grandTotalPaise / 100).toLocaleString('en-IN')}`
          + ` - ₹${(cn.appliedPaise / 100).toLocaleString('en-IN')} applied to their outstanding invoices.`
        : `${cn.creditNoteNo} issued. Nothing was outstanding, so the full amount is on the customer’s account.`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function revalidateAll() {
  for (const p of ['/sales-return', '/credit-notes', '/invoices', '/customers', '/products', '/dashboard']) {
    revalidatePath(p);
  }
}

/** Would taking these goods back need approval? Decided before anything is written. */
async function returnNeedsApproval(
  scope: Awaited<ReturnType<typeof requireContext>>['scope'], userId: string, invoiceId: string,
  lines: { invoiceItemId: string; qty: number }[],
): Promise<boolean> {
  if (scope.kind !== 'single') return false;
  const items = await db.invoiceItem.findMany({
    where: { id: { in: lines.map((l) => l.invoiceItemId) }, invoice: { id: invoiceId, storeId: scope.storeId } },
    select: { id: true, unitPricePaise: true },
  });
  const price = new Map(items.map((i) => [i.id, i.unitPricePaise]));
  const value = lines.reduce((n, l) => n + l.qty * (price.get(l.invoiceItemId) ?? 0), 0);
  return approvalNeeded(scope.storeId, 'sales_return', userId, value);
}

/** Sales return - take goods back, through Approval Rules (5 Oct 2026). */
async function heldReturn(scope: Awaited<ReturnType<typeof requireContext>>['scope'], userId: string, id: string): Promise<string | null> {
  if (scope.kind !== 'single') return null;
  const r = await db.salesReturn.findFirst({
    where: { id, storeId: scope.storeId },
    select: { returnNo: true, customerName: true, items: { select: { qty: true, unitPricePaise: true } } },
  });
  if (!r) return null;
  const value = r.items.reduce((n, i) => n + i.qty * i.unitPricePaise, 0);
  return heldMessage(scope, userId, {
    type: 'sales_return', entityId: id, amountPaise: value,
    title: `Take back goods on ${r.returnNo} ${rupeesText(value)}`, summary: r.customerName,
  });
}
