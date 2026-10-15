import { tenantCss } from '@/lib/appearance';
import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { db } from './db';
import { publicBrandUrl } from './storage';
import { newSessionKey } from './shop';

/**
 * Which shop a visitor is looking at, and who they are.
 *
 * ---------------------------------------------------------------------------
 * THE BUSINESS IS IN THE URL; THE BRANCH IS NOT (3 Oct 2026)
 *
 * The first version assumed one business per deployment - the SaaS model of
 * 29 Sep - and showed "the first active branch". On the shared server that is
 * whichever business was set up first, so atlas.nairsolutions.org/shop showed
 * N.A.I.R.'s shop to Vcare's customers. Pravin's call: every business gets
 * `/shop/<shopSlug>`, and a bare `/shop` lists NOBODY, so one client's
 * customers never see the other clients hosted alongside.
 *
 * A deployment holding exactly one business (the SaaS end state) still opens
 * its shop at plain `/shop`, which is the only case where that is unambiguous.
 *
 * The branch stays out of the URL: a customer should not need to know which
 * warehouse their camera comes from. A business shows its oldest active
 * branch's catalogue; if that ever stops being enough, this is the only
 * function that changes.
 *
 * ---------------------------------------------------------------------------
 * THE SESSION KEY IS NOT A LOGIN
 *
 * It is a random id in a cookie so an anonymous basket survives a page reload.
 * It identifies a browser, never a person, and carries nothing - no name, no
 * signature, nothing to forge. Somebody copying another visitor's key would
 * see that visitor's basket and nothing else; there is no account behind it and
 * no action it authorises. Asking for something requires a real portal login,
 * checked separately. One key serves every shop on the server: baskets are
 * unique per (store, key), so they never mix.
 */

export const SHOP_SESSION_COOKIE = 'atlas_shop';

export interface ShopContext {
  store: { id: string; name: string; address: string | null };
  organization: {
    name: string;
    logoUrl: string | null;
    /** CSS custom properties from Org Profile, already filtered to safe names. */
    themeCss: string;
  };
  /**
   * Where this shop's pages live: `/shop/vcare`, `/shop` on a one-business
   * server, or `/portal/shop` inside the customer portal.
   */
  base: string;
  /** The slug that found it, or null for a bare `/shop` or the portal. */
  slug: string | null;
  sessionKey: string;
  /** The signed-in customer, where there is one - and only for THIS business. */
  partyId: string | null;
  partyName: string | null;
}

/** What a page or action passes to say which shop it is. */
export type ShopRef = { slug: string | null } | { portal: true };

/** A shop short name: lower-case letters, digits and single hyphens, 2-40 long. */
export const SHOP_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * The business's palette and Appearance choices, as complete CSS for a <style>
 * tag. Palette values must be HSL triples and appearance values come from
 * fixed lists - see lib/appearance.ts - so nothing saved is echoed raw.
 */
export function themeCssFrom(tokens: unknown): string {
  return tenantCss(tokens);
}

const STORE_SELECT = {
  id: true, name: true, address: true,
  organization: { select: { name: true, logoPath: true, themeTokens: true, shopSlug: true } },
} as const;

/** The store a public shop request means, or null for "no such shop". */
async function storeFor(slug: string | null) {
  if (slug) {
    if (!SHOP_SLUG.test(slug)) return null;
    return db.store.findFirst({
      where: { isActive: true, organization: { shopSlug: slug } },
      orderBy: { createdAt: 'asc' },
      select: STORE_SELECT,
    });
  }
  /**
   * Bare `/shop`: open a shop only when the server holds exactly one business.
   * With two or more, which one is meant cannot be known, and guessing is how
   * Vcare's customers ended up in N.A.I.R.'s shop.
   */
  const orgs = await db.organization.findMany({
    where: { stores: { some: { isActive: true } } },
    select: { id: true },
    take: 2,
  });
  if (orgs.length !== 1) return null;
  return db.store.findFirst({
    where: { isActive: true, organizationId: orgs[0].id },
    orderBy: { createdAt: 'asc' },
    select: STORE_SELECT,
  });
}

async function signedInFor(storeId: string) {
  // A soft read: the shop works perfectly well for somebody who is not signed
  // in, and somebody signed in to a DIFFERENT business is a visitor here.
  try {
    const { getPortalContext } = await import('./portal-context');
    const portal = await getPortalContext();
    if (portal && portal.party.storeId === storeId) {
      return { partyId: portal.party.id, partyName: portal.party.displayName };
    }
  } catch {
    // Not signed in, or the session has expired. Neither is a problem here.
  }
  return { partyId: null, partyName: null };
}

/**
 * The shop, for a page that may be read by anybody.
 *
 * Returns null when there is no such shop, rather than throwing: a wrong link
 * should say "no shop here", not show a stack trace.
 */
/**
 * Keyed on a plain string because React's per-request `cache` compares
 * arguments by identity - an object literal per call would never hit.
 */
const PORTAL_KEY = ':portal';
export function getShopContext(ref: ShopRef = { slug: null }): Promise<ShopContext | null> {
  return shopContextFor('portal' in ref ? PORTAL_KEY : (ref.slug ?? ''));
}

const shopContextFor = cache(async (key: string): Promise<ShopContext | null> => {
  const jar = await cookies();
  // Read-only here. A page cannot set a cookie in Next's server components, so
  // the key is minted by the first server action that needs one - see
  // `ensureSessionKey`. Until then a visitor browses with no key at all, which
  // is right: looking at a shop should not plant anything in anybody's browser.
  const sessionKey = jar.get(SHOP_SESSION_COOKIE)?.value ?? '';

  if (key === PORTAL_KEY) {
    // Inside the portal the business is the customer's own - there is nothing
    // to choose and nobody to register.
    const { getPortalContext } = await import('./portal-context');
    const portal = await getPortalContext();
    if (!portal) return null;
    // A client can switch the shop out of the portal (portal.shop). Enforced
    // here, where every portal shop page and action resolves its store, not
    // only by hiding the tab.
    const { portalConfig } = await import('./config');
    if (!(await portalConfig(portal.store.id)).on('portal.shop')) return null;
    return {
      store: { id: portal.store.id, name: portal.store.name, address: null },
      organization: {
        name: portal.organization.name,
        logoUrl: publicBrandUrl(portal.organization.logoPath),
        themeCss: themeCssFrom(portal.organization.themeTokens),
      },
      base: '/portal/shop',
      slug: null,
      sessionKey,
      partyId: portal.party.id,
      partyName: portal.party.displayName,
    };
  }

  const slug = key.trim().toLowerCase() || null;
  const store = await storeFor(slug);
  if (!store) return null;

  return {
    store: { id: store.id, name: store.name, address: store.address },
    organization: {
      name: store.organization.name,
      logoUrl: publicBrandUrl(store.organization.logoPath),
      themeCss: themeCssFrom(store.organization.themeTokens),
    },
    base: slug ? `/shop/${slug}` : '/shop',
    slug,
    sessionKey,
    ...(await signedInFor(store.id)),
  };
});

/**
 * Where a signed-in customer of this business should be instead of the public
 * shop page, or null to stay (4 Oct 2026, lib/portal-target).
 *
 * Only for their OWN business (`partyId` is null for a visitor and for somebody
 * signed in elsewhere), and only while the business shows the shop inside the
 * portal - with `portal.shop` off they keep the public pages, signed in.
 */
export async function portalInstead(shop: ShopContext, path: string): Promise<string | null> {
  if (!shop.partyId || shop.base.startsWith('/portal')) return null;
  const { portalConfig } = await import('./config');
  if (!(await portalConfig(shop.store.id)).on('portal.shop')) return null;
  const { portalPathFor } = await import('@/lib/portal-target');
  return portalPathFor(path);
}

/**
 * The browser's key, minted on first use.
 *
 * Called only from server actions - adding to a basket, asking for something -
 * never from a page render. Browsing plants nothing; the cookie appears the
 * first time somebody does something that needs to be remembered.
 */
export async function ensureSessionKey(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(SHOP_SESSION_COOKIE)?.value;
  if (existing) return existing;

  const key = newSessionKey();
  jar.set(SHOP_SESSION_COOKIE, key, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Long enough that a basket survives a weekend, short enough that it is not
    // a permanent mark on somebody's browser.
    maxAge: 60 * 60 * 24 * 30,
  });
  return key;
}
