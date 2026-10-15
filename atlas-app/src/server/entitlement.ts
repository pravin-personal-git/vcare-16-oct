import 'server-only';
import { db } from './db';
import { resolveEntitlement, type Entitlement } from '@/lib/plans';

/**
 * What a tenant is entitled to (workstream F).
 *
 * Read on every request that builds a menu, so it is deliberately one small
 * indexed lookup and nothing more.
 */
export async function entitlementFor(organizationId: string | null): Promise<Entitlement> {
  if (!organizationId) {
    return resolveEntitlement({
      planId: null, userLimitOverride: null,
      excludedModulesOverride: null, trialEndsAt: null, enabledFeatures: null,
      excludedPages: null,
    });
  }

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      planId: true, userLimit: true, excludedModules: true, excludedPages: true,
      trialEndsAt: true, enabledFeatures: true,
    },
  }).catch(() => null);

  return resolveEntitlement({
    planId: org?.planId ?? null,
    userLimitOverride: org?.userLimit ?? null,
    excludedModulesOverride: Array.isArray(org?.excludedModules)
      ? (org.excludedModules as unknown[]).map(String)
      : null,
    trialEndsAt: org?.trialEndsAt ?? null,
    enabledFeatures: org?.enabledFeatures ?? null,
    excludedPages: org?.excludedPages ?? null,
  });
}

/** How many people are set up, for the user cap. */
export async function userCount(organizationId: string): Promise<number> {
  return db.user.count({ where: { organizationId, isActive: true } });
}
