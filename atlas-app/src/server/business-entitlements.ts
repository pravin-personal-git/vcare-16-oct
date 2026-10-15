import 'server-only';
import { db } from './db';

/**
 * Who may create a new business, and how many branches a business may have
 * (founder decision, 25 Sep 2026). Running more than one business, or more
 * branches, is part of the paid plan, so the Platform Owner decides it per
 * tenant - never the tenant itself:
 *
 *   - `allowSelfServiceBusinessCreation` must be on (off by default), and
 *   - the person must hold the tenant's built-in Admin role (`isSystem`) -
 *     not a permission, because a tenant admin can hand any permission to
 *     any role, and this right must never spread without the Platform
 *     Owner, and
 *   - the tenant must be under `businessLimit` (null = no cap).
 *
 * Branches: `branchLimit` (null = no cap) counts every store in the tenant.
 */

export interface BusinessCreationStatus {
  allowed: boolean;
  /** Plain words for the person, when not allowed. */
  reason: string | null;
  used: number;
  limit: number | null;
}

export async function isTenantAdmin(userId: string, organizationId: string): Promise<boolean> {
  const row = await db.userStoreRole.findFirst({
    where: { userId, role: { isSystem: true }, store: { organizationId } },
    select: { userId: true },
  });
  return !!row;
}

export async function businessCreationStatus(userId: string, organizationId: string): Promise<BusinessCreationStatus> {
  const [org, used, admin] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { allowSelfServiceBusinessCreation: true, businessLimit: true },
    }),
    db.organization.count({ where: { createdFromOrganizationId: organizationId } }),
    isTenantAdmin(userId, organizationId),
  ]);
  const limit = org?.businessLimit ?? null;
  if (!org?.allowSelfServiceBusinessCreation) {
    return { allowed: false, reason: 'Adding another business is not part of your plan. Contact your account manager to enable it.', used, limit };
  }
  if (!admin) {
    return { allowed: false, reason: 'Only the business admin can add a new business.', used, limit };
  }
  if (limit !== null && used >= limit) {
    return { allowed: false, reason: `Your plan allows ${limit} additional business${limit === 1 ? '' : 'es'}, and all are in use. Contact your account manager to add more.`, used, limit };
  }
  return { allowed: true, reason: null, used, limit };
}

export async function branchCreationStatus(organizationId: string): Promise<{ allowed: boolean; reason: string | null; used: number; limit: number | null }> {
  const [org, used] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { branchLimit: true } }),
    db.store.count({ where: { organizationId } }),
  ]);
  const limit = org?.branchLimit ?? null;
  if (limit !== null && used >= limit) {
    return { allowed: false, reason: `Your plan allows ${limit} branch${limit === 1 ? '' : 'es'}, and all are in use. Contact your account manager to add more.`, used, limit };
  }
  return { allowed: true, reason: null, used, limit };
}
