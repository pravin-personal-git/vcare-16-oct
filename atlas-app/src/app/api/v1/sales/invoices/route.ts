import { field, jsonBody, str, V1Error } from '@/server/auth/v1-staff';
import { invoicesList } from '@/server/invoices-list';
import { createDirectInvoice, type DirectInvoiceInput } from '@/server/invoices';
import { issueChecked, takePayment } from '@/server/invoice-flow';
import { claimPhoneNumber, PhoneNumberError, recordPhoneNumber } from '@/server/phone-numbers';
import { SalespersonError } from '@/server/salesperson';
import { db } from '@/server/db';
import { createParty } from '@/server/parties';

/**
 * Invoices on the phone (13 Oct 2026, native admin app part 3).
 *
 * GET: the website's list (server/invoices-list - "whose invoices they see"
 * applies).
 *
 * POST: a direct invoice made on the phone, maybe offline. With `invoiceNo`
 * it carries a final number the phone gave from its own block (F-13 Q3) -
 * accepted only if that number is this person's phone's and unused
 * (server/phone-numbers). Without one (the phone saw it needs approval -
 * decision S2 - or made it online) it takes the branch's next number as on
 * the website. `issue`: issue it at once through the same approval gate as
 * the website's Issue button (server/invoice-flow); if the rule holds it, it
 * waits as a draft for approval. Stock moves when it is created, as on the
 * website; a shortfall is noted, never refused (decision S3). Totals and tax
 * are always worked out again here from the lines.
 */
export async function GET(req: Request) {
  return field(req, ['invoice.view', 'invoice.create'], null, async (ctx) => {
    const view = new URL(req.url).searchParams.get('view') === 'history' ? 'history' : 'active';
    const out = await invoicesList(ctx, { view, pageSize: '500' });
    return {
      invoices: out.rows.map((r) => ({
        id: r.id, invoiceNo: r.invoiceNo, customerName: r.customerName, organizationName: r.organizationName ?? null,
        invoiceDate: r.invoiceDate, dueDate: r.dueDate, grandTotalPaise: r.grandTotalPaise, amountPaidPaise: r.amountPaidPaise,
        status: r.status, lifecycle: r.lifecycle, salespersonName: r.salespersonName ?? null,
      })),
      canCreate: ctx.permissions.has('invoice.create'),
    };
  });
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const int = (v: unknown, d = 0) => Math.round(num(v, d));

export async function POST(req: Request) {
  return field(req, 'invoice.create', null, async (ctx) => {
    if (ctx.scope.kind !== 'single') throw new V1Error('Choose a branch first.');
    const storeId = ctx.scope.storeId;
    const b = await jsonBody(req);
    const lines = Array.isArray(b.lines) ? b.lines.slice(0, 200) : [];
    const at = new Date(String(b.invoiceDate ?? b.at ?? ''));
    const input: DirectInvoiceInput = {
      noGst: b.noGst === true,
      partyId: str(b.partyId, 40), customerName: str(b.customerName, 200) ?? '', organizationName: str(b.organizationName, 200),
      email: str(b.email, 200), phone: str(b.phone, 30) ?? '', gstin: str(b.gstin, 20),
      billingAddress: str(b.billingAddress, 500), shippingAddress: str(b.shippingAddress, 500),
      stateId: str(b.stateId, 40), cityId: str(b.cityId, 80),
      // The day it was made on the phone, even if it reaches us later.
      invoiceDate: Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 60_000 ? new Date() : at,
      termsDays: Math.max(0, Math.min(365, int(b.termsDays, 0))), poNumber: str(b.poNumber, 60),
      deliveryCharge: Math.max(0, int(b.deliveryPaise)), deliveryExempt: b.deliveryExempt === true,
      discountType: b.discountType === 'percent' ? 'percent' : 'amount', discountValue: Math.max(0, num(b.discountValue)),
      termsBody: str(b.termsBody, 4000), notes: str(b.notes, 2000),
      lines: lines.map((l: Record<string, unknown>) => ({
        productId: str(l.productId, 40), productName: str(l.productName, 300) ?? '', productCode: str(l.productCode, 60),
        qty: num(l.qty), unitPricePaise: Math.max(0, int(l.unitPricePaise)),
        discountPct: Math.max(0, Math.min(100, num(l.discountPct))), taxRatePct: Math.max(0, Math.min(40, num(l.taxRatePct, 18))),
      })),
    };
    if (!/^[\d\s+]{10,}$/.test(input.phone)) throw new V1Error('A valid phone number is required.');

    /**
     * A NEW CUSTOMER made on the phone becomes a customer record (13 Oct 2026):
     * a payment can only be taken against an invoice with one, and a phone sale
     * is almost always paid there and then. The same phone number already on a
     * customer = that customer, not a second one. Needs Customers: create.
     */
    if (!input.partyId && b.newCustomer === true && ctx.permissions.has('customers.create')) {
      const digits = input.phone.replace(/\D/g, '').slice(-10);
      const existing = await db.party.findFirst({ where: { storeId, isCustomer: true, phone: digits }, select: { id: true } });
      if (existing) input.partyId = existing.id;
      else {
        const [first, ...rest] = input.customerName.trim().split(/\s+/);
        const { party } = await createParty(ctx.scope, {
          isCustomer: true, isSupplier: false, supplierType: null, paymentTermsDays: 0,
          companyName: input.organizationName, gstin: input.gstin, title: null, firstName: first ?? input.customerName, lastName: rest.join(' ') || null,
          designation: null, phone: digits, altPhone: null, email: input.email, website: null, customerTypeId: null, source: 'Vcare',
          birthday: null, weddingAnniversary: null, addressLine1: input.billingAddress, state: input.stateId, city: null, pincode: null,
          deliveryAddress: null, deliverySameAsBilling: true, creditLimitPaise: 0, creditLimitDays: 0, subscribeSms: false,
        });
        input.partyId = party.id;
      }
    }

    const invoiceNo = str(b.invoiceNo, 40);
    try {
      if (invoiceNo) await claimPhoneNumber(storeId, ctx.user.id, invoiceNo);
      const inv = await createDirectInvoice(ctx.scope, input, ctx.user.id, invoiceNo ? { presetInvoiceNo: invoiceNo } : {});
      if (invoiceNo) await recordPhoneNumber(storeId, ctx.user.id, invoiceNo);
      await db.activityLog.create({
        data: {
          storeId, userId: ctx.user.id, activityType: 'Create', entityType: 'Invoice', entityId: inv.id,
          amount: inv.grandTotalPaise / 100, description: `Invoice ${inv.invoiceNo} made on the phone${invoiceNo ? ' (number given offline)' : ''} for ${inv.customerName}`,
        },
      }).catch(() => undefined);
      const issued = b.issue === true ? await issueChecked(ctx, inv.id) : null;
      /**
       * Money taken there and then, sent WITH the invoice: made offline, the
       * phone has no invoice id to send a payment to later. Only once issued -
       * a draft (or one held for approval) cannot take a payment, as on the website.
       */
      let paid: string | null = null;
      const pay = b.payment && typeof b.payment === 'object' ? b.payment as Record<string, unknown> : null;
      if (pay && issued && !issued.held && Number(pay.amountPaise) > 0) {
        const method = ['cash', 'upi', 'bank', 'cheque', 'card'].includes(String(pay.method)) ? String(pay.method) : 'cash';
        paid = (await takePayment(ctx, inv.id, { amountPaise: Math.round(Number(pay.amountPaise)), method, reference: str(pay.reference, 120) })).message;
      }
      return {
        ok: true, id: inv.id, invoiceNo: inv.invoiceNo, grandTotalPaise: inv.grandTotalPaise,
        held: issued?.held ?? false,
        message: [issued ? issued.message : `Invoice ${inv.invoiceNo} saved as a draft.`, paid].filter(Boolean).join(' '),
      };
    } catch (e) {
      if (e instanceof PhoneNumberError || e instanceof SalespersonError) throw new V1Error(e.message);
      if (e instanceof Error && e.message.length < 200 && !/prisma|invocation/i.test(e.message)) throw new V1Error(e.message);
      throw e;
    }
  });
}
