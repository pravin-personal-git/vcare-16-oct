import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import type { AppContext } from './context';
import {
  cleanAccess, presetForRole, resolveAccess, DEFAULT_ACCESS,
  type AccessSettings, type ResolvedAccess,
} from '@/lib/app-access';

/**
 * Phone app access - the server half (26 Sep 2026, PHONE-APP-ACCESS-SPEC.md).
 * Rules and keys live in lib/app-access. A role with no row yet gets the
 * preset for its name; sync-tenant-defaults writes those rows on release so
 * renaming a role later does not quietly change what its phones show.
 */
export class AppAccessError extends Error {}

function roleSettings(row: { settings: unknown } | null | undefined, roleName: string): AccessSettings {
  return row ? { ...DEFAULT_ACCESS, ...cleanAccess(row.settings) } : presetForRole(roleName);
}

/** What one person's phone may show and do, in the given branches. */
export async function resolveForUser(userId: string, storeIds: string[], permissions?: Iterable<string>): Promise<ResolvedAccess> {
  const [assignments, overrides] = await Promise.all([
    db.userStoreRole.findMany({
      where: { userId, storeId: { in: storeIds } },
      select: {
        role: {
          select: {
            name: true, appAccess: { select: { settings: true } },
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    }),
    db.userAppAccess.findMany({ where: { userId, storeId: { in: storeIds } }, select: { settings: true } }),
  ]);
  const perms = permissions
    ? [...permissions]
    : assignments.flatMap((a) => (a.role.permissions ?? []).map((p) => p.permission.key));
  const override = Object.assign({}, ...overrides.map((o) => cleanAccess(o.settings))) as AccessSettings;
  return resolveAccess(assignments.map((a) => roleSettings(a.role.appAccess, a.role.name)), override, perms);
}

/** For a website-style context (phone bearer token): the branch it is working in. */
export async function accessFor(ctx: AppContext): Promise<ResolvedAccess> {
  const storeIds = ctx.scope.kind === 'single' ? [ctx.scope.storeId] : ctx.stores.map((s) => s.id);
  const access = await resolveForUser(ctx.user.id, storeIds, ctx.permissions);
  // Sections of modules the platform owner switched off disappear from the
  // phone app too (F-01, 5 Oct 2026), whatever the role's app settings say.
  const off = ctx.excludedModules ?? new Set<string>();
  const sections = { ...access.sections };
  if (off.has('Customer Service')) { sections.complaints = false; sections.installations = false; }
  if (off.has('Sales')) sections.leads = false;
  if (off.has('Task Manager')) sections.tasks = false;
  if (off.has('Inventory')) { sections.stock = false; sections.van = false; }
  if (off.has('HRM')) sections.attendance = false;
  return { ...access, sections };
}

// ---------------------------------------------------------------- settings screens

export interface RoleAccessView {
  roleId: string;
  roleName: string;
  storeName: string;
  settings: AccessSettings;
  /** True when nothing has been saved yet - the values shown are the preset for the name. */
  isPreset: boolean;
  /** The role's website permissions, to grey out switches they do not allow. */
  permissions: string[];
}

export async function roleAccessView(scope: StoreScope, roleId: string): Promise<RoleAccessView | null> {
  const role = await db.role.findFirst({
    where: { id: roleId, ...scopeWhere(scope) },
    select: {
      id: true, name: true, store: { select: { name: true } }, appAccess: { select: { settings: true } },
      permissions: { select: { permission: { select: { key: true } } } },
    },
  });
  if (!role) return null;
  return {
    roleId: role.id,
    roleName: role.name,
    storeName: role.store.name,
    settings: roleSettings(role.appAccess, role.name),
    isPreset: !role.appAccess,
    permissions: role.permissions.map((p) => p.permission.key),
  };
}

export async function saveRoleAccess(scope: StoreScope, roleId: string, settings: AccessSettings) {
  const role = await db.role.findFirst({ where: { id: roleId, ...scopeWhere(scope) }, select: { id: true, storeId: true } });
  if (!role) throw new AppAccessError('That role is not in your branch.');
  const clean = { ...DEFAULT_ACCESS, ...cleanAccess(settings) };
  return db.roleAppAccess.upsert({
    where: { roleId },
    create: { storeId: role.storeId, roleId, settings: clean },
    update: { settings: clean },
  });
}

export interface UserAccessView {
  userId: string;
  fullName: string;
  storeName: string;
  roles: { name: string; settings: AccessSettings }[];
  /** The keys this person differs on. */
  override: AccessSettings;
  /** Roles combined, before the override - what "Same as role" means. */
  fromRoles: ResolvedAccess;
  resolved: ResolvedAccess;
  permissions: string[];
}

/** The caller must already have checked the branch is one of theirs. */
export async function userAccessView(storeId: string, userId: string): Promise<UserAccessView | null> {
  const [user, store, assignments, row] = await Promise.all([
    db.user.findFirst({ where: { id: userId, storeRoles: { some: { storeId } } }, select: { id: true, fullName: true } }),
    db.store.findUnique({ where: { id: storeId }, select: { name: true } }),
    db.userStoreRole.findMany({
      where: { userId, storeId },
      select: {
        role: {
          select: {
            name: true, appAccess: { select: { settings: true } },
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    }),
    db.userAppAccess.findUnique({ where: { storeId_userId: { storeId, userId } }, select: { settings: true } }),
  ]);
  if (!user) return null;
  const roles = assignments.map((a) => ({ name: a.role.name, settings: roleSettings(a.role.appAccess, a.role.name) }));
  const permissions = [...new Set(assignments.flatMap((a) => a.role.permissions.map((p) => p.permission.key)))];
  const override = cleanAccess(row?.settings);
  return {
    userId: user.id,
    fullName: user.fullName,
    storeName: store?.name ?? '',
    roles,
    override,
    fromRoles: resolveAccess(roles.map((r) => r.settings), {}, permissions),
    resolved: resolveAccess(roles.map((r) => r.settings), override, permissions),
    permissions,
  };
}

export async function saveUserAccess(storeId: string, userId: string, override: AccessSettings) {
  const member = await db.userStoreRole.findFirst({ where: { userId, storeId }, select: { userId: true } });
  if (!member) throw new AppAccessError('That person has no role in this branch.');
  const settings = cleanAccess(override);
  if (!Object.keys(settings).length) {
    await db.userAppAccess.deleteMany({ where: { storeId, userId } });
    return;
  }
  await db.userAppAccess.upsert({
    where: { storeId_userId: { storeId, userId } },
    create: { storeId, userId, settings },
    update: { settings },
  });
}

/** One line for the roles list: "Full website" or "Complaints, Tasks". */
export function accessSummary(s: AccessSettings): string {
  if (s.home === 'website') return 'Full website';
  const names: Record<string, string> = {
    'section.attendance': 'Attendance', 'section.complaints': 'Complaints', 'section.stock': 'Stock',
    'section.leads': 'Leads', 'section.tasks': 'Tasks',
  };
  const on = Object.keys(names).filter((k) => s[k] === true).map((k) => names[k]);
  return on.length ? on.join(', ') : 'Nothing';
}

/** Role rows for the list's "Phone app" column. */
export async function roleAccessSummaries(scope: StoreScope, roleIds: string[]): Promise<Record<string, { summary: string; isPreset: boolean }>> {
  const roles = await db.role.findMany({
    where: { id: { in: roleIds }, ...scopeWhere(scope) },
    select: { id: true, name: true, appAccess: { select: { settings: true } } },
  });
  return Object.fromEntries(roles.map((r) => [r.id, { summary: accessSummary(roleSettings(r.appAccess, r.name)), isPreset: !r.appAccess }]));
}
