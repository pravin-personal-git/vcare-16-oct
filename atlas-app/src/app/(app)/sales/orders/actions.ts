'use server';

import { revalidatePath } from 'next/cache';
import { heldMessage, rupeesText } from '@/server/approval-actions';
import { requireContext } from '@/server/context';
import { salesReach } from '@/server/sales-reach';
import { db } from '@/server/db';
import {
  cancelSalesOrder,
  convertQuotationToOrder,
  createSalesOrder,
  updateSalesOrder,
  getSalesOrderDetail,
  moveFulfilment,
  recordPayment,
  type SalesOrderInput,
} from '@/server/sales-orders';
import type { FulfilmentStatus } from '@/lib/sales-order-status';
import { stageNamer } from '@/server/order-stages';

export interface OrderFormState {
  error?: string;
  ok?: boolean;
  message?: string;
  /** Set on create, so the form can upload files it was holding. */
  id?: string;
}

/** Anything that touched an order should show up on the audit trail. */
async function log(
  storeId: string, userId: string, entityId: string,
  activityType: string, description: string, amount?: number,
) {
  await db.activityLog
    .create({
      data: {
        storeId, userId, activityType,
        entityType: 'SalesOrder', entityId, amount, description,
      },
    })
    .catch((e) => console.error('[sales-order] audit write failed (non-fatal)', e));
}

export async function convertQuotation(
  quotationId: string,
  opts: { expectedDeliveryDate: string | null; requiresApproval: boolean },
): Promise<OrderFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('orders.create')) {
      return { error: 'You do not have permission to create sales orders.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store before converting a quotation.' };
    }

    const order = await convertQuotationToOrder(ctx.scope, quotationId, ctx.user.id, {
      expectedDeliveryDate: opts.expectedDeliveryDate
        ? new Date(opts.expectedDeliveryDate)
        : null,
      requiresApproval: opts.requiresApproval,
    });

    await log(
      order.storeId, ctx.user.id, order.id, 'Create',
      `Sales order ${order.orderNo} created from a quotation for ${order.customerName}`,
      order.grandTotalPaise / 100,
    );

    revalidatePath('/sales/orders');
    revalidatePath('/quotation');
    return { ok: true, id: order.id, message: `Order ${order.orderNo} created.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not create the order.';
    console.error('[sales-order] convert failed', err);
    return { error: msg };
  }
}

export async function addSalesOrder(input: SalesOrderInput): Promise<OrderFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('orders.create')) {
      return { error: 'You do not have permission to create sales orders.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store before creating an order.' };
    }
    if (!input.customerName.trim()) return { error: 'Customer name is required.' };
    if (!/^[\d\s+]{10,}$/.test(input.phone)) return { error: 'A valid phone number is required.' };
    if (input.lines.length === 0) return { error: 'Add at least one product.' };
    if (input.lines.some((l) => l.qty <= 0)) {
      return { error: 'Quantity must be more than zero on every line.' };
    }

    const order = await createSalesOrder(ctx.scope, input, ctx.user.id);

    await log(
      order.storeId, ctx.user.id, order.id, 'Create',
      `Sales order ${order.orderNo} created for ${order.customerName}`,
      order.grandTotalPaise / 100,
    );

    revalidatePath('/sales/orders');
    return { ok: true, id: order.id, message: `Order ${order.orderNo} created.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not save the order.';
    console.error('[sales-order] create failed', err);
    return { error: msg };
  }
}

export async function advanceOrder(
  id: string,
  to: FulfilmentStatus,
  extra?: { awbNo?: string | null },
): Promise<OrderFormState> {
  try {
    const ctx = await requireContext();

    // Confirming an order is an approval, and approval is its own permission -
    // the person who raises an order should not be the one who approves it.
    const needed = to === 'confirmed' ? 'orders.approve' : 'orders.edit';
    if (!ctx.permissions.has(needed)) {
      return {
        error: to === 'confirmed'
          ? 'You do not have permission to approve orders.'
          : 'You do not have permission to update orders.',
      };
    }

    // Voiding an order the customer has paid towards can need approval.
    if (to === 'void' && ctx.scope.kind === 'single') {
      const o = await db.salesOrder.findFirst({
        where: { id, storeId: ctx.scope.storeId },
        select: { orderNo: true, customerName: true, amountPaidPaise: true },
      });
      const held = o && o.amountPaidPaise > 0 && await heldMessage(ctx.scope, ctx.user.id, {
        type: 'order_cancel_paid', entityId: id, amountPaise: o.amountPaidPaise,
        title: `Cancel paid order ${o.orderNo} (${rupeesText(o.amountPaidPaise)} received)`,
        summary: o.customerName, payload: { via: 'void' },
      });
      if (held) { revalidatePath('/sales/orders'); return { ok: true, message: held }; }
    }
    const order = await moveFulfilment(ctx.scope, id, to, ctx.user.id, extra);
    // The business's own stage name (G3) - "Packed" may be called "Ready".
    const named = (await stageNamer(ctx.scope))(to);

    await log(
      order.storeId, ctx.user.id, order.id, 'Update',
      `Sales order ${order.orderNo} moved to ${named}`,
    );

    revalidatePath('/sales/orders');
    return { ok: true, message: `${order.orderNo} → ${named}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not update the order.';
    console.error('[sales-order] status change failed', err);
    return { error: msg };
  }
}

export async function addPayment(id: string, amountRupees: number): Promise<OrderFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('orders.edit')) {
      return { error: 'You do not have permission to record payments.' };
    }
    if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
      return { error: 'Enter an amount greater than zero.' };
    }

    // Writes a real, numbered receipt held on account against this order, with
    // its journal entry - not just a counter. See `recordPayment`.
    const order = await recordPayment(ctx.scope, id, Math.round(amountRupees * 100), ctx.user.id);

    await log(
      order.storeId, ctx.user.id, order.id, 'Payment',
      `Advance of ₹${amountRupees.toLocaleString('en-IN')} received against ${order.orderNo}`,
      amountRupees,
    );

    revalidatePath('/sales/orders');
    return {
      ok: true,
      message: `Receipt raised. ₹${((order.grandTotalPaise - order.amountPaidPaise) / 100)
        .toLocaleString('en-IN')} still due on this order.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not record the payment.';
    console.error('[sales-order] payment failed', err);
    return { error: msg };
  }
}

export async function loadSalesOrder(id: string) {
  const ctx = await requireContext();
  const o = await getSalesOrderDetail(ctx.scope, id);
  // Whose orders this person sees (B4 step 3) - the pop-up follows the page.
  const reach = o ? await salesReach(ctx) : null;
  return o && (!reach || reach.allows(o.salespersonId)) ? o : null;
}

/* ---------------------------------------------------------------- archive */

export async function closeOrder(id: string): Promise<OrderFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('orders.edit')) {
      return { error: 'Closing an order needs the order edit permission.' };
    }
    const { closeDocument } = await import('@/server/archive');
    await closeDocument(ctx.scope, 'sales_order', id, ctx.user.id);
    revalidatePath('/sales/orders');
    return { ok: true, message: 'Moved to History.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not close it.' };
  }
}

export async function reopenOrder(id: string): Promise<OrderFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('orders.edit')) {
      return { error: 'Reopening an order needs the order edit permission.' };
    }
    const { reopenDocument } = await import('@/server/archive');
    await reopenDocument(ctx.scope, 'sales_order', id);
    revalidatePath('/sales/orders');
    return { ok: true, message: 'Back in the Active list.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not reopen it.' };
  }
}

export async function removeOrder(id: string): Promise<OrderFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('orders.edit')) {
      return { error: 'Deleting an order needs the order edit permission.' };
    }
    const { deleteDocument } = await import('@/server/archive');
    await deleteDocument(ctx.scope, 'sales_order', id);
    revalidatePath('/sales/orders');
    return { ok: true, message: 'Order deleted.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not delete it.' };
  }
}

export async function removeOrderFile(fileId: string): Promise<OrderFormState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('orders.edit')) {
      return { error: 'Removing a file needs the order edit permission.' };
    }
    const { removeAttachment } = await import('@/server/attachments');
    await removeAttachment(ctx.scope, fileId, ctx.user.id);
    revalidatePath('/sales/orders');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not remove the file.' };
  }
}

/** Files hung off an order, for the document view. */
export async function listOrderFiles(id: string) {
  const ctx = await requireContext();
  const { listAttachments } = await import('@/server/attachments');
  return listAttachments(ctx.scope, 'sales_order', id);
}

/**
 * Change an order that has not been packed yet.
 *
 * The same validation as creating one, because the user is looking at the same
 * form and an error that only appears on save is an error found too late.
 */
export async function editSalesOrder(
  id: string, input: SalesOrderInput,
): Promise<OrderFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('orders.edit')) {
      return { error: 'You do not have permission to edit sales orders.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store before editing an order.' };
    }
    if (!input.customerName.trim()) return { error: 'Customer name is required.' };
    if (!/^[\d\s+]{10,}$/.test(input.phone)) return { error: 'A valid phone number is required.' };
    if (input.lines.length === 0) return { error: 'Add at least one product.' };

    const order = await updateSalesOrder(ctx.scope, id, input, ctx.user.id);

    await log(
      order.storeId, ctx.user.id, order.id, 'Update',
      `Sales order ${order.orderNo} edited - now ${'\u20b9'}${(order.grandTotalPaise / 100).toLocaleString('en-IN')}`,
      order.grandTotalPaise / 100,
    );

    revalidatePath('/sales/orders');
    revalidatePath(`/sales/orders/${id}`);
    return { ok: true, id: order.id, message: `Order ${order.orderNo} updated.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not save the order.';
    console.error('[sales-order] edit failed', err);
    return { error: msg };
  }
}

/**
 * Cancel an order, which is not the same as deleting one.
 *
 * Gated on `orders.approve` rather than `orders.edit`: cancelling can return
 * stock to the shelf, and that is a decision a salesperson should not be able
 * to make alone.
 */
export async function cancelOrder(id: string, reason: string): Promise<OrderFormState> {
  try {
    const ctx = await requireContext();

    if (!ctx.permissions.has('orders.approve')) {
      return { error: 'Cancelling an order needs approval permission.' };
    }
    if (ctx.scope.kind === 'all') {
      return { error: 'Select a single store first.' };
    }
    if (!reason.trim()) return { error: 'Say why it is being cancelled.' };

    // Cancelling an order the customer has already paid towards opens the way
    // to a refund, so it can need approval (Settings > Approval Rules).
    {
      const o = await db.salesOrder.findFirst({
        where: { id, storeId: ctx.scope.storeId },
        select: { orderNo: true, customerName: true, amountPaidPaise: true, grandTotalPaise: true },
      });
      const held = o && o.amountPaidPaise > 0 && await heldMessage(ctx.scope, ctx.user.id, {
        type: 'order_cancel_paid', entityId: id, amountPaise: o.amountPaidPaise,
        title: `Cancel paid order ${o.orderNo} (${rupeesText(o.amountPaidPaise)} received)`,
        summary: `${o.customerName} - ${reason.trim()}`, payload: { reason: reason.trim() },
      });
      if (held) { revalidatePath('/sales/orders'); return { ok: true, message: held }; }
    }
    const r = await cancelSalesOrder(ctx.scope, id, reason, ctx.user.id);

    await log(
      ctx.scope.storeId, ctx.user.id, id, 'Update',
      `Sales order ${r.orderNo} cancelled - ${reason.trim()}`,
    );

    revalidatePath('/sales/orders');
    revalidatePath('/reports/product-stock');
    return {
      ok: true,
      message: r.returned > 0
        ? `${r.orderNo} cancelled. ${r.returned} dispatched line${r.returned === 1 ? '' : 's'} returned to stock.`
        : `${r.orderNo} cancelled.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not cancel the order.';
    console.error('[sales-order] cancel failed', err);
    return { error: msg };
  }
}

/**
 * The customer's no-login link to this order, /o/<token> (A2, 11 Oct 2026):
 * items and stage, no prices. What the order's WhatsApp button sends.
 */
export async function getOrderShareLink(id: string): Promise<{ error?: string; url?: string }> {
  try {
    const ctx = await requireContext();
    const { ensureOrderShareToken } = await import('@/server/customer-links');
    const token = await ensureOrderShareToken(ctx.scope, id);
    const h = await (await import('next/headers')).headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    return { url: `${proto}://${host}/o/${token}` };
  } catch (err) {
    const { CustomerLinkError } = await import('@/server/customer-links');
    console.error('[order] share link failed', err);
    return { error: err instanceof CustomerLinkError ? err.message : 'Could not create a link to this order.' };
  }
}
