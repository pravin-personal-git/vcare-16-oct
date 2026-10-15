import { field } from '@/server/auth/v1-staff';
import { db } from '@/server/db';
import { buyerOptions, catalogueOptions, leadOptions } from '@/server/form-options';
import { loadRule, roleIdsOf } from '@/server/approvals';

/**
 * What the phone needs to raise a sales document with no signal (13 Oct 2026,
 * native admin app - sales): products with their price and GST rate, the
 * customers and open leads to pick from, and the branch's state (CGST + SGST
 * or IGST is decided by it, the same rule as the website - lib/quotation-totals).
 * Read once while online and kept on the phone like every other answer.
 *
 * The same lists the website's quotation / order / invoice forms load
 * (server/form-options). Cost price is left out - it is the margin panel's,
 * not something to carry around on a phone. Hidden prices (Settings > Roles >
 * Phone app) are taken out by `field` as everywhere.
 */
const NEED = ['quotation.view', 'quotation.create', 'orders.view', 'orders.create', 'invoice.view', 'invoice.create'];

export async function GET(req: Request) {
  return field(req, NEED, null, async (ctx) => {
    const storeId = ctx.scope.kind === 'single' ? ctx.scope.storeId : null;
    const [products, buyers, leads, store] = await Promise.all([
      catalogueOptions(ctx.scope),
      buyerOptions(ctx.scope),
      ctx.permissions.has('leads.view') || ctx.permissions.has('leads.edit') ? leadOptions(ctx.scope) : Promise.resolve([]),
      storeId ? db.store.findUnique({
        where: { id: storeId },
        select: { stateId: true, name: true, address: true, organization: { select: { name: true, gstin: true, email: true, mobile: true } } },
      }) : null,
    ]);
    /**
     * Part 3 (13 Oct 2026): the invoice approval rule as it applies to THIS
     * person (their roles, the skip lists), so the phone can tell offline
     * whether an invoice must wait for approval (decision S2) - with the
     * website's own rule function (lib/approval-rules evaluateRule).
     */
    const [invoiceRule, roleIds] = storeId
      ? await Promise.all([loadRule(storeId, 'invoice_issue'), roleIdsOf(storeId, ctx.user.id)])
      : [null, [] as string[]];
    return {
      products: products.map((p) => ({
        id: p.id, code: p.code, name: p.name, dlpPaise: p.dlpPaise, mrpPaise: p.mrpPaise,
        taxRatePct: p.taxRatePct ?? 18, hsn: p.hsn ?? null, category: p.category, barcode: p.barcode ?? null,
        stock: p.stock, promised: p.promised,
      })),
      buyers,
      leads,
      storeStateId: store?.stateId ?? null,
      // What the phone prints on an invoice it makes offline - the same block as the website's invoice.
      seller: store ? {
        name: store.organization.name, gstin: store.organization.gstin, email: store.organization.email,
        mobile: store.organization.mobile, storeName: store.name, storeAddress: store.address,
      } : null,
      approval: { userId: ctx.user.id, roleIds, invoiceRule },
      can: {
        quotation: ctx.permissions.has('quotation.create'),
        order: ctx.permissions.has('orders.create'),
        invoice: ctx.permissions.has('invoice.create'),
      },
      at: new Date().toISOString(),
    };
  });
}
