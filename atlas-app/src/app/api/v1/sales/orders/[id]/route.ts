import { field, jsonBody, V1Error } from '@/server/auth/v1-staff';
import { getSalesOrderDetail } from '@/server/sales-orders';
import { convertOrderToInvoice } from '@/server/invoices';
import { issueChecked } from '@/server/invoice-flow';
import { guardSalesDocOrThrow } from '@/server/sales-reach';
import { db } from '@/server/db';

type Params = { params: Promise<{ id: string }> };

/**
 * One sales order on the phone (13 Oct 2026, native admin app part 3): the
 * order as the website has it, and Make the invoice (Invoices: create) -
 * `convertOrderToInvoice`, the website's own; `issue` issues it straight
 * after through the approval gate (server/invoice-flow).
 */
async function guard(ctx: Parameters<typeof guardSalesDocOrThrow>[0], salespersonId: string | null) {
  try { await guardSalesDocOrThrow(ctx, salespersonId); } catch { throw new V1Error('This order belongs to someone else.', 403); }
}

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['orders.view', 'orders.create', 'orders.edit'], null, async (ctx) => {
    const o = await getSalesOrderDetail(ctx.scope, id);
    if (!o) throw new V1Error('That order is not in this branch.', 404);
    await guard(ctx, o.salespersonId);
    const invoice = await db.invoice.findFirst({ where: { salesOrderId: id, lifecycle: { not: 'cancelled' } }, select: { id: true, invoiceNo: true } });
    return { order: o, invoice, can: { invoice: ctx.permissions.has('invoice.create') && !invoice } };
  });
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, 'invoice.create', null, async (ctx) => {
    const o = await getSalesOrderDetail(ctx.scope, id);
    if (!o) throw new V1Error('That order is not in this branch.', 404);
    await guard(ctx, o.salespersonId);
    const b = await jsonBody(req);
    if (b.action !== 'invoice') throw new V1Error('Unknown action.');
    if (ctx.scope.kind === 'all') throw new V1Error('Choose a branch first.');
    try {
      const inv = await convertOrderToInvoice(ctx.scope, id, ctx.user.id, { termsDays: Math.max(0, Math.min(365, Number(b.termsDays) || 0)) });
      await db.activityLog.create({
        data: {
          storeId: inv.storeId, userId: ctx.user.id, activityType: 'Create', entityType: 'Invoice', entityId: inv.id,
          amount: inv.grandTotalPaise / 100, description: `Invoice ${inv.invoiceNo} made from order ${o.orderNo} on the phone`,
        },
      }).catch(() => undefined);
      const issued = b.issue === true ? await issueChecked(ctx, inv.id) : null;
      return { ok: true, invoiceId: inv.id, invoiceNo: inv.invoiceNo, held: issued?.held ?? false, message: issued?.message ?? `Invoice ${inv.invoiceNo} created as a draft.` };
    } catch (e) {
      if (e instanceof Error && e.message.length < 200 && !/prisma|invocation/i.test(e.message)) throw new V1Error(e.message);
      throw e;
    }
  });
}
