import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { FEED_MAX_ROWS, LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * Shop: reviews, wishlist, "people also viewed" and the "interested but did
 * not ask" list (5 Oct 2026, Pravin's shop brief).
 *
 * Reviews are written by a signed-in customer and shown only after the
 * business approves them - a shop that prints whatever is typed is a shop
 * with an "awful" review on the camera everyone is looking at. Wishlist works
 * without signing in, like the list. "Also viewed" and "interested" are read
 * from the events the shop already records (CatalogueEvent).
 */

export class ShopExtrasError extends Error {}

// ------------------------------------------------------------------ reviews

export interface PublicReview { id: string; authorName: string; rating: number; body: string | null; reply: string | null; createdAt: Date }
export interface ReviewSummary { average: number | null; count: number; reviews: PublicReview[] }

/** Approved reviews of one listing, newest first. */
export async function approvedReviews(storeId: string, listingId: string): Promise<ReviewSummary> {
  const rows = await db.productReview.findMany({
    where: { storeId, listingId, status: 'approved', deletedAt: null },
    orderBy: { createdAt: 'desc' }, take: FEED_MAX_ROWS,
    select: { id: true, authorName: true, rating: true, body: true, reply: true, createdAt: true },
  });
  const average = rows.length ? Math.round((rows.reduce((n, r) => n + r.rating, 0) / rows.length) * 10) / 10 : null;
  return { average, count: rows.length, reviews: rows };
}

/** Average and count per listing, for the cards on the shop. */
export async function ratingsByListing(storeId: string): Promise<Map<string, { average: number; count: number }>> {
  const rows = await db.productReview.groupBy({
    by: ['listingId'], where: { storeId, status: 'approved', deletedAt: null },
    _avg: { rating: true }, _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.listingId, { average: Math.round((r._avg.rating ?? 0) * 10) / 10, count: r._count._all }]));
}

/** The signed-in customer's own review of a listing, whatever its status. */
export async function myReview(storeId: string, listingId: string, partyId: string | null) {
  if (!partyId) return null;
  return db.productReview.findFirst({
    where: { storeId, listingId, partyId, deletedAt: null },
    select: { rating: true, body: true, status: true },
  });
}

/** Write or rewrite a review. It waits for the business's approval either way. */
export async function submitReview(storeId: string, input: { listingId: string; partyId: string; rating: number; body: string | null }) {
  const rating = Math.round(input.rating);
  if (!(rating >= 1 && rating <= 5)) throw new ShopExtrasError('Choose 1 to 5 stars.');
  const body = input.body?.trim().slice(0, 2000) || null;
  const listing = await db.catalogueListing.findFirst({ where: { id: input.listingId, storeId, isListed: true }, select: { id: true } });
  if (!listing) throw new ShopExtrasError('That product is no longer on the shop.');
  const party = await db.party.findFirst({ where: { id: input.partyId, storeId }, select: { firstName: true } });
  if (!party) throw new ShopExtrasError('Sign in to write a review.');
  // First name only on the shop - never a surname or a phone number.
  const authorName = (party.firstName || 'Customer').split(/\s+/)[0].slice(0, 40);
  await db.productReview.upsert({
    where: { listingId_partyId: { listingId: input.listingId, partyId: input.partyId } },
    create: { storeId, listingId: input.listingId, partyId: input.partyId, authorName, rating, body },
    update: { rating, body, authorName, status: 'pending', decidedAt: null, decidedBy: null, deletedAt: null },
  });
}

export interface AdminReview {
  id: string; listingId: string; productName: string; authorName: string; customerPhone: string | null;
  rating: number; body: string | null; status: string; reply: string | null; createdAt: Date;
}

/** Every review for the business, pending first. */
export async function reviewsForAdmin(scope: StoreScope): Promise<AdminReview[]> {
  const rows = await db.productReview.findMany({
    where: { ...scopeWhere(scope), deletedAt: null },
    orderBy: [{ createdAt: 'desc' }], take: LIST_MAX_ROWS,
    select: {
      id: true, listingId: true, authorName: true, rating: true, body: true, status: true, reply: true, createdAt: true,
      listing: { select: { headline: true, product: { select: { productName: true } } } },
      party: { select: { phone: true } },
    },
  });
  const rank: Record<string, number> = { pending: 0, approved: 1, hidden: 2 };
  return rows
    .map((r) => ({
      id: r.id, listingId: r.listingId, productName: r.listing.headline || r.listing.product.productName,
      authorName: r.authorName, customerPhone: r.party?.phone ?? null, rating: r.rating, body: r.body,
      status: r.status, reply: r.reply, createdAt: r.createdAt,
    }))
    .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || b.createdAt.getTime() - a.createdAt.getTime());
}

/** Approve, hide, or answer a review. */
export async function decideReview(scope: StoreScope, id: string, input: { status?: 'approved' | 'hidden'; reply?: string | null }, userId: string) {
  const storeId = scopeForWrite(scope);
  const r = await db.productReview.findFirst({ where: { id, storeId }, select: { id: true } });
  if (!r) throw new ShopExtrasError('That review is not in your scope.');
  await db.productReview.update({
    where: { id },
    data: {
      ...(input.status ? { status: input.status, decidedBy: userId, decidedAt: new Date() } : {}),
      ...(input.reply !== undefined ? { reply: input.reply?.trim().slice(0, 1000) || null } : {}),
    },
  });
}

// ------------------------------------------------------------------ wishlist

/** The listings this visitor has saved. */
export async function wishlistFor(storeId: string, sessionKey: string | null, partyId: string | null): Promise<Set<string>> {
  if (!sessionKey && !partyId) return new Set();
  const rows = await db.shopWishlist.findMany({
    where: { storeId, deletedAt: null, OR: [...(sessionKey ? [{ sessionKey }] : []), ...(partyId ? [{ partyId }] : [])] },
    select: { listingId: true },
  });
  return new Set(rows.map((r) => r.listingId));
}

/** Save or unsave. Returns whether it is now saved. */
export async function toggleWishlist(storeId: string, sessionKey: string, partyId: string | null, listingId: string): Promise<boolean> {
  const listing = await db.catalogueListing.findFirst({ where: { id: listingId, storeId }, select: { id: true } });
  if (!listing) throw new ShopExtrasError('That product is no longer on the shop.');
  const existing = await db.shopWishlist.findFirst({
    where: { storeId, listingId, OR: [{ sessionKey }, ...(partyId ? [{ partyId }] : [])] },
    select: { id: true, deletedAt: true },
  });
  if (existing && !existing.deletedAt) {
    await db.shopWishlist.update({ where: { id: existing.id }, data: { deletedAt: new Date(), deletedBy: partyId ?? 'visitor' } });
    return false;
  }
  if (existing) {
    await db.shopWishlist.update({ where: { id: existing.id }, data: { deletedAt: null, deletedBy: null, partyId: partyId ?? undefined } });
    return true;
  }
  await db.shopWishlist.create({ data: { storeId, sessionKey, partyId, listingId } });
  return true;
}

/** Most-saved listings, for the business. */
export async function mostWishlisted(storeId: string, take = 10): Promise<{ listingId: string; productName: string; saves: number }[]> {
  const rows = await db.shopWishlist.groupBy({
    by: ['listingId'], where: { storeId, deletedAt: null }, _count: { _all: true },
    orderBy: { _count: { listingId: 'desc' } }, take,
  });
  const names = await db.catalogueListing.findMany({
    where: { id: { in: rows.map((r) => r.listingId) } },
    select: { id: true, headline: true, product: { select: { productName: true } } },
  });
  const nameOf = new Map(names.map((n) => [n.id, n.headline || n.product.productName]));
  return rows.map((r) => ({ listingId: r.listingId, productName: nameOf.get(r.listingId) ?? '-', saves: r._count._all }));
}

// ------------------------------------------------------------------ also viewed

/**
 * "People who looked at this also looked at": other listings viewed in the
 * same shop sessions over the last 90 days, most shared first. Anonymous
 * views carry no session, so they cannot link two products and are left out.
 */
export async function alsoViewed(storeId: string, listingId: string, take = 8): Promise<string[]> {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const sessions = await db.catalogueEvent.findMany({
    where: { storeId, kind: 'view', listingId, at: { gte: since }, NOT: { sessionKey: 'anonymous' } },
    select: { sessionKey: true }, distinct: ['sessionKey'], take: FEED_MAX_ROWS,
  });
  if (!sessions.length) return [];
  const others = await db.catalogueEvent.groupBy({
    by: ['listingId'],
    where: { storeId, kind: 'view', at: { gte: since }, sessionKey: { in: sessions.map((s) => s.sessionKey) }, listingId: { not: null }, NOT: { listingId } },
    _count: { _all: true }, orderBy: { _count: { listingId: 'desc' } }, take,
  });
  return others.map((o) => o.listingId).filter((id): id is string => !!id);
}

// ------------------------------------------------------------------ interested, did not ask

export interface InterestedRow {
  partyId: string; name: string; phone: string | null;
  looked: string[]; added: string[]; saved: string[]; lastSeen: Date;
}

/**
 * Registered customers who looked at products, added them or saved them in
 * the last N days and did NOT send an enquiry afterwards - the people worth a
 * call. Anonymous visitors are counted on the shop figures, never named.
 */
export async function interestedNoEnquiry(storeId: string, days = 30): Promise<InterestedRow[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const events = await db.catalogueEvent.findMany({
    where: { storeId, at: { gte: since }, partyId: { not: null }, kind: { in: ['view', 'add', 'request'] } },
    select: { partyId: true, kind: true, listingId: true, at: true }, orderBy: { at: 'asc' }, take: LIST_MAX_ROWS,
  });
  const saves = await db.shopWishlist.findMany({
    where: { storeId, deletedAt: null, partyId: { not: null }, createdAt: { gte: since } },
    select: { partyId: true, listingId: true, createdAt: true },
  });
  const per = new Map<string, { looked: Set<string>; added: Set<string>; saved: Set<string>; lastInterest: Date; lastRequest: Date | null }>();
  const row = (id: string) => {
    let r = per.get(id);
    if (!r) { r = { looked: new Set(), added: new Set(), saved: new Set(), lastInterest: new Date(0), lastRequest: null }; per.set(id, r); }
    return r;
  };
  for (const e of events) {
    const r = row(e.partyId!);
    if (e.kind === 'request') { r.lastRequest = e.at; continue; }
    if (e.listingId) (e.kind === 'add' ? r.added : r.looked).add(e.listingId);
    if (e.at > r.lastInterest) r.lastInterest = e.at;
  }
  for (const w of saves) {
    const r = row(w.partyId!);
    r.saved.add(w.listingId);
    if (w.createdAt > r.lastInterest) r.lastInterest = w.createdAt;
  }
  const keep = [...per.entries()].filter(([, r]) => r.lastInterest.getTime() > 0 && (!r.lastRequest || r.lastRequest < r.lastInterest));
  if (!keep.length) return [];
  const parties = await db.party.findMany({
    where: { id: { in: keep.map(([id]) => id) }, storeId },
    select: { id: true, firstName: true, lastName: true, companyName: true, phone: true },
  });
  const listingIds = [...new Set(keep.flatMap(([, r]) => [...r.looked, ...r.added, ...r.saved]))];
  const names = await db.catalogueListing.findMany({
    where: { id: { in: listingIds } }, select: { id: true, headline: true, product: { select: { productName: true } } },
  });
  const nameOf = new Map(names.map((n) => [n.id, n.headline || n.product.productName]));
  const pOf = new Map(parties.map((p) => [p.id, p]));
  const label = (ids: Set<string>) => [...ids].map((i) => nameOf.get(i)).filter((x): x is string => !!x);
  return keep
    .filter(([id]) => pOf.has(id))
    .map(([id, r]) => {
      const p = pOf.get(id)!;
      return {
        partyId: id, name: p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' '), phone: p.phone,
        looked: label(r.looked), added: label(r.added), saved: label(r.saved), lastSeen: r.lastInterest,
      };
    })
    .sort((a, b) => b.added.length - a.added.length || b.saved.length - a.saved.length || b.lastSeen.getTime() - a.lastSeen.getTime());
}

// ------------------------------------------------------------------ product page

export interface ProductExtras {
  reviews: ReviewSummary;
  mine: { rating: number; body: string | null; status: string } | null;
  canReview: boolean;
  saved: boolean;
  /** Same brand or section, nearest in price - "Similar". */
  similar: string[];
  /** Viewed in the same visits - "People also viewed". */
  alsoViewed: string[];
}

/**
 * Everything the product page adds around the product itself. Takes the
 * whole shop list (already loaded by the page) so "Similar" needs no query.
 */
export async function productExtras(
  shop: { store: { id: string }; sessionKey: string | null; partyId: string | null },
  item: { id: string; kind: string; categoryName: string | null; brandName: string | null; pricePaise: number },
  items: { id: string; kind: string; categoryName: string | null; brandName: string | null; pricePaise: number }[],
): Promise<ProductExtras> {
  const isProduct = item.kind === 'product';
  const [reviews, mine, saved, viewed] = await Promise.all([
    isProduct ? approvedReviews(shop.store.id, item.id) : Promise.resolve({ average: null, count: 0, reviews: [] }),
    isProduct ? myReview(shop.store.id, item.id, shop.partyId) : Promise.resolve(null),
    isProduct ? wishlistFor(shop.store.id, shop.sessionKey, shop.partyId) : Promise.resolve(new Set<string>()),
    isProduct ? alsoViewed(shop.store.id, item.id) : Promise.resolve([] as string[]),
  ]);
  const onShop = new Set(items.map((i) => i.id));
  const similar = items
    .filter((i) => i.id !== item.id && (i.categoryName === item.categoryName || (!!item.brandName && i.brandName === item.brandName)))
    .map((i) => ({ id: i.id, score: (i.categoryName === item.categoryName ? 0 : 1) + Math.abs(i.pricePaise - item.pricePaise) / Math.max(1, item.pricePaise) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 8)
    .map((x) => x.id);
  return {
    reviews, mine, canReview: isProduct && !!shop.partyId, saved: saved.has(item.id), similar,
    alsoViewed: viewed.filter((id) => onShop.has(id) && !similar.includes(id)).slice(0, 8),
  };
}
