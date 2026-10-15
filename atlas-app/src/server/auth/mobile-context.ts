import 'server-only';
import { db } from '../db';
import { requestIp, setActor } from '../audit-context';
import { requireApiCaller } from './api-caller';
import { buildContextFromAssignments, type AppContext } from '../context';

/**
 * The website's AppContext, for a Vcare phone.
 *
 * The phone signs in with a bearer token instead of a cookie; everything
 * after that is the SAME resolver the website uses
 * (`buildContextFromAssignments`) - stores, All Company vs one store,
 * permissions as the union of roles in scope, menu gating, read-only when the
 * organisation is locked. So a route can hand this straight to any existing
 * `server/*` function that takes a `StoreScope`, and a phone can never be
 * allowed something the website would refuse.
 *
 * The phone picks its store with the `x-store-id` header - the mobile
 * equivalent of the store-switcher cookie. An id that is not one of the
 * person's own stores is ignored (All Company), exactly as on the web.
 *
 * Customers (portal tokens) and device tokens get null here: they are not
 * staff and have no store roles.
 */
export async function mobileContext(req: Request): Promise<AppContext | null> {
  const caller = await requireApiCaller(req);
  if (!caller || caller.kind !== 'user') return null;

  const user = await db.user.findUnique({
    where: { id: caller.userId },
    include: {
      organization: true,
      storeRoles: {
        include: {
          store: true,
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
    },
  });
  if (!user || !user.isActive || !user.organization || user.storeRoles.length === 0) return null;

  const ctx = await buildContextFromAssignments({
    user: { id: user.id, fullName: user.fullName, username: user.username, email: user.email },
    assignments: user.storeRoles,
    organization: user.organization,
    requestedStoreId: req.headers.get('x-store-id'),
    impersonation: null,
    mustChangePassword: user.mustChangePassword,
  });
  if (ctx) {
    await setActor({
      id: ctx.user.id, name: ctx.user.fullName, kind: 'user', via: 'Vcare',
      ip: await requestIp(), storeId: ctx.activeStoreId,
    });
  }
  return ctx;
}
