import 'server-only';
import { db } from './db';
import { heldMessage, pricingOf, rupeesText } from './approval-actions';
import { issueInvoice, recordPayment } from './invoices';
import { createContractsForInvoice } from './amc';
import type { AppContext } from './context';

/**
 * ISSUING AN INVOICE AND TAKING A PAYMENT - one path for the website and the
 * Vcare phone (13 Oct 2026, native admin app part 3). These lived in the
 * website's server actions only: the approval gate, the activity line and
 * the AMC contracts would have been skipped by a phone calling `issueInvoice`
 * straight. Callers check the permission themselves (the website's guard test
 * reads it in the action) - this does the rest.
 */
async function log(storeId: string, userId: string, entityId: string, activityType: string, description: string, amount?: number) {
  await db.activityLog
    .create({ data: { storeId, userId, activityType, entityType: 'Invoice', entityId, amount, description } })
    .catch((e) => console.error('[invoice] audit write failed (non-fatal)', e));
}

export interface IssueResult { held: boolean; message: string; invoiceNo: string | null; amcContracts: string[] }

/** Issue a draft - unless the approval rule holds it, in which case it waits for approval (`held`). */
export async function issueChecked(ctx: AppContext, id: string): Promise<IssueResult> {
  if (ctx.scope.kind === 'single') {
    const d = await db.invoice.findFirst({
      where: { id, storeId: ctx.scope.storeId },
      select: {
        invoiceNo: true, customerName: true, grandTotalPaise: true,
        subtotalPaise: true, itemDiscountPaise: true, orderDiscountPaise: true, taxableBasePaise: true,
      },
    });
    const held = d && await heldMessage(ctx.scope, ctx.user.id, {
      type: 'invoice_issue', entityId: id, amountPaise: d.grandTotalPaise,
      title: `Issue invoice ${d.invoiceNo} ${rupeesText(d.grandTotalPaise)}`, summary: d.customerName,
      pricing: pricingOf(d),
    });
    if (held) return { held: true, message: held, invoiceNo: d.invoiceNo, amcContracts: [] };
  }
  const inv = await issueInvoice(ctx.scope, id, ctx.user.id);
  await log(inv.storeId, ctx.user.id, inv.id, 'Update', `Invoice ${inv.invoiceNo} issued`);

  /**
   * Any AMC sold on this invoice becomes a live contract now - after issuing
   * and never fatal (the invoice is the legal document; the AMC screen's own
   * sweep catches anything missed). See the website action's longer note.
   */
  let contractNos: string[] = [];
  try {
    const r = await createContractsForInvoice(ctx.scope, { invoiceId: inv.id, userId: ctx.user.id });
    if (r.created > 0) {
      contractNos = r.contractNos;
      await log(inv.storeId, ctx.user.id, inv.id, 'Update', `AMC contract${r.created === 1 ? '' : 's'} created: ${r.contractNos.join(', ')}`);
    }
  } catch (amcErr) {
    console.error('[invoice] issued, but AMC contract creation failed', amcErr);
  }
  return {
    held: false, invoiceNo: inv.invoiceNo, amcContracts: contractNos,
    message: contractNos.length ? `${inv.invoiceNo} issued. AMC ${contractNos.join(', ')} now active.` : `${inv.invoiceNo} issued.`,
  };
}

/** Money received against an issued invoice; the message says what is still due. */
export async function takePayment(
  ctx: AppContext, id: string,
  input: { amountPaise: number; method: string; reference?: string | null; note?: string | null },
): Promise<{ message: string; duePaise: number }> {
  if (!Number.isFinite(input.amountPaise) || input.amountPaise <= 0) throw new Error('Enter an amount greater than zero.');
  const inv = await recordPayment(ctx.scope, id, {
    amountPaise: Math.round(input.amountPaise), method: input.method,
    reference: input.reference?.trim() || null, note: input.note?.trim() || null,
  }, ctx.user.id);
  const rupees = input.amountPaise / 100;
  await log(inv.storeId, ctx.user.id, inv.id, 'Payment',
    `₹${rupees.toLocaleString('en-IN')} received against ${inv.invoiceNo}${input.reference ? ` (${input.reference})` : ''}`, rupees);
  const due = inv.grandTotalPaise - inv.amountPaidPaise;
  return {
    duePaise: Math.max(0, due),
    message: due > 0 ? `Recorded. ₹${(due / 100).toLocaleString('en-IN')} still due.` : `Recorded. ${inv.invoiceNo} is fully paid.`,
  };
}
