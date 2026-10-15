import 'server-only';
import { db } from './db';
import type { StoreScope } from './store-scope';
import { resolveMenus } from './permissions';
import { resolveForUser } from './app-access';
import { isSettingsOnlyRoute } from '@/lib/settings-only-routes';
import { isPageOff } from '@/lib/modules';
import { canOpenRoute } from '@/lib/route-access';
import { ROLE_MODULES, type ModuleLevel } from '@/lib/role-modules';
import { CAPABILITIES, ADMIN_WARN_OVER, areaLevels, canDo, isAdminLike } from '@/lib/access-capabilities';
import { DASHES, allowedDashes } from '@/app/(app)/dashboard/dashes';
import { FEED_MAX_ROWS, LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * ACCESS CHECK - WHO SEES WHAT, ON ONE PAGE (B2, 11 Oct 2026). Read only.
 *
 * Who-can-do-what was spread over eleven screens (roles, user store roles,
 * the menu matrix, phone app access per role and per person, customisation…)
 * and nobody could answer "who can approve a purchase?" without opening all
 * of them. This reads the same rows those screens write, resolved the same
 * way the app resolves them for a real sign-in (permissions: the union of a
 * person's roles in this branch; menu: lib/permissions `resolveMenus` - the
 * one `server/context.ts` uses; dashboards: `allowedDashes`; phone:
 * `resolveForUser`), so what it says is what the person gets.
 *
 * One branch at a time, like the screens it summarises.
 */

export interface AccessPerson {
  id: string;
  name: string;
  username: string;
  active: boolean;
  /** Decision P3 (11 Oct 2026): every login is an employee. */
  hasEmployee: boolean;
  roles: string[];
  levels: Record<string, ModuleLevel>;
  capabilities: string[];
  dashboards: string[];
  phone: { home: string; sections: string[] };
  /** Menu pages their role would open but their menu hides. */
  hiddenPages: number;
  /** Their own menu settings that differ from what their roles say. */
  overrides: { label: string; shown: boolean }[];
  reportsTo: string | null;
  lastLoginAt: string | null;
}

export interface AccessWarning {
  kind: 'no-employee' | 'no-role' | 'admins' | 'override' | 'empty-role' | 'no-reports-to';
  severity: 'problem' | 'check';
  text: string;
  href: string | null;
}

export interface AccessChange {
  id: string;
  at: string;
  who: string;
  what: string;
  action: string;
  detail: string;
}

export interface AccessReport {
  storeName: string;
  areas: { key: string; label: string; group: string }[];
  people: AccessPerson[];
  capabilities: { key: string; area: string; group: string; sentence: string; who: string[] }[];
  roles: { id: string; name: string; members: number }[];
  warnings: AccessWarning[];
  changes: AccessChange[];
}

const TABLE_LABEL: Record<string, string> = {
  UserStoreRole: 'Person’s role in a branch',
  RolePermission: 'Role permission',
  Role: 'Role',
  StoreMenuConfig: 'Menu for the branch',
  RoleMenuConfig: 'Menu for a role',
  UserMenuConfig: 'Menu for one person',
  RoleAppAccess: 'Phone app for a role',
  UserAppAccess: 'Phone app for one person',
  User: 'Login',
};

const ACTION_LABEL: Record<string, string> = { insert: 'added', update: 'changed', delete: 'removed' };

export async function accessReport(
  scope: StoreScope,
  organizationId: string,
  plan: { excludedModules: ReadonlySet<string>; excludedPages: ReadonlySet<string> },
): Promise<AccessReport | null> {
  if (scope.kind !== 'single') return null;
  const storeId = scope.storeId;

  const [store, roles, assignments, menus, storeCfg, roleCfg, userCfg] = await Promise.all([
    db.store.findUnique({ where: { id: storeId }, select: { name: true } }),
    db.role.findMany({
      where: { storeId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, permissions: { select: { permission: { select: { key: true } } } }, _count: { select: { userStoreRoles: true } } },
    }),
    db.userStoreRole.findMany({ where: { storeId }, select: { userId: true, roleId: true } }),
    db.menu.findMany({ where: { platform: 'WEB', deletedAt: null }, select: { id: true, label: true, route: true } }),
    db.storeMenuConfig.findMany({ where: { storeId, isEnabled: true }, select: { menuId: true } }),
    db.roleMenuConfig.findMany({ where: { storeId, isVisible: true }, select: { roleId: true, menuId: true } }),
    db.userMenuConfig.findMany({ where: { storeId }, select: { userId: true, menuId: true, isVisible: true } }),
  ]);
  if (!store) return null;

  const userIds = [...new Set(assignments.map((a) => a.userId))];
  const [users, employees, orgUsersNoRole] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds } },
      orderBy: { fullName: 'asc' },
      take: LIST_MAX_ROWS,
      select: { id: true, fullName: true, username: true, isActive: true, lastLoginAt: true, reportsTo: { select: { fullName: true } } },
    }),
    db.employeeProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true } }),
    // A login in this business with no role in any branch: it signs in to nothing.
    db.user.findMany({
      where: { organizationId, isActive: true, storeRoles: { none: {} } },
      take: LIST_MAX_ROWS,
      select: { id: true, fullName: true },
    }),
  ]);

  const roleById = new Map(roles.map((r) => [r.id, r]));
  const rolePerms = new Map(roles.map((r) => [r.id, r.permissions.map((p) => p.permission.key)]));
  const roleMenus = new Map<string, string[]>();
  for (const rc of roleCfg) roleMenus.set(rc.roleId, [...(roleMenus.get(rc.roleId) ?? []), rc.menuId]);
  const storeMenuIds = storeCfg.map((s) => s.menuId);
  const hasEmployee = new Set(employees.map((e) => e.userId));
  const menuById = new Map(menus.map((m) => [m.id, m]));
  const liveRouted = menus.filter((m) => m.route && !isSettingsOnlyRoute(m.route) && !isPageOff(m.route, plan.excludedModules, plan.excludedPages));

  const people: AccessPerson[] = [];
  for (const u of users) {
    const myRoles = assignments.filter((a) => a.userId === u.id).map((a) => a.roleId);
    const perms = new Set(myRoles.flatMap((r) => rolePerms.get(r) ?? []));
    const roleUnion = myRoles.map((r) => roleMenus.get(r) ?? []);
    const mine = userCfg.filter((c) => c.userId === u.id);
    const visible = resolveMenus(storeMenuIds, roleUnion, new Map(mine.map((c) => [c.menuId, c.isVisible])));
    const menuRoutes = new Map<string, boolean>();
    for (const m of liveRouted) menuRoutes.set(m.route!, (menuRoutes.get(m.route!) ?? false) || visible.has(m.id));
    const roleShows = new Set(roleUnion.flat());
    const phone = u.isActive ? await resolveForUser(u.id, [storeId], perms) : null;

    people.push({
      id: u.id,
      name: u.fullName,
      username: u.username,
      active: u.isActive,
      hasEmployee: hasEmployee.has(u.id),
      roles: myRoles.map((r) => roleById.get(r)?.name ?? '?').sort(),
      levels: areaLevels(perms),
      capabilities: CAPABILITIES.filter((c) => canDo(c, perms)).map((c) => c.key),
      dashboards: allowedDashes(perms, plan.excludedModules, menuRoutes).map((k) => DASHES.find((d) => d.k === k)!.l),
      phone: phone
        ? { home: phone.home === 'website' ? 'Full website' : 'Field app', sections: Object.entries(phone.sections).filter(([, on]) => on).map(([k]) => k) }
        : { home: '-', sections: [] },
      hiddenPages: liveRouted.filter((m) => !visible.has(m.id) && canOpenRoute(m.route!, perms) && m.route !== '/my/reminders').length,
      overrides: mine
        .filter((c) => c.isVisible !== roleShows.has(c.menuId) && menuById.has(c.menuId))
        .map((c) => ({ label: menuById.get(c.menuId)!.label, shown: c.isVisible })),
      reportsTo: u.reportsTo?.fullName ?? null,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    });
  }

  const active = people.filter((p) => p.active);
  const warnings: AccessWarning[] = [];
  for (const p of active.filter((x) => !x.hasEmployee)) {
    warnings.push({ kind: 'no-employee', severity: 'problem', text: `${p.name} (${p.username}) can sign in but has no employee record. Every login should be an employee - add their employee record.`, href: '/settings/employees' });
  }
  for (const u of orgUsersNoRole) {
    warnings.push({ kind: 'no-role', severity: 'problem', text: `${u.fullName} has a login but no role in any branch, so they can sign in to nothing. Give them a role or switch the login off.`, href: '/settings/user-store-roles' });
  }
  const admins = active.filter((p) => isAdminLike(new Set(CAPABILITIES.filter((c) => p.capabilities.includes(c.key)).flatMap((c) => c.needs))));
  if (admins.length > ADMIN_WARN_OVER) {
    warnings.push({ kind: 'admins', severity: 'check', text: `${admins.length} people in this branch can change users and settings (${admins.map((a) => a.name).join(', ')}). Is that more than you meant?`, href: '/settings/roles' });
  }
  for (const p of active.filter((x) => x.overrides.length > 0)) {
    const shown = p.overrides.filter((o) => o.shown).map((o) => o.label);
    const hidden = p.overrides.filter((o) => !o.shown).map((o) => o.label);
    warnings.push({
      kind: 'override', severity: 'check',
      text: `${p.name}'s own menu differs from their role:${shown.length ? ` shows ${shown.join(', ')}` : ''}${shown.length && hidden.length ? ';' : ''}${hidden.length ? ` hides ${hidden.join(', ')}` : ''}.`,
      href: '/settings/store-menu-config',
    });
  }
  for (const r of roles.filter((x) => x._count.userStoreRoles === 0)) {
    warnings.push({ kind: 'empty-role', severity: 'check', text: `Role "${r.name}" has nobody in it.`, href: '/settings/roles' });
  }
  for (const p of active.filter((x) => !x.reportsTo && !isAdminLike(new Set(CAPABILITIES.filter((c) => x.capabilities.includes(c.key)).flatMap((c) => c.needs))))) {
    warnings.push({ kind: 'no-reports-to', severity: 'check', text: `${p.name} reports to nobody, so "my team" views will not include them.`, href: `/hrm/employees/${p.id}` });
  }

  return {
    storeName: store.name,
    areas: ROLE_MODULES.map((m) => ({ key: m.key, label: m.label, group: m.group })),
    people,
    capabilities: CAPABILITIES.map((c) => ({
      key: c.key, area: c.area, group: c.group, sentence: c.sentence,
      who: active.filter((p) => p.capabilities.includes(c.key)).map((p) => p.name),
    })),
    roles: roles.map((r) => ({ id: r.id, name: r.name, members: r._count.userStoreRoles })),
    warnings,
    changes: await accessChanges(storeId, organizationId, roles.map((r) => r.id)),
  };
}

/**
 * The access change log, from the audit trail every one of these tables
 * already writes. Rows without a branch (a role's permission, a login) are
 * kept to this business by their role or their author - never another
 * business's rows on the same database.
 */
async function accessChanges(storeId: string, organizationId: string, roleIds: string[]): Promise<AccessChange[]> {
  const orgUsers = await db.user.findMany({ where: { organizationId }, select: { id: true } });
  const rows = await db.auditEvent.findMany({
    where: {
      tableName: { in: Object.keys(TABLE_LABEL) },
      OR: [
        { storeId },
        { storeId: null, actorId: { in: orgUsers.map((u) => u.id) } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: FEED_MAX_ROWS,
    select: { id: true, createdAt: true, actorName: true, tableName: true, action: true, label: true, changed: true },
  });

  // Names for the ids the changes carry.
  const ids = (k: string) => [...new Set(rows.map((r) => (r.changed as Record<string, unknown> | null)?.[k]).filter((v): v is string => typeof v === 'string'))];
  const [rolesN, usersN, menusN, permsN] = await Promise.all([
    db.role.findMany({ where: { id: { in: ids('roleId') } }, select: { id: true, name: true, storeId: true } }),
    db.user.findMany({ where: { id: { in: ids('userId') }, organizationId }, select: { id: true, fullName: true } }),
    db.menu.findMany({ where: { id: { in: ids('menuId') } }, select: { id: true, label: true } }),
    db.permission.findMany({ where: { id: { in: ids('permissionId') } }, select: { id: true, key: true } }),
  ]);
  const name = new Map<string, string>([
    ...rolesN.map((r) => [r.id, `role ${r.name}`] as [string, string]),
    ...usersN.map((u) => [u.id, u.fullName] as [string, string]),
    ...menusN.map((m) => [m.id, `menu ${m.label}`] as [string, string]),
    ...permsN.map((p) => [p.id, p.key] as [string, string]),
  ]);
  const ourRoles = new Set(roleIds);

  return rows
    // A permission row with no branch belongs to a role - keep only ours.
    .filter((r) => {
      const c = r.changed as Record<string, unknown> | null;
      return r.tableName !== 'RolePermission' || (typeof c?.roleId === 'string' && ourRoles.has(c.roleId));
    })
    .map((r) => {
      const c = (r.changed ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      for (const k of ['userId', 'roleId', 'menuId', 'permissionId']) {
        const v = c[k];
        // An id we cannot name is a person or role since removed (or not in this business).
        if (typeof v === 'string') parts.push(name.get(v) ?? `a removed ${k === 'userId' ? 'person' : k.replace('Id', '')}`);
      }
      for (const k of ['isVisible', 'isEnabled', 'isActive']) {
        if (typeof c[k] === 'boolean') parts.push(`${k === 'isActive' ? 'active' : 'shown'}: ${c[k] ? 'yes' : 'no'}`);
      }
      return {
        id: String(r.id),
        at: r.createdAt.toISOString(),
        who: r.actorName ?? 'System',
        what: TABLE_LABEL[r.tableName] ?? r.tableName,
        action: ACTION_LABEL[r.action] ?? r.action,
        detail: parts.join(' · ') || r.label || '',
      };
    });
}
