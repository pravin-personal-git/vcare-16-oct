'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { receiveGoods as receive, cancelGrn, getGrnDetail, linkGrnLine, type GrnLineDraft } from '@/server/goods-receipt';
import { friendlyError } from '@/lib/friendly-error';
import { istDayStart } from '@/lib/date-ranges';

export interface GrnState {
  ok?: boolean;
  error?: string;
  message?: string;
  id?: string;
}

const CAN_EDIT = 'purchase.edit';

async function guard() {
  const ctx = await requireContext();
  if (!ctx.permissions.has(CAN_EDIT)) {
    return { error: `You do not have permission to receive goods.` };
  }
  if (ctx.scope.kind === 'all') {
    return { error: 'Select a single store first.' };
  }
  return { ctx };
}

function fail(e: unknown): GrnState {
  return { error: friendlyError(e, true) };
}

/** A line as the form sends it - dates as `YYYY-MM-DD` strings. */
export type GrnLineForm = Omit<GrnLineDraft, 'mfgDate' | 'expiryDate'> & { expiryDate?: string | null };

export async function receiveGoods(input: {
  purchaseOrderId: string | null;
  partyId: string;
  receivedDate: string;
  supplierInvoiceNo: string | null;
  notes: string | null;
  lines: GrnLineForm[];
}): Promise<GrnState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    // One step: every line planned and every serial checked before a number
    // is used, then created and posted together. See `receiveGoods` in
    // server/goods-receipt.
    const created = await receive(g.ctx.scope, {
      purchaseOrderId: input.purchaseOrderId,
      partyId: input.partyId,
      receivedDate: new Date(input.receivedDate),
      supplierInvoiceNo: input.supplierInvoiceNo,
      notes: input.notes,
      lines: input.lines.map((l) => ({
        ...l,
        // Midnight India time - see `parseDay` in services/amc/actions (9 Oct 2026).
        expiryDate: l.expiryDate ? istDayStart(l.expiryDate) ?? new Date(Number.NaN) : null,
      })),
    }, g.ctx.user.id);

    await db.activityLog
      .create({
        data: {
          storeId: g.ctx.scope.kind === 'single' ? g.ctx.scope.storeId : '',
          userId: g.ctx.user.id, activityType: 'created', entityType: 'GoodsReceiptNote',
          entityId: created.id, description: `Goods receipt ${created.grnNo} posted`,
        },
      })
      .catch((e) => console.error('[goods-receipt] audit write failed (non-fatal)', e));

    revalidatePath('/goods-receipt');
    revalidatePath('/purchase/orders');
    revalidatePath('/products');

    return {
      ok: true,
      id: created.id,
      message: [`${created.grnNo} posted. Stock is in.`, ...created.warnings].join(' '),
    };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelReceipt(id: string, reason: string): Promise<GrnState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await cancelGrn(g.ctx.scope, id, g.ctx.user.id, reason);
    revalidatePath('/goods-receipt');
    revalidatePath('/purchase/orders');
    revalidatePath('/products');
    return { ok: true, message: 'Cancelled. Stock has been taken back out.' };
  } catch (e) {
    return fail(e);
  }
}

export async function loadReceipt(id: string) {
  try {
    const ctx = await requireContext();
    const grn = await getGrnDetail(ctx.scope, id);
    return { data: { ...grn, receivedDate: grn.receivedDate.toISOString(), createdAt: grn.createdAt.toISOString() } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not load the receipt.' };
  }
}

/** G1: link a posted receipt's text-only line to its product, and put the stock in now. */
export async function linkReceiptLine(grnItemId: string, productId: string): Promise<GrnState> {
  const g = await guard();
  if ('error' in g) return g;
  try {
    const r = await linkGrnLine(g.ctx.scope, grnItemId, productId, g.ctx.user.id);
    await db.activityLog.create({
      data: {
        storeId: g.ctx.scope.kind === 'single' ? g.ctx.scope.storeId : '',
        userId: g.ctx.user.id, activityType: 'updated', entityType: 'GoodsReceiptNoteItem',
        entityId: grnItemId, description: `${r.grnNo}: line linked to ${r.productName}, ${r.qty} into stock`,
      },
    }).catch((e) => console.error('[goods-receipt] audit write failed (non-fatal)', e));
    revalidatePath('/goods-receipt');
    revalidatePath('/products');
    return {
      ok: true,
      message: r.trackingMode === 'none'
        ? `Linked to ${r.productName}. It is not a stocked product, so nothing went on the shelf.`
        : `Linked to ${r.productName}: ${r.qty} now in stock.${r.trackingMode === 'serial' ? ' Fill in their serials from Serial & Batch Stock.' : ''}`,
    };
  } catch (e) {
    return fail(e);
  }
}
