'use server';

import { gateQuotationSend } from '@/server/quotation-send-gate';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  setQuotationStatus, unconvertQuotation,
  type QuotationInput,
} from '@/server/quotations';
import { db } from '@/server/db';
import { SalespersonError } from '@/server/salesperson';
import { QuotationCreateError, raiseQuotation } from '@/server/quotation-create';
import type { QuotationStatus } from '@/lib/quotation-totals';

export interface QuotationFormState {
  error?: string;
  ok?: boolean;
  message?: string;
  /** Set on create, so the form can upload files it was holding. */
  id?: string;
}

export async function addQuotation(input: QuotationInput): Promise<QuotationFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('quotation.create')) {
      return { error: 'You do not have permission to create quotations.' };
    }
    // The other checks, the activity line and the lead note live in one place for the website and the phone.
    const q = await raiseQuotation(ctx, input);
    revalidatePath('/quotation');
    revalidatePath('/crm/leads');
    return { ok: true, id: q.id, message: `Quotation ${q.quotationNo} created.` };
  } catch (err) {
    if (err instanceof SalespersonError || err instanceof QuotationCreateError) return { error: err.message };
    console.error('[quotation] create failed', err);
    return { error: 'Could not save the quotation. Please try again.' };
  }
}

export async function changeStatus(id: string, status: QuotationStatus): Promise<QuotationFormState> {
  try {
    const ctx = await requireContext();

    // Was ungated. Marking a quotation Accepted is not a cosmetic change - it
    // is what the conversion rate and the whole pipeline report are counted
    // from, so anybody who could see a quotation could move the numbers.
    if (!ctx.permissions.has('quotation.edit')) {
      return { error: 'Changing a quotation status needs the quotation edit permission.' };
    }

    // Sending can need approval (Settings > Approval Rules > Quotation - send).
    if (status === 'sent') {
      const held = await gateQuotationSend(ctx.scope, ctx.user.id, id);
      if (held) { revalidatePath('/quotation'); return { ok: true, message: held }; }
    }
    await setQuotationStatus(ctx.scope, id, status);
    revalidatePath('/quotation');
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && /approv|raised this yourself|waits on/i.test(err.message)) return { error: err.message };
    console.error('[quotation] status change failed', err);
    return { error: 'Could not update the status.' };
  }
}

/**
 * Close, reopen, delete.
 *
 * Closing archives - the quotation leaves the Active list and turns up under
 * History. Deleting is only allowed while it is still a draft nobody has seen;
 * the server enforces that, because a greyed-out menu item is a suggestion and
 * a thrown error is a rule.
 */
export async function closeQuotation(id: string): Promise<QuotationFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('quotation.edit')) {
      return { error: 'Closing a quotation needs the quotation edit permission.' };
    }
    const { closeDocument } = await import('@/server/archive');
    await closeDocument(ctx.scope, 'quotation', id, ctx.user.id);
    revalidatePath('/quotation');
    return { ok: true, message: 'Moved to History.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not close it.' };
  }
}

export async function reopenQuotation(id: string): Promise<QuotationFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('quotation.edit')) {
      return { error: 'Reopening a quotation needs the quotation edit permission.' };
    }
    const { reopenDocument } = await import('@/server/archive');
    await reopenDocument(ctx.scope, 'quotation', id);
    revalidatePath('/quotation');
    return { ok: true, message: 'Back in the Active list.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not reopen it.' };
  }
}

export async function removeQuotation(id: string): Promise<QuotationFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('quotation.delete') && !ctx.permissions.has('quotation.edit')) {
      return { error: 'Deleting a quotation needs the quotation permission.' };
    }
    const { deleteDocument } = await import('@/server/archive');
    await deleteDocument(ctx.scope, 'quotation', id);
    revalidatePath('/quotation');
    return { ok: true, message: 'Quotation deleted.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not delete it.' };
  }
}

export async function listQuotationFiles(id: string) {
  const ctx = await requireContext();
  const { listAttachments } = await import('@/server/attachments');
  return listAttachments(ctx.scope, 'quotation', id);
}

export async function removeQuotationFile(fileId: string): Promise<QuotationFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('quotation.edit')) {
      return { error: 'Removing a file needs the quotation edit permission.' };
    }
    const { removeAttachment } = await import('@/server/attachments');
    await removeAttachment(ctx.scope, fileId, ctx.user.id);
    revalidatePath('/quotation');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not remove the file.' };
  }
}

export async function loadQuotation(id: string) {
  const ctx = await requireContext();
  const { getQuotationDetail } = await import('@/server/quotations');
  return getQuotationDetail(ctx.scope, id);
}

/** Create a product without leaving the quotation form. */
export async function quickAddProduct(input: {
  productName: string; categoryId: string | null;
  dlp: number; mrp: number; taxRatePct: number;
  hsnCode: string | null; unit: string;
}): Promise<{ error?: string; product?: {
  id: string; code: string; name: string;
  dlpPaise: number; mrpPaise: number; category: string | null; stock: number;
} }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('products.edit')) {
      return { error: 'You do not have permission to add products.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store first.' };
    }
    if (!input.productName.trim()) return { error: 'Product name is required.' };
    if (input.dlp <= 0) return { error: 'Rate must be more than zero.' };

    const { quickCreateProduct } = await import('@/server/products');
    const p = await quickCreateProduct(ctx.scope, {
      productName: input.productName.trim(),
      categoryId: input.categoryId,
      dlpPaise: Math.round(input.dlp * 100),
      mrpPaise: Math.round((input.mrp || input.dlp) * 100),
      taxRatePct: input.taxRatePct,
      hsnCode: input.hsnCode,
      unit: input.unit || 'pcs',
    });

    await db.activityLog.create({
      data: {
        storeId: p.storeId, userId: ctx.user.id,
        activityType: 'Create', entityType: 'Product', entityId: p.id,
        description: `Product '${p.productName}' created from a quotation (${p.productCode})`,
      },
    }).catch(() => undefined);

    revalidatePath('/products');
    revalidatePath('/quotation');

    return {
      product: {
        id: p.id, code: p.productCode, name: p.productName,
        dlpPaise: Math.round(input.dlp * 100),
        mrpPaise: Math.round((input.mrp || input.dlp) * 100),
        category: null, stock: 0,
      },
    };
  } catch (err) {
    console.error('[quotation] quick add product failed', err);
    return { error: 'Could not create the product.' };
  }
}

export async function editQuotation(
  id: string,
  input: Parameters<typeof import('@/server/quotations').updateQuotation>[2],
): Promise<QuotationFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('quotation.create')) {
      return { error: 'You do not have permission to edit quotations.' };
    }
    if (input.lines.length === 0) return { error: 'Add at least one product.' };
    if (input.lines.some((l) => l.qty <= 0)) return { error: 'Quantity must be more than zero.' };

    const { updateQuotation } = await import('@/server/quotations');
    const q = await updateQuotation(ctx.scope, id, input);

    await db.activityLog.create({
      data: {
        storeId: q.storeId, userId: ctx.user.id,
        activityType: 'Update', entityType: 'Quotation', entityId: q.id,
        amount: q.grandTotalPaise / 100,
        description: `Quotation ${q.quotationNo} edited - new total ₹${(q.grandTotalPaise / 100).toLocaleString('en-IN')}`,
      },
    }).catch(() => undefined);

    revalidatePath('/quotation');
    return { ok: true, message: `${q.quotationNo} updated.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not save the changes.';
    console.error('[quotation] edit failed', err);
    return { error: msg };
  }
}

/** Returns a public URL the customer can open without logging in. */
export async function getShareLink(id: string, rotate = false):
  Promise<{ error?: string; url?: string }> {
  try {
    const ctx = await requireContext();
    // A share link is how a quotation reaches the customer (WhatsApp, email),
    // so it waits for the same approval as Mark as Sent.
    const held = await gateQuotationSend(ctx.scope, ctx.user.id, id);
    if (held) return { error: held };
    const { ensureShareToken } = await import('@/server/quotations');
    const token = await ensureShareToken(ctx.scope, id, rotate);

    const h = await (await import('next/headers')).headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
    const proto = h.get('x-forwarded-proto') ?? 'https';

    return { url: `${proto}://${host}/q/${token}` };
  } catch (err) {
    console.error('[quotation] share link failed', err);
    return { error: err instanceof Error && /approv|raised this yourself|waits on/i.test(err.message) ? err.message : 'Could not create a share link.' };
  }
}

/**
 * Undo a conversion that should not have happened.
 *
 * Gated on `quotation.approve`, not `quotation.edit`. Converting is a
 * commitment - an order exists downstream because of it - and unwinding one
 * should sit with whoever can approve the original.
 */
export async function undoConversion(id: string, reason: string): Promise<QuotationFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('quotation.approve')) {
      return { error: 'Undoing a conversion needs approval permission.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store first.' };
    }
    if (!reason.trim()) return { error: 'Say why the conversion is being undone.' };

    const q = await unconvertQuotation(ctx.scope, id, reason);

    await db.activityLog
      .create({
        data: {
          storeId: ctx.scope.storeId,
          userId: ctx.user.id,
          activityType: 'Update',
          entityType: 'Quotation',
          entityId: id,
          description: `${q.quotationNo} released from converted - ${reason.trim()}`,
        },
      })
      .catch((e) => console.error('[quotation] audit write failed (non-fatal)', e));

    revalidatePath('/quotation');
    revalidatePath(`/quotation/${id}`);
    return { ok: true, message: `${q.quotationNo} can be edited again.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not undo the conversion.';
    console.error('[quotation] unconvert failed', err);
    return { error: msg };
  }
}

// gateQuotationSend moved to server/quotation-send-gate.ts (A3, 12 Oct 2026) -
// the WhatsApp Business send needs the same gate.

