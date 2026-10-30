import 'server-only';
import { db } from './db';
import { forgetMenuConfig } from './menu-cache';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { randomInt } from 'node:crypto';
import { hashPassword, verifyPassword } from './auth/password';
import {
  MIN_PASSWORD_LENGTH, checkChosenPassword, generatePassword,
} from '@/lib/password-policy';
import { revokeDevice } from './call-logs';
import { keepPasswordCopy } from './password-copy';
import type { Prisma } from '@prisma/client';
import { cleanAppearance, type Appearance } from '@/lib/appearance';

/**
 * Administration - the configuration surface.
 *
 * Everything in this file existed as a *model* long before it existed as a
 * screen. Roles, permissions, the two-tier menu gate, the master lists behind
 * every dropdown - all built, all tested, and all administered by editing SQL
 * by hand. That is fine for one developer and impossible for a client.
 *
 * WHY THIS MODULE IS THE ONE THAT MAKES ATLAS A PRODUCT
 *
 * A white-label product is not one that *can* be rebranded. It is one that can
 * be rebranded, re-scoped and re-permissioned **without a developer**. Until
 * this module existed, standing up a client meant running a seed script and
 * then hand-editing rows - which does not scale past the first client and is
 * exactly how a product business turns into a services business.
 *
 * FOUR SAFETY RULES, ENFORCED HERE RATHER THAN IN THE UI
 *
 *  1. **You cannot lock yourself out.** An admin may not remove their own last
 *     admin role, deactivate their own account, or delete the role that grants
 *     them access. A disabled button is a suggestion; this is the rule.
 *  2. **The last admin of a store cannot be removed.** A store with no
 *     administrator is a store nobody can configure again.
 *  3. **System roles cannot be deleted or renamed.** They are referenced by
 *     the provisioning scripts and by `sync-tenant-defaults`.
 *  4. **A master row still in use cannot be deleted.** It is deactivated
 *     instead, so historical documents keep resolving their references.
 *
 * Spec: 12-users-roles-permissions.md, 13-system-settings.md
 */

// ===========================================================================
// USERS
// ===========================================================================
//
// Users belong to an ORGANISATION, not a store - one person can hold roles in
// several branches. So these take an organisationId rather than a StoreScope.
// The store filter happens at the role-assignment level, below.

export interface UserRow {
  id: string;
  userCode: string;
  fullName: string;
  username: string;
  email: string | null;
  phone: string | null;
  departmentName: string | null;
  isActive: boolean;
  isSeatLicensed: boolean;
  avatarColor: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  /**
   * Can this person get in, and if not why not (3 Oct 2026).
   *
   * Atlas held every one of these facts and showed none of them, so the only way
   * to find out whether somebody could sign in was to reset their password and
   * ask. See lib/password-policy `accessState`.
   */
  mustChangePassword: boolean;
  passwordSetAt: Date | null;
  loginLockedUntil: Date | null;
  failedLoginCount: number;
  /** Every store/role pair this person holds. */
  assignments: { storeId: string; storeName: string; roleId: string; roleName: string }[];
  activeSessions: number;
}

export async function listUsers(organizationId: string): Promise<UserRow[]> {
  const users = await db.user.findMany({
    where: { organizationId },
    orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    include: {
      department: { select: { name: true } },
      storeRoles: {
        include: {
          store: { select: { id: true, name: true } },
          role: { select: { id: true, name: true } },
        },
      },
      sessions: {
        where: { isRevoked: false, loggedOutAt: null },
        select: { id: true },
      },
    },
  });

  return users.map((u) => ({
    id: u.id,
    userCode: u.userCode,
    fullName: u.fullName,
    username: u.username,
    email: u.email,
    phone: u.phone,
    departmentName: u.department?.name ?? null,
    isActive: u.isActive,
    isSeatLicensed: u.isSeatLicensed,
    avatarColor: u.avatarColor,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    mustChangePassword: u.mustChangePassword,
    passwordSetAt: u.passwordSetAt,
    loginLockedUntil: u.loginLockedUntil,
    failedLoginCount: u.failedLoginCount,
    assignments: u.storeRoles.map((a) => ({
      storeId: a.store.id,
      storeName: a.store.name,
      roleId: a.role.id,
      roleName: a.role.name,
    })),
    activeSessions: u.sessions.length,
  }));
}

/** Six-character code, matching the convention in `provision-prod.ts`. */
function userCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export interface UserInput {
  fullName: string;
  username: string;
  email: string | null;
  phone: string | null;
  departmentId: string | null;
  password: string;
  isSeatLicensed: boolean;
  /** At least one, or the user can sign in and see nothing. */
  assignments: { storeId: string; roleId: string }[];
}

export class AdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminError';
  }
}

/**
 * Create a user, with their role assignments, in one transaction.
 *
 * A user row without a `UserStoreRole` resolves to a null context and is
 * bounced straight back to the login screen - see `context.ts`. So creating one
 * without an assignment produces an account that appears to work and does not.
 * Refused here rather than left as a trap.
 */
export async function createUser(
  organizationId: string,
  input: UserInput,
  /**
   * More rows that must exist with the login or not at all - the guided "Add
   * a person" (B3, 11 Oct 2026) writes the employee record here, so a login
   * can never be made without one (Pravin, P3).
   */
  alsoInside?: (tx: Prisma.TransactionClient, userId: string) => Promise<void>,
) {
  const username = input.username.trim().toLowerCase();
  if (!username) throw new AdminError('A username is required.');
  if (!input.fullName.trim()) throw new AdminError('A full name is required.');
  if (input.password.length < 12) {
    throw new AdminError('The password must be at least 12 characters.');
  }
  if (input.assignments.length === 0) {
    throw new AdminError(
      'Give the user at least one store and role - an account with none can sign in but sees nothing.',
    );
  }

  /**
   * The plan's user cap (workstream F).
   *
   * Checked here rather than in the screen, because the screen is not the
   * only way in - and a limit a client can walk past by using a different
   * route is not a limit. Counts ACTIVE users only: deactivating somebody
   * should free their seat, which is what "a seat" means commercially.
   */
  const { entitlementFor, userCount } = await import('./entitlement');
  const { canAddUser } = await import('@/lib/plans');
  const seat = canAddUser(await entitlementFor(organizationId), await userCount(organizationId));
  if (!seat.allowed) throw new AdminError(seat.reason!);

  const clash = await db.user.findUnique({ where: { username } });
  if (clash) throw new AdminError(`The username "${username}" is already taken.`);

  // Every target store must belong to this organisation. Without this check a
  // crafted request could attach a user to another tenant's store.
  const stores = await db.store.findMany({
    where: { organizationId, id: { in: input.assignments.map((a) => a.storeId) } },
    select: { id: true },
  });
  const permitted = new Set(stores.map((s) => s.id));
  for (const a of input.assignments) {
    if (!permitted.has(a.storeId)) throw new AdminError('Unknown store.');
  }

  const passwordHash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        userCode: userCode(),
        organizationId,
        fullName: input.fullName.trim(),
        username,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        departmentId: input.departmentId || null,
        isSeatLicensed: input.isSeatLicensed,
        passwordHash,
      },
    });
    // The admin-readable copy (Vcare, 9 Oct 2026) - see server/password-copy.
    await keepPasswordCopy(tx, user.id, input.password);

    await tx.userStoreRole.createMany({
      data: input.assignments.map((a) => ({
        userId: user.id,
        storeId: a.storeId,
        roleId: a.roleId,
      })),
      skipDuplicates: true,
    });

    if (alsoInside) await alsoInside(tx, user.id);
    return user;
  });
}

export interface UserPatch {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  departmentId?: string | null;
  isSeatLicensed?: boolean;
  /** A key from `AVATAR_COLOR_OPTIONS` (`src/lib/avatar.ts`), or null to go back to the automatic colour. */
  avatarColor?: string | null;
}

export async function updateUser(organizationId: string, userId: string, patch: UserPatch) {
  const user = await db.user.findFirst({ where: { id: userId, organizationId } });
  if (!user) throw new AdminError('User not found.');

  return db.user.update({
    where: { id: userId },
    data: {
      ...(patch.fullName !== undefined ? { fullName: patch.fullName.trim() } : {}),
      ...(patch.email !== undefined ? { email: patch.email?.trim() || null } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone?.trim() || null } : {}),
      ...(patch.departmentId !== undefined ? { departmentId: patch.departmentId || null } : {}),
      ...(patch.isSeatLicensed !== undefined ? { isSeatLicensed: patch.isSeatLicensed } : {}),
      ...(patch.avatarColor !== undefined ? { avatarColor: patch.avatarColor } : {}),
    },
  });
}

/**
 * Activate or deactivate an account.
 *
 * Deactivating revokes every live session in the same transaction. Leaving them
 * running would mean a dismissed employee keeps working until their cookie
 * expires - up to thirty days with "remember me".
 */
export async function setUserActive(
  organizationId: string,
  userId: string,
  isActive: boolean,
  actingUserId: string,
) {
  if (userId === actingUserId && !isActive) {
    throw new AdminError('You cannot deactivate your own account.');
  }

  const user = await db.user.findFirst({ where: { id: userId, organizationId } });
  if (!user) throw new AdminError('User not found.');

  return db.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: userId }, data: { isActive } });

    if (!isActive) {
      await tx.loginSession.updateMany({
        where: { userId, isRevoked: false, loggedOutAt: null },
        data: { isRevoked: true, loggedOutAt: new Date() },
      });
    }

    return updated;
  });
}

/**
 * Set a new password for someone else.
 *
 * There is no "send a reset link" - outbound email needs the worker tier that
 * does not exist yet (Phase 6). An administrator setting a password and telling
 * the person is the honest interim, and it is what the recovery script does
 * from the command line today.
 *
 * Every session is revoked, because a password change that leaves old sessions
 * alive does not actually lock anybody out.
 */
export async function resetUserPassword(
  organizationId: string,
  userId: string,
  newPassword: string,
) {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new AdminError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const user = await db.user.findFirst({ where: { id: userId, organizationId } });
  if (!user) throw new AdminError('User not found.');

  const passwordHash = await hashPassword(newPassword);

  return db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash, failedLoginCount: 0, loginLockedUntil: null,
        // Not forced to change any more (Pravin, option b, 9 Oct 2026): the
        // password the admin sets IS the password, and the admin can look it
        // up later. Clears a flag left by an earlier reset, too.
        mustChangePassword: false,
        passwordSetAt: new Date(),
      },
    });
    await keepPasswordCopy(tx, userId, newPassword);
    await tx.loginSession.updateMany({
      where: { userId, isRevoked: false, loggedOutAt: null },
      data: { isRevoked: true, loggedOutAt: new Date() },
    });
  });
}

/**
 * Reset a password WITHOUT anybody having to invent one (3 Oct 2026).
 *
 * The answer to "let me see each employee's password". That is not possible -
 * `passwordHash` is a one-way scrypt fingerprint, there is nothing stored to
 * show - and making it possible would mean one database leak handing over every
 * employee's password in plain text. See lib/password-policy for the whole
 * reasoning.
 *
 * What the request was actually about is solved here: the admin presses one
 * button, Atlas generates a strong password, and it is returned ONCE so the
 * screen can show it. It is never stored in readable form, never logged, and
 * never retrievable again - a second look means a second reset, which is
 * correct, because by then two people have seen the first one.
 *
 * The account is flagged `mustChangePassword`, so that password works exactly
 * long enough to sign in and is then replaced by one only its owner knows.
 */
export async function issueTemporaryPassword(
  organizationId: string,
  userId: string,
): Promise<{ fullName: string; username: string; password: string }> {
  const user = await db.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true, fullName: true, username: true },
  });
  if (!user) throw new AdminError('User not found.');

  const password = generatePassword((max) => randomInt(max));
  const passwordHash = await hashPassword(password);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        // Was `true` until 9 Oct 2026 - see resetUserPassword above.
        mustChangePassword: false,
        passwordSetAt: new Date(),
        // Clears a lockout as a side effect, which is what an admin wants: the
        // person is locked out BECAUSE they could not remember the password,
        // and they are about to be given a new one.
        failedLoginCount: 0,
        loginLockedUntil: null,
      },
    });
    await keepPasswordCopy(tx, userId, password);
    /**
     * Every session goes. A password reset that leaves old sessions alive does
     * not actually lock anybody out - which matters most in the case this is
     * usually used for, somebody who has left.
     */
    await tx.loginSession.updateMany({
      where: { userId, isRevoked: false, loggedOutAt: null },
      data: { isRevoked: true, loggedOutAt: new Date() },
    });
    await tx.mobileRefreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  /**
   * NOTHING IS LOGGED HERE ON PURPOSE, and that is not an omission.
   *
   * The `atlas_audit` trigger already records this `User` update into
   * `AuditEvent`, in the same transaction, with the acting user taken from
   * `app.actor` - and it redacts `passwordHash` to "(hidden) -> (changed)"
   * because the column name matches its secret list. So the fact of the reset,
   * who did it and when is already answerable, and the password itself is
   * nowhere (AGENTS.md section 6).
   *
   * A second hand-written log line here would add nothing and would be one more
   * place a future change could accidentally put the password.
   */
  return { fullName: user.fullName, username: user.username, password };
}

/**
 * The person sets their own, ending the temporary one.
 *
 * Their current password is checked even though they are already signed in: a
 * logged-in session left open on a shared counter PC must not be enough to lock
 * the real owner out of their own account.
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, fullName: true, passwordHash: true },
  });
  if (!user) throw new AdminError('User not found.');

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AdminError('That is not your current password.');
  }

  const verdict = checkChosenPassword(newPassword, {
    username: user.username, fullName: user.fullName,
  });
  if (!verdict.ok) throw new AdminError(verdict.reason);

  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new AdminError('That is the password you are already using. Choose a different one.');
  }

  const passwordHash = await hashPassword(newPassword);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: false,
        passwordSetAt: new Date(),
        failedLoginCount: 0,
        loginLockedUntil: null,
      },
    });
    // Their own choice is kept for the admin too - the set-password screen
    // tells them so before they type it.
    await keepPasswordCopy(tx, userId, newPassword);
    /**
     * Other sessions are revoked, not this one.
     *
     * Somebody changing their password because they think it is known needs the
     * other sessions gone; revoking their own as well would sign them out
     * mid-action and read as the change having failed.
     */
    await tx.mobileRefreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
}

// ===========================================================================
// ROLES AND PERMISSIONS
// ===========================================================================
//
// A Role belongs to a STORE. "Sales Manager" in Bhilai and in Raipur are two
// rows and may carry different permissions - which is right, because branches
// are run differently.

export interface RoleRow {
  id: string;
  storeId: string;
  storeName: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionKeys: string[];
  userCount: number;
}

export async function listRoles(scope: StoreScope): Promise<RoleRow[]> {
  const roles = await db.role.findMany({
    where: scopeWhere(scope),
    orderBy: [{ store: { name: 'asc' } }, { isSystem: 'desc' }, { name: 'asc' }],
    include: {
      store: { select: { name: true } },
      permissions: { include: { permission: { select: { key: true } } } },
      _count: { select: { userStoreRoles: true } },
    },
  });

  return roles.map((r) => ({
    id: r.id,
    storeId: r.storeId,
    storeName: r.store.name,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissionKeys: r.permissions.map((p) => p.permission.key).sort(),
    userCount: r._count.userStoreRoles,
  }));
}

/** Every permission key in the system, grouped by module for the checkbox grid. */
export async function listPermissions() {
  const perms = await db.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] });

  const byModule = new Map<string, { id: string; key: string; action: string }[]>();
  for (const p of perms) {
    const list = byModule.get(p.module) ?? [];
    list.push({ id: p.id, key: p.key, action: p.action });
    byModule.set(p.module, list);
  }

  return [...byModule.entries()].map(([module, items]) => ({ module, items }));
}

export async function createRole(
  scope: StoreScope,
  input: { name: string; description: string | null; permissionKeys: string[] },
) {
  const storeId = scopeForWrite(scope);
  const name = input.name.trim();
  if (!name) throw new AdminError('A role name is required.');

  const clash = await db.role.findFirst({ where: { storeId, name } });
  if (clash) throw new AdminError(`A role called "${name}" already exists in this store.`);

  const perms = await db.permission.findMany({ where: { key: { in: input.permissionKeys } } });

  return db.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: { storeId, name, description: input.description?.trim() || null, isSystem: false },
    });

    if (perms.length) {
      await tx.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }

    return role;
  });
}

/**
 * Replace a role's permission set.
 *
 * Wholesale replacement rather than a diff: a permission grid is submitted as a
 * complete picture of what the role should hold, and reconciling adds against
 * removes buys nothing but a chance to get it wrong.
 *
 * The acting user's own effective permissions are checked afterwards. Stripping
 * `settings.edit` from the only role you hold locks you out of the screen you
 * are standing on, and the failure is silent until the next navigation.
 */
export async function setRolePermissions(
  scope: StoreScope,
  roleId: string,
  permissionKeys: string[],
  actingUserId: string,
) {
  const role = await db.role.findFirst({
    where: { id: roleId, ...scopeWhere(scope) },
    include: { userStoreRoles: { where: { userId: actingUserId }, select: { userId: true } } },
  });
  if (!role) throw new AdminError('Role not found.');

  const heldByActor = role.userStoreRoles.length > 0;
  if (heldByActor && !permissionKeys.includes('settings.edit')) {
    throw new AdminError(
      'You hold this role. Removing "settings.edit" from it would lock you out of this screen - '
      + 'assign yourself another admin role first.',
    );
  }

  const perms = await db.permission.findMany({ where: { key: { in: permissionKeys } } });

  return db.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (perms.length) {
      await tx.rolePermission.createMany({
        data: perms.map((p) => ({ roleId, permissionId: p.id })),
      });
    }
  });
}

export async function renameRole(
  scope: StoreScope,
  roleId: string,
  name: string,
  description: string | null,
) {
  const role = await db.role.findFirst({ where: { id: roleId, ...scopeWhere(scope) } });
  if (!role) throw new AdminError('Role not found.');
  if (role.isSystem) throw new AdminError('A system role cannot be renamed.');

  return db.role.update({
    where: { id: roleId },
    data: { name: name.trim(), description: description?.trim() || null },
  });
}

/**
 * Delete a role.
 *
 * Refused while anyone still holds it. Cascading the delete would silently
 * strip those people of access, and they would discover it at the login screen
 * with no explanation. Reassign first, then delete.
 */
export async function deleteRole(
  scope: StoreScope, roleId: string, userId: string | null = null,
) {
  const role = await db.role.findFirst({
    where: { id: roleId, ...scopeWhere(scope) },
    include: { _count: { select: { userStoreRoles: true } } },
  });
  if (!role) throw new AdminError('Role not found.');
  if (role.isSystem) throw new AdminError('A system role cannot be deleted.');
  if (role._count.userStoreRoles > 0) {
    throw new AdminError(
      `${role._count.userStoreRoles} user(s) still hold this role. Reassign them before deleting it.`,
    );
  }

  /**
   * Tombstoned, not removed (3 Oct 2026). A deleted role that resurrects from
   * another machine grants permissions somebody took away on purpose, which is
   * the worst outcome in the whole hard-delete list. `server/soft-delete` keeps
   * it out of every top-level read.
   */
  return db.role.update({
    where: { id: roleId },
    data: { deletedAt: new Date(), deletedBy: userId },
  });
}

// ===========================================================================
// ROLE ASSIGNMENT - user × store × role
// ===========================================================================

/**
 * Grant a role in a store.
 *
 * `createMany` with `skipDuplicates` rather than a create, because the primary
 * key is the triple and re-granting an existing assignment is a no-op the user
 * should not see an error for.
 */
export async function assignRole(
  organizationId: string,
  userId: string,
  storeId: string,
  roleId: string,
) {
  const [user, role] = await Promise.all([
    db.user.findFirst({ where: { id: userId, organizationId } }),
    db.role.findFirst({ where: { id: roleId, storeId, store: { organizationId } } }),
  ]);
  if (!user) throw new AdminError('User not found.');
  if (!role) throw new AdminError('That role does not belong to that store.');

  await db.userStoreRole.createMany({
    data: [{ userId, storeId, roleId }],
    skipDuplicates: true,
  });
}

/**
 * Revoke a role.
 *
 * Two guards, both about not creating an unrecoverable state:
 *
 *  - You cannot remove your own last assignment. You would be signed out on the
 *    next request with no way back in.
 *  - You cannot remove the last admin of a store. That store becomes
 *    unconfigurable by anyone.
 */
export async function removeAssignment(
  organizationId: string,
  userId: string,
  storeId: string,
  roleId: string,
  actingUserId: string,
) {
  const user = await db.user.findFirst({
    where: { id: userId, organizationId },
    include: { storeRoles: true },
  });
  if (!user) throw new AdminError('User not found.');

  if (userId === actingUserId && user.storeRoles.length <= 1) {
    throw new AdminError(
      'This is your only role. Removing it would sign you out with no way back in.',
    );
  }

  const role = await db.role.findFirst({ where: { id: roleId, storeId } });
  if (role?.isSystem) {
    const others = await db.userStoreRole.count({
      where: { storeId, roleId, userId: { not: userId } },
    });
    if (others === 0) {
      throw new AdminError(
        `${user.fullName} is the last administrator of this store. Assign someone else first.`,
      );
    }
  }

  await db.userStoreRole.deleteMany({ where: { userId, storeId, roleId } });
}

// ===========================================================================
// MENU CONFIGURATION - the two-tier gate
// ===========================================================================
//
//     effective_menus = store_config ∩ (⋃ role_config for the user's roles)
//
// This is the single most useful screen for a white-label deployment. Forty of
// Atlas's fifty-eight routes are placeholders; a client who clicks one finds
// nothing, and trust does not come back. Switching those menus OFF for a store
// makes the product honest in an afternoon, with no code change - and switching
// them back on is how a module ships.

export interface MenuNodeConfig {
  id: string;
  parentId: string | null;
  label: string;
  route: string | null;
  sort: number;
  /** Enabled for this store. Absent config rows read as enabled. */
  storeEnabled: boolean;
  /** roleId → visible. Absent config rows read as visible. */
  roleVisible: Record<string, boolean>;
}

export async function getMenuMatrix(scope: StoreScope) {
  const storeId = scopeForWrite(scope);

  const [menus, roles, storeCfg, roleCfg] = await db.$transaction([
    db.menu.findMany({
      where: { platform: 'WEB', deletedAt: null },
      orderBy: { sort: 'asc' },
      select: { id: true, parentId: true, label: true, route: true, sort: true },
    }),
    db.role.findMany({
      where: { storeId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isSystem: true },
    }),
    db.storeMenuConfig.findMany({ where: { storeId }, select: { menuId: true, isEnabled: true } }),
    db.roleMenuConfig.findMany({
      where: { storeId },
      select: { menuId: true, roleId: true, isVisible: true },
    }),
  ]);

  const storeMap = new Map(storeCfg.map((c) => [c.menuId, c.isEnabled]));
  const roleMap = new Map(roleCfg.map((c) => [`${c.roleId}:${c.menuId}`, c.isVisible]));

  const nodes: MenuNodeConfig[] = menus.map((m) => ({
    id: m.id,
    parentId: m.parentId,
    label: m.label,
    route: m.route,
    sort: m.sort,
    storeEnabled: storeMap.get(m.id) ?? false,
    roleVisible: Object.fromEntries(
      roles.map((r) => [r.id, roleMap.get(`${r.id}:${m.id}`) ?? false]),
    ),
  }));

  return { nodes, roles };
}

/**
 * Enable or disable a menu for the store - the outer bound.
 *
 * Disabling a parent takes its children with it. Leaving a child enabled under
 * a disabled parent produces a route nobody can navigate to but which still
 * counts as "on", and the next person to read the config cannot tell what was
 * intended.
 */
export async function setStoreMenu(scope: StoreScope, menuId: string, isEnabled: boolean) {
  const storeId = scopeForWrite(scope);

  const children = await db.menu.findMany({ where: { parentId: menuId }, select: { id: true } });
  const ids = [menuId, ...children.map((c) => c.id)];

  await db.$transaction(
    ids.map((id) =>
      db.storeMenuConfig.upsert({
        where: { storeId_menuId: { storeId, menuId: id } },
        create: { storeId, menuId: id, isEnabled },
        update: { isEnabled },
      }),
    ),
  );
  forgetMenuConfig();
}

export async function setRoleMenu(
  scope: StoreScope,
  roleId: string,
  menuId: string,
  isVisible: boolean,
) {
  const storeId = scopeForWrite(scope);

  const role = await db.role.findFirst({ where: { id: roleId, storeId } });
  if (!role) throw new AdminError('Role not found in this store.');

  const children = await db.menu.findMany({ where: { parentId: menuId }, select: { id: true } });
  const ids = [menuId, ...children.map((c) => c.id)];

  await db.$transaction(
    ids.map((id) =>
      db.roleMenuConfig.upsert({
        where: { storeId_roleId_menuId: { storeId, roleId, menuId: id } },
        create: { storeId, roleId, menuId: id, isVisible },
        update: { isVisible },
      }),
    ),
  );
  forgetMenuConfig();
}

/** A specific person's menu overrides, keyed by menu id - present only where a row exists. */
export async function getUserMenuOverrides(scope: StoreScope, userId: string): Promise<Record<string, boolean>> {
  const storeId = scopeForWrite(scope);
  const rows = await db.userMenuConfig.findMany({
    where: { storeId, userId },
    select: { menuId: true, isVisible: true },
  });
  return Object.fromEntries(rows.map((r) => [r.menuId, r.isVisible]));
}

/**
 * Hide or show one menu for one specific person, layered on top of
 * `store ∩ role` - see `resolveMenus` in `permissions.ts` for the resolution
 * order. `override: null` removes the row entirely, going back to
 * "inherit whatever the role says" - there is no third stored state for
 * that, its absence IS the meaning.
 */
export async function setUserMenu(
  scope: StoreScope, userId: string, menuId: string, override: boolean | null,
) {
  const storeId = scopeForWrite(scope);

  const holdsRole = await db.userStoreRole.findFirst({ where: { storeId, userId } });
  if (!holdsRole) throw new AdminError('That person does not have access to this store.');

  const children = await db.menu.findMany({ where: { parentId: menuId }, select: { id: true } });
  const ids = [menuId, ...children.map((c) => c.id)];

  if (override === null) {
    await db.userMenuConfig.deleteMany({ where: { storeId, userId, menuId: { in: ids } } });
    forgetMenuConfig();
    return;
  }

  await db.$transaction(
    ids.map((id) =>
      db.userMenuConfig.upsert({
        where: { storeId_userId_menuId: { storeId, userId, menuId: id } },
        create: { storeId, userId, menuId: id, isVisible: override },
        update: { isVisible: override },
      }),
    ),
  );
  forgetMenuConfig();
}

/**
 * Turn on every menu that has a working screen behind it, and turn off the
 * rest - for one store, across every role.
 *
 * This is the one-click version of the honesty fix. The list of built routes is
 * passed in by the caller rather than inferred, because "does this screen work"
 * is a judgement the route catalogue already holds and this module should not
 * duplicate.
 */
export async function applyBuiltOnlyMenus(scope: StoreScope, builtRoutes: string[]) {
  const storeId = scopeForWrite(scope);
  const built = new Set(builtRoutes);

  const [menus, roles] = await Promise.all([
    db.menu.findMany({
      where: { platform: 'WEB', deletedAt: null },
      select: { id: true, parentId: true, route: true },
    }),
    db.role.findMany({ where: { storeId }, select: { id: true } }),
  ]);

  // A leaf is on if its route is built. A group is on if any child is on.
  const onLeaf = new Set(
    menus.filter((m) => m.route && built.has(m.route)).map((m) => m.id),
  );
  const parentsWithLiveChild = new Set(
    menus.filter((m) => m.parentId && onLeaf.has(m.id)).map((m) => m.parentId as string),
  );

  const decide = (m: { id: string; parentId: string | null; route: string | null }) =>
    onLeaf.has(m.id) || parentsWithLiveChild.has(m.id);

  await db.$transaction([
    ...menus.map((m) =>
      db.storeMenuConfig.upsert({
        where: { storeId_menuId: { storeId, menuId: m.id } },
        create: { storeId, menuId: m.id, isEnabled: decide(m) },
        update: { isEnabled: decide(m) },
      }),
    ),
    ...roles.flatMap((r) =>
      menus.map((m) =>
        db.roleMenuConfig.upsert({
          where: { storeId_roleId_menuId: { storeId, roleId: r.id, menuId: m.id } },
          create: { storeId, roleId: r.id, menuId: m.id, isVisible: decide(m) },
          update: { isVisible: decide(m) },
        }),
      ),
    ),
  ]);

  forgetMenuConfig();
  return { enabled: menus.filter(decide).length, total: menus.length };
}

// ===========================================================================
// MASTER DATA - the editable lists behind every dropdown
// ===========================================================================
//
// Categories, brands, customer types, lead stages and sources, deal stages,
// payment types, tax rates, warehouses, departments and T&C templates.
//
// These were seed data. A fresh production tenant therefore had empty dropdowns
// and no way to fill them, which meant every product landed as GEN-00001 with
// no classification. Making them editable is what turns provisioning a client
// from a developer task into an afternoon.

export type MasterKind =
  | 'category' | 'subCategory' | 'brand' | 'customerType'
  | 'leadStage' | 'leadSource' | 'leadDealStage'
  | 'paymentType' | 'taxRate' | 'warehouse' | 'department' | 'tncTemplate';

export interface MasterItem {
  id: string;
  name: string;
  /** Second column - a code, a prefix, a percentage. Meaning varies by kind. */
  detail: string | null;
  /** `taxRate` only - the HSN code this rate applies to. `TaxRate.hsnPattern` existed on the model well before any screen read or wrote it. */
  hsnPattern: string | null;
  parentId: string | null;
  parentName: string | null;
  isActive: boolean;
  /** How many live records point at this row. Drives delete-vs-deactivate. */
  usageCount: number;
  /** `tncTemplate` only - the full text, so the edit form opens filled in. */
  body?: string;
  /** `tncTemplate` only - document types and "cat:<id>" it is the default for. */
  defaultFor?: string[];
}

export interface MasterKindMeta {
  kind: MasterKind;
  label: string;
  /**
   * Spelled out rather than derived by stripping an "s".
   *
   * That trick produced "Add Product Categorie" and "Add Terms & Condition".
   * English plurals are not a string operation, and a button that misspells
   * itself is the kind of small wrongness that makes a product feel unfinished.
   */
  singular: string;
  description: string;
  /** Label for the `detail` column, or null when the kind has none. */
  detailLabel: string | null;
  detailHint?: string;
  supportsParent?: boolean;
}

export const MASTER_KINDS: MasterKindMeta[] = [
  {
    kind: 'category', label: 'Product Categories',
    singular: 'Product Category',
    description: 'Top-level product classification. The code prefix drives product codes - CAM-00001.',
    detailLabel: 'Code prefix', detailHint: 'Two to four letters, e.g. CAM',
  },
  {
    kind: 'subCategory', label: 'Product Sub-Categories',
    singular: 'Product Sub-Category',
    description: 'Second level, filtered by category on the quotation product picker.',
    detailLabel: 'Code prefix', supportsParent: true,
  },
  {
    kind: 'brand', label: 'Brands',
    singular: 'Brand',
    description: 'Manufacturer or brand shown on the product and the quotation line.',
    detailLabel: null,
  },
  {
    kind: 'customerType', label: 'Customer Types',
    singular: 'Customer Type',
    description: 'Segments used when qualifying a lead and pricing a customer.',
    detailLabel: null,
  },
  {
    kind: 'leadStage', label: 'Lead Stages',
    singular: 'Lead Stage',
    description: 'The CRM pipeline. Order here is the order on the lead board.',
    detailLabel: null,
  },
  {
    kind: 'leadSource', label: 'Lead Sources',
    singular: 'Lead Source',
    description: 'Where a lead came from - IndiaMART, walk-in, referral.',
    detailLabel: null,
  },
  {
    kind: 'leadDealStage', label: 'Deal Stages',
    singular: 'Deal Stage',
    description: 'Deal progression, tracked separately from the lead stage.',
    detailLabel: null,
  },
  {
    kind: 'paymentType', label: 'Payment Methods',
    singular: 'Payment Method',
    description: 'Cash, cheque, UPI, NEFT - offered when recording a receipt.',
    detailLabel: null,
  },
  {
    kind: 'taxRate', label: 'GST Rates',
    singular: 'GST Rate',
    description: 'Rates offered on a product and a document line. A rate has no '
      + 'active flag - an unwanted rate is deleted, because an inactive tax rate '
      + 'is not a concept GST has.',
    detailLabel: 'Rate %', detailHint: 'e.g. 18 or 12.5',
  },
  {
    kind: 'warehouse', label: 'Warehouses',
    singular: 'Warehouse',
    description: 'Stock locations. Every movement is recorded against one.',
    detailLabel: 'Code',
  },
  {
    kind: 'department', label: 'Departments',
    singular: 'Department',
    description: 'Used for staff grouping and task routing.',
    detailLabel: 'Code',
  },
  {
    kind: 'tncTemplate', label: 'Terms & Conditions',
    singular: 'Terms Template',
    description: 'Reusable terms offered on quotations, orders and invoices.',
    detailLabel: null,
  },
];

export async function listMasters(scope: StoreScope, kind: MasterKind): Promise<MasterItem[]> {
  const where = scopeWhere(scope);

  const shape = (
    id: string, name: string, detail: string | null, isActive: boolean,
    usageCount = 0, parentId: string | null = null, parentName: string | null = null,
    hsnPattern: string | null = null,
  ): MasterItem => ({ id, name, detail, hsnPattern, parentId, parentName, isActive, usageCount });

  switch (kind) {
    case 'category':
    case 'subCategory': {
      const rows = await db.category.findMany({
        where: { ...where, parentId: kind === 'category' ? null : { not: null } },
        orderBy: { name: 'asc' },
        include: {
          parent: { select: { name: true } },
          // A category is referenced two ways - as a product's category and as
          // its sub-category. Both count as "in use".
          _count: { select: { products: true, subOf: true, children: true } },
        },
      });
      return rows.map((r) => shape(
        r.id, r.name, r.codePrefix, r.isActive,
        r._count.products + r._count.subOf,
        r.parentId, r.parent?.name ?? null,
      ));
    }
    case 'brand': {
      const rows = await db.brand.findMany({
        where, orderBy: { name: 'asc' },
        include: { _count: { select: { products: true } } },
      });
      return rows.map((r) => shape(r.id, r.name, null, r.isActive, r._count.products));
    }
    case 'customerType': {
      const rows = await db.customerType.findMany({
        where, orderBy: { name: 'asc' },
        include: { _count: { select: { parties: true } } },
      });
      return rows.map((r) => shape(r.id, r.name, null, r.isActive, r._count.parties));
    }
    case 'leadStage': {
      const rows = await db.leadStage.findMany({
        where, orderBy: [{ sort: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { leads: true } } },
      });
      return rows.map((r) => shape(r.id, r.name, null, r.isActive, r._count.leads));
    }
    case 'leadSource': {
      const rows = await db.leadSource.findMany({
        where, orderBy: { name: 'asc' },
        include: { _count: { select: { leads: true } } },
      });
      return rows.map((r) => shape(r.id, r.name, null, r.isActive, r._count.leads));
    }
    case 'leadDealStage': {
      const rows = await db.leadDealStage.findMany({
        where, orderBy: { name: 'asc' },
        include: { _count: { select: { leads: true } } },
      });
      return rows.map((r) => shape(r.id, r.name, null, r.isActive, r._count.leads));
    }
    case 'paymentType': {
      const rows = await db.paymentType.findMany({ where, orderBy: { name: 'asc' } });
      return rows.map((r) => shape(r.id, r.name, null, r.isActive));
    }
    case 'taxRate': {
      // TaxRate carries no isActive column - a rate that should not be offered
      // is deleted, because an inactive tax rate is not a concept GST has.
      const rows = await db.taxRate.findMany({ where, orderBy: { ratePct: 'asc' } });
      return rows.map((r) => shape(r.id, r.name, `${r.ratePct.toString()}%`, true, 0, null, null, r.hsnPattern));
    }
    case 'warehouse': {
      const rows = await db.warehouse.findMany({
        where, orderBy: { name: 'asc' },
        include: { _count: { select: { balances: true } } },
      });
      return rows.map((r) => shape(r.id, r.name, r.code, r.isActive, r._count.balances));
    }
    case 'department': {
      const rows = await db.department.findMany({
        where, orderBy: { name: 'asc' },
        include: { _count: { select: { users: true } } },
      });
      return rows.map((r) => shape(r.id, r.name, r.code, r.isActive, r._count.users));
    }
    case 'tncTemplate': {
      const rows = await db.tncTemplate.findMany({
        where, orderBy: { name: 'asc' },
        include: { _count: { select: { quotations: true } } },
      });
      return rows.map((r) => ({
        ...shape(
          r.id, r.name,
          // Show the opening of the body so the list reads without opening each row.
          r.body.length > 60 ? `${r.body.slice(0, 60)}…` : r.body || null,
          r.isActive, r._count.quotations,
        ),
        body: r.body,
        defaultFor: r.defaultFor,
      }));
    }
    default: {
      const never: never = kind;
      throw new AdminError(`Unknown master list: ${String(never)}`);
    }
  }
}

/** The document types a terms template can be the default for. */
export const TERMS_DOC_TYPES = [
  { key: 'quotation', label: 'Quotations' },
  { key: 'sales_order', label: 'Sales orders' },
  { key: 'invoice', label: 'Invoices' },
] as const;

function cleanDefaultFor(v: string[] | undefined): string[] {
  const docs = new Set<string>(TERMS_DOC_TYPES.map((d) => d.key));
  return [...new Set((v ?? []).filter((x) => docs.has(x) || /^cat:[\w-]+$/.test(x)))];
}

export interface MasterInput {
  name: string;
  detail: string | null;
  parentId: string | null;
  body?: string | null;
  /** `taxRate` only. */
  hsnPattern?: string | null;
  /** `tncTemplate` only. */
  defaultFor?: string[];
}

export async function createMaster(scope: StoreScope, kind: MasterKind, input: MasterInput) {
  const storeId = scopeForWrite(scope);
  const name = input.name.trim();
  if (!name) throw new AdminError('A name is required.');

  const detail = input.detail?.trim() || null;

  switch (kind) {
    case 'category':
      return db.category.create({
        data: { storeId, name, codePrefix: (detail ?? name.slice(0, 3)).toUpperCase(), parentId: null },
      });
    case 'subCategory':
      if (!input.parentId) throw new AdminError('Choose a parent category.');
      return db.category.create({
        data: {
          storeId, name, parentId: input.parentId,
          codePrefix: (detail ?? name.slice(0, 3)).toUpperCase(),
        },
      });
    case 'brand':
      return db.brand.create({ data: { storeId, name } });
    case 'customerType':
      return db.customerType.create({ data: { storeId, name } });
    case 'leadStage':
      return db.leadStage.create({ data: { storeId, name } });
    case 'leadSource':
      return db.leadSource.create({ data: { storeId, name } });
    case 'leadDealStage':
      return db.leadDealStage.create({ data: { storeId, name } });
    case 'paymentType':
      // `code` is unique per store and required. Derived rather than asked for -
      // nobody has an opinion about the code for "Cheque".
      return db.paymentType.create({
        data: {
          storeId, name,
          code: (detail ?? name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12),
        },
      });
    case 'taxRate': {
      const pct = Number(String(detail ?? '').replace('%', ''));
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new AdminError('Enter a rate between 0 and 100.');
      }
      // Every rate hangs off a TaxType. A tenant that has never had one gets a
      // GST type here rather than being sent to another screen first.
      const taxType = await db.taxType.findFirst({ where: { storeId } })
        ?? await db.taxType.create({ data: { storeId, name: 'GST', code: 'GST' } });

      return db.taxRate.create({
        data: {
          storeId, taxTypeId: taxType.id, name, ratePct: pct,
          hsnPattern: input.hsnPattern?.trim() || null,
        },
      });
    }
    case 'warehouse':
      return db.warehouse.create({
        data: { storeId, name, code: (detail ?? name.slice(0, 4)).toUpperCase() },
      });
    case 'department':
      return db.department.create({
        data: { storeId, name, code: (detail ?? name.slice(0, 4)).toUpperCase() },
      });
    case 'tncTemplate':
      if (!input.body?.trim()) throw new AdminError('The terms text is required.');
      return db.tncTemplate.create({
        data: { storeId, name, body: input.body.trim(), defaultFor: cleanDefaultFor(input.defaultFor) },
      });
    default: {
      const never: never = kind;
      throw new AdminError(`Unknown master list: ${String(never)}`);
    }
  }
}

/**
 * Rename, re-detail, or activate/deactivate a master row.
 *
 * Deliberately no delete for most kinds - see `setMasterActive`. Renaming is
 * safe because documents snapshot the *name* they used at the time, so an old
 * quotation keeps reading what it said.
 */
export async function updateMaster(
  scope: StoreScope,
  kind: MasterKind,
  id: string,
  patch: { name?: string; detail?: string | null; isActive?: boolean; body?: string | null; hsnPattern?: string | null; defaultFor?: string[] },
) {
  const where = { id, ...scopeWhere(scope) };
  const name = patch.name?.trim();
  const detail = patch.detail?.trim() || null;

  const common = {
    ...(name ? { name } : {}),
    ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
  };

  switch (kind) {
    case 'category':
    case 'subCategory': {
      const row = await db.category.findFirst({ where });
      if (!row) throw new AdminError('Not found.');
      return db.category.update({
        where: { id },
        data: { ...common, ...(detail ? { codePrefix: detail.toUpperCase() } : {}) },
      });
    }
    case 'brand': {
      const row = await db.brand.findFirst({ where });
      if (!row) throw new AdminError('Not found.');
      return db.brand.update({ where: { id }, data: common });
    }
    case 'customerType': {
      const row = await db.customerType.findFirst({ where });
      if (!row) throw new AdminError('Not found.');
      return db.customerType.update({ where: { id }, data: common });
    }
    case 'leadStage': {
      const row = await db.leadStage.findFirst({ where });
      if (!row) throw new AdminError('Not found.');
      return db.leadStage.update({ where: { id }, data: common });
    }
    case 'leadSource': {
      const row = await db.leadSource.findFirst({ where });
      if (!row) throw new AdminError('Not found.');
      return db.leadSource.update({ where: { id }, data: common });
    }
    case 'leadDealStage': {
      const row = await db.leadDealStage.findFirst({ where });
      if (!row) throw new AdminError('Not found.');
      return db.leadDealStage.update({ where: { id }, data: common });
    }
    case 'paymentType': {
      const row = await db.paymentType.findFirst({ where });
      if (!row) throw new AdminError('Not found.');
      return db.paymentType.update({ where: { id }, data: common });
    }
    case 'taxRate': {
      const row = await db.taxRate.findFirst({ where });
      if (!row) throw new AdminError('Not found.');
      const pct = detail === null ? undefined : Number(detail.replace('%', ''));
      if (pct !== undefined && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
        throw new AdminError('Enter a rate between 0 and 100.');
      }
      // No isActive on this model - see listMasters.
      return db.taxRate.update({
        where: { id },
        data: {
          ...(name ? { name } : {}),
          ...(pct !== undefined ? { ratePct: pct } : {}),
          ...(patch.hsnPattern !== undefined ? { hsnPattern: patch.hsnPattern?.trim() || null } : {}),
        },
      });
    }
    case 'warehouse': {
      const row = await db.warehouse.findFirst({ where });
      if (!row) throw new AdminError('Not found.');
      return db.warehouse.update({
        where: { id },
        data: { ...common, ...(detail ? { code: detail.toUpperCase() } : {}) },
      });
    }
    case 'department': {
      const row = await db.department.findFirst({ where });
      if (!row) throw new AdminError('Not found.');
      return db.department.update({
        where: { id },
        data: { ...common, ...(detail ? { code: detail.toUpperCase() } : {}) },
      });
    }
    case 'tncTemplate': {
      const row = await db.tncTemplate.findFirst({ where });
      if (!row) throw new AdminError('Not found.');
      return db.tncTemplate.update({
        where: { id },
        data: {
          ...common,
          // Blank means "keep the text" - the form says so, and a template with
          // no text is not a template.
          ...(patch.body?.trim() ? { body: patch.body.trim() } : {}),
          ...(patch.defaultFor !== undefined ? { defaultFor: cleanDefaultFor(patch.defaultFor) } : {}),
        },
      });
    }
    default: {
      const never: never = kind;
      throw new AdminError(`Unknown master list: ${String(never)}`);
    }
  }
}

/**
 * Delete a master row - only while nothing points at it.
 *
 * The usage count comes from `listMasters`, and the check is repeated here
 * because the count the browser is holding may be minutes old. A row in use is
 * deactivated instead: it disappears from every dropdown and every historical
 * document still resolves it.
 */
export async function deleteMaster(
  scope: StoreScope, kind: MasterKind, id: string, userId: string | null = null,
) {
  const items = await listMasters(scope, kind);
  const item = items.find((i) => i.id === id);
  if (!item) throw new AdminError('Not found.');

  if (item.usageCount > 0) {
    throw new AdminError(
      `${item.usageCount} record(s) still use "${item.name}". Deactivate it instead - `
      + 'it will disappear from the dropdowns and existing records keep working.',
    );
  }

  /**
   * TOMBSTONED, NOT REMOVED (3 Oct 2026).
   *
   * These rows used to be deleted outright, on the reasoning that the usage check
   * above proves nothing references them. That reasoning holds on ONE machine. On
   * two - which is what F3 and the Windows build are for - a row deleted here and
   * a row the other machine has not sent yet look identical to the hub, so it
   * either resurrects the deletion or deletes rows it has never seen.
   *
   * `server/soft-delete` keeps the dead rows out of every top-level read, so
   * nothing a person can see changes.
   */
  const data = { deletedAt: new Date(), deletedBy: userId };
  const where = { id };

  switch (kind) {
    case 'category':
    case 'subCategory': {
      // Only LIVE children block it. A tombstoned sub-category is already gone as
      // far as anybody can see, and counting it would make a deleted parent
      // undeletable forever - the filter in soft-delete.ts handles this `count`.
      const kids = await db.category.count({ where: { parentId: id } });
      if (kids > 0) throw new AdminError(`${kids} sub-categories sit under this. Remove them first.`);
      return db.category.update({ where, data });
    }
    case 'brand': return db.brand.update({ where, data });
    case 'customerType': return db.customerType.update({ where, data });
    case 'leadStage': return db.leadStage.update({ where, data });
    case 'leadSource': return db.leadSource.update({ where, data });
    case 'leadDealStage': return db.leadDealStage.update({ where, data });
    case 'paymentType': return db.paymentType.update({ where, data });
    case 'taxRate': return db.taxRate.update({ where, data });
    case 'warehouse': return db.warehouse.update({ where, data });
    case 'department': return db.department.update({ where, data });
    case 'tncTemplate': return db.tncTemplate.update({ where, data });
    default: {
      const never: never = kind;
      throw new AdminError(`Unknown master list: ${String(never)}`);
    }
  }
}

// ===========================================================================
// LEGAL ENTITIES (D046)
// ===========================================================================

export interface LegalEntityRow {
  id: string;
  name: string;
  legalName: string | null;
  gstin: string | null;
  pan: string | null;
  registrationNumber: string | null;
  status: string;
  storeCount: number;
  createdAt: Date;
}

/**
 * Read-only for now (Slice 2 of the platform-ownership phase) - every
 * tenant already has exactly one, created by `backfill-legal-entity.ts`
 * when this shipped. Create/approve/multi-entity workflows (spec §6-§7)
 * are a later slice; this just makes the concept visible.
 */
export async function listLegalEntities(organizationId: string): Promise<LegalEntityRow[]> {
  const entities = await db.legalEntity.findMany({
    where: { organizationId },
    include: { _count: { select: { stores: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return entities.map((e) => ({
    id: e.id,
    name: e.name,
    legalName: e.legalName,
    gstin: e.gstin,
    pan: e.pan,
    registrationNumber: e.registrationNumber,
    status: e.status,
    storeCount: e._count.stores,
    createdAt: e.createdAt,
  }));
}

// ===========================================================================
// ORGANISATION PROFILE AND THEME
// ===========================================================================

export async function getOrganization(organizationId: string) {
  return db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: {
      stores: {
        orderBy: { name: 'asc' },
        select: {
          id: true, name: true, branchCode: true, stateId: true, cityId: true,
          address: true, currency: true, timezone: true, locale: true, isActive: true,
        },
      },
    },
  });
}

export interface OrgPatch {
  name?: string;
  gstin?: string | null;
  email?: string | null;
  mobile?: string | null;
  industry?: string | null;
  orgSize?: string | null;
  paymentLink?: string | null;
}

export async function updateOrganization(organizationId: string, patch: OrgPatch) {
  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) throw new AdminError('The organisation name is required.');

  return db.organization.update({
    where: { id: organizationId },
    data: {
      ...(name ? { name } : {}),
      ...(patch.gstin !== undefined ? { gstin: patch.gstin?.trim() || null } : {}),
      ...(patch.email !== undefined ? { email: patch.email?.trim() || null } : {}),
      ...(patch.mobile !== undefined ? { mobile: patch.mobile?.trim() || null } : {}),
      ...(patch.industry !== undefined ? { industry: patch.industry?.trim() || null } : {}),
      ...(patch.orgSize !== undefined ? { orgSize: patch.orgSize?.trim() || null } : {}),
      ...(patch.paymentLink !== undefined ? { paymentLink: patch.paymentLink?.trim() || null } : {}),
    },
  });
}

/** The five brand-image slots plus the payment QR, each a single Organization column. */
export const BRAND_ASSET_FIELD = {
  logo: 'logoPath',
  seal: 'sealPath',
  icon: 'iconPath',
  favicon: 'faviconPath',
  invoiceLogo: 'invoiceLogoPath',
  paymentQr: 'paymentQrPath',
} as const;

export type BrandAssetKind = keyof typeof BRAND_ASSET_FIELD;

export async function setOrgBrandAsset(organizationId: string, kind: BrandAssetKind, storagePath: string) {
  const field = BRAND_ASSET_FIELD[kind];
  return db.organization.update({
    where: { id: organizationId },
    data: { [field]: storagePath },
  });
}

export async function clearOrgBrandAsset(organizationId: string, kind: BrandAssetKind) {
  const field = BRAND_ASSET_FIELD[kind];
  return db.organization.update({
    where: { id: organizationId },
    data: { [field]: null },
  });
}

/**
 * The palette tokens a tenant may override.
 *
 * Deliberately a short list. Every colour in the product derives from these -
 * hovers, foregrounds and muted variants are computed in CSS - so exposing the
 * full token set would let a client produce combinations nobody can read, and
 * the support cost of that lands on us.
 *
 * Values are **bare HSL triples** (`197 100% 44%`), not `hsl(...)` and not hex,
 * because Tailwind's opacity modifiers (`bg-brand/10`) only compose when the
 * token is not already a complete colour.
 */
export const THEME_TOKENS = [
  {
    key: '--brand-primary', label: 'Primary',
    hint: 'Buttons, links, active states',
    // Mirrors globals.css. Kept as an HSL triple rather than hex so this file
    // does not trip the no-hard-coded-colours lint rule - which exists for a
    // good reason and should not be silenced just because this is the one
    // screen legitimately about colour. `hslTripleToHex` feeds the picker.
    fallback: '224 76.3% 48%',
  },
  {
    key: '--brand-navy', label: 'Header / deep',
    hint: 'Record headers, avatars, the login panel',
    fallback: '213 94% 19%',
  },
  {
    key: '--brand-accent', label: 'Accent',
    hint: 'Rare irreversible actions. Use sparingly',
    fallback: '12 100% 67%',
  },
] as const;

const HSL_TRIPLE = /^\d{1,3}\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%$/;

/** `#00A1E0` → `197 100% 44%`. Returns null for anything unparseable. */
export function hexToHslTriple(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;

  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 1000) / 10}% ${Math.round(l * 1000) / 10}%`;
}

/** `197 100% 44%` → `#00a1e0`, for the colour input. */
export function hslTripleToHex(triple: string): string | null {
  const m = /^(\d{1,3})\s+([\d.]+)%\s+([\d.]+)%$/.exec(triple.trim());
  if (!m) return null;

  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;

  const hue = (p: number, q: number, t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = l; g = l; b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }

  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Save the tenant palette.
 *
 * An empty object means "use the product default" - which is why clearing is a
 * first-class outcome rather than something to work around. `sync-tenant-defaults`
 * relies on it: a tenant holding a superseded palette is reset by writing `{}`.
 */
export async function setThemeTokens(organizationId: string, tokens: Record<string, string>) {
  const clean: Record<string, unknown> = {};

  for (const { key } of THEME_TOKENS) {
    const raw = tokens[key]?.trim();
    if (!raw) continue;

    const triple = raw.startsWith('#') ? hexToHslTriple(raw) : raw;
    if (!triple || !HSL_TRIPLE.test(triple)) {
      throw new AdminError(`"${raw}" is not a colour I can read. Use a hex value like #00A1E0.`);
    }
    clean[key] = triple;
  }

  // The Appearance choices live in the same JSON (lib/appearance.ts) and are
  // saved by their own screen; a palette save must not wipe them.
  const current = await db.organization.findUnique({ where: { id: organizationId }, select: { themeTokens: true } });
  const appearance = (current?.themeTokens as Record<string, unknown> | null)?.appearance;
  if (appearance && typeof appearance === 'object') clean.appearance = appearance;
  // So does the page background (12 Oct 2026) - its own control on Appearance.
  const pageBackground = (current?.themeTokens as Record<string, unknown> | null)?.pageBackground;
  if (pageBackground && typeof pageBackground === 'object') clean.pageBackground = pageBackground;
  // And the colours of the boxes and the text (12 Oct 2026, lib/look).
  const look = (current?.themeTokens as Record<string, unknown> | null)?.look;
  if (look && typeof look === 'object') clean.look = look;

  return db.organization.update({
    where: { id: organizationId },
    data: { themeTokens: clean as Prisma.InputJsonObject },
  });
}

/**
 * Save Settings › Appearance (UI refresh, 4 Oct 2026). Every value is checked
 * against lib/appearance's lists and an unknown one is refused. The palette
 * tokens already saved are kept; `palette` (from a preset or the pickers)
 * replaces them when given.
 */
export async function setAppearance(
  organizationId: string,
  input: Partial<Record<keyof Appearance, string>>,
  palette?: Record<string, string>,
) {
  let appearance: Appearance;
  try {
    appearance = cleanAppearance(input);
  } catch (e) {
    throw new AdminError((e as Error).message);
  }
  if (palette) await setThemeTokens(organizationId, palette);
  const current = await db.organization.findUnique({ where: { id: organizationId }, select: { themeTokens: true } });
  const tokens = { ...((current?.themeTokens as Record<string, unknown> | null) ?? {}), appearance };
  return db.organization.update({
    where: { id: organizationId },
    data: { themeTokens: tokens as unknown as Prisma.InputJsonObject },
  });
}

/** The page background (Settings > Appearance), checked by lib/page-background. Other tokens are kept. */
export async function setPageBackground(organizationId: string, input: unknown) {
  const { cleanPageBackground, PageBackgroundError } = await import('@/lib/page-background');
  let bg;
  try { bg = cleanPageBackground(input); } catch (e) {
    if (e instanceof PageBackgroundError) throw new AdminError(e.message);
    throw e;
  }
  const current = await db.organization.findUnique({ where: { id: organizationId }, select: { themeTokens: true } });
  const tokens: Record<string, unknown> = { ...((current?.themeTokens as Record<string, unknown> | null) ?? {}) };
  if (bg.kind === 'default') delete tokens.pageBackground; else tokens.pageBackground = bg;
  await db.organization.update({ where: { id: organizationId }, data: { themeTokens: tokens as unknown as Prisma.InputJsonObject } });
  return bg;
}

/** The colours of the top bar, cards, tables, buttons and text (Settings > Appearance), checked by lib/look. Other tokens are kept. */
export async function setLook(organizationId: string, input: unknown) {
  const { cleanLook, isDefaultLook, LookError } = await import('@/lib/look');
  let look;
  try { look = cleanLook(input); } catch (e) {
    if (e instanceof LookError) throw new AdminError(e.message);
    throw e;
  }
  const current = await db.organization.findUnique({ where: { id: organizationId }, select: { themeTokens: true } });
  const tokens: Record<string, unknown> = { ...((current?.themeTokens as Record<string, unknown> | null) ?? {}) };
  if (isDefaultLook(look)) delete tokens.look; else tokens.look = look;
  await db.organization.update({ where: { id: organizationId }, data: { themeTokens: tokens as unknown as Prisma.InputJsonObject } });
  return look;
}

/** Reset to Atlas defaults: palette and every Appearance choice. */
export async function resetAppearance(organizationId: string) {
  return db.organization.update({ where: { id: organizationId }, data: { themeTokens: {} } });
}

export interface StorePatch {
  name?: string;
  stateId?: string | null;
  cityId?: string | null;
  address?: string | null;
  currency?: string;
  timezone?: string;
  isActive?: boolean;
  legalEntityId?: string;
}

/**
 * Update a branch.
 *
 * `branchCode` is **not** editable. It is baked into every document number this
 * store has ever issued - changing it would orphan `QT-BR052-2026-0007` from
 * the branch that raised it, and GST expects that link to hold.
 */
export async function updateStore(organizationId: string, storeId: string, patch: StorePatch) {
  const store = await db.store.findFirst({ where: { id: storeId, organizationId } });
  if (!store) throw new AdminError('Store not found.');

  if (patch.legalEntityId !== undefined) {
    // Never take the target entity on trust from the caller - it must
    // belong to the SAME organisation this store already does, or a typo'd
    // id could silently move a branch's statutory identity under another
    // tenant's LegalEntity.
    const entity = await db.legalEntity.findFirst({
      where: { id: patch.legalEntityId, organizationId },
    });
    if (!entity) throw new AdminError('That legal entity does not belong to this organisation.');
  }

  return db.store.update({
    where: { id: storeId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.stateId !== undefined ? { stateId: patch.stateId?.trim() || null } : {}),
      ...(patch.cityId !== undefined ? { cityId: patch.cityId?.trim() || null } : {}),
      ...(patch.address !== undefined ? { address: patch.address?.trim() || null } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      ...(patch.legalEntityId !== undefined ? { legalEntityId: patch.legalEntityId } : {}),
    },
  });
}

// ===========================================================================
// LOGIN SESSIONS
// ===========================================================================

export interface SessionRow {
  id: string;
  userId: string;
  userName: string;
  username: string;
  ipAddress: string | null;
  userAgent: string | null;
  loginAt: Date;
  lastActiveAt: Date;
  isCurrent: boolean;
}

/**
 * Live sessions across the organisation.
 *
 * The spec asks for this screen *and* for remote revocation, which is the
 * reason sessions live in the database rather than in a JWT - you cannot revoke
 * a stateless token. This is that screen.
 */
export async function listSessions(
  organizationId: string,
  currentToken: string | null,
): Promise<SessionRow[]> {
  const rows = await db.loginSession.findMany({
    where: {
      isRevoked: false,
      loggedOutAt: null,
      user: { organizationId },
    },
    orderBy: { lastActiveAt: 'desc' },
    include: { user: { select: { id: true, fullName: true, username: true } } },
  });

  return rows.map((s) => ({
    id: s.id,
    userId: s.user.id,
    userName: s.user.fullName,
    username: s.user.username,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    loginAt: s.loggedInAt,
    lastActiveAt: s.lastActiveAt,
    isCurrent: currentToken !== null && s.sessionToken === currentToken,
  }));
}

export async function revokeSession(
  organizationId: string,
  sessionId: string,
  currentToken: string | null,
) {
  const session = await db.loginSession.findFirst({
    where: { id: sessionId, user: { organizationId } },
  });
  if (!session) throw new AdminError('Session not found.');
  if (currentToken && session.sessionToken === currentToken) {
    throw new AdminError('That is the session you are using. Use Sign out instead.');
  }

  await db.loginSession.update({
    where: { id: sessionId },
    data: { isRevoked: true, loggedOutAt: new Date() },
  });
}

// ===========================================================================
// PAIRED PHONES - the other half of "Device Management"
// ===========================================================================

/**
 * Android call-sync phones, org-wide - not just one store.
 *
 * `revokeDevice` in call-logs.ts is store-scoped, correctly, for the screen
 * built around one branch's own devices (`/settings/call-devices`). This
 * screen is the org-wide admin view of every session AND every phone
 * together (`config-catalogue.ts`'s "Device Management" card), so it needs
 * its own read across stores - gated on `users.edit`, the same permission
 * that already lets this screen revoke somebody's browser session, rather
 * than `calls.manage`, which is scoped to a single store and would not let
 * an org-wide screen show org-wide data.
 */
export interface PairedDeviceRow {
  id: string;
  userId: string;
  userName: string;
  storeId: string;
  storeName: string;
  deviceLabel: string | null;
  deviceModel: string | null;
  androidVersion: string | null;
  appVersion: string | null;
  pairedAt: Date;
  lastSyncedAt: Date | null;
}

export async function listPairedDevices(organizationId: string): Promise<PairedDeviceRow[]> {
  const rows = await db.callSyncDevice.findMany({
    where: { isActive: true, store: { organizationId } },
    orderBy: [{ lastSyncedAt: 'desc' }, { pairedAt: 'desc' }],
    include: {
      user: { select: { fullName: true } },
      store: { select: { id: true, name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userName: r.user.fullName,
    storeId: r.store.id,
    storeName: r.store.name,
    deviceLabel: r.deviceLabel,
    deviceModel: r.deviceModel,
    androidVersion: r.androidVersion,
    appVersion: r.appVersion,
    pairedAt: r.pairedAt,
    lastSyncedAt: r.lastSyncedAt,
  }));
}

/**
 * Resolves the device's own store from its organisation-scoped id, then
 * defers to the real `revokeDevice` - one revocation implementation, not
 * two copies that could drift.
 */
export async function revokePairedDeviceOrgWide(
  organizationId: string,
  deviceId: string,
  userId: string,
): Promise<void> {
  const device = await db.callSyncDevice.findFirst({
    where: { id: deviceId, store: { organizationId } },
    select: { storeId: true },
  });
  if (!device) throw new AdminError('Device not found.');
  await revokeDevice({ kind: 'single', storeId: device.storeId, writable: true }, deviceId, userId);
}

/** Sign one person out everywhere. Their own current session is spared. */
export async function revokeAllForUser(
  organizationId: string,
  userId: string,
  currentToken: string | null,
) {
  const user = await db.user.findFirst({ where: { id: userId, organizationId } });
  if (!user) throw new AdminError('User not found.');

  const { count } = await db.loginSession.updateMany({
    where: {
      userId,
      isRevoked: false,
      loggedOutAt: null,
      ...(currentToken ? { sessionToken: { not: currentToken } } : {}),
    },
    data: { isRevoked: true, loggedOutAt: new Date() },
  });

  return count;
}

// ===========================================================================
// ACTIVITY LOG
// ===========================================================================

export interface ActivityRow {
  id: string;
  at: Date;
  userName: string;
  activityType: string;
  entityType: string;
  entityId: string | null;
  description: string;
}

/**
 * The audit trail, such as it is.
 *
 * ⚠️ **Read the honest caveat on the screen with this.** `ActivityLog` is
 * written from seven places, and none of them touch money or stock: invoices,
 * payments, orders, stock adjustments and permission changes are all unlogged.
 * There is also no IP, no user-agent and no before/after value.
 *
 * Building this screen does not fix that - it makes the gap visible, which is
 * the point. The fix is an `audited()` wrapper writing inside the same
 * transaction as the business change. See the roadmap, Phase 4.
 */
export async function listActivity(
  scope: StoreScope,
  opts: { limit?: number; entityType?: string | null; userId?: string | null } = {},
): Promise<ActivityRow[]> {
  const rows = await db.activityLog.findMany({
    where: {
      ...scopeWhere(scope),
      ...(opts.entityType ? { entityType: opts.entityType } : {}),
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(opts.limit ?? 300, 1000),
    include: { user: { select: { fullName: true } } },
  });

  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    userName: r.user?.fullName ?? 'System',
    activityType: r.activityType,
    entityType: r.entityType,
    entityId: r.entityId,
    description: r.description,
  }));
}

/** Distinct entity types present in the log, for the filter dropdown. */
export async function listActivityEntityTypes(scope: StoreScope): Promise<string[]> {
  const rows = await db.activityLog.findMany({
    where: scopeWhere(scope),
    distinct: ['entityType'],
    select: { entityType: true },
    orderBy: { entityType: 'asc' },
  });
  return rows.map((r) => r.entityType);
}
