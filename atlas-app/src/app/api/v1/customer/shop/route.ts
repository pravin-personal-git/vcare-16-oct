import { customer } from '@/server/auth/v1-customer';
import { V1Error } from '@/server/auth/v1-staff';
import { db } from '@/server/db';
import { portalConfig } from '@/server/config';
import { publicShop, shopCategories } from '@/server/catalogue';
import { addToCart, setCartQty, submitRequest, viewCart } from '@/server/shop';

/**
 * The shop in Vcare, for a signed-in customer (3 Oct 2026, decision 9:
 * "public browse, on web AND in the app").
 *
 * The phone has no shop cookie, so its list is kept under a key made from the
 * customer's own id: the same list on every launch and every phone they sign
 * in on, and never anybody else's. Their business comes from their token,
 * never from the request.
 *
 * GET  -> what is on the shop, and their list
 * POST -> { action: 'add', kind, refId } | { action: 'qty', itemId, qty }
 *       | { action: 'send', message }   (buying only; a visit uses the app's
 *         own visit screen, which already captures the site location)
 */
const listKey = (partyId: string) => `app_${partyId}`;

async function shopOn(storeId: string) {
  if (!(await portalConfig(storeId)).on('portal.shop')) {
    throw new V1Error('The shop is not available for this business.', 403);
  }
}

export async function GET(req: Request) {
  return customer(req, async (c) => {
    await shopOn(c.storeId);
    const [items, list, store] = await Promise.all([
      publicShop(c.storeId),
      viewCart(c.storeId, listKey(c.partyId)),
      db.store.findUnique({ where: { id: c.storeId }, select: { organization: { select: { name: true } } } }),
    ]);
    return { business: store?.organization.name ?? '', items, categories: shopCategories(items), list };
  });
}

export async function POST(req: Request) {
  return customer(req, async (c) => {
    await shopOn(c.storeId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const key = listKey(c.partyId);

    if (body.action === 'add') {
      const kind = body.kind === 'combo' ? 'combo' : 'product';
      if (typeof body.refId !== 'string' || !body.refId) throw new V1Error('Choose something to add.', 400);
      try {
        await addToCart(c.storeId, key, { kind, refId: body.refId }, c.partyId);
      } catch (err) {
        throw new V1Error(err instanceof Error && !/prisma/i.test(err.message) ? err.message : 'Could not add that.', 400);
      }
    } else if (body.action === 'qty') {
      if (typeof body.itemId !== 'string') throw new V1Error('Which line?', 400);
      await setCartQty(c.storeId, key, body.itemId, Number(body.qty) || 0);
    } else if (body.action === 'send') {
      try {
        await submitRequest(c.storeId, {
          sessionKey: key, partyId: c.partyId, kind: 'product',
          message: typeof body.message === 'string' ? body.message : '',
        });
      } catch (err) {
        throw new V1Error(err instanceof Error && !/prisma/i.test(err.message) ? err.message : 'Could not send that.', 400);
      }
      return { ok: true, sent: true, list: null };
    } else {
      throw new V1Error('Unknown action.', 400);
    }
    return { ok: true, list: await viewCart(c.storeId, key) };
  });
}
