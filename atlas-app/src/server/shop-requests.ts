import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { notify, ownersOf, usersWithAnyPermission } from './notify';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { publicShop } from './catalogue';

/**
 * WHAT CUSTOMERS ASKED FOR IN THE ONLINE SHOP (13 Oct 2026, Pravin: "no one
 * ever knows what the customer requested").
 *
 * The shop's "My list" already turned a request into a LEAD ("I want to buy
 * these") or a COMPLAINT ("I need a visit") - server/shop `submitRequest`,
 * decision 10 - but told nobody, left the lead with no owner and no source,
 * and the only place to see it was an activity block on the Catalogue page.
 *
 * Now:
 *  - the moment it arrives, the owner + everyone who works leads (buy) or
 *    assigns complaints (visit) is told - bell and phone (`announce`);
 *  - one list of every request with what it became and who has it
 *    (`shopRequests`) - website Sales > Shop requests, and the phone;
 *  - a salesperson "picks up" a buy request, which makes the lead theirs
 *    (`pickUpRequest`); a visit is assigned from the Service board as any job.
 */
export type RequestKind = 'buy' | 'visit';
export type RequestState = 'new' | 'picked' | 'closed';

export interface ShopRequestRow {
  id: string; kind: RequestKind; at: string;
  customer: { id: string | null; name: string; phone: string | null };
  items: { name: string; qty: number }[];
  goodsPaise: number; message: string | null;
  state: RequestState;
  /** Who has it: the lead's owner, or the complaint's technician. */
  ownerName: string | null;
  lead: { id: string; code: string } | null;
  complaint: { id: string; no: string; status: string } | null;
}

const partyName = (p: { companyName: string | null; firstName: string | null; lastName: string | null } | null) =>
  p ? (p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Customer') : 'Customer';

/** Bell + phone for the people who must act on a new request (decision 13 Oct: buy -> owner + leads; visit -> owner + service desk). */
export async function announce(storeId: string, input: {
  cartId: string; kind: RequestKind; customerName: string; items: string; goodsPaise: number; message: string | null;
  href: string;
}) {
  const people = [
    ...await ownersOf(storeId),
    ...await usersWithAnyPermission(storeId, input.kind === 'buy' ? ['leads.edit', 'leads.create'] : ['complaints.edit']),
  ];
  const what = input.kind === 'buy'
    ? `wants to buy${input.items ? `: ${input.items.replace(/\n/g, ', ')}` : ''}${input.goodsPaise ? ` (₹${(input.goodsPaise / 100).toLocaleString('en-IN')})` : ''}`
    : `needs a visit${input.message ? `: ${input.message}` : ''}`;
  await notify({
    storeId, userIds: people, kind: 'shop_request',
    title: `Online shop: ${input.customerName} ${input.kind === 'buy' ? 'wants a quote' : 'needs a visit'}`,
    body: `${input.customerName} ${what}`.slice(0, 900),
    href: input.href, entityType: 'cart', entityId: input.cartId,
    dedupeKey: `shop-request:${input.cartId}`,
  });
}

/** The "Online shop" lead source for a branch - made the first time it is needed. */
export async function onlineShopSource(storeId: string): Promise<string> {
  const found = await db.leadSource.findFirst({ where: { storeId, name: 'Online shop' }, select: { id: true } });
  if (found) return found.id;
  return (await db.leadSource.create({ data: { storeId, name: 'Online shop', isActive: true }, select: { id: true } })).id;
}

export async function shopRequests(scope: StoreScope): Promise<ShopRequestRow[]> {
  const carts = await db.cart.findMany({
    where: { ...scopeWhere(scope), status: 'requested' },
    orderBy: { requestedAt: 'desc' },
    take: LIST_MAX_ROWS,
    select: {
      id: true, storeId: true, requestedAt: true, createdAt: true, message: true, leadId: true, complaintId: true,
      party: { select: { id: true, companyName: true, firstName: true, lastName: true, phone: true } },
      items: { select: { qty: true, listingId: true, comboId: true } },
      lead: { select: { id: true, leadCode: true, isClosed: true, assignedToUserId: true } },
      complaint: { select: { id: true, complaintNo: true, status: true, assignedTechnicianId: true } },
    },
  });
  const ids = [...new Set(carts.flatMap((c) => [c.lead?.assignedToUserId, c.complaint?.assignedTechnicianId]).filter((x): x is string => !!x))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.fullName]));
  // Named and priced the way the shop names and prices them (server/shop publicShop), as the customer saw them.
  const shops = new Map<string, Map<string, { name: string; pricePaise: number }>>();
  for (const storeId of new Set(carts.map((c) => c.storeId))) {
    shops.set(storeId, new Map((await publicShop(storeId)).map((i) => [i.id, { name: i.name, pricePaise: i.pricePaise }])));
  }

  return carts.map((c) => {
    const kind: RequestKind = c.complaintId ? 'visit' : 'buy';
    const owner = kind === 'buy' ? c.lead?.assignedToUserId : c.complaint?.assignedTechnicianId;
    const closed = kind === 'buy' ? !!c.lead?.isClosed : ['resolved', 'closed', 'cancelled'].includes(c.complaint?.status ?? '');
    return {
      id: c.id, kind, at: (c.requestedAt ?? c.createdAt).toISOString(),
      customer: { id: c.party?.id ?? null, name: partyName(c.party), phone: c.party?.phone ?? null },
      items: c.items.map((i) => ({ name: shops.get(c.storeId)?.get(i.listingId ?? i.comboId ?? '')?.name ?? 'Item no longer in the shop', qty: i.qty })),
      goodsPaise: c.items.reduce((n, i) => n + i.qty * (shops.get(c.storeId)?.get(i.listingId ?? i.comboId ?? '')?.pricePaise ?? 0), 0),
      message: c.message,
      state: closed ? 'closed' : owner ? 'picked' : 'new',
      ownerName: owner ? nameOf.get(owner) ?? null : null,
      lead: c.lead ? { id: c.lead.id, code: c.lead.leadCode } : null,
      complaint: c.complaint ? { id: c.complaint.id, no: c.complaint.complaintNo, status: c.complaint.status } : null,
    };
  });
}

export class ShopRequestError extends Error {}

/** "I'll take it": a buy request's lead becomes this person's. First one wins. */
export async function pickUpRequest(scope: StoreScope, cartId: string, userId: string) {
  const cart = await db.cart.findFirst({
    where: { id: cartId, ...scopeWhere(scope), status: 'requested' },
    select: { leadId: true, complaintId: true, lead: { select: { assignedToUserId: true } } },
  });
  if (!cart) throw new ShopRequestError('That request is not in this branch.');
  if (cart.complaintId || !cart.leadId) throw new ShopRequestError('A visit request is assigned from the Service board, like any job.');
  if (cart.lead?.assignedToUserId && cart.lead.assignedToUserId !== userId) {
    const who = await db.user.findUnique({ where: { id: cart.lead.assignedToUserId }, select: { fullName: true } });
    throw new ShopRequestError(`${who?.fullName ?? 'Someone'} has already picked this up.`);
  }
  // Only while nobody has it - two people tapping at once cannot both win.
  const moved = await db.lead.updateMany({ where: { id: cart.leadId, OR: [{ assignedToUserId: null }, { assignedToUserId: userId }] }, data: { assignedToUserId: userId } });
  if (moved.count !== 1) throw new ShopRequestError('Someone else picked this up a moment ago.');
  return { leadId: cart.leadId };
}

/** How many requests nobody has picked up yet - the owner's home card and the Leads banner. */
export async function newShopRequestCount(scope: StoreScope): Promise<number> {
  return (await shopRequests(scope)).filter((r) => r.state === 'new').length;
}
