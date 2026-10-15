import 'server-only';
import { cache } from 'react';
import { db } from './db';
import { getSessionToken } from './auth/session';

/**
 * Platform/Reseller-level identity resolution - the counterpart to
 * `context.ts`'s `getContext()`/`AppContext`, but for D045's non-store-
 * scoped roles (`PLATFORM_OWNER`, `RESELLER_ADMIN`, ...) instead of tenant
 * employees.
 *
 * Deliberately a SEPARATE resolver, not an extension of `AppContext`.
 * `getContext()` requires a tenant (`user.storeRoles.length > 0`, an
 * `Organization`) - a pure Platform/Reseller user has neither, only
 * `Membership` rows, so folding this in would mean making `organization`
 * nullable on `AppContext` and touching every one of the ~20+ existing
 * pages that read `ctx.organization` assuming it exists. Keeping the two
 * resolvers apart means zero changes to any of them; a person can hold a
 * tenant context, a platform context, or both, from the same login and the
 * same `LoginSession` row - see `User.organizationId`'s schema comment.
 *
 * Same DB-backed session as `context.ts` (`LoginSession`, `atlas_session`
 * cookie via `getSessionToken()`) - one login works for both.
 */

export interface PlatformMembership {
  id: string;
  roleKey: string;
  roleName: string;
  scopeType: string;
  platformAccountId: string | null;
  organizationId: string | null;
  legalEntityId: string | null;
  /** The name of whichever scope entity this membership points at - for display (e.g. the platform shell's header). */
  scopeName: string;
}

export interface PlatformContext {
  user: { id: string; fullName: string; username: string };
  memberships: PlatformMembership[];
  /** Union of every membership's role's permissions - same union shape as `resolvePermissions` in `permissions.ts`. */
  permissions: Set<string>;
}

export const getPlatformContext = cache(async (): Promise<PlatformContext | null> => {
  try {
    return await loadPlatformContext();
  } catch (err) {
    console.error('[platform-context] resolution failed', err);
    return null;
  }
});

async function loadPlatformContext(): Promise<PlatformContext | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const session = await db.loginSession.findUnique({
    where: { sessionToken: token },
    include: {
      user: {
        include: {
          memberships: {
            include: {
              platformRole: { include: { permissions: { include: { permission: true } } } },
              platformAccount: { select: { name: true } },
              organization: { select: { name: true } },
              legalEntity: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!session || session.isRevoked || session.loggedOutAt) return null;
  if (!session.user.isActive) return null;

  const { memberships } = session.user;
  if (memberships.length === 0) return null;

  const permissions = new Set<string>();
  for (const m of memberships) {
    for (const rp of m.platformRole.permissions) permissions.add(rp.permission.key);
  }

  return {
    user: { id: session.user.id, fullName: session.user.fullName, username: session.user.username },
    memberships: memberships.map((m) => ({
      id: m.id,
      roleKey: m.platformRole.key,
      roleName: m.platformRole.name,
      scopeType: m.platformRole.scopeType,
      platformAccountId: m.platformAccountId,
      organizationId: m.organizationId,
      legalEntityId: m.legalEntityId,
      scopeName: m.platformAccount?.name ?? m.organization?.name ?? m.legalEntity?.name ?? 'Unknown',
    })),
    permissions,
  };
}

export async function requirePlatformContext(): Promise<PlatformContext> {
  const ctx = await getPlatformContext();
  if (!ctx) throw new Error('UNAUTHENTICATED');
  return ctx;
}
