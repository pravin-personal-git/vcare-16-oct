import 'server-only';
import { db } from './db';

/**
 * Cross-tenant/subtree scope - genuinely new functionality `StoreScope`
 * (`store-scope.ts`) was never meant to express (its own doc comment: "All
 * mode aggregates across the USER'S stores", never across tenants). A
 * Platform Owner's tenant list, a Reseller's client list - both need to see
 * many `Organization` rows at once, which is a different shape of query
 * from anything the existing ~84 `scopeWhere` call sites do.
 *
 * Deliberately a separate, narrower type from `StoreScope` rather than one
 * merged union - widening `StoreScope` itself would mean every one of those
 * 84 functions' `scope: StoreScope` parameter type-checks a value it was
 * never built to handle, which either needs a runtime guard added to all of
 * them or, worse, eventually gets a convenience `{}` fallback - exactly the
 * "God Mode by removing tenant scope" spec §9 forbids. Two separate types
 * means a missing/wrong scope stays a compile error.
 */
export type PlatformScope =
  | { kind: 'platform' }
  | { kind: 'resellerSubtree'; accountIds: string[] }
  | { kind: 'tenant'; organizationId: string };

/** Prisma `where` fragment for `Organization`. */
export function platformScopeOrgWhere(
  scope: PlatformScope,
): Record<string, never> | { platformAccountId: { in: string[] } } | { id: string } {
  switch (scope.kind) {
    case 'platform': return {};
    case 'resellerSubtree': return { platformAccountId: { in: scope.accountIds } };
    case 'tenant': return { id: scope.organizationId };
  }
}

/**
 * Resolves a Reseller's (or Platform's) subtree in one indexed query, via
 * the materialized `path` prefix - see the schema comment on
 * `PlatformAccount.path`.
 */
export async function resolveSubtreeAccountIds(platformAccountId: string): Promise<string[]> {
  const root = await db.platformAccount.findUniqueOrThrow({
    where: { id: platformAccountId }, select: { path: true },
  });
  const subtree = await db.platformAccount.findMany({
    where: { path: { startsWith: root.path } }, select: { id: true },
  });
  return subtree.map((a) => a.id);
}

/**
 * The scope a membership's `platformRole.scopeType` grants over
 * `Organization` rows. `PLATFORM` sees everything; `RESELLER` sees its own
 * subtree; `TENANT`/`LEGAL_ENTITY` memberships don't grant a cross-tenant
 * view at all (they administer the one tenant they belong to, through the
 * ordinary tenant context - see `platform-context.ts`'s module comment).
 */
export async function resolveOrgScopeForMembership(m: {
  scopeType: string; platformAccountId: string | null; organizationId: string | null;
}): Promise<PlatformScope | null> {
  if (m.scopeType === 'PLATFORM' && m.platformAccountId) {
    return { kind: 'platform' };
  }
  if (m.scopeType === 'RESELLER' && m.platformAccountId) {
    return { kind: 'resellerSubtree', accountIds: await resolveSubtreeAccountIds(m.platformAccountId) };
  }
  if (m.scopeType === 'TENANT' && m.organizationId) {
    return { kind: 'tenant', organizationId: m.organizationId };
  }
  return null;
}

/**
 * True if `organizationId` falls within the widest scope `memberships`
 * add up to. The one check every platform action that targets a specific
 * tenant needs before doing anything to it (Access Tenant, suspend,
 * reactivate, schedule/cancel a lock, ...) - factored out here after it
 * started being written out by hand (`AND: [{id}, platformScopeOrgWhere(...)]`)
 * at each new call site in Slice 5.
 *
 * `AND`, not a spread merge - `platformScopeOrgWhere` can itself carry an
 * `id` field (the `tenant` scope case), and spreading it after a literal
 * `id: organizationId` would silently let the LATER field win, checking
 * the wrong organisation instead of failing the request.
 */
export async function isOrgInMembershipScope(
  memberships: { scopeType: string; platformAccountId: string | null; organizationId: string | null }[],
  organizationId: string,
): Promise<boolean> {
  const scope = await resolveBestOrgScope(memberships);
  if (!scope) return false;

  const match = await db.organization.findFirst({
    where: { AND: [{ id: organizationId }, platformScopeOrgWhere(scope)] },
    select: { id: true },
  });
  return match !== null;
}

/**
 * D055 single-seat hardening - an explicit guard on top of the ordinary
 * `PlatformScope`/permission checks, for the most destructive action set:
 * cross-tenant credential reset/username change (Slice 7), `PlatformConfig`
 * edits, and lifecycle changes on `PlatformAccount` rows (reseller
 * suspend/reactivate). Checks that the acting user's `PLATFORM_OWNER`
 * membership sits on the ROOT account (`parentAccountId === null`), not a
 * future reseller-tier equivalent of it - resetting any tenant admin's
 * login (or suspending a reseller) must never become available to a
 * second platform-tier account without a deliberate decision to extend it,
 * per D055's own wording.
 *
 * Deliberately a separate call from the ordinary permission check rather
 * than folded into one - a caller might hold `platformTenant.manageCredentials`
 * (e.g. a future PLATFORM_ADMIN) without being the root owner; this is the
 * second, narrower gate that specific action set additionally requires.
 */
export class RootPlatformOwnerRequiredError extends Error {
  constructor() {
    super('This action is restricted to the root Platform Owner account.');
    this.name = 'RootPlatformOwnerRequiredError';
  }
}

export async function requireRootPlatformOwner(userId: string): Promise<void> {
  const rootMembership = await db.membership.findFirst({
    where: {
      userId,
      platformRole: { key: 'PLATFORM_OWNER' },
      platformAccount: { parentAccountId: null },
    },
    select: { id: true },
  });
  if (!rootMembership) throw new RootPlatformOwnerRequiredError();
}

/**
 * The widest tenant-administration scope a person's memberships add up to -
 * PLATFORM beats RESELLER, and a TENANT/LEGAL_ENTITY-only membership grants
 * no cross-tenant list at all (`null`). Used by `/platform/tenants` and
 * `/platform/resellers`, which show one list, not one per membership.
 */
export async function resolveBestOrgScope(
  memberships: { scopeType: string; platformAccountId: string | null; organizationId: string | null }[],
): Promise<PlatformScope | null> {
  const platform = memberships.find((m) => m.scopeType === 'PLATFORM');
  if (platform) return resolveOrgScopeForMembership(platform);

  const reseller = memberships.find((m) => m.scopeType === 'RESELLER');
  if (reseller) return resolveOrgScopeForMembership(reseller);

  return null;
}
