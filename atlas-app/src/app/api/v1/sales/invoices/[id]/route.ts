import { field, jsonBody, str, V1Error } from '@/server/auth/v1-staff';
import { ensureInvoiceShareToken, getInvoiceDetail } from '@/server/invoices';
import { issueChecked, takePayment } from '@/server/invoice-flow';
import { guardSalesDocOrThrow } from '@/server/sales-reach';

type Params = { params: Promise<{ id: string }> };

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://atlas.nairsolutions.org';
const METHODS = ['cash', 'upi', 'bank', 'cheque', 'card'];

/**
 * One invoice on the phone (13 Oct 2026, native admin app part 3): the
 * invoice as the website has it, and its buttons - issue a draft (through the
 * approval gate), take a payment, make the customer's link for WhatsApp.
 * The same functions as the website (server/invoice-flow).
 */
async function guard(ctx: Parameters<typeof guardSalesDocOrThrow>[0], salespersonId: string | null) {
  try { await guardSalesDocOrThrow(ctx, salespersonId); } catch { throw new V1Error('This invoice belongs to someone else.', 403); }
}

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['invoice.view', 'invoice.create'], null, async (ctx) => {
    const inv = await getInvoiceDetail(ctx.scope, id);
    if (!inv) throw new V1Error('That invoice is not in this branch.', 404);
    await guard(ctx, inv.salespersonId);
    return { invoice: inv, can: { issue: ctx.permissions.has('invoice.create'), payment: ctx.permissions.has('invoice.create') } };
  });
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['invoice.view', 'invoice.create'], null, async (ctx) => {
    const inv = await getInvoiceDetail(ctx.scope, id);
    if (!inv) throw new V1Error('That invoice is not in this branch.', 404);
    await guard(ctx, inv.salespersonId);
    const b = await jsonBody(req);
    const action = String(b.action ?? '');
    try {
      if (action === 'link') {
        return { ok: true, url: `${APP_URL}/i/${await ensureInvoiceShareToken(ctx.scope, id)}` };
      }
      if (!ctx.permissions.has('invoice.create')) throw new V1Error('You do not have permission to change invoices.', 403);
      if (action === 'issue') {
        const r = await issueChecked(ctx, id);
        return { ok: true, held: r.held, message: r.message };
      }
      if (action === 'payment') {
        const method = METHODS.includes(String(b.method)) ? String(b.method) : 'cash';
        const r = await takePayment(ctx, id, {
          amountPaise: Math.round(Number(b.amountPaise) || 0), method,
          reference: str(b.reference, 120), note: str(b.note, 500),
        });
        return { ok: true, message: r.message, duePaise: r.duePaise };
      }
    } catch (e) {
      if (e instanceof V1Error) throw e;
      if (e instanceof Error && e.message.length < 200 && !/prisma|invocation/i.test(e.message)) throw new V1Error(e.message);
      throw e;
    }
    throw new V1Error('Unknown action.');
  });
}
