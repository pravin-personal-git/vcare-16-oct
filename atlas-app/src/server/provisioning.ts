import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { hashPassword } from './auth/password';
import { getFinancialYear } from '@/lib/financial-year';
import { branchCreationStatus } from './business-entitlements';
import { STANDARD_CHART_OF_ACCOUNTS } from '@/lib/chart-of-accounts';

/**
 * Creating a branch or a whole new business - in-app, without a terminal.
 *
 * Before 17 Sep 2026 the only way to add either was `prisma/provision-prod.ts`,
 * a script that also explicitly refuses to run a second time ("this database
 * already has an organisation"). That is correct for what it is - a one-time
 * bootstrap - but it left no answer at all for "I already have Atlas Demo
 * Company, how do I add a second branch" or "how do I set up a second
 * business for Switch Business to actually switch to." Both are real gaps a
 * live user hit.
 *
 * `Permission` and `Menu` are global rows, not per-organisation (see
 * schema.prisma) - every tenant shares one permission catalogue and one menu
 * tree, and a store's slice of it is just which `StoreMenuConfig`/
 * `RoleMenuConfig` rows exist. So neither function below creates permissions
 * or menus: it fetches the ones that already exist and wires a new store (and,
 * for a new business, a new organisation and admin user) onto them. This is
 * deliberately NOT a refactor of `provision-prod.ts` to share this logic -
 * that script's whole job is bootstrapping an EMPTY database and must keep
 * working with no rows to fetch; these functions assume the opposite, a
 * database that already has permissions and menus to reuse.
 */

export class ProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisioningError';
  }
}

export function userCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

const SEEDED_DOC_TYPES = ['QT', 'SO', 'INV', 'PO', 'GRN', 'GDN'];
const SEEDED_CUSTOMER_TYPES = ['Regular', 'Wholesale', 'VIP', 'Corporate'];

/**
 * Wires a brand-new `Store` onto every permission and menu that already
 * exists: an `isSystem` Admin role holding every permission, that role and
 * every menu enabled for the store, starter document sequences and customer
 * types - the same shape `provision-prod.ts` gives a store, minus creating
 * permissions/menus that are already there.
 */
async function wireNewStore(tx: Prisma.TransactionClient, storeId: string) {
  const [permissions, menus] = await Promise.all([
    tx.permission.findMany({ select: { id: true } }),
    tx.menu.findMany({ where: { deletedAt: null }, select: { id: true } }),
  ]);

  const role = await tx.role.create({
    data: { storeId, name: 'Admin', description: 'Full access', isSystem: true },
  });

  await tx.rolePermission.createMany({
    data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
  });
  await tx.storeMenuConfig.createMany({
    data: menus.map((m) => ({ storeId, menuId: m.id, isEnabled: true })),
  });
  await tx.roleMenuConfig.createMany({
    data: menus.map((m) => ({ storeId, roleId: role.id, menuId: m.id, isVisible: true })),
  });

  const financialYear = getFinancialYear();
  await tx.documentSequence.createMany({
    data: SEEDED_DOC_TYPES.map((docType) => ({ storeId, docType, financialYear })),
  });
  await tx.customerType.createMany({
    data: SEEDED_CUSTOMER_TYPES.map((name) => ({ storeId, name })),
  });

  return role;
}

export interface CreateBranchInput {
  name: string;
  branchCode: string;
  stateId?: string | null;
  cityId?: string | null;
  address?: string | null;
}

/**
 * Adds a new branch to an EXISTING organisation, and immediately grants the
 * calling user access to it - otherwise the person who just created it could
 * not open it without a second admin action.
 */
export async function createBranch(
  organizationId: string, callingUserId: string, input: CreateBranchInput,
): Promise<{ storeId: string; branchCode: string }> {
  const name = input.name.trim();
  const branchCode = input.branchCode.trim().toUpperCase();
  if (!name) throw new ProvisioningError('Give the branch a name.');
  if (!/^[A-Z0-9]{2,10}$/.test(branchCode)) {
    throw new ProvisioningError('Branch code must be 2-10 letters/numbers, e.g. BR002.');
  }

  // The plan's branch cap (Platform Owner setting, 25 Sep 2026).
  const cap = await branchCreationStatus(organizationId);
  if (!cap.allowed) throw new ProvisioningError(cap.reason!);

  const clash = await db.store.findFirst({ where: { organizationId, branchCode } });
  if (clash) throw new ProvisioningError(`Branch code "${branchCode}" is already used in this organisation.`);

  // Every Store needs a LegalEntity (D046). A new branch joins the
  // organisation's earliest one - the same "default entity" convention
  // `backfill-legal-entity.ts` established - until a screen exists to pick
  // a different one explicitly (not built yet: this org may have several).
  const defaultEntity = await db.legalEntity.findFirst({
    where: { organizationId }, orderBy: { createdAt: 'asc' }, select: { id: true },
  });
  if (!defaultEntity) throw new ProvisioningError('This organisation has no legal entity to attach the branch to.');

  const store = await db.$transaction(async (tx) => {
    const created = await tx.store.create({
      data: {
        organizationId, name, branchCode,
        legalEntityId: defaultEntity.id,
        stateId: input.stateId?.trim() || null,
        cityId: input.cityId?.trim() || null,
        address: input.address?.trim() || null,
      },
    });

    const role = await wireNewStore(tx, created.id);

    await tx.userStoreRole.create({
      data: { userId: callingUserId, storeId: created.id, roleId: role.id },
    });

    return created;
  });

  return { storeId: store.id, branchCode: store.branchCode };
}

export interface CreateBusinessInput {
  orgName: string;
  storeName: string;
  branchCode: string;
  adminFullName: string;
  adminUsername: string;
  adminEmail: string | null;
  adminPassword: string;
  /**
   * Which PlatformAccount this tenant sits under (D048/D049). Defaults to
   * the single root PLATFORM account - a direct Atlas customer, not under
   * any reseller - which is exactly right for the existing self-service
   * "Switch Business" path below. The Platform Owner "create tenant" flow
   * (`platform-admin.ts`) passes this explicitly instead.
   */
  platformAccountId?: string;
  /**
   * The business this one was created from, via "Create a new business" -
   * counted against that business's `businessLimit`. Unset for tenants the
   * Platform Owner or a reseller provisions.
   */
  fromOrganizationId?: string;
}

/**
 * Creates a wholly separate business - a new `Organization`, its first
 * `LegalEntity` and `Store`, and a new admin `User` with their own login.
 *
 * `callingUserId` is the EXISTING tenant user requesting a second business
 * for themselves ("Switch Business"), in which case the two accounts are
 * linked both ways, exactly the way `linked-accounts.ts::linkAccount` links
 * any other second account - EXCEPT no password re-entry is needed: the
 * caller just set that password themselves, two lines above, so asking them
 * to type it again to "prove" they know it would be theatre.
 *
 * `null` instead means a Platform Owner or Reseller is provisioning this
 * tenant for a customer who does not yet have any Atlas login of their own -
 * there is no existing account to link it to, and linking it to the
 * platform staff member's own login would wrongly hand them a permanent
 * "Switch Business" shortcut into every tenant they ever provision, which is
 * a different feature from impersonation/Access Tenant and must stay
 * separate from it.
 *
 * Two organisations created this way share nothing except the global
 * permission/menu catalogue and (when linked) this one bidirectional link -
 * no data, no store, no chart of accounts. That isolation is the entire
 * point; see `linked-accounts.ts`'s own module comment.
 */
export async function createBusiness(
  callingUserId: string | null, input: CreateBusinessInput,
): Promise<{ organizationId: string; storeId: string; adminUsername: string }> {
  const orgName = input.orgName.trim();
  const storeName = input.storeName.trim();
  const branchCode = input.branchCode.trim().toUpperCase();
  const adminUsername = input.adminUsername.trim().toLowerCase();
  const adminFullName = input.adminFullName.trim() || adminUsername;

  if (!orgName) throw new ProvisioningError('Give the business a name.');
  if (!storeName) throw new ProvisioningError('Give the first branch a name.');
  if (!/^[A-Z0-9]{2,10}$/.test(branchCode)) {
    throw new ProvisioningError('Branch code must be 2-10 letters/numbers, e.g. BR001.');
  }
  if (!adminUsername) throw new ProvisioningError('Give the new admin a username.');
  if (input.adminPassword.length < 12) {
    throw new ProvisioningError('The admin password must be at least 12 characters.');
  }

  const usernameClash = await db.user.findUnique({ where: { username: adminUsername } });
  if (usernameClash) throw new ProvisioningError(`The username "${adminUsername}" is already taken.`);

  const passwordHash = await hashPassword(input.adminPassword);

  const result = await db.$transaction(async (tx) => {
    // ORG-2026-3841 rather than provision-prod.ts's fixed "-0001" - this path
    // runs in a database that can already hold other organisations, so the
    // suffix has to actually distinguish them.
    const orgCode = `ORG-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const platformAccountId = input.platformAccountId
      ?? (await tx.platformAccount.findFirstOrThrow({
        where: { type: 'PLATFORM', parentAccountId: null },
        select: { id: true },
      })).id;

    const org = await tx.organization.create({
      data: {
        orgCode, name: orgName, countryCode: '+91', email: input.adminEmail?.trim() || null,
        platformAccountId,
        createdFromOrganizationId: input.fromOrganizationId ?? null,
        createdByUserId: input.fromOrganizationId ? callingUserId : null,
      },
    });

    // Every tenant starts with exactly one LegalEntity (D046), named after
    // the organisation itself - the same default `backfill-legal-entity.ts`
    // gave every pre-existing tenant. Splitting into several is a later,
    // explicit action; this just means the org is never without one.
    const legalEntity = await tx.legalEntity.create({
      data: { organizationId: org.id, name: orgName, status: 'APPROVED', approvedAt: new Date() },
    });

    const store = await tx.store.create({
      data: { organizationId: org.id, legalEntityId: legalEntity.id, name: storeName, branchCode },
    });

    const role = await wireNewStore(tx, store.id);

    const topLevelAccounts = STANDARD_CHART_OF_ACCOUNTS.filter((a) => !a.parentCode);
    const childAccounts = STANDARD_CHART_OF_ACCOUNTS.filter((a) => a.parentCode);
    for (const a of topLevelAccounts) {
      await tx.account.create({
        data: { organizationId: org.id, code: a.code, name: a.name, type: a.type, subType: a.subType ?? null },
      });
    }
    for (const a of childAccounts) {
      const parent = await tx.account.findUnique({
        where: { organizationId_code: { organizationId: org.id, code: a.parentCode! } },
        select: { id: true },
      });
      await tx.account.create({
        data: {
          organizationId: org.id, code: a.code, name: a.name, type: a.type,
          subType: a.subType ?? null, parentId: parent?.id ?? null,
        },
      });
    }

    const admin = await tx.user.create({
      data: {
        userCode: userCode(),
        organizationId: org.id,
        fullName: adminFullName,
        username: adminUsername,
        email: input.adminEmail?.trim() || null,
        passwordHash,
      },
    });

    await tx.userStoreRole.create({
      data: { userId: admin.id, storeId: store.id, roleId: role.id },
    });

    // Link both ways, same shape as linkAccount - ownership was just proven
    // by setting this password, so there is nothing left to verify. Skipped
    // entirely for a platform-provisioned tenant (`callingUserId === null`)
    // - see the module comment above for why.
    if (callingUserId) {
      await tx.linkedAccount.upsert({
        where: { ownerUserId_linkedUserId: { ownerUserId: callingUserId, linkedUserId: admin.id } },
        update: {},
        create: { ownerUserId: callingUserId, linkedUserId: admin.id, label: orgName },
      });
      const owner = await tx.user.findUniqueOrThrow({ where: { id: callingUserId }, select: { fullName: true } });
      await tx.linkedAccount.upsert({
        where: { ownerUserId_linkedUserId: { ownerUserId: admin.id, linkedUserId: callingUserId } },
        update: {},
        create: { ownerUserId: admin.id, linkedUserId: callingUserId, label: owner.fullName },
      });
    }

    return { organizationId: org.id, storeId: store.id, adminUsername: admin.username };
  }, { timeout: 15_000 });
  // Default interactive-transaction timeout (5s) is too tight for this one -
  // the chart-of-accounts loop above is ~40 sequential round trips (one
  // `create`, some also a `findUnique` for the parent), which measurably hit
  // that default and failed with a real, reproducible P2028 ("transaction
  // not found") while this function was being exercised for the first time
  // from a NEW caller (the platform-ownership Slice 4 create-tenant flow) -
  // the same code path self-service "Switch Business" has always used, this
  // was simply the first time it got hit enough times in a row to surface
  // it. Prisma auto-rolls-back on timeout, so no partial data was ever left
  // behind - confirmed by checking for it - but a user-facing action
  // failing on an internal transaction limit is worth fixing outright
  // rather than leaving as a rare, confusing "please try again."

  return result;
}
