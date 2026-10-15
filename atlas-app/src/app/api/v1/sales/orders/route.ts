import { field } from '@/server/auth/v1-staff';
import { ordersList } from '@/server/orders-list';

/**
 * Sales orders on the phone (13 Oct 2026, native admin app part 3): the
 * website's list (server/orders-list - "whose orders they see" applies).
 * New orders come from a quotation (Make it a sales order) as on the website.
 */
export async function GET(req: Request) {
  return field(req, ['orders.view', 'orders.create', 'orders.edit'], null, async (ctx) => {
    const view = new URL(req.url).searchParams.get('view') === 'history' ? 'history' : 'active';
    const out = await ordersList(ctx, { view, pageSize: '500' });
    return {
      orders: out.rows.map((r) => ({
        id: r.id, orderNo: r.orderNo, customerName: r.customerName, organizationName: r.organizationName,
        orderDate: r.orderDate, grandTotalPaise: r.grandTotalPaise, amountPaidPaise: r.amountPaidPaise,
        fulfilmentStatus: r.fulfilmentStatus, paymentStatus: r.paymentStatus, isInvoiced: r.isInvoiced,
        salespersonName: r.salespersonName,
      })),
    };
  });
}
