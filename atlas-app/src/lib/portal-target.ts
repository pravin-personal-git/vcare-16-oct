/**
 * Where a signed-in customer belongs (4 Oct 2026).
 *
 * One rule, used by sign-in, registration and the shop: a customer who is
 * signed in to this business works INSIDE the customer portal - the shop is a
 * tab there, with the same list - rather than on the public shop pages, where
 * "Sign in" and "Create an account" would still be on offer.
 *
 *   /shop/<name>          -> /portal/shop
 *   /shop/<name>/list     -> /portal/shop/list   (the list comes too: same browser key)
 *   /shop/<name>/p/<id>   -> /portal/shop/p/<id>
 *   /portal...            -> unchanged
 *   anything else         -> /portal
 */
export function portalPathFor(next: string | null | undefined): string {
  const n = typeof next === 'string' ? next : '';
  if (/^\/portal(\/|$|\?)/.test(n) && !n.startsWith('//')) return n;
  const m = /^\/shop(?:\/[a-z0-9-]+)?(\/list|\/p\/[A-Za-z0-9_-]+)?\/?(\?.*)?$/.exec(n);
  if (m) return `/portal/shop${m[1] ?? ''}${m[2] ?? ''}`;
  return '/portal';
}
