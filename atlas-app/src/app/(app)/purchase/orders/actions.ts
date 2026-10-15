'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import {
  createPurchaseOrder, updatePurchaseOrder, movePoStatus, cancelPurchaseOrder,
  getPurchaseOrderDetail, type PoLineDraft,
} from '@/server/purchase-orders';
import type { PurchaseOrderStatus } from '@/lib/purchase-order-status';
import { friendlyError } from '@/lib/friendly-error';

/**
 * Server actions for purchase orders.
 *
 * `purchase.edit` covers everything up to approval - entering, changing and
 * sending a PO is still just paperwork, the same authority that enters a
 * purchase bill. `purchase.approve` gates only the one transition that
 * commits the business to it, mirroring `orders.approve` on the sales side.
 */

const CAN_EDIT = 'purchase.edit';
const CAN_APPROVE = 'purchase.approve';

export interface PoState {
  ok?: boolean;
  error?: string;
  message?: string;
  id?: string;
}

async function log(
  storeId: string, userId: string, entityId: string, activityType: string, description: string,
) {
  await db.activityLog
    .create({ data: { storeId, userId, activityType, entityType: 'PurchaseOrder', entityId, description } })
    .catch((e) => console.error('[purchase-orders] audit write failed (non-fatal)', e));
}

async function guard(permission: string, what: string) {
  const ctx = await requireContext();
  if (!ctx.permissions.has(permission)) {
    return { error: `You do not have permission to ${what}.` };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single store first.' };
  }
  return { ctx, storeId: ctx.scope.storeId };
}

function fail(e: unknown): PoState {
  return { error: friendlyError(e, true) };
}

export async function createOrderAction(input: {
  partyId: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  notes: string | null;
  lines: PoLineDraft[];
}): Promise<PoState> {
  const g = await guard(CAN_EDIT, 'create purchase orders');
  if ('error' in g) return g;

  try {
    const result = await createPurchaseOrder(
      g.ctx.scope,
      {
        partyId: input.partyId,
        orderDate: new Date(input.orderDate),
        expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
        notes: input.notes,
        lines: input.lines,
      },
      g.ctx.user.id,
    );

    await log(g.storeId, g.ctx.user.id, result.id, 'created', `Purchase order ${result.orderNo} created`);
    revalidatePath('/purchase/orders');

    return { ok: true, id: result.id, message: `${result.orderNo} saved as a draft.` };
  } catch (e) {
    return fail(e);
  }
}

export async function updateOrderAction(id: string, input: {
  partyId: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  notes: string | null;
  lines: PoLineDraft[];
}): Promise<PoState> {
  const g = await guard(CAN_EDIT, 'edit purchase orders');
  if ('error' in g) return g;

  try {
    await updatePurchaseOrder(g.ctx.scope, id, {
      partyId: input.partyId,
      orderDate: new Date(input.orderDate),
      expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
      notes: input.notes,
      lines: input.lines,
    });

    await log(g.storeId, g.ctx.user.id, id, 'edited', 'Purchase order edited');
    revalidatePath('/purchase/orders');

    return { ok: true, message: 'Saved.' };
  } catch (e) {
    return fail(e);
  }
}

export async function sendOrderAction(id: string): Promise<PoState> {
  const g = await guard(CAN_EDIT, 'send purchase orders');
  if ('error' in g) return g;

  try {
    await movePoStatus(g.ctx.scope, id, 'sent', g.ctx.user.id);
    await log(g.storeId, g.ctx.user.id, id, 'sent', 'Purchase order marked as sent to supplier');
    revalidatePath('/purchase/orders');
    return { ok: true, message: 'Marked as sent.' };
  } catch (e) {
    return fail(e);
  }
}

export async function approveOrderAction(id: string): Promise<PoState> {
  const g = await guard(CAN_APPROVE, 'approve purchase orders');
  if ('error' in g) return g;

  try {
    await movePoStatus(g.ctx.scope, id, 'approved', g.ctx.user.id);
    await log(g.storeId, g.ctx.user.id, id, 'approved', 'Purchase order approved');
    revalidatePath('/purchase/orders');
    return { ok: true, message: 'Approved.' };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelOrderAction(id: string, reason: string): Promise<PoState> {
  const g = await guard(CAN_EDIT, 'cancel purchase orders');
  if ('error' in g) return g;

  try {
    await cancelPurchaseOrder(g.ctx.scope, id, reason);
    await log(g.storeId, g.ctx.user.id, id, 'cancelled', `Purchase order cancelled: ${reason}`);
    revalidatePath('/purchase/orders');
    return { ok: true, message: 'Cancelled.' };
  } catch (e) {
    return fail(e);
  }
}

export async function loadOrderAction(id: string) {
  try {
    const ctx = await requireContext();
    const order = await getPurchaseOrderDetail(ctx.scope, id);
    return {
      data: {
        ...order,
        orderDate: order.orderDate.toISOString(),
        expectedDeliveryDate: order.expectedDeliveryDate?.toISOString() ?? null,
        approvedAt: order.approvedAt?.toISOString() ?? null,
        cancelledAt: order.cancelledAt?.toISOString() ?? null,
        createdAt: order.createdAt.toISOString(),
        status: order.status as PurchaseOrderStatus,
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not load the purchase order.' };
  }
}
