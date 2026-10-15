import 'server-only';
import { db } from './db';
import { createLead } from './leads';
import { createPortalComplaint } from './portal';
import { publicShop, type ShopItem } from './catalogue';
import { announce, onlineShopSource } from './shop-requests';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * The basket, and what it turns into.
 *
 * Decision 10, in Pravin's words: a request for a NEW PRODUCT is a Lead - even
 * from an existing customer - and a SERVICE REQUEST becomes a complaint
 * challan. There is no payment portal and there will not be one for now.
 *
 * ---------------------------------------------------------------------------
 * WHY A CART IS A ROW AND NOT A COOKIE
 *
 * Because Pravin asked to see abandoned carts. A basket that lives in the
 * browser is a basket nobody can report on, and "what did people nearly buy"
 * is the question being asked. That single requirement is the reason for every
 * table in this file.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE TAKES A `StoreScope`
 *
 * There is no staff session on a shop page. The caller resolves which shop
 * this is - one client, one deployment, one organisation - and passes a plain
 * `storeId`. Every query then names it explicitly, which is the same guarantee
 * `scopeWhere` gives elsewhere, written out by hand because there is nobody to
 * derive it from.
 */

/** A browser's own id. Long enough that two visitors never collide. */
export function newSessionKey(): string {
  return `s_${crypto.randomUUID().replace(/-/g, '')}`;
}

/* -------------------------------------------------------------------------- */
/*  The basket                                                                */
/* -------------------------------------------------------------------------- */

export interface CartLine {
  id: string;
  kind: 'product' | 'combo';
  refId: string;
  name: string;
  qty: number;
  pricePaise: number;
  imageUrl: string | null;
}

export interface CartView {
  id: string;
  status: string;
  lines: CartLine[];
  /**
   * What the goods come to. NOT a total to pay: decision 11 says the catalogue
   * shows the product price and installation is quoted separately, so calling
   * this a total would be the one number a customer remembers and the one
   * nobody agreed to.
   */
  goodsPaise: number;
}

async function cartRow(storeId: string, sessionKey: string) {
  return db.cart.findFirst({
    where: { storeId, sessionKey, status: 'open' },
    select: { id: true, status: true, partyId: true },
  });
}

/** The open basket for this browser, made on demand. */
export async function openCart(storeId: string, sessionKey: string, partyId?: string | null) {
  const existing = await cartRow(storeId, sessionKey);
  if (existing) {
    // Registering mid-browse: the basket they already built becomes theirs.
    // Without this the shop would quietly empty at exactly the moment somebody
    // finally committed to it.
    if (partyId && !existing.partyId) {
      await db.cart.update({ where: { id: existing.id }, data: { partyId } });
    }
    return existing;
  }

  /**
   * The browser's key is unique per store, so a basket that is no longer open
   * still holds it (3 Oct 2026). Before this, a customer who sent one list
   * could never start another - the next "Add" died on the unique index - and
   * neither could anybody whose basket had been swept as abandoned.
   *
   *   - abandoned: they came back. Reopen it, items and all; nothing was lost
   *     and nothing was asked for.
   *   - requested (or anything else): it is history now - a lead or a
   *     complaint points at it. It gives up the key and keeps everything else,
   *     and a fresh basket starts.
   */
  const stale = await db.cart.findFirst({
    where: { storeId, sessionKey, status: { not: 'open' } },
    select: { id: true, status: true, partyId: true },
  });
  if (stale?.status === 'abandoned') {
    return db.cart.update({
      where: { id: stale.id },
      data: { status: 'open', abandonedAt: null, ...(partyId && !stale.partyId ? { partyId } : {}) },
      select: { id: true, status: true, partyId: true },
    });
  }
  if (stale) {
    await db.cart.update({ where: { id: stale.id }, data: { sessionKey: `${sessionKey}~${stale.id}` } });
  }

  return db.cart.create({
    data: { storeId, sessionKey, partyId: partyId ?? null },
    select: { id: true, status: true, partyId: true },
  });
}

export async function viewCart(storeId: string, sessionKey: string): Promise<CartView | null> {
  const cart = await db.cart.findFirst({
    where: { storeId, sessionKey, status: 'open' },
    select: {
      id: true, status: true,
      items: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, qty: true, listingId: true, comboId: true },
      },
    },
  });
  if (!cart) return null;

  // Priced from the same place the shop prices things, rather than from
  // anything stored on the line. A basket kept overnight should show today's
  // price, not a figure frozen when somebody clicked.
  const shop = await publicShop(storeId);
  const byId = new Map(shop.map((i) => [i.id, i]));

  const lines: CartLine[] = [];
  for (const item of cart.items) {
    const refId = item.listingId ?? item.comboId;
    const subject = refId ? byId.get(refId) : undefined;
    // A line whose listing has since been taken off the shop is skipped rather
    // than shown as a blank row. It is removed on the next write.
    if (!refId || !subject) continue;
    lines.push({
      id: item.id,
      kind: item.listingId ? 'product' : 'combo',
      refId,
      name: subject.name,
      qty: item.qty,
      pricePaise: subject.pricePaise,
      imageUrl: subject.imageUrls[0] ?? null,
    });
  }

  return {
    id: cart.id,
    status: cart.status,
    lines,
    goodsPaise: lines.reduce((t, l) => t + l.qty * l.pricePaise, 0),
  };
}

export async function addToCart(
  storeId: string,
  sessionKey: string,
  input: { kind: 'product' | 'combo'; refId: string; qty?: number },
  partyId?: string | null,
) {
  const qty = Math.max(1, Math.min(99, Math.floor(input.qty ?? 1)));

  // Checked against what is actually ON the shop, not just what exists. A
  // listing that was taken down this morning must not be addable from a page
  // somebody left open last night.
  const live = input.kind === 'product'
    ? await db.catalogueListing.findFirst({
      where: { id: input.refId, storeId, isListed: true }, select: { id: true },
    })
    : await db.catalogueCombo.findFirst({
      where: { id: input.refId, storeId, isListed: true }, select: { id: true },
    });
  if (!live) throw new Error('That is no longer available.');

  const cart = await openCart(storeId, sessionKey, partyId);

  const where = input.kind === 'product'
    ? { cartId: cart.id, listingId: input.refId }
    : { cartId: cart.id, comboId: input.refId };
  const already = await db.cartItem.findFirst({ where, select: { id: true, qty: true } });

  if (already) {
    await db.cartItem.update({
      where: { id: already.id },
      data: { qty: Math.min(99, already.qty + qty) },
    });
  } else {
    await db.cartItem.create({
      data: {
        cartId: cart.id,
        listingId: input.kind === 'product' ? input.refId : null,
        comboId: input.kind === 'combo' ? input.refId : null,
        qty,
      },
    });
  }

  await recordEvent(storeId, {
    kind: 'add', sessionKey, partyId,
    listingId: input.kind === 'product' ? input.refId : null,
    comboId: input.kind === 'combo' ? input.refId : null,
    cartId: cart.id,
  });
  return cart.id;
}

export async function removeFromCart(storeId: string, sessionKey: string, itemId: string) {
  const item = await db.cartItem.findFirst({
    where: { id: itemId, cart: { storeId, sessionKey, status: 'open' } },
    select: { id: true, cartId: true, listingId: true, comboId: true },
  });
  if (!item) return;
  // A basket line genuinely goes away - it is not a record of anything that
  // happened, it is a thing somebody changed their mind about. The `remove`
  // event below is what keeps the fact that they did.
  await db.cartItem.delete({ where: { id: itemId } });
  await recordEvent(storeId, {
    kind: 'remove', sessionKey,
    listingId: item.listingId, comboId: item.comboId, cartId: item.cartId,
  });
}

/** Set how many of a line are on the list. Nought takes it off. */
export async function setCartQty(storeId: string, sessionKey: string, itemId: string, qty: number) {
  const n = Math.floor(qty);
  if (n <= 0) return removeFromCart(storeId, sessionKey, itemId);
  const item = await db.cartItem.findFirst({
    where: { id: itemId, cart: { storeId, sessionKey, status: 'open' } },
    select: { id: true },
  });
  if (!item) return;
  await db.cartItem.update({ where: { id: itemId }, data: { qty: Math.min(99, n) } });
}

/* -------------------------------------------------------------------------- */
/*  Asking for something                                                      */
/* -------------------------------------------------------------------------- */

export interface RequestInput {
  sessionKey: string;
  partyId: string;
  /** product = they want to buy. service = they want somebody to come out. */
  kind: 'product' | 'service';
  message: string;
  /**
   * Where the visit is. Mandatory for a service request: every complaint
   * carries coordinates (18 Sep 2026) because the technician's check-in is
   * matched against them.
   */
  location?: { lat: number; lng: number; source: 'gps' | 'maps_link' } | null;
}

/**
 * Turn a basket into a request.
 *
 * Decision 10, exactly as Pravin put it: a request for a new product is a LEAD,
 * "even if it is from an existing customer or a completely new customer"; a
 * service request becomes a COMPLAINT.
 *
 * The reason that distinction is drawn here rather than left to whoever picks
 * it up: a lead and a complaint are chased by different people, measured
 * differently, and answered in different timescales. Dropping both into one
 * inbox and letting somebody sort them means the sorting does not happen on the
 * day the shop is busy.
 *
 * NO PAYMENT. The basket is a conversation starter, and what the customer
 * actually pays is settled on a quotation by a person who knows what the
 * installation costs.
 */
const partyLabel = (p: { companyName: string | null; firstName: string | null; lastName: string | null }) =>
  p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' ') || 'A customer';

export async function submitRequest(storeId: string, input: RequestInput) {
  const found = await db.cart.findFirst({
    where: { storeId, sessionKey: input.sessionKey, status: 'open' },
    select: { id: true, items: { select: { id: true } } },
  });
  // A visit needs no list (13 Oct 2026): "my camera is dead" from somebody who
  // never added anything has no basket yet, and used to be told "There is
  // nothing to send" - no visit request from the shop ever got through.
  if (!found && input.kind !== 'service') throw new Error('There is nothing to send.');

  const message = input.message.trim();
  // A service request can be empty of products - "my camera is dead" needs no
  // basket. A product request cannot: it would reach the branch saying only
  // that somebody wants something.
  if (input.kind === 'product' && (found?.items.length ?? 0) === 0) {
    throw new Error('Add something to your list first.');
  }
  if (input.kind === 'service' && !message) {
    throw new Error('Tell us what is wrong, so somebody arrives knowing what to bring.');
  }
  if (input.kind === 'service' && !input.location) {
    throw new Error('Share where the visit is - your location, or a Maps link.');
  }

  const party = await db.party.findFirst({
    where: { id: input.partyId, storeId },
    select: {
      id: true, companyName: true, firstName: true, lastName: true, title: true,
      phone: true, email: true, addressLine1: true, city: true, state: true,
    },
  });
  if (!party) throw new Error('We could not find your account.');
  const cart = found ?? await openCart(storeId, input.sessionKey, party.id);

  const view = await viewCart(storeId, input.sessionKey);
  const basket = (view?.lines ?? []).map((l) => `${l.qty} × ${l.name}`).join('\n');

  if (input.kind === 'service') {
    /**
     * The same function the customer portal uses, not a second path.
     *
     * It already refuses when the client has switched self-service off, and
     * already checks a named product against what this party actually bought.
     * A shop-side copy would have to be told both of those things again, and
     * would stop being told the day somebody changes one of them.
     *
     * The site's coordinates are asked for on the list page (3 Oct 2026).
     * Before that this passed 0,0 and every visit request from the shop was
     * refused by the complaint rule that coordinates are mandatory - the
     * customer was told to share a location on a page that had no way to.
     */
    const complaintId = await createPortalComplaint(party.id, storeId, {
      productId: null,
      siteLocation: [party.addressLine1, party.city].filter(Boolean).join(', ') || null,
      siteLat: input.location!.lat,
      siteLng: input.location!.lng,
      siteSource: input.location!.source,
      description: [message, basket && `About:\n${basket}`].filter(Boolean).join('\n\n'),
      customFields: {},
    });
    await db.cart.update({
      where: { id: cart.id },
      data: { status: 'requested', requestedAt: new Date(), message, complaintId, partyId: party.id },
    });
    await recordEvent(storeId, { kind: 'request', sessionKey: input.sessionKey, partyId: party.id, cartId: cart.id });
    // Somebody must know (13 Oct 2026): the owner and the service desk, bell + phone.
    await announce(storeId, {
      cartId: cart.id, kind: 'visit', customerName: partyLabel(party), items: basket, goodsPaise: view?.goodsPaise ?? 0,
      message, href: '/sales/shop-requests',
    }).catch((e) => console.error('[shop] visit request alert failed', e));
    return { kind: 'service' as const };
  }

  const lead = await createLead({ kind: 'single', storeId, writable: true }, {
    businessName: party.companyName,
    gstin: null,
    title: party.title,
    firstName: party.firstName || party.companyName || 'Shop visitor',
    lastName: party.lastName,
    designation: null,
    mobile: party.phone,
    altMobile: null,
    email: party.email,
    addressLine1: party.addressLine1,
    addressLine2: null,
    state: party.state,
    city: party.city,
    pincode: null,
    refCode: null,
    dealStageId: null,
    stageId: null,
    // Marked as the shop's, so Leads can tell where it came from (13 Oct 2026).
    sourceId: await onlineShopSource(storeId),
    assignedToUserId: null,
    // What they actually asked for, in the shape somebody picking this up needs
    // to read in five seconds.
    requirement: basket || message,
    notes: [message, 'Raised from the online catalogue.'].filter(Boolean).join('\n'),
    potentialPaise: view?.goodsPaise ?? 0,
    lastTalkAt: null,
    // Nobody has promised to ring them yet. A date here would put an action in
    // somebody's diary that they never agreed to and will not be expecting.
    nextActionAt: null,
    tags: [],
    latitude: null,
    longitude: null,
    locationNote: null,
  });

  /**
   * Which lead this request is now (3 Oct 2026). `createLead` returns
   * `{ lead, duplicateOf, rejected }`; this used to read `.id` off that
   * wrapper, so every request was saved with no lead behind it.
   *
   * And when the business refuses a second lead on the same mobile
   * (LeadPolicy.allowDuplicateMobile = false), NO lead is made - the request
   * used to vanish while the customer was told "Sent". It now joins their
   * existing lead as a note, so a repeat customer's request still reaches
   * somebody.
   */
  let leadId = lead.lead?.id ?? null;
  if (!leadId && lead.rejected) {
    const existing = await db.lead.findFirst({
      where: { storeId, leadCode: lead.duplicateOf },
      select: { id: true },
    });
    if (!existing) throw new Error('Your request could not be recorded. Please ring the branch.');
    await db.leadNote.create({
      data: {
        leadId: existing.id,
        kind: 'note',
        body: ['New request from the online shop:', basket, message].filter(Boolean).join('\n'),
      },
    });
    leadId = existing.id;
  }

  await db.cart.update({
    where: { id: cart.id },
    data: {
      status: 'requested', requestedAt: new Date(), message, leadId,
      // A basket built before signing in carries no name until now.
      partyId: party.id,
    },
  });
  await recordEvent(storeId, { kind: 'request', sessionKey: input.sessionKey, partyId: party.id, cartId: cart.id });
  // Somebody must know (13 Oct 2026): the owner and everyone who works leads - first to pick it up takes it.
  await announce(storeId, {
    cartId: cart.id, kind: 'buy', customerName: partyLabel(party), items: basket, goodsPaise: view?.goodsPaise ?? 0,
    message: message || null, href: '/sales/shop-requests',
  }).catch((e) => console.error('[shop] buy request alert failed', e));
  return { kind: 'product' as const };
}

/* -------------------------------------------------------------------------- */
/*  What people did                                                           */
/* -------------------------------------------------------------------------- */

export async function recordEvent(storeId: string, e: {
  kind: string;
  sessionKey: string;
  partyId?: string | null;
  listingId?: string | null;
  comboId?: string | null;
  cartId?: string | null;
}) {
  // Never allowed to break a page. A shop that will not show a camera because
  // its analytics write failed is worse than a shop with a gap in its figures.
  await db.catalogueEvent.create({
    data: {
      storeId, kind: e.kind, sessionKey: e.sessionKey, partyId: e.partyId ?? null,
      listingId: e.listingId ?? null, comboId: e.comboId ?? null, cartId: e.cartId ?? null,
    },
  }).catch((err) => console.error('[shop] event write failed (non-fatal)', err));
}

/**
 * Mark baskets nobody came back to.
 *
 * Run by the nightly cron. The cut-off is deliberately generous: somebody
 * filling a basket on Friday and ringing on Monday has not abandoned anything,
 * and a shop that writes them off after an hour produces a report full of
 * people who did buy.
 */
export async function sweepAbandonedCarts(storeId: string, olderThanHours = 48) {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const stale = await db.cart.findMany({
    where: { storeId, status: 'open', updatedAt: { lt: cutoff }, items: { some: {} } },
    select: { id: true, sessionKey: true },
    take: LIST_MAX_ROWS,
  });
  if (stale.length === 0) return { marked: 0 };

  await db.cart.updateMany({
    where: { id: { in: stale.map((c) => c.id) }, storeId },
    data: { status: 'abandoned', abandonedAt: new Date() },
  });
  for (const c of stale) {
    await recordEvent(storeId, { kind: 'abandon', sessionKey: c.sessionKey, cartId: c.id });
  }
  return { marked: stale.length };
}

export interface AbandonedCartRow {
  id: string;
  abandonedAt: Date | null;
  customerName: string | null;
  phone: string | null;
  lines: string[];
  goodsPaise: number;
}

/**
 * What people nearly bought.
 *
 * Shown with a name where there is one. An anonymous basket is still worth
 * seeing - three people abandoning the same camera says something about that
 * camera - but it is not somebody to ring.
 */
export async function abandonedCarts(storeId: string): Promise<AbandonedCartRow[]> {
  const carts = await db.cart.findMany({
    where: { storeId, status: 'abandoned' },
    orderBy: { abandonedAt: 'desc' },
    take: LIST_MAX_ROWS,
    select: {
      id: true, abandonedAt: true,
      party: { select: { companyName: true, firstName: true, lastName: true, phone: true } },
      items: { select: { qty: true, listingId: true, comboId: true } },
    },
  });

  const shop = await publicShop(storeId);
  const byId = new Map(shop.map((i: ShopItem) => [i.id, i]));

  return carts.map((c) => {
    const lines = c.items.map((i) => {
      const subject = byId.get(i.listingId ?? i.comboId ?? '');
      return { name: subject?.name ?? 'No longer listed', qty: i.qty, price: subject?.pricePaise ?? 0 };
    });
    return {
      id: c.id,
      abandonedAt: c.abandonedAt,
      customerName: c.party
        ? c.party.companyName || [c.party.firstName, c.party.lastName].filter(Boolean).join(' ')
        : null,
      phone: c.party?.phone ?? null,
      lines: lines.map((l) => `${l.qty} × ${l.name}`),
      goodsPaise: lines.reduce((t, l) => t + l.qty * l.price, 0),
    };
  });
}

/** How the shop is doing, over a window. Counts only - no personal trail. */
export async function shopActivity(storeId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.catalogueEvent.groupBy({
    by: ['kind'],
    where: { storeId, at: { gte: since } },
    _count: { _all: true },
  });
  const by = new Map(rows.map((r) => [r.kind, r._count._all]));

  const views = by.get('view') ?? 0;
  const requests = by.get('request') ?? 0;
  return {
    days,
    views,
    adds: by.get('add') ?? 0,
    requests,
    abandoned: by.get('abandon') ?? 0,
    registrations: by.get('register') ?? 0,
    /**
     * Requests per hundred views. Stated as a plain ratio rather than dressed
     * up as a conversion rate, because a request is not a sale and nobody
     * should start reporting it as one.
     */
    requestsPerHundredViews: views > 0 ? Math.round((requests / views) * 1000) / 10 : 0,
  };
}
