/**
 * Hidden in the menu = cannot be opened (B1, decision P1, 11 Oct 2026).
 *
 * Until now the menu only drew links: a page switched off for a branch, a
 * role or a person still opened from a bookmark, a document link or Ctrl+K,
 * and the Dashboards section ignored the menu altogether. One rule now, in
 * this order: business plan → branch → role → person (their override last),
 * and the permission check in `lib/route-access` stays the floor - the menu
 * can only take a page away, never give one.
 *
 * Pure, so both the page guard (`server/context.ts`) and the dashboards list
 * (`dashboard/dashes.ts`) read the same answer.
 */
import { routeEntry } from './route-access';

/** raw menu route (may carry a query) → is it visible for this person. */
export type MenuRoutes = ReadonlyMap<string, boolean>;

/**
 * Never closed by a menu setting. The landing page (it decides its own tabs
 * below), the person's own desk and account, and the page that explains a
 * block - closing that one would loop.
 */
const ALWAYS_OPEN = ['/dashboard', '/my', '/no-access', '/user/account', '/set-password'];

const clean = (p: string) => p.split('?')[0]!.replace(/\/+$/, '') || '/';
const under = (p: string, k: string) => p === k || p.startsWith(`${k}/`);

/**
 * Does the person's menu hide the page at `path`?
 *
 * The row that governs a page is the row with its exact path, else the
 * longest row that is a parent folder of it AND sits in the same permission
 * area - so `/invoices/<id>` follows the Invoices row, while
 * `/hrm/employees/<id>` does not follow the "HRM Dashboard" row at `/hrm`
 * just because the address starts the same way. A page no row governs is
 * left to its permission alone. Several rows on one path (Sales Team Calls
 * and Service Team Calls are both `/call-logs`): open if any is visible.
 */
export function menuHides(path: string, routes: MenuRoutes): boolean {
  const p = clean(path);
  if (ALWAYS_OPEN.some((k) => under(p, k))) return false;
  const byPath = new Map<string, boolean>();
  for (const [r, visible] of routes) {
    const k = clean(r);
    byPath.set(k, (byPath.get(k) ?? false) || visible);
  }
  if (byPath.has(p)) return !byPath.get(p);
  const area = routeEntry(p);
  let best: string | null = null;
  for (const k of byPath.keys()) {
    if (k === '/' || !p.startsWith(`${k}/`) || routeEntry(k) !== area) continue;
    if (!best || k.length > best.length) best = k;
  }
  return best ? !byPath.get(best) : false;
}

/** The menu row for one dashboard, under the top-level Dashboard row. */
export const dashMenuRoute = (k: string) => `/dashboard?tab=${k}`;

/**
 * Does the menu hide this dashboard? Unticking Dashboard hides them all;
 * unticking one hides that one. My day is the person's own - never hidden,
 * so `/dashboard` always has something to show.
 */
export function menuHidesDash(k: string, routes: MenuRoutes | undefined): boolean {
  if (!routes || k === 'my') return false;
  if (routes.get('/dashboard') === false) return true;
  return routes.get(dashMenuRoute(k)) === false;
}
