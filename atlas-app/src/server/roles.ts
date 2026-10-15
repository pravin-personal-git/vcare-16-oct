import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';

/**
 * Custom role creation - spec 12-users-roles-permissions.md.
 *
 * `Role` already existed (seeded once per store as Admin/Sales), and the
 * matrix at `/settings/user-store-roles` already assigns an existing role to
 * a user. What was missing was a way to make a NEW role - this file and its
 * screen are that.
 *
 * A role belongs to exactly one store (`Role.storeId`, not organisation-wide)
 * - the same granularity the schema already committed to. `isSystem` roles
 * (Admin) are read-only here: `sync-tenant-defaults.ts` grants every
 * permission to every `isSystem` role on every deploy, so editing one by
 * hand here would just be overwritten, and deleting one could lock an
 * organisation out of its own data.
 */

export class RoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleError';
  }
}

export interface RoleRow {
  id: string;
  storeId: string;
  storeName: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  level: number | null;
  designationCode: string | null;
  permissionCount: number;
  userCount: number;
}

export async function listRoles(scope: StoreScope): Promise<RoleRow[]> {
  const roles = await db.role.findMany({
    where: { ...scopeWhere(scope) },
    select: {
      id: true, storeId: true, name: true, description: true, isSystem: true,
      level: true, designationCode: true,
      store: { select: { name: true } },
      _count: { select: { permissions: true, userStoreRoles: true } },
    },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  });
  return roles.map((r) => ({
    id: r.id, storeId: r.storeId, storeName: r.store.name,
    name: r.name, description: r.description, isSystem: r.isSystem,
    level: r.level, designationCode: r.designationCode,
    permissionCount: r._count.permissions, userCount: r._count.userStoreRoles,
  }));
}

export interface PermissionOption {
  id: string;
  key: string;
  module: string;
  action: string;
}

export async function listAllPermissions(): Promise<PermissionOption[]> {
  const perms = await db.permission.findMany({
    // `platformTenant.*`/`platformReseller.*` live in this same global
    // table (granted only via `PlatformRolePermission`, never
    // `RolePermission`) but must never appear as a toggleable option on a
    // store Role's editor - a tenant Admin has no use for them, and
    // offering them invites exactly the confusion this filter avoids, even
    // though granting one here would be inert (no tenant AppContext ever
    // reads a platform-module permission key).
    where: { NOT: { module: { startsWith: 'platform' } } },
    select: { id: true, key: true, module: true, action: true },
    orderBy: [{ module: 'asc' }, { action: 'asc' }],
  });
  return perms;
}

export interface MenuOption {
  id: string;
  label: string;
  parentId: string | null;
  /** The page it opens - the Roles editor works out from it who may see it. */
  route: string | null;
}

export async function listAllMenus(): Promise<MenuOption[]> {
  const menus = await db.menu.findMany({
    where: { platform: 'WEB', deletedAt: null },
    select: { id: true, label: true, parentId: true, route: true },
    orderBy: { sort: 'asc' },
  });
  return menus;
}

export interface RoleDetail {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  level: number | null;
  designationCode: string | null;
  permissionIds: string[];
  menuIds: string[];
}

export async function getRoleDetail(scope: StoreScope, roleId: string): Promise<RoleDetail | null> {
  const role = await db.role.findFirst({
    where: { id: roleId, ...scopeWhere(scope) },
    select: {
      id: true, storeId: true, name: true, description: true, isSystem: true,
      level: true, designationCode: true,
      permissions: { select: { permissionId: true } },
      menuConfigs: { where: { isVisible: true }, select: { menuId: true } },
    },
  });
  if (!role) return null;
  return {
    id: role.id, storeId: role.storeId, name: role.name, description: role.description,
    isSystem: role.isSystem, level: role.level, designationCode: role.designationCode,
    permissionIds: role.permissions.map((p) => p.permissionId),
    menuIds: role.menuConfigs.map((m) => m.menuId),
  };
}

export interface RoleInput {
  storeId: string;
  name: string;
  description: string | null;
  /** An org-chart tier, e.g. 1 = CEO. Independent of permissions. */
  level: number | null;
  designationCode: string | null;
  permissionIds: string[];
  menuIds: string[];
}

export async function createRole(scope: StoreScope, input: RoleInput): Promise<{ id: string }> {
  scopeForWrite(scope);
  if (!input.name.trim()) throw new RoleError('Give the role a name.');
  if (scope.kind === 'single' && input.storeId !== scope.storeId) {
    throw new RoleError('That store is not in your scope.');
  }
  if (scope.kind === 'all' && !scope.storeIds.includes(input.storeId)) {
    throw new RoleError('That store is not in your scope.');
  }

  const existing = await db.role.findFirst({
    where: { storeId: input.storeId, name: input.name.trim() },
    select: { id: true },
  });
  if (existing) throw new RoleError(`A role named "${input.name.trim()}" already exists for this store.`);

  const role = await db.role.create({
    data: {
      storeId: input.storeId,
      name: input.name.trim(),
      description: input.description,
      level: input.level,
      designationCode: input.designationCode?.trim() || null,
      isSystem: false,
      permissions: { create: input.permissionIds.map((permissionId) => ({ permissionId })) },
      menuConfigs: { create: input.menuIds.map((menuId) => ({ storeId: input.storeId, menuId, isVisible: true })) },
    },
  });
  return { id: role.id };
}

/**
 * Set ONLY a role's org-chart designation - never its permissions, name or
 * menus. Deliberately allowed for `isSystem` roles, unlike `updateRole`
 * above: the reason system roles refuse a full edit is that
 * `sync-tenant-defaults.ts` re-grants their permissions on every deploy, so
 * a hand-edit there would be silently overwritten - level/designationCode
 * are never touched by that sync, so that risk does not apply here.
 *
 * Exists because the Admin role ships with neither set (see
 * `sync-tenant-defaults.ts`'s own backfill, which gives it a sensible
 * default of "ADMIN"/level 1 so the org's owner shows *something* on Team
 * Setup) - this is how an admin customises that label afterward, to
 * "Owner", "Founder", whatever fits their business, without touching
 * permissions at all.
 */
export async function setRoleDesignation(
  scope: StoreScope, roleId: string, input: { designationCode: string | null; level: number | null },
): Promise<void> {
  scopeForWrite(scope);
  const role = await db.role.findFirst({ where: { id: roleId, ...scopeWhere(scope) } });
  if (!role) throw new RoleError('Role not found in your scope.');

  await db.role.update({
    where: { id: roleId },
    data: { designationCode: input.designationCode?.trim() || null, level: input.level },
  });
}

export async function updateRole(
  scope: StoreScope, roleId: string, input: Omit<RoleInput, 'storeId'>,
): Promise<void> {
  scopeForWrite(scope);
  if (!input.name.trim()) throw new RoleError('Give the role a name.');

  const role = await db.role.findFirst({ where: { id: roleId, ...scopeWhere(scope) } });
  if (!role) throw new RoleError('Role not found in your scope.');
  if (role.isSystem) throw new RoleError('System roles cannot be edited - create a custom role instead.');

  const nameClash = await db.role.findFirst({
    where: { storeId: role.storeId, name: input.name.trim(), id: { not: roleId } },
    select: { id: true },
  });
  if (nameClash) throw new RoleError(`A role named "${input.name.trim()}" already exists for this store.`);

  await db.$transaction([
    db.role.update({
      where: { id: roleId },
      data: {
        name: input.name.trim(), description: input.description,
        level: input.level, designationCode: input.designationCode?.trim() || null,
      },
    }),
    db.rolePermission.deleteMany({ where: { roleId } }),
    db.rolePermission.createMany({
      data: input.permissionIds.map((permissionId) => ({ roleId, permissionId })),
    }),
    db.roleMenuConfig.deleteMany({ where: { roleId } }),
    db.roleMenuConfig.createMany({
      data: input.menuIds.map((menuId) => ({ storeId: role.storeId, roleId, menuId, isVisible: true })),
    }),
  ]);
}

/**
 * Grant or revoke exactly one permission on a role, without touching its
 * other permissions or its menu configuration.
 *
 * `updateRole` replaces the whole permission set at once - right for a form
 * that edits a role in full, wrong for a scoped screen (like the attendance
 * Privilege grid) that should only ever be able to move the one checkbox it
 * shows, never accidentally wipe permissions or menus outside its view.
 */
export async function setRolePermission(
  scope: StoreScope, roleId: string, permissionKey: string, grant: boolean,
): Promise<void> {
  scopeForWrite(scope);

  const role = await db.role.findFirst({ where: { id: roleId, ...scopeWhere(scope) } });
  if (!role) throw new RoleError('Role not found in your scope.');
  if (role.isSystem) {
    throw new RoleError('System roles already hold every permission and cannot be edited here.');
  }

  const permission = await db.permission.findUnique({ where: { key: permissionKey } });
  if (!permission) throw new RoleError('Unknown permission.');

  if (grant) {
    await db.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: permission.id } },
      create: { roleId, permissionId: permission.id },
      update: {},
    });
  } else {
    await db.rolePermission.deleteMany({ where: { roleId, permissionId: permission.id } });
  }
}

export async function deleteRole(
  scope: StoreScope, roleId: string, userId: string | null = null,
): Promise<void> {
  scopeForWrite(scope);
  const role = await db.role.findFirst({
    where: { id: roleId, ...scopeWhere(scope) },
    select: { id: true, isSystem: true, name: true, _count: { select: { userStoreRoles: true } } },
  });
  if (!role) throw new RoleError('Role not found in your scope.');
  if (role.isSystem) throw new RoleError('System roles cannot be deleted.');
  if (role._count.userStoreRoles > 0) {
    throw new RoleError(
      `${role._count.userStoreRoles} user(s) still hold "${role.name}". Reassign them before deleting it.`,
    );
  }
  /**
   * Tombstoned, not removed (3 Oct 2026). A deleted role that resurrects from
   * another machine grants permissions somebody took away on purpose, which is
   * the worst outcome in the whole hard-delete list. `server/soft-delete` keeps
   * it out of every top-level read.
   */
  await db.role.update({
    where: { id: roleId },
    data: { deletedAt: new Date(), deletedBy: userId },
  });
}
