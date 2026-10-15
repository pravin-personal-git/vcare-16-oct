'use server';

import { revalidatePath } from 'next/cache';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { requireContext } from '@/server/context';
import { heldMessage, rupeesText } from '@/server/approval-actions';
import { db } from '@/server/db';
import { cancelInvoice, convertOrderToInvoice, getInvoiceDetail } from '@/server/invoices';
import { issueChecked, takePayment } from '@/server/invoice-flow';
import {
  createConsolidatedInvoice, getInvoiceTrail, previewConsolidatedInvoice,
  type ConsolidatedDraft, type LineTrail,
} from '@/server/consolidated-invoice';

export interface InvoiceFormState {
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
      data: { storeId, userId, activityType, entityType: 'Invoice', entityId, amount, description },
    })
    .catch((e) => console.error('[invoice] audit write failed (non-fatal)', e));
}

export async function convertOrder(
  salesOrderId: string,
  opts: { termsDays: number },
): Promise<InvoiceFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('invoice.create')) {
      return { error: 'You do not have permission to raise invoices.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store before raising an invoice.' };
    }

    const inv = await convertOrderToInvoice(ctx.scope, salesOrderId, ctx.user.id, {
      termsDays: opts.termsDays,
    });

    await log(
      inv.storeId, ctx.user.id, inv.id, 'Create',
      `Invoice ${inv.invoiceNo} raised for ${inv.customerName}`,
      inv.grandTotalPaise / 100,
    );

    revalidatePath('/invoices');
    revalidatePath('/sales/orders');
    return { ok: true, id: inv.id, message: `Invoice ${inv.invoiceNo} created as a draft.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not raise the invoice.';
    console.error('[invoice] convert failed', err);
    return { error: msg };
  }
}

export async function issue(id: string): Promise<InvoiceFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.create')) {
      return { error: 'You do not have permission to issue invoices.' };
    }
    // The approval gate, the activity line and AMC contracts - one path with the phone (server/invoice-flow).
    const r = await issueChecked(ctx, id);
    revalidatePath('/invoices');
    if (r.amcContracts.length) revalidatePath('/services/amc');
    return { ok: true, message: r.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not issue the invoice.';
    console.error('[invoice] issue failed', err);
    return { error: msg };
  }
}

export async function cancel(id: string, reason: string): Promise<InvoiceFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.approve')) {
      return { error: 'Cancelling an invoice needs the approve permission.' };
    }
    if (!reason.trim()) {
      return { error: 'A cancellation reason is required - it goes on the audit trail.' };
    }

    {
      const d = await invoiceFacts(ctx.scope, id);
      const held = d && await heldMessage(ctx.scope, ctx.user.id, {
        type: 'invoice_cancel', entityId: id, amountPaise: d.grandTotalPaise,
        title: `Cancel invoice ${d.invoiceNo} ${rupeesText(d.grandTotalPaise)}`, summary: `${d.customerName} - ${reason.trim()}`,
        payload: { reason: reason.trim() },
      });
      if (held) { revalidatePath('/invoices'); return { ok: true, message: held }; }
    }
    const inv = await cancelInvoice(ctx.scope, id, reason.trim(), ctx.user.id);
    await log(
      inv.storeId, ctx.user.id, inv.id, 'Cancel',
      `Invoice ${inv.invoiceNo} cancelled - ${reason.trim()}`,
    );

    revalidatePath('/invoices');
    revalidatePath('/sales/orders');
    return { ok: true, message: `${inv.invoiceNo} cancelled.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not cancel the invoice.';
    console.error('[invoice] cancel failed', err);
    return { error: msg };
  }
}

export async function addPayment(
  id: string,
  input: { amountRupees: number; method: string; reference?: string; note?: string },
): Promise<InvoiceFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.create')) {
      return { error: 'You do not have permission to record payments.' };
    }
    if (!Number.isFinite(input.amountRupees) || input.amountRupees <= 0) {
      return { error: 'Enter an amount greater than zero.' };
    }
    const r = await takePayment(ctx, id, {
      amountPaise: Math.round(input.amountRupees * 100), method: input.method,
      reference: input.reference ?? null, note: input.note ?? null,
    });
    revalidatePath('/invoices');
    revalidatePath('/customers');
    return { ok: true, message: r.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not record the payment.';
    console.error('[invoice] payment failed', err);
    return { error: msg };
  }
}

export async function loadInvoice(id: string) {
  const ctx = await requireContext();
  return getInvoiceDetail(ctx.scope, id);
}

/** Create New Invoice - a counter sale with no order behind it. */
export async function addDirectInvoice(input: {
  partyId: string | null;
  customerName: string;
  organizationName: string | null;
  email: string | null;
  phone: string;
  gstin: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  stateId: string | null;
  cityId: string | null;
  /** The GST switch on the form. The server decides what NONE means. */
  noGst?: boolean;
  invoiceDateIso: string;
  termsDays: number;
  poNumber: string | null;
  deliveryChargePaise: number;
  deliveryExempt: boolean;
  discountType: 'amount' | 'percent';
  discountValue: number;
  termsBody: string | null;
  notes: string | null;
  salespersonId?: string | null;
  lines: {
    productId: string | null;
    productName: string;
    productCode: string | null;
    qty: number;
    unitPricePaise: number;
    discountPct: number;
    taxRatePct: number;
    /** Serial products: the units ticked on the form (10 Oct 2026). */
    stockUnitIds?: string[];
  }[];
}): Promise<{ error?: string; id?: string; invoiceNo?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.create')) {
      return { error: 'Creating an invoice needs the invoice create permission.' };
    }
    const { createDirectInvoice } = await import('@/server/invoices');
    const inv = await createDirectInvoice(
      ctx.scope,
      {
        ...input,
        invoiceDate: new Date(input.invoiceDateIso),
        deliveryCharge: input.deliveryChargePaise,
      },
      ctx.user.id,
    );
    revalidatePath('/invoices');
    return { id: inv.id, invoiceNo: inv.invoiceNo };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save the invoice.' };
  }
}

/* ---------------------------------------------------------------- archive */

export async function closeInvoice(id: string): Promise<{ error?: string; ok?: boolean; message?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.edit')) {
      return { error: 'Closing an invoice needs the invoice edit permission.' };
    }
    const { closeDocument } = await import('@/server/archive');
    await closeDocument(ctx.scope, 'invoice', id, ctx.user.id);
    revalidatePath('/invoices');
    return { ok: true, message: 'Moved to History.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not close it.' };
  }
}

export async function reopenInvoice(id: string): Promise<{ error?: string; ok?: boolean; message?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.edit')) {
      return { error: 'Reopening an invoice needs the invoice edit permission.' };
    }
    const { reopenDocument } = await import('@/server/archive');
    await reopenDocument(ctx.scope, 'invoice', id);
    revalidatePath('/invoices');
    return { ok: true, message: 'Back in the Active list.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not reopen it.' };
  }
}

export async function removeInvoice(id: string): Promise<{ error?: string; ok?: boolean; message?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.edit')) {
      return { error: 'Deleting an invoice needs the invoice edit permission.' };
    }
    const { deleteDocument } = await import('@/server/archive');
    await deleteDocument(ctx.scope, 'invoice', id);
    revalidatePath('/invoices');
    return { ok: true, message: 'Invoice deleted.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not delete it.' };
  }
}

export async function removeInvoiceFile(fileId: string): Promise<{ error?: string; ok?: boolean }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.edit')) {
      return { error: 'Removing a file needs the invoice edit permission.' };
    }
    const { removeAttachment } = await import('@/server/attachments');
    await removeAttachment(ctx.scope, fileId, ctx.user.id);
    revalidatePath('/invoices');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not remove the file.' };
  }
}

/**
 * Correct an issued invoice.
 *
 * Gated on invoice.approve, not invoice.edit. The person who writes the bill
 * should not also be the person who can quietly change it after it has gone
 * out - that is the same reason approving an order needs a different
 * permission from raising one.
 */
export async function editInvoice(id: string, input: {
  customerName: string;
  organizationName: string | null;
  email: string | null;
  phone: string;
  gstin: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  stateId: string | null;
  cityId: string | null;
  invoiceDateIso: string;
  termsDays: number;
  poNumber: string | null;
  deliveryChargePaise: number;
  deliveryExempt: boolean;
  discountType: 'amount' | 'percent';
  discountValue: number;
  termsBody: string | null;
  notes: string | null;
  salespersonId?: string | null;
  reason: string;
  /** The GST switch on the form. Absent = keep the invoice's own answer. */
  noGst?: boolean;
  lines: {
    productId: string | null;
    productName: string;
    productCode: string | null;
    qty: number;
    unitPricePaise: number;
    discountPct: number;
    taxRatePct: number;
  }[];
}): Promise<{ error?: string; ok?: boolean; message?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.approve')) {
      return {
        error: 'Editing an issued invoice needs the invoice approve permission. '
          + 'Ask an administrator - the change goes on the record either way.',
      };
    }

    {
      const d = await invoiceFacts(ctx.scope, id);
      const held = d && await heldMessage(ctx.scope, ctx.user.id, {
        type: 'invoice_edit', entityId: id, amountPaise: d.grandTotalPaise,
        title: `Change issued invoice ${d.invoiceNo}`, summary: `${d.customerName} - ${input.reason}`,
        payload: { ...input, invoiceDate: input.invoiceDateIso, deliveryCharge: input.deliveryChargePaise },
      });
      if (held) { revalidatePath('/invoices'); return { ok: true, message: held }; }
    }
    const { editIssuedInvoice } = await import('@/server/invoices');
    const inv = await editIssuedInvoice(
      ctx.scope,
      id,
      {
        ...input,
        invoiceDate: new Date(input.invoiceDateIso),
        deliveryCharge: input.deliveryChargePaise,
      },
      ctx.user.id,
    );

    revalidatePath('/invoices');
    revalidatePath(`/invoices/${id}`);
    return { ok: true, message: `${inv.invoiceNo} updated - version ${inv.version}.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save the changes.' };
  }
}

export async function loadInvoiceForEdit(id: string) {
  const ctx = await requireContext();
  const { getInvoiceDetail } = await import('@/server/invoices');
  return getInvoiceDetail(ctx.scope, id);
}

export async function invoiceRevisions(id: string) {
  const ctx = await requireContext();
  const { listRevisions } = await import('@/server/invoices');
  return listRevisions(ctx.scope, id);
}

/* -------------------------------------------------------------------------- */
/*  One bill for a whole site                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Show what is about to be billed, without writing anything.
 *
 * A consolidated invoice draws on several documents at once, so "press the
 * button and see what you get" is not good enough - by the time the invoice
 * exists, the challans are marked billed and undoing it is a cancellation.
 * The preview is how somebody checks before that happens.
 */
export async function previewSiteBill(
  challanIds: string[],
  salesOrderIds: string[],
): Promise<{ error?: string; draft?: ConsolidatedDraft }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.create')) {
      return { error: 'You do not have permission to raise invoices.' };
    }
    return { draft: await previewConsolidatedInvoice(ctx.scope, { challanIds, salesOrderIds }) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not work out the bill.' };
  }
}

export async function billSite(
  challanIds: string[],
  salesOrderIds: string[],
  opts: { termsDays: number; poNumber?: string | null; notes?: string | null },
): Promise<InvoiceFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('invoice.create')) {
      return { error: 'You do not have permission to raise invoices.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store before raising an invoice.' };
    }

    const inv = await createConsolidatedInvoice(ctx.scope, {
      challanIds,
      salesOrderIds,
      invoiceDate: new Date(),
      termsDays: opts.termsDays,
      poNumber: opts.poNumber ?? null,
      notes: opts.notes ?? null,
    }, ctx.user.id);

    await log(
      inv.storeId, ctx.user.id, inv.id, 'Create',
      `Invoice ${inv.invoiceNo} raised for ${inv.customerName}, covering ${challanIds.length} challan(s)`,
      inv.grandTotalPaise / 100,
    );

    revalidatePath('/invoices');
    revalidatePath('/sales/orders');
    revalidatePath('/installation-challans');
    return { ok: true, id: inv.id, message: `Invoice ${inv.invoiceNo} created as a draft.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not raise the invoice.';
    console.error('[invoice] site bill failed', err);
    return { error: msg };
  }
}

/**
 * Where every charge on an invoice came from.
 *
 * Gated on `invoice.costTrail`, which is NOT `invoice.view`. Reading an invoice
 * and knowing what the goods on it cost the business are different authorities,
 * and plenty of shops do not want both on the same desk. The refusal is here,
 * at the boundary, rather than in the server module - that is where the user is.
 */
export async function loadCostTrail(
  invoiceId: string,
): Promise<{ error?: string; trail?: LineTrail[] }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('invoice.costTrail')) {
      return { error: 'You do not have permission to see where these costs came from.' };
    }
    return { trail: await getInvoiceTrail(ctx.scope, invoiceId) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not load the trail.' };
  }
}

/** The figures an approval request shows for an invoice. */
async function invoiceFacts(scope: Awaited<ReturnType<typeof requireContext>>['scope'], id: string) {
  if (scope.kind !== 'single') return null;
  return db.invoice.findFirst({
    where: { id, storeId: scope.storeId },
    select: {
      invoiceNo: true, customerName: true, grandTotalPaise: true,
      subtotalPaise: true, itemDiscountPaise: true, orderDiscountPaise: true, taxableBasePaise: true,
    },
  });
}

/**
 * The customer's no-login link to an issued invoice (6 Oct 2026), for the
 * WhatsApp message - wa.me carries text only, never the PDF.
 */
export async function getInvoiceShareLink(id: string): Promise<{ error?: string; url?: string }> {
  try {
    const ctx = await requireContext();
    const { ensureInvoiceShareToken } = await import('@/server/invoices');
    const token = await ensureInvoiceShareToken(ctx.scope, id);

    const h = await (await import('next/headers')).headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    return { url: `${proto}://${host}/i/${token}` };
  } catch (err) {
    const { InvoiceShareError } = await import('@/server/invoices');
    console.error('[invoice] share link failed', err);
    return { error: err instanceof InvoiceShareError ? err.message : 'Could not create a link to this invoice.' };
  }
}

/**
 * The serials on the shelf for the serial products on an invoice form (10 Oct
 * 2026) - so the person billing ticks the exact units the customer takes.
 * Products that are not serial-tracked are left out.
 */
export async function inStockSerialsAction(productIds: string[]): Promise<{ productId: string; units: { id: string; serialNo: string }[] }[]> {
  const ctx = await requireContext();
  if (ctx.scope.kind !== 'single') return [];
  const ids = [...new Set(productIds)].slice(0, 100);
  if (!ids.length) return [];
  const serialProducts = await db.product.findMany({ where: { id: { in: ids }, storeId: ctx.scope.storeId, trackingMode: 'serial' }, select: { id: true } });
  if (!serialProducts.length) return [];
  const units = await db.stockUnit.findMany({
    where: { storeId: ctx.scope.storeId, productId: { in: serialProducts.map((p) => p.id) }, status: { in: ['in_stock', 'reserved'] }, deletedAt: null, serialNo: { not: null } },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    take: LIST_MAX_ROWS,
    select: { id: true, serialNo: true, productId: true },
  });
  return serialProducts.map((p) => ({ productId: p.id, units: units.filter((u) => u.productId === p.id).map((u) => ({ id: u.id, serialNo: u.serialNo! })) }));
}
