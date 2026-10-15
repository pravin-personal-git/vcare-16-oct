import { field, jsonBody, V1Error } from '@/server/auth/v1-staff';
import { ensureShareToken, getQuotationDetail, setQuotationStatus } from '@/server/quotations';
import { convertQuotationToOrder } from '@/server/sales-orders';
import { guardSalesDocOrThrow } from '@/server/sales-reach';
import { db } from '@/server/db';
import type { QuotationStatus } from '@/lib/quotation-totals';

type Params = { params: Promise<{ id: string }> };

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://atlas.nairsolutions.org';

/**
 * One quotation on the phone (13 Oct 2026, native admin app - sales part 1).
 * GET: the quotation as the website shows it (the margin panel only for the
 * owner); POST: mark sent / accepted / rejected (Quotations: edit), make the
 * customer's link (to share on WhatsApp), or convert to a sales order
 * (Orders: create) - the same functions as the website's buttons.
 */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['quotation.view', 'quotation.create'], null, async (ctx) => {
    const q = await getQuotationDetail(ctx.scope, id);
    if (!q) throw new V1Error('That quotation is not in this branch.', 404);
    try { await guardSalesDocOrThrow(ctx, q.salespersonId); } catch { throw new V1Error('This quotation belongs to someone else.', 403); }
    const order = q.status === 'converted'
      ? await db.salesOrder.findFirst({ where: { quotationId: id }, select: { id: true, orderNo: true } })
      : null;
    const { profit, ...rest } = q as typeof q & { profit?: unknown };
    return {
      quotation: { ...rest, ...(ctx.permissions.has('settings.edit') ? { profit } : {}) },
      order,
      can: {
        edit: ctx.permissions.has('quotation.edit'),
        convert: ctx.permissions.has('orders.create') && q.status !== 'converted',
      },
    };
  });
}

const STATUSES: QuotationStatus[] = ['sent', 'accepted', 'rejected'];

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['quotation.view', 'quotation.create', 'quotation.edit', 'orders.create'], null, async (ctx) => {
    const b = await jsonBody(req);
    const q = await db.quotation.findFirst({ where: { id, ...(ctx.scope.kind === 'single' ? { storeId: ctx.scope.storeId } : { storeId: { in: ctx.scope.storeIds } }) }, select: { salespersonId: true } });
    if (!q) throw new V1Error('That quotation is not in this branch.', 404);
    try { await guardSalesDocOrThrow(ctx, q.salespersonId); } catch { throw new V1Error('This quotation belongs to someone else.', 403); }

    const action = String(b.action ?? '');
    if (action === 'status') {
      if (!ctx.permissions.has('quotation.edit')) throw new V1Error('Changing a quotation status needs the quotation edit permission.', 403);
      const status = String(b.status) as QuotationStatus;
      if (!STATUSES.includes(status)) throw new V1Error('Choose Sent, Accepted or Rejected.');
      try { await setQuotationStatus(ctx.scope, id, status); } catch (e) { throw new V1Error(e instanceof Error ? e.message : 'Could not change it.'); }
      return { ok: true, message: 'Saved.' };
    }
    if (action === 'link') {
      const token = await ensureShareToken(ctx.scope, id);
      return { ok: true, url: `${APP_URL}/q/${token}` };
    }
    if (action === 'convert') {
      if (!ctx.permissions.has('orders.create')) throw new V1Error('You do not have permission to create sales orders.', 403);
      if (ctx.scope.kind === 'all') throw new V1Error('Select a single store before converting a quotation.');
      try {
        const order = await convertQuotationToOrder(ctx.scope, id, ctx.user.id, { expectedDeliveryDate: null, requiresApproval: false });
        await db.activityLog.create({
          data: {
            storeId: order.storeId, userId: ctx.user.id, activityType: 'Create', entityType: 'SalesOrder', entityId: order.id,
            amount: order.grandTotalPaise / 100, description: `Sales order ${order.orderNo} created from a quotation for ${order.customerName} (phone)`,
          },
        }).catch(() => undefined);
        return { ok: true, orderId: order.id, orderNo: order.orderNo, message: `Order ${order.orderNo} created.` };
      } catch (e) {
        throw new V1Error(e instanceof Error ? e.message : 'Could not create the order.');
      }
    }
    throw new V1Error('Unknown action.');
  });
}
