'use server';

import { revalidatePath } from 'next/cache';
import { getShopContext, ensureSessionKey, type ShopRef } from '@/server/shop-context';
import { addToCart, recordEvent, setCartQty, submitRequest } from '@/server/shop';
import { submitReview, toggleWishlist } from '@/server/shop-extras';

export interface ShopState {
  error?: string;
  ok?: boolean;
  message?: string;
}

/**
 * Everything here is PUBLIC. There is no staff session and no permission to
 * check, so each action resolves the shop itself and names its store
 * explicitly - the same guarantee `scopeWhere` gives elsewhere, written out by
 * hand because there is nobody to derive it from.
 *
 * Which shop is passed as a `ShopRef` - a business's short name, or "the
 * portal", which means the signed-in customer's own business. The reference is
 * resolved again on the server every time; nothing the browser sends decides
 * which store is written to.
 *
 * The only thing that needs an identity is asking for something, and that is
 * checked against a real portal login rather than the browser key.
 */

/**
 * What a customer may read when something fails. The shop's own messages are
 * written for them ("That is no longer available."); a database error is not,
 * and once showed a customer a Prisma stack line. Those are logged and replaced.
 */
function said(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : '';
  if (!msg || /prisma|invocation|constraint|ECONN|timeout/i.test(msg)) {
    console.error('[shop] action failed', err);
    return fallback;
  }
  return msg;
}

async function shopFor(ref: ShopRef) {
  const shop = await getShopContext(ref);
  if (!shop) throw new Error('This shop is not open.');
  return shop;
}

export async function addAction(ref: ShopRef, kind: 'product' | 'combo', refId: string): Promise<ShopState> {
  try {
    const shop = await shopFor(ref);
    const sessionKey = await ensureSessionKey();
    await addToCart(shop.store.id, sessionKey, { kind, refId }, shop.partyId);
    revalidatePath(shop.base, 'layout');
    return { ok: true, message: 'Added to your list.' };
  } catch (err) {
    return { error: said(err, 'Could not add that.') };
  }
}

export async function setQtyAction(ref: ShopRef, itemId: string, qty: number): Promise<ShopState> {
  try {
    const shop = await shopFor(ref);
    if (!shop.sessionKey) return { error: 'Your list has expired.' };
    await setCartQty(shop.store.id, shop.sessionKey, itemId, qty);
    revalidatePath(shop.base, 'layout');
    return { ok: true };
  } catch (err) {
    return { error: said(err, 'Could not change that.') };
  }
}

export async function viewedAction(ref: ShopRef, kind: 'product' | 'combo', refId: string): Promise<void> {
  try {
    const shop = await getShopContext(ref);
    if (!shop) return;
    // Browsing must not plant a cookie, so a view with no key is recorded
    // against an empty session rather than minting one. The count is still
    // right; it simply cannot be tied to a basket, which is the correct
    // trade for somebody who has only looked.
    await recordEvent(shop.store.id, {
      kind: 'view',
      sessionKey: shop.sessionKey || 'anonymous',
      partyId: shop.partyId,
      listingId: kind === 'product' ? refId : null,
      comboId: kind === 'combo' ? refId : null,
    });
  } catch {
    // Never allowed to break a page.
  }
}

export async function requestAction(
  ref: ShopRef,
  kind: 'product' | 'service',
  message: string,
  location: { lat: number; lng: number; source: 'gps' | 'maps_link' } | null = null,
): Promise<ShopState> {
  try {
    const shop = await shopFor(ref);
    // The one action that needs a real identity. Checked against the portal
    // session, never the browser key - that key identifies a browser and
    // authorises nothing. A customer of a DIFFERENT business is not signed in
    // here (shop-context checks the store).
    if (!shop.partyId) {
      return { error: 'Please sign in or register first, so we know who to come back to.' };
    }
    const sessionKey = await ensureSessionKey();
    const r = await submitRequest(shop.store.id, {
      sessionKey, partyId: shop.partyId, kind, message, location,
    });
    revalidatePath(shop.base, 'layout');
    return {
      ok: true,
      message: r.kind === 'service'
        ? `Sent to ${shop.organization.name}. Somebody will ring you to arrange a visit.`
        : `Sent to ${shop.organization.name}. Somebody will ring you with a quotation.`,
    };
  } catch (err) {
    return { error: said(err, 'Could not send that.') };
  }
}

/** The heart: save or unsave a product. Works without signing in (5 Oct 2026). */
export async function wishlistAction(ref: ShopRef, listingId: string): Promise<ShopState & { saved?: boolean }> {
  try {
    const shop = await shopFor(ref);
    const sessionKey = await ensureSessionKey();
    const saved = await toggleWishlist(shop.store.id, sessionKey, shop.partyId, listingId);
    revalidatePath(shop.base, 'layout');
    return { ok: true, saved, message: saved ? 'Saved for later.' : 'Removed from saved.' };
  } catch (err) {
    return { error: said(err, 'Could not save that.') };
  }
}

/** Write a review. Needs a signed-in customer; shown once the business approves it. */
export async function reviewAction(ref: ShopRef, listingId: string, rating: number, body: string): Promise<ShopState> {
  try {
    const shop = await shopFor(ref);
    if (!shop.partyId) return { error: 'Sign in or register to write a review.' };
    await submitReview(shop.store.id, { listingId, partyId: shop.partyId, rating, body: body || null });
    revalidatePath(shop.base, 'layout');
    return { ok: true, message: 'Thank you. Your review will show once the shop has seen it.' };
  } catch (err) {
    return { error: said(err, 'Could not save your review.') };
  }
}
