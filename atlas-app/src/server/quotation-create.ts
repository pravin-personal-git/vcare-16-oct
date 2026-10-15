import 'server-only';
import { db } from './db';
import { createQuotation, type QuotationInput } from './quotations';
import type { AppContext } from './context';

/**
 * Raise a quotation - ONE path for the website form and the Vcare phone
 * (13 Oct 2026, native admin app). The checks, the activity line and the
 * note on the lead used to live in the website's server action only; the
 * phone calling `createQuotation` straight would have skipped all three.
 *
 * Throws QuotationCreateError with a sentence for the person; anything else
 * is a fault.
 */
export class QuotationCreateError extends Error {}

export async function raiseQuotation(ctx: AppContext, input: QuotationInput) {
  if (!ctx.permissions.has('quotation.create')) throw new QuotationCreateError('You do not have permission to create quotations.');
  if (ctx.scope.kind === 'all') throw new QuotationCreateError('Select a single store before creating a quotation.');
  if (!input.customerName.trim()) throw new QuotationCreateError('Customer name is required.');
  if (!/^[\d\s+]{10,}$/.test(input.phone)) throw new QuotationCreateError('A valid phone number is required.');
  if (input.lines.length === 0) throw new QuotationCreateError('Add at least one product.');
  if (input.lines.some((l) => l.qty <= 0)) throw new QuotationCreateError('Quantity must be more than zero on every line.');

  const q = await createQuotation(ctx.scope, input, ctx.user.id);

  await db.activityLog.create({
    data: {
      storeId: q.storeId, userId: ctx.user.id,
      activityType: 'Create', entityType: 'Quotation', entityId: q.id,
      amount: q.grandTotalPaise / 100,
      description: `Quotation ${q.quotationNo} created for ${q.customerName}`,
    },
  }).catch((e) => console.error('[quotation] audit write failed (non-fatal)', e));

  // A quotation raised from a lead is a real activity on that lead.
  if (input.leadId) {
    await db.leadActivity.create({
      data: {
        leadId: input.leadId, channel: 'quotation', outcome: 'sent',
        note: `${q.quotationNo} - ₹${(q.grandTotalPaise / 100).toLocaleString('en-IN')}`,
        createdBy: ctx.user.id,
      },
    }).catch(() => undefined);
  }
  return q;
}
