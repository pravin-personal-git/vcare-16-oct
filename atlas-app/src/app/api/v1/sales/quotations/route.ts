import { field, jsonBody, str, V1Error } from '@/server/auth/v1-staff';
import { quotationsList } from '@/server/quotations-list';
import { QuotationCreateError, raiseQuotation } from '@/server/quotation-create';
import { SalespersonError } from '@/server/salesperson';
import type { QuotationInput } from '@/server/quotations';

/**
 * Quotations on the phone (13 Oct 2026, native admin app - sales part 1).
 * GET: the same list as the website (server/quotations-list - "Quotations,
 * orders and invoices they see" applies), active ones first.
 * POST: raise one through the same path as the website form
 * (server/quotation-create) - totals and tax are recomputed on the server
 * from the lines, never taken from the phone.
 */
export async function GET(req: Request) {
  return field(req, ['quotation.view', 'quotation.create'], null, async (ctx) => {
    const view = new URL(req.url).searchParams.get('view') === 'history' ? 'history' : 'active';
    const out = await quotationsList(ctx, { view, pageSize: '500' });
    return {
      quotations: out.rows.map((r) => ({
        id: r.id, quotationNo: r.quotationNo, customerName: r.customerName, organizationName: r.organizationName,
        phone: r.phone, quotationDate: r.quotationDate, validUntil: r.validUntil, grandTotalPaise: r.grandTotalPaise,
        status: r.status, itemCount: r.itemCount, salespersonName: r.salespersonName, awaitingApproval: r.awaitingApproval,
      })),
      canCreate: ctx.permissions.has('quotation.create'),
    };
  });
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const int = (v: unknown, d = 0) => Math.round(num(v, d));

export async function POST(req: Request) {
  return field(req, 'quotation.create', null, async (ctx) => {
    const b = await jsonBody(req);
    const lines = Array.isArray(b.lines) ? b.lines.slice(0, 200) : [];
    const input: QuotationInput = {
      noGst: b.noGst === true,
      leadId: str(b.leadId, 40), partyId: str(b.partyId, 40),
      customerName: str(b.customerName, 200) ?? '', organizationName: str(b.organizationName, 200),
      email: str(b.email, 200), phone: str(b.phone, 30) ?? '', gstin: str(b.gstin, 20),
      billingAddress: str(b.billingAddress, 500), shippingAddress: str(b.shippingAddress, 500),
      stateId: str(b.stateId, 40), cityId: str(b.cityId, 80),
      validityPeriodDays: Math.max(1, Math.min(365, int(b.validityPeriodDays, 15))),
      discountType: b.discountType === 'percent' ? 'percent' : 'amount',
      discountValue: Math.max(0, num(b.discountValue)),
      deliveryPaise: Math.max(0, int(b.deliveryPaise)), deliveryExempt: b.deliveryExempt === true, deliveryMode: str(b.deliveryMode, 60),
      termsBody: str(b.termsBody, 4000), notes: str(b.notes, 2000),
      transportPaise: 0, incentivePaise: 0,
      lines: lines.map((l: Record<string, unknown>) => ({
        productId: str(l.productId, 40), productName: str(l.productName, 300) ?? '', productCode: str(l.productCode, 60),
        qty: num(l.qty), unitPricePaise: Math.max(0, int(l.unitPricePaise)),
        discountPct: Math.max(0, Math.min(100, num(l.discountPct))), taxRatePct: Math.max(0, Math.min(40, num(l.taxRatePct, 18))),
      })),
    };
    try {
      const q = await raiseQuotation(ctx, input);
      return { ok: true, id: q.id, quotationNo: q.quotationNo, grandTotalPaise: q.grandTotalPaise, message: `Quotation ${q.quotationNo} created.` };
    } catch (e) {
      if (e instanceof QuotationCreateError || e instanceof SalespersonError) throw new V1Error(e.message);
      throw e;
    }
  });
}
