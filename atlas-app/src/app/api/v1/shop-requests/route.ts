import { field, jsonBody, str, V1Error } from '@/server/auth/v1-staff';
import { pickUpRequest, ShopRequestError, shopRequests } from '@/server/shop-requests';

/**
 * Shop requests on the phone (13 Oct 2026): the same list as the website's
 * Sales > Shop requests (server/shop-requests), and "I'll take it" on a buy
 * request (its lead becomes yours - Leads: create or edit).
 */
const SEE = ['leads.view', 'leads.edit', 'leads.create', 'complaints.view', 'complaints.edit'];

export async function GET(req: Request) {
  return field(req, SEE, null, async (ctx) => ({
    requests: await shopRequests(ctx.scope),
    canPickUp: ctx.permissions.has('leads.edit') || ctx.permissions.has('leads.create'),
  }));
}

export async function POST(req: Request) {
  return field(req, ['leads.edit', 'leads.create'], null, async (ctx) => {
    const b = await jsonBody(req);
    const id = str(b.id, 40);
    if (!id) throw new V1Error('Choose a request.');
    try {
      const r = await pickUpRequest(ctx.scope, id, ctx.user.id);
      return { ok: true, leadId: r.leadId, message: 'It is yours - ring them with a quote.' };
    } catch (e) {
      if (e instanceof ShopRequestError) throw new V1Error(e.message);
      throw e;
    }
  });
}
