'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { createDispatch, DispatchError } from '@/server/supplier-dispatch';
import { RmaError } from '@/server/rma';
import { recordSupplierAnswer, receiveFromSupplier, closeAtSupplier, RmaReceiptError } from '@/server/rma-receipt';
import { friendlyError } from '@/lib/friendly-error';

export interface DispatchFormInput {
  caseIds: string[];
  supplierId: string | null;
  supplierName: string | null;
  serviceCentre: string | null;
  supplierRmaNo: string | null;
  courier: string | null;
  docketNo: string | null;
  trackingUrl: string | null;
  /** Rupees as typed. */
  courierCharge: string;
  courierPaidBy: string;
  chargeSplit: 'equal' | 'value';
  boxes: string;
  weightKg: string;
  /** YYYY-MM-DD, an India day. */
  expectedBack: string;
  note: string | null;
}

/** Make one dispatch and send every ticked case on it (repair flow stage 4). */
export async function createDispatchAction(input: DispatchFormInput): Promise<{ error?: string; id?: string; dispatchNo?: string; warnings?: string[] }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.edit')) return { error: 'You do not have permission to send items to suppliers.' };
    const rupees = Number(input.courierCharge || 0);
    if (!Number.isFinite(rupees) || rupees < 0) return { error: 'The courier charge must be a number.' };
    const r = await createDispatch(ctx.scope, {
      caseIds: input.caseIds, supplierId: input.supplierId, supplierName: input.supplierName, serviceCentre: input.serviceCentre,
      supplierRmaNo: input.supplierRmaNo, courier: input.courier, docketNo: input.docketNo, trackingUrl: input.trackingUrl,
      courierChargePaise: Math.round(rupees * 100), courierPaidBy: input.courierPaidBy, chargeSplit: input.chargeSplit,
      boxes: input.boxes ? Number(input.boxes) : null, weightKg: input.weightKg ? Number(input.weightKg) : null,
      // End of that India day, so "due back on the 20th" is late only from the 21st.
      expectedBackAt: input.expectedBack ? new Date(`${input.expectedBack}T23:59:59+05:30`) : null,
      note: input.note,
    }, ctx.user.id);
    revalidatePath('/services/dispatch');
    revalidatePath('/services/replacements');
    return { id: r.id, dispatchNo: r.dispatchNo, warnings: r.warnings };
  } catch (err) {
    if (err instanceof DispatchError || err instanceof RmaError) return { error: err.message };
    console.error('[dispatch] create failed', err);
    return { error: friendlyError(err) };
  }
}

type Result = { error?: string; warnings?: string[]; id?: string; receiptNo?: string };

async function run(label: string, fn: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<Result | void>): Promise<Result> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('complaints.edit')) return { error: 'You do not have permission to record what suppliers send back.' };
    const r = await fn(ctx);
    revalidatePath('/services/dispatch', 'layout');
    revalidatePath('/services/replacements');
    revalidatePath('/services/complaints', 'layout');
    return r ?? {};
  } catch (err) {
    if (err instanceof RmaReceiptError || err instanceof RmaError) return { error: err.message };
    console.error(`[dispatch] ${label} failed`, err);
    return { error: friendlyError(err) };
  }
}

const paise = (rupees: string) => {
  const n = Number(rupees || 0);
  if (!Number.isFinite(n) || n < 0) throw new RmaReceiptError('Amounts must be numbers.');
  return Math.round(n * 100);
};

/** The supplier's answer on one item, with their quote (stage 5). */
export async function supplierAnswerAction(caseId: string, answer: string, quote: string, note: string): Promise<Result> {
  return run('answer', async (ctx) => {
    await recordSupplierAnswer(ctx.scope, caseId, { answer, quotePaise: quote.trim() ? paise(quote) : null, note: note || null }, ctx.user.id);
  });
}

/** Receive part or all of a box on an RMA receipt (stage 5). */
export async function receiveAction(dispatchId: string, input: {
  lines: { caseId: string; result: string; newSerialNo: string }[]; courier: string; docketNo: string; courierCharge: string; courierPaidBy: string; note: string;
}): Promise<Result> {
  return run('receive', async (ctx) => {
    const r = await receiveFromSupplier(ctx.scope, dispatchId, {
      lines: input.lines, courier: input.courier || null, docketNo: input.docketNo || null,
      courierChargePaise: paise(input.courierCharge), courierPaidBy: input.courierPaidBy, note: input.note || null,
    }, ctx.user.id);
    return { id: r.id, receiptNo: r.receiptNo, warnings: r.warnings };
  });
}

/** Closed at the supplier with nothing back: credit note or written reply (stage 5). */
export async function closeAtSupplierAction(caseId: string, input: { kind: 'credit_note' | 'written_reply'; creditNoteNo: string; amount: string; replyRef: string; note: string }): Promise<Result> {
  return run('close', async (ctx) => {
    const r = await closeAtSupplier(ctx.scope, caseId, {
      kind: input.kind, creditNoteNo: input.creditNoteNo || null, creditAmountPaise: input.kind === 'credit_note' ? paise(input.amount) : null,
      replyRef: input.replyRef || null, note: input.note || null,
    }, ctx.user.id);
    return r.warning ? { warnings: [r.warning] } : {};
  });
}
