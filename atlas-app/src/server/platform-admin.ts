import 'server-only';
import { db } from './db';
import { Prisma } from '@prisma/client';
import { PLANS, SELLABLE_MODULES, isHideable, resolveExcludedPages, resolveFeatures } from '@/lib/plans';
import { moduleOfPath } from '@/lib/modules';
import { createBusiness, userCode, ProvisioningError, type CreateBusinessInput } from './provisioning';
import { hashPassword } from './auth/password';
import { platformScopeOrgWhere, resolveSubtreeAccountIds, type PlatformScope } from './platform-scope';
import { FEED_MAX_ROWS } from '@/lib/list-limits';

export class PlatformAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformAdminError';
  }
}

export interface TenantRow {
  id: string;
  orgCode: string;
  name: string;
  lifecycleState: string;
  storeCount: number;
  createdAt: Date;
  scheduledLockAt: Date | null;
  lockReason: string | null;
  /** Plan controls (25 Sep 2026): may this tenant's admin add businesses, and how many so far. */
  canCreateBusiness: boolean;
  businessLimit: number | null;
  businessesCreated: number;
  branchLimit: number | null;
  /** The business this one was created from, if an owner made it themselves. */
  createdFromName: string | null;
}

/** Every tenant within `scope` - the Platform Owner's full list, or a Reseller's own subtree. */
export async function listTenants(scope: PlatformScope): Promise<TenantRow[]> {
  const orgs = await db.organization.findMany({
    where: platformScopeOrgWhere(scope),
    include: { _count: { select: { stores: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const children = await db.organization.groupBy({
    by: ['createdFromOrganizationId'],
    where: { createdFromOrganizationId: { in: orgs.map((o) => o.id) } },
    _count: { _all: true },
  });
  const createdBy = new Map(children.map((c) => [c.createdFromOrganizationId, c._count._all]));
  const parentIds = [...new Set(orgs.map((o) => o.createdFromOrganizationId).filter((x): x is string => !!x))];
  const parents = new Map((parentIds.length ? await db.organization.findMany({
    where: { id: { in: parentIds } }, select: { id: true, name: true },
  }) : []).map((p) => [p.id, p.name]));

  return orgs.map((o) => ({
    id: o.id,
    orgCode: o.orgCode,
    name: o.name,
    lifecycleState: o.lifecycleState,
    storeCount: o._count.stores,
    createdAt: o.createdAt,
    canCreateBusiness: o.allowSelfServiceBusinessCreation,
    businessLimit: o.businessLimit,
    businessesCreated: createdBy.get(o.id) ?? 0,
    branchLimit: o.branchLimit,
    createdFromName: o.createdFromOrganizationId ? parents.get(o.createdFromOrganizationId) ?? null : null,
    scheduledLockAt: o.scheduledLockAt,
    lockReason: o.lockReason,
  }));
}

export interface TenantDetail {
  id: string;
  orgCode: string;
  name: string;
  lifecycleState: string;
  scheduledLockAt: Date | null;
  lockReason: string | null;
  createdAt: Date;
  allowSelfServiceBusinessCreation: boolean;
  allowLinkedAccounts: boolean;
  businessLimit: number | null;
  branchLimit: number | null;
  /** /shop/<shopSlug>, or null when the business has no public shop address. */
  shopSlug: string | null;
  /** Plan and entitlement (workstream F, 1 Oct 2026). */
  planId: string;
  userLimit: number | null;
  excludedModules: string[] | null;
  /** Individual pages switched off for this client, as routes (F-01, 10 Oct 2026). */
  excludedPages: string[];
  trialEndsAt: Date | null;
  /** lib/plans `PLATFORM_FEATURES` this client has. */
  enabledFeatures: string[];
  /** Active people, so the console shows the cap against reality. */
  activeUsers: number;
  /** Businesses this tenant's admins created for themselves. */
  businessesCreated: { id: string; name: string; orgCode: string; createdAt: Date; createdByName: string | null }[];
  createdFrom: { id: string; name: string } | null;
  stores: { id: string; name: string; branchCode: string }[];
}

/**
 * THE PAGES A PLATFORM OWNER MAY SWITCH OFF, as the client sees them (F-01,
 * 10 Oct 2026).
 *
 * Read from the real menu rather than a hand-kept list of routes, for the same
 * reason `menu-routes.test.ts` exists: a list of routes maintained beside the
 * menu drifts from it, and the owner would be ticking pages that moved or are
 * gone. The menu is where a client actually meets Atlas, so it is also the
 * right vocabulary for deciding what they get - the owner reads
 * "Payroll > Travel Allowance", not `/hrm/payroll/travel`.
 *
 * `lib/plans.isHideable` removes the ways in and the ways to administer, so
 * what comes back here is only what is genuinely safe to sell separately.
 */
export interface HideablePage {
  route: string;
  label: string;
  /** The top-level group it sits under, for grouping the list. */
  group: string;
  /** The sellable module it belongs to, or null. Already-excluded modules are marked, not hidden. */
  module: string | null;
}

export async function hideablePages(): Promise<HideablePage[]> {
  const rows = await db.menu.findMany({
    where: { platform: 'WEB', deletedAt: null },
    select: { id: true, label: true, parentId: true, route: true },
    orderBy: { sort: 'asc' },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const groupOf = (row: { label: string; parentId: string | null }): string => {
    let cur = row;
    const seen = new Set<string>();
    while (cur.parentId && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      const up = byId.get(cur.parentId);
      if (!up) break;
      cur = up;
    }
    return cur.label;
  };

  const out: HideablePage[] = [];
  const taken = new Set<string>();
  for (const r of rows) {
    if (!r.route || !isHideable(r.route) || taken.has(r.route)) continue;
    taken.add(r.route);
    out.push({ route: r.route, label: r.label, group: groupOf(r), module: moduleOfPath(r.route) });
  }
  return out;
}

/** The tenant-detail page's own data (superadmin-roadmap Slice 9) - org info plus its read-only branch list. */
export async function getTenantDetail(organizationId: string): Promise<TenantDetail | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    include: { stores: { select: { id: true, name: true, branchCode: true }, orderBy: { name: 'asc' } } },
  });
  if (!org) return null;
  const children = await db.organization.findMany({
    where: { createdFromOrganizationId: org.id },
    select: { id: true, name: true, orgCode: true, createdAt: true, createdByUserId: true },
    orderBy: { createdAt: 'asc' },
  });
  const creatorIds = [...new Set(children.map((c) => c.createdByUserId).filter((x): x is string => !!x))];
  const creators = new Map((creatorIds.length ? await db.user.findMany({
    where: { id: { in: creatorIds } }, select: { id: true, fullName: true },
  }) : []).map((u) => [u.id, u.fullName]));
  const parent = org.createdFromOrganizationId
    ? await db.organization.findUnique({ where: { id: org.createdFromOrganizationId }, select: { id: true, name: true } })
    : null;

  return {
    id: org.id,
    orgCode: org.orgCode,
    name: org.name,
    lifecycleState: org.lifecycleState,
    scheduledLockAt: org.scheduledLockAt,
    lockReason: org.lockReason,
    createdAt: org.createdAt,
    allowSelfServiceBusinessCreation: org.allowSelfServiceBusinessCreation,
    allowLinkedAccounts: org.allowLinkedAccounts,
    businessLimit: org.businessLimit,
    branchLimit: org.branchLimit,
    shopSlug: org.shopSlug,
    planId: org.planId,
    userLimit: org.userLimit,
    excludedModules: Array.isArray(org.excludedModules)
      ? (org.excludedModules as unknown[]).map(String)
      : null,
    excludedPages: resolveExcludedPages(org.excludedPages),
    trialEndsAt: org.trialEndsAt,
    enabledFeatures: resolveFeatures(org.enabledFeatures),
    activeUsers: await db.user.count({ where: { organizationId, isActive: true } }),
    businessesCreated: children.map((c) => ({
      id: c.id, name: c.name, orgCode: c.orgCode, createdAt: c.createdAt,
      createdByName: c.createdByUserId ? creators.get(c.createdByUserId) ?? null : null,
    })),
    createdFrom: parent,
    stores: org.stores,
  };
}

export type CreateTenantInput = CreateBusinessInput;

/**
 * Platform Owner or Reseller provisioning a tenant for a customer who has no
 * Atlas login of their own yet - wraps the same transaction the existing
 * self-service "Switch Business" path uses (`provisioning.ts::createBusiness`),
 * with `callingUserId: null` so no LinkedAccount is created (see that
 * function's module comment for why) and `platformAccountId` set explicitly
 * rather than defaulting to the root.
 */
export async function createTenant(
  platformAccountId: string, input: CreateTenantInput,
): Promise<{ organizationId: string; storeId: string; adminUsername: string }> {
  try {
    return await createBusiness(null, { ...input, platformAccountId });
  } catch (e) {
    if (e instanceof ProvisioningError) throw new PlatformAdminError(e.message);
    throw e;
  }
}

export interface ResellerRow {
  id: string;
  name: string;
  accountCode: string;
  lifecycleState: string;
  tenantCount: number;
  createdAt: Date;
}

/** Every RESELLER account within a Reseller's own subtree, or every reseller platform-wide. */
export async function listResellers(scope: PlatformScope): Promise<ResellerRow[]> {
  const where =
    scope.kind === 'platform' ? { type: 'RESELLER' as const }
      : scope.kind === 'resellerSubtree' ? { type: 'RESELLER' as const, id: { in: scope.accountIds } }
        : { type: 'RESELLER' as const, id: '__none__' }; // a TENANT-scoped caller never sees resellers

  const accounts = await db.platformAccount.findMany({
    where,
    include: { _count: { select: { organizations: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    accountCode: a.accountCode,
    lifecycleState: a.lifecycleState,
    tenantCount: a._count.organizations,
    createdAt: a.createdAt,
  }));
}

export interface ResellerDetail {
  id: string;
  name: string;
  accountCode: string;
  lifecycleState: string;
  scheduledLockAt: Date | null;
  lockReason: string | null;
  createdAt: Date;
  tenants: { id: string; orgCode: string; name: string; lifecycleState: string }[];
}

/** The reseller-detail page's own data (Slice 9) - account info plus every tenant in its subtree. */
export async function getResellerDetail(platformAccountId: string): Promise<ResellerDetail | null> {
  const account = await db.platformAccount.findFirst({
    where: { id: platformAccountId, type: 'RESELLER' },
  });
  if (!account) return null;

  const accountIds = await resolveSubtreeAccountIds(platformAccountId);
  const tenants = await db.organization.findMany({
    where: platformScopeOrgWhere({ kind: 'resellerSubtree', accountIds }),
    select: { id: true, orgCode: true, name: true, lifecycleState: true },
    orderBy: { name: 'asc' },
  });

  return {
    id: account.id,
    name: account.name,
    accountCode: account.accountCode,
    lifecycleState: account.lifecycleState,
    scheduledLockAt: account.scheduledLockAt,
    lockReason: account.lockReason,
    createdAt: account.createdAt,
    tenants,
  };
}

export interface CreateResellerInput {
  name: string;
  adminFullName: string;
  adminUsername: string;
  adminEmail: string | null;
  adminPassword: string;
}

/**
 * Creates a new RESELLER account under `parentAccountId`, bounded by
 * `PlatformConfig.maxResellerDepth` (D049 - one level by default: a
 * Reseller may only be created directly under the root PLATFORM account,
 * not under another Reseller, until that config is raised) - together
 * with its first admin login (`RESELLER_OWNER`, via `Membership`), the
 * same "account + first admin" shape `createBusiness` gives a new tenant.
 * Without this, a created reseller account would have no way to ever log
 * in and use it - `/platform/resellers` created the account row alone
 * until this, which was a real gap, not a deferred feature.
 */
export async function createReseller(
  parentAccountId: string, input: CreateResellerInput,
): Promise<{ id: string; accountCode: string; adminUsername: string }> {
  const trimmedName = input.name.trim();
  const adminUsername = input.adminUsername.trim().toLowerCase();
  const adminFullName = input.adminFullName.trim() || adminUsername;

  if (!trimmedName) throw new PlatformAdminError('Give the reseller a name.');
  if (!adminUsername) throw new PlatformAdminError('Give the reseller admin a username.');
  if (input.adminPassword.length < 12) {
    throw new PlatformAdminError('The admin password must be at least 12 characters.');
  }

  const parent = await db.platformAccount.findUnique({ where: { id: parentAccountId } });
  if (!parent) throw new PlatformAdminError('Parent account not found.');

  const config = await db.platformConfig.findFirst();
  const maxDepth = config?.maxResellerDepth ?? 1;
  // Depth of a node = number of ancestors, root exclusive - the root's own
  // path has exactly one segment. A new child one level below `parent` is
  // only within bounds if `parent`'s own segment count does not already
  // exceed maxDepth.
  const parentDepth = parent.path.split('.').length;
  if (parentDepth > maxDepth) {
    throw new PlatformAdminError(
      `Reseller depth is capped at ${maxDepth} level(s) - cannot create a sub-reseller under "${parent.name}".`,
    );
  }

  const usernameClash = await db.user.findUnique({ where: { username: adminUsername } });
  if (usernameClash) throw new PlatformAdminError(`The username "${adminUsername}" is already taken.`);

  const resellerOwnerRole = await db.platformRole.findUnique({ where: { key: 'RESELLER_OWNER' } });
  if (!resellerOwnerRole) {
    throw new PlatformAdminError('The RESELLER_OWNER role is not seeded - run npm run db:defaults first.');
  }

  const passwordHash = await hashPassword(input.adminPassword);
  const accountCode = `RESELLER-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const result = await db.$transaction(async (tx) => {
    const created = await tx.platformAccount.create({
      data: {
        type: 'RESELLER',
        parentAccountId: parent.id,
        rootPlatformId: parent.rootPlatformId,
        path: '', // set below once the id is known
        name: trimmedName,
        accountCode,
        lifecycleState: 'ACTIVE',
      },
    });
    const updated = await tx.platformAccount.update({
      where: { id: created.id },
      data: { path: `${parent.path}.${created.id}` },
    });

    const admin = await tx.user.create({
      data: {
        userCode: userCode(),
        organizationId: null,
        fullName: adminFullName,
        username: adminUsername,
        email: input.adminEmail?.trim() || null,
        passwordHash,
      },
    });
    await tx.membership.create({
      data: { userId: admin.id, platformRoleId: resellerOwnerRole.id, platformAccountId: updated.id },
    });

    return { id: updated.id, accountCode: updated.accountCode, adminUsername: admin.username };
  });

  return result;
}

// ===========================================================================
// TENANT LIFECYCLE (superadmin-roadmap Slice 6, D051/D052)
//
// Reseller-account lifecycle (PlatformAccount.lifecycleState) is deferred -
// the roadmap itself scopes it as "not in detail here - same pattern,
// smaller surface, do it same slice or next" pending the reseller detail
// page. Deliberately not built here rather than half-built.
//
// None of these four go through `requireRootPlatformOwner()` - the
// roadmap's own D055 list of what needs that guard is Slice 7's
// credential actions, Slice 9's PlatformConfig edits, and specifically
// Slice 6's RESELLER-suspend (not built yet, see above), not tenant
// suspend. A Reseller Owner may suspend/reactivate/schedule-lock a tenant
// within their own subtree - the ordinary `PlatformScope` check the
// calling action already does is the right boundary here.
// ===========================================================================

async function loadOrgForLifecycle(organizationId: string) {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, lifecycleState: true, scheduledLockAt: true },
  });
  if (!org) throw new PlatformAdminError('Tenant not found.');
  return org;
}

export async function suspendTenant(actingUserId: string, organizationId: string, reason: string): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new PlatformAdminError('A reason is required to suspend a tenant.');
  const org = await loadOrgForLifecycle(organizationId);

  await db.$transaction([
    db.organization.update({
      where: { id: organizationId },
      data: { lifecycleState: 'SUSPENDED', lockedAt: new Date(), lockedBy: actingUserId, lockReason: trimmedReason },
    }),
    db.privilegedAccessEvent.create({
      data: {
        actingUserId, actionType: 'SUSPEND', organizationId, reason: trimmedReason,
        previousValue: { lifecycleState: org.lifecycleState }, newValue: { lifecycleState: 'SUSPENDED' },
      },
    }),
  ]);
}

export async function reactivateTenant(actingUserId: string, organizationId: string, reason: string): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new PlatformAdminError('A reason is required to reactivate a tenant.');
  const org = await loadOrgForLifecycle(organizationId);

  await db.$transaction([
    db.organization.update({
      where: { id: organizationId },
      data: {
        lifecycleState: 'ACTIVE', unlockedAt: new Date(), unlockedBy: actingUserId,
        // Clears any pending scheduled lock too - reactivating and then
        // getting auto-suspended again on the next login because an old
        // schedule was still armed would be exactly the kind of surprise
        // this feature exists to prevent, not cause.
        scheduledLockAt: null,
      },
    }),
    db.privilegedAccessEvent.create({
      data: {
        actingUserId, actionType: 'REACTIVATE', organizationId, reason: trimmedReason,
        previousValue: { lifecycleState: org.lifecycleState }, newValue: { lifecycleState: 'ACTIVE' },
      },
    }),
  ]);
}

export async function scheduleLock(
  actingUserId: string, organizationId: string, at: Date, reason: string,
): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new PlatformAdminError('A reason is required to schedule a lock.');
  if (at.getTime() <= Date.now()) throw new PlatformAdminError('The lock date must be in the future.');
  await loadOrgForLifecycle(organizationId);

  await db.$transaction([
    db.organization.update({
      where: { id: organizationId },
      data: { scheduledLockAt: at, lockReason: trimmedReason },
    }),
    db.privilegedAccessEvent.create({
      data: {
        actingUserId, actionType: 'SCHEDULE_LOCK', organizationId, reason: trimmedReason,
        newValue: { scheduledLockAt: at.toISOString() },
      },
    }),
  ]);
}

export async function cancelScheduledLock(actingUserId: string, organizationId: string): Promise<void> {
  const org = await loadOrgForLifecycle(organizationId);
  if (!org.scheduledLockAt) return; // idempotent no-op - nothing to cancel

  await db.$transaction([
    db.organization.update({ where: { id: organizationId }, data: { scheduledLockAt: null } }),
    db.privilegedAccessEvent.create({
      data: {
        actingUserId, actionType: 'CANCEL_SCHEDULED_LOCK', organizationId,
        previousValue: { scheduledLockAt: org.scheduledLockAt.toISOString() },
      },
    }),
  ]);
}

// ===========================================================================
// TENANT CREDENTIAL AND ACCESS CONTROL (superadmin-roadmap Slice 7, D054/D055)
//
// "The single most sensitive slice in the whole roadmap" - the literal
// ability to take over any tenant admin's login. `resetTenantAdminPassword`
// and `changeTenantAdminUsername` are additionally gated by
// `requireRootPlatformOwner()` at the calling action (not here - this module
// stays scope-agnostic about WHO may call it, same as every other function
// above; the guard belongs with the other permission/scope checks in
// `actions.ts`, not duplicated into the server layer). `forceLogoutUser` is
// deliberately NOT root-gated, per the roadmap's own scoping: "a lighter
// action than a reset, useful on its own" - a Reseller Owner may force-log-out
// a user within their own subtree without needing root.
//
// Password values never appear in `previousValue`/`newValue` on any audit
// row - only the fact that a reset happened, by whom, for whom, and why.
// ===========================================================================

export interface TenantUserRow {
  id: string;
  userCode: string;
  fullName: string;
  username: string;
  email: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  roleNames: string[];
  activeSessions: number;
}

/** Read-only roster for a tenant - who the Platform Owner would be resetting, before doing it. */
export async function listTenantUsers(organizationId: string): Promise<TenantUserRow[]> {
  const users = await db.user.findMany({
    where: { organizationId },
    orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    include: {
      storeRoles: { include: { role: { select: { name: true } } } },
      sessions: { where: { isRevoked: false, loggedOutAt: null }, select: { id: true } },
    },
  });

  return users.map((u) => ({
    id: u.id,
    userCode: u.userCode,
    fullName: u.fullName,
    username: u.username,
    email: u.email,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt,
    roleNames: [...new Set(u.storeRoles.map((a) => a.role.name))].sort(),
    activeSessions: u.sessions.length,
  }));
}

async function loadTargetUser(organizationId: string, userId: string) {
  const user = await db.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, username: true } });
  if (!user) throw new PlatformAdminError('User not found in that tenant.');
  return user;
}

/**
 * Sets a new password for a tenant admin and force-logs-out every existing
 * session of theirs in the same transaction - a reset that leaves old
 * sessions alive does not actually lock anybody out. No password value is
 * ever written to `previousValue`/`newValue`.
 */
export async function resetTenantAdminPassword(
  actingUserId: string, organizationId: string, userId: string, newPassword: string, reason: string,
): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new PlatformAdminError('A reason is required to reset a password.');
  if (newPassword.length < 12) throw new PlatformAdminError('The new password must be at least 12 characters.');
  await loadTargetUser(organizationId, userId);

  const passwordHash = await hashPassword(newPassword);

  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash, failedLoginCount: 0, loginLockedUntil: null } }),
    db.loginSession.updateMany({
      where: { userId, isRevoked: false, loggedOutAt: null },
      data: { isRevoked: true, loggedOutAt: new Date() },
    }),
    db.privilegedAccessEvent.create({
      data: {
        actingUserId, actionType: 'PASSWORD_RESET', organizationId, targetUserId: userId, reason: trimmedReason,
      },
    }),
  ]);
}

/**
 * Changes a tenant admin's login username - same global-uniqueness check
 * `provisioning.ts` already applies to new accounts. Does not itself force a
 * logout (a `LoginSession` is keyed by token, not username), but the acting
 * caller may also call `forceLogoutUser` alongside this if the intent is a
 * full account takeover response.
 */
export async function changeTenantAdminUsername(
  actingUserId: string, organizationId: string, userId: string, newUsername: string, reason: string,
): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new PlatformAdminError('A reason is required to change a username.');
  const normalized = newUsername.trim().toLowerCase();
  if (!normalized) throw new PlatformAdminError('Enter a new username.');

  const target = await loadTargetUser(organizationId, userId);
  if (normalized === target.username) return; // idempotent no-op - already that username

  const clash = await db.user.findUnique({ where: { username: normalized } });
  if (clash) throw new PlatformAdminError(`The username "${normalized}" is already taken.`);

  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { username: normalized } }),
    db.privilegedAccessEvent.create({
      data: {
        actingUserId, actionType: 'USERNAME_CHANGE', organizationId, targetUserId: userId, reason: trimmedReason,
        previousValue: { username: target.username }, newValue: { username: normalized },
      },
    }),
  ]);
}

/** Revokes every live session for a user, no password change - a lighter action, e.g. for a compromised-device report. */
export async function forceLogoutUser(
  actingUserId: string, organizationId: string, userId: string, reason: string,
): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new PlatformAdminError('A reason is required to force a logout.');
  await loadTargetUser(organizationId, userId);

  await db.$transaction([
    db.loginSession.updateMany({
      where: { userId, isRevoked: false, loggedOutAt: null },
      data: { isRevoked: true, loggedOutAt: new Date() },
    }),
    db.privilegedAccessEvent.create({
      data: { actingUserId, actionType: 'FORCE_LOGOUT', organizationId, targetUserId: userId, reason: trimmedReason },
    }),
  ]);
}

// ===========================================================================
// TENANT CAPABILITY FLAGS (superadmin-roadmap Slice 8, D053)
// ===========================================================================

export interface TenantFlags {
  allowSelfServiceBusinessCreation: boolean;
  allowLinkedAccounts: boolean;
  /** Null = no cap. */
  businessLimit: number | null;
  branchLimit: number | null;
}

export async function setTenantFlags(
  actingUserId: string, organizationId: string, flags: TenantFlags,
): Promise<void> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { allowSelfServiceBusinessCreation: true, allowLinkedAccounts: true, businessLimit: true, branchLimit: true },
  });
  if (!org) throw new PlatformAdminError('Tenant not found.');
  for (const [label, v] of [['Business limit', flags.businessLimit], ['Branch limit', flags.branchLimit]] as const) {
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 10_000)) {
      throw new PlatformAdminError(`${label} must be a whole number from 0 to 10,000, or blank for no limit.`);
    }
  }

  await db.$transaction([
    db.organization.update({
      where: { id: organizationId },
      data: {
        allowSelfServiceBusinessCreation: flags.allowSelfServiceBusinessCreation,
        allowLinkedAccounts: flags.allowLinkedAccounts,
        businessLimit: flags.businessLimit,
        branchLimit: flags.branchLimit,
      },
    }),
    db.privilegedAccessEvent.create({
      data: {
        actingUserId, actionType: 'FEATURE_FLAG_CHANGE', organizationId,
        previousValue: { ...org }, newValue: { ...flags },
      },
    }),
  ]);
}

export interface TenantPlanInput {
  planId: string;
  /** Null means "use the plan's own cap". */
  userLimit: number | null;
  /** Null means "use the plan's own list". */
  excludedModules: string[] | null;
  /**
   * Individual pages switched off for this client, as routes (F-01, 10 Oct
   * 2026). An explicit list, never null: there is no plan default to fall
   * back to, and a plan that named pages would be a plan nobody could read.
   * Anything `lib/plans.isHideable` refuses is dropped, not stored - see the
   * check in `setTenantPlan`.
   */
  excludedPages: string[];
  trialEndsAt: Date | null;
  /**
   * Cross-module capabilities this client gets - lib/plans `PLATFORM_FEATURES`.
   *
   * An explicit list, never null: unlike modules, there is no plan default to
   * fall back to. Empty means none, which is what every tenant has unless the
   * platform owner says otherwise.
   */
  enabledFeatures: string[];
}

/**
 * Put a tenant on a plan (workstream F, 1 Oct 2026).
 *
 * The platform owner's decision about what a client may have AT ALL, as
 * opposed to what the client then chooses to show their own people. Enforced
 * in server/context.ts after the client's own menu resolution, so their
 * settings cannot overrule it.
 *
 * Recorded as a privileged access event like every other platform action -
 * changing what a client is entitled to is exactly the sort of thing that has
 * to be answerable later.
 */
export async function setTenantPlan(
  actingUserId: string, organizationId: string, input: TenantPlanInput,
): Promise<void> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      planId: true, userLimit: true, excludedModules: true, excludedPages: true,
      trialEndsAt: true, enabledFeatures: true,
    },
  });
  if (!org) throw new PlatformAdminError('Tenant not found.');

  if (!PLANS.some((p) => p.id === input.planId)) {
    throw new PlatformAdminError(`There is no plan called "${input.planId}".`);
  }
  if (input.userLimit !== null && (!Number.isInteger(input.userLimit) || input.userLimit < 1 || input.userLimit > 10_000)) {
    throw new PlatformAdminError('The user limit must be a whole number from 1 to 10,000, or blank for no limit.');
  }

  /**
   * Refuse a module name nobody will recognise rather than storing it.
   * A typo excludes nothing and looks like the plan is broken, which is a
   * far harder thing to diagnose than an error at the moment of saving.
   */
  if (input.excludedModules) {
    const unknown = input.excludedModules.filter(
      (m) => !(SELLABLE_MODULES as readonly string[]).includes(m),
    );
    if (unknown.length > 0) {
      throw new PlatformAdminError(`Not a module that can be switched off: ${unknown.join(', ')}.`);
    }
  }

  /**
   * A PAGE THE CLIENT CANNOT BE LOCKED OUT OF (10 Oct 2026).
   *
   * The page grain is sharp enough to be dangerous: hide `/settings/users`
   * and nobody in that business can ever add a person again, and the only
   * one who can undo it is whoever is reading this. `lib/plans.NEVER_HIDEABLE`
   * is the list, and refusing here - rather than quietly dropping it - is
   * deliberate: silently ignoring a tick looks like the feature is broken.
   */
  const refused = input.excludedPages.filter((r) => !isHideable(r));
  if (refused.length > 0) {
    throw new PlatformAdminError(
      `These cannot be switched off, or an Atlas is left that nobody can administer: ${refused.join(', ')}.`,
    );
  }

  // Same reasoning as the module check above: a feature id nobody recognises
  // switches nothing on and looks like the feature is broken.
  const features = resolveFeatures(input.enabledFeatures);
  const unknownFeatures = input.enabledFeatures.filter(
    (f) => !(features as readonly string[]).includes(f),
  );
  if (unknownFeatures.length > 0) {
    throw new PlatformAdminError(`Not a feature that can be switched on: ${unknownFeatures.join(', ')}.`);
  }

  await db.$transaction([
    db.organization.update({
      where: { id: organizationId },
      data: {
        planId: input.planId,
        userLimit: input.userLimit,
        excludedModules: input.excludedModules === null
          ? Prisma.DbNull
          : (input.excludedModules as unknown as object),
        excludedPages: [...new Set(input.excludedPages)],
        trialEndsAt: input.trialEndsAt,
        enabledFeatures: features,
      },
    }),
    db.privilegedAccessEvent.create({
      data: {
        actingUserId, actionType: 'FEATURE_FLAG_CHANGE', organizationId,
        previousValue: { ...org } as unknown as object,
        newValue: { ...input, trialEndsAt: input.trialEndsAt?.toISOString() ?? null } as unknown as object,
      },
    }),
  ]);
}

// ===========================================================================
// PLATFORM SETTINGS AND AUDIT VIEWER (superadmin-roadmap Slice 9)
// ===========================================================================

export async function getPlatformConfig(): Promise<{ id: string; maxResellerDepth: number }> {
  const config = await db.platformConfig.findFirst();
  if (!config) throw new PlatformAdminError('Platform configuration is not seeded - run npm run db:defaults.');
  return config;
}

/** Root-gated at the calling action (D055) - a config value every reseller depth check depends on. */
export async function updateMaxResellerDepth(actingUserId: string, maxResellerDepth: number): Promise<void> {
  if (!Number.isInteger(maxResellerDepth) || maxResellerDepth < 1) {
    throw new PlatformAdminError('Max reseller depth must be a whole number of at least 1.');
  }
  const config = await getPlatformConfig();

  await db.$transaction([
    db.platformConfig.update({ where: { id: config.id }, data: { maxResellerDepth } }),
    db.privilegedAccessEvent.create({
      data: {
        actingUserId, actionType: 'PLATFORM_CONFIG_CHANGE',
        previousValue: { maxResellerDepth: config.maxResellerDepth }, newValue: { maxResellerDepth },
      },
    }),
  ]);
}

export interface AuditEventRow {
  id: string;
  actingUserName: string;
  actionType: string;
  organizationName: string | null;
  targetUserName: string | null;
  reason: string | null;
  startedAt: Date;
}

export interface AuditFilter {
  organizationId?: string;
  actionType?: string;
  from?: Date;
  to?: Date;
}

/** Read-only, filterable - no delete route exists anywhere for this model, by construction. */
export async function listAuditEvents(scope: PlatformScope, filter: AuditFilter): Promise<AuditEventRow[]> {
  const events = await db.privilegedAccessEvent.findMany({
    where: {
      ...(filter.organizationId
        ? { organizationId: filter.organizationId }
        : scope.kind !== 'platform' ? { organization: platformScopeOrgWhere(scope) } : {}),
      ...(filter.actionType ? { actionType: filter.actionType } : {}),
      ...(filter.from || filter.to ? { startedAt: { gte: filter.from, lte: filter.to } } : {}),
    },
    include: {
      actingUser: { select: { fullName: true } },
      targetUser: { select: { fullName: true } },
      organization: { select: { name: true } },
    },
    orderBy: { startedAt: 'desc' },
    take: FEED_MAX_ROWS,
  });

  return events.map((e) => ({
    id: e.id,
    actingUserName: e.actingUser.fullName,
    actionType: e.actionType,
    organizationName: e.organization?.name ?? null,
    targetUserName: e.targetUser?.fullName ?? null,
    reason: e.reason,
    startedAt: e.startedAt,
  }));
}

// ===========================================================================
// RESELLER LIFECYCLE (superadmin-roadmap Slice 6/9 parity, D055)
//
// Same shape as tenant lifecycle above, on `PlatformAccount` instead of
// `Organization`. Root-gated at the calling action - a Reseller must never
// suspend itself or a sibling, and this is squarely the kind of action D055
// reserves for the root Platform Owner alone.
// ===========================================================================

async function loadResellerForLifecycle(platformAccountId: string) {
  const account = await db.platformAccount.findFirst({
    where: { id: platformAccountId, type: 'RESELLER' },
    select: { id: true, name: true, lifecycleState: true },
  });
  if (!account) throw new PlatformAdminError('Reseller not found.');
  return account;
}

export async function suspendReseller(actingUserId: string, platformAccountId: string, reason: string): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new PlatformAdminError('A reason is required to suspend a reseller.');
  const account = await loadResellerForLifecycle(platformAccountId);

  await db.$transaction([
    db.platformAccount.update({
      where: { id: platformAccountId },
      data: { lifecycleState: 'SUSPENDED', lockedAt: new Date(), lockedBy: actingUserId, lockReason: trimmedReason },
    }),
    db.privilegedAccessEvent.create({
      data: {
        actingUserId, actionType: 'RESELLER_SUSPEND', reason: trimmedReason,
        previousValue: { lifecycleState: account.lifecycleState, platformAccountId, platformAccountName: account.name },
        newValue: { lifecycleState: 'SUSPENDED' },
      },
    }),
  ]);
}

export async function reactivateReseller(actingUserId: string, platformAccountId: string, reason: string): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new PlatformAdminError('A reason is required to reactivate a reseller.');
  const account = await loadResellerForLifecycle(platformAccountId);

  await db.$transaction([
    db.platformAccount.update({
      where: { id: platformAccountId },
      data: { lifecycleState: 'ACTIVE', unlockedAt: new Date(), unlockedBy: actingUserId, scheduledLockAt: null },
    }),
    db.privilegedAccessEvent.create({
      data: {
        actingUserId, actionType: 'RESELLER_REACTIVATE', reason: trimmedReason,
        previousValue: { lifecycleState: account.lifecycleState, platformAccountId, platformAccountName: account.name },
        newValue: { lifecycleState: 'ACTIVE' },
      },
    }),
  ]);
}

/** Words that are routes under /shop, so cannot be a business's short name. */
const RESERVED_SHOP_SLUGS = new Set(['register', 'p', 'list', 'login', 'portal', 'admin', 'api']);

/**
 * Give a business its shop address, /shop/<slug> (3 Oct 2026).
 *
 * The platform owner's to set, like a plan: it is what the business's
 * customers are told to type, and on a shared server two businesses cannot
 * have the same one. Blank clears it, which takes the public shop offline
 * without touching the catalogue (portal customers still see it).
 */
export async function setTenantShopSlug(
  actingUserId: string, organizationId: string, raw: string,
): Promise<string | null> {
  const slug = raw.trim().toLowerCase() || null;
  if (slug !== null) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug) || slug.includes('--')) {
      throw new PlatformAdminError('Use 2-40 lower-case letters, digits and single hyphens - like "vcare" or "vcare-global".');
    }
    if (RESERVED_SHOP_SLUGS.has(slug)) throw new PlatformAdminError(`"${slug}" is used by the shop itself. Pick another.`);
    const taken = await db.organization.findFirst({
      where: { shopSlug: slug, id: { not: organizationId } },
      select: { name: true },
    });
    if (taken) throw new PlatformAdminError(`"${slug}" already belongs to ${taken.name}.`);
  }

  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { shopSlug: true } });
  if (!org) throw new PlatformAdminError('Tenant not found.');
  if (org.shopSlug === slug) return slug;

  await db.$transaction([
    db.organization.update({ where: { id: organizationId }, data: { shopSlug: slug } }),
    db.privilegedAccessEvent.create({
      data: {
        actingUserId, actionType: 'SHOP_ADDRESS_CHANGE', organizationId,
        previousValue: { shopSlug: org.shopSlug }, newValue: { shopSlug: slug },
      },
    }),
  ]);
  return slug;
}
