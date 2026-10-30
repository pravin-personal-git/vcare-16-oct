import 'server-only';
import { isSettingsOnlyRoute } from '@/lib/settings-only-routes';
import { isPageOff } from '@/lib/modules';
import { redirect } from 'next/navigation';
import { canOpenRoute } from '@/lib/route-access';
import { menuHides, type MenuRoutes } from '@/lib/menu-gate';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import type { AccountLifecycleState } from '@prisma/client';
import { db } from './db';
import { requestIp, setActor } from './audit-context';
import { getSessionToken } from './auth/session';
import { resolvePermissions, resolveMenus } from './permissions';
import { applyPersonalLevel, isModuleLevel, moduleByKey } from '@/lib/role-modules';
import { entitlementFor } from './entitlement';
import { pickStartStore, resolveScope, type StoreScope } from './store-scope';
import { resolveActiveImpersonation } from './impersonation';

const ACTIVE_STORE_COOKIE = 'atlas_store';

export interface MenuNode {
  id: string;
  label: string;
  route: string | null;
  icon: string | null;
  children: MenuNode[];
}

export interface AppContext {
  user: { id: string; fullName: string; username: string; email: string | null };
  /**
   * An administrator reset this password, so it is a temporary one somebody else
   * has seen (3 Oct 2026, see lib/password-policy).
   *
   * The app layout sends them to /set-password until they choose their own.
   * Read from the session's user on every request rather than put in the cookie,
   * so an admin resetting a password takes effect on the person's NEXT page view
   * rather than whenever their session happens to expire.
   */
  mustChangePassword: boolean;
  stores: { id: string; name: string; branchCode: string }[];
  activeStoreId: string | null;          // null = All Company
  scope: StoreScope;
  roleNames: string[];
  permissions: Set<string>;
  menu: MenuNode[];
  /**
   * Every live menu route → is it visible for this person (B1, 11 Oct 2026):
   * branch on, a role or the person's override shows it. What the page guard
   * and the Dashboards list read, so a page hidden in the menu does not open
   * from a link either. Absent on contexts built outside `buildContext`.
   */
  menuRoutes?: MenuRoutes;
  organization: {
    id: string; name: string; themeTokens: unknown;
    logoPath: string | null; faviconPath: string | null;
    /** Superadmin-roadmap Slice 8, D053 - per-tenant capability flags the Platform Owner controls. */
    allowSelfServiceBusinessCreation: boolean;
    allowLinkedAccounts: boolean;
  };
  /**
   * Cross-module capabilities the PLATFORM OWNER switched on for this tenant
   * (2 Oct 2026). See lib/plans `PLATFORM_FEATURES`.
   *
   * A Set rather than an array because every reader asks the same question -
   * `ctx.features.has('expiry')` - and a client cannot grant themselves one of
   * these, so there is no second list to merge with.
   */
  features: Set<string>;
  /**
   * Modules the PLATFORM OWNER switched off for this business (F-01, 5 Oct
   * 2026), by name - see lib/modules. Every door checks it: pages, phone APIs,
   * Settings, search, approval types, handbook.
   */
  excludedModules: Set<string>;
  /**
   * Individual PAGES the platform owner switched off for this business (F-01,
   * 10 Oct 2026), as routes. The finer grain beside `excludedModules` - a
   * client sold HRM without Payroll. Checked at the same doors, through
   * `lib/modules.isPageOff`, which asks both questions at once so no door can
   * answer one and forget the other.
   */
  excludedPages: Set<string>;
  /**
   * Set when `user` is a Platform/Reseller staff member currently inside
   * "Access Tenant" (superadmin-roadmap Slice 5) - everything else in this
   * object (`stores`/`scope`/`roleNames`/`permissions`/`menu`/`organization`)
   * already reflects the IMPERSONATED tenant by the time this is non-null;
   * `user` itself stays the acting Platform Owner's own identity. Consumers
   * that only care about "what can I see and do" never need to check this -
   * it exists purely so the app shell can render the "Viewing X as Platform
   * Owner · Return to Platform" banner and know which tenant's admin
   * appears to be signed in.
   */
  impersonation: { organizationId: string; organizationName: string; eventId: string } | null;
  /**
   * Superadmin-roadmap Slice 6, D051 - the tenant's `lifecycleState` is
   * `READ_ONLY` (or worse). Same underlying decision as `scope.writable`
   * (every `scopeForWrite()` call site already enforces it without
   * needing to know this field exists) - this is purely for the app shell
   * to render a persistent banner, so UI code never has to reach into
   * `StoreScope`'s own, lower-level field to answer "should I show a
   * warning."
   */
  readOnly: boolean;
}

/** The subset of a `UserStoreRole` assignment `loadContext` actually reads downstream. */
export interface Assignment {
  storeId: string;
  roleId: string;
  store: { id: string; name: string; branchCode: string };
  role: { name: string; permissions: { permission: { key: string } }[] };
  /** When the role was given - the earliest is the person's home branch. */
  assignedAt?: Date;
}

/**
 * Resolves everything the request needs about who is asking and what they may see.
 *
 * Two-tier menu gating, per 12-users-roles-permissions.md §7:
 *     effective_menus = store_config ∩ (⋃ role_config for the user's roles)
 *
 * `cache` dedupes this within a single render pass - the layout, header and
 * sidebar all call it and only one round of queries is issued.
 */
export const getContext = cache(async (): Promise<AppContext | null> => {
  try {
    const ctx = await loadContext();
    // Who the audit trigger records for this request's writes (AUD-1).
    if (ctx) {
      await setActor({
        id: ctx.user.id, name: ctx.user.fullName, kind: 'user', via: 'web',
        ip: await requestIp(), storeId: ctx.activeStoreId,
      });
    }
    return ctx;
  } catch (err) {
    // A database blip must not take the whole application down with a server
    // exception. Degrade to "not signed in" - the caller redirects to /login,
    // which renders without touching the database.
    console.error('[context] resolution failed', err);
    return null;
  }
});

/**
 * How often a session's `lastActiveAt` is refreshed.
 *
 * This used to be written on every single request. On a pooled connection to a
 * database in another region that is a write - and a round trip - on every page
 * view, to update a column nobody reads in real time. Five minutes is precise
 * enough to spot an idle session and cheap enough to forget about.
 */
const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60_000;

async function loadContext(): Promise<AppContext | null> {
  const token = await getSessionToken();
  if (!token) return null;

  /**
   * One query for identity, roles and permissions.
   *
   * These were three separate awaits. With `connection_limit=1` - which is the
   * right setting for serverless - concurrent queries queue on a single
   * connection, so three queries meant three sequential round trips before the
   * page could begin rendering. Nesting the includes makes it one.
   */
  const session = await db.loginSession.findUnique({
    where: { sessionToken: token },
    include: {
      user: {
        include: {
          organization: true,
          storeRoles: {
            include: {
              store: true,
              role: { include: { permissions: { include: { permission: true } } } },
            },
          },
        },
      },
    },
  });

  if (!session || session.isRevoked || session.loggedOutAt) return null;
  if (!session.user.isActive) return null;

  const user = session.user;

  /**
   * "Access Tenant" (superadmin-roadmap Slice 5) - checked before the
   * ordinary `UserStoreRole` path below, so it applies whether the acting
   * user is a pure Platform/Reseller staff member (no assignments of their
   * own at all) or, in principle, someone who also happens to hold a real
   * tenant role somewhere - Access Tenant always means "I am now looking
   * at THIS tenant," full stop, not "merged with whatever I already had."
   *
   * `assignments`/`organizationForContext` are built from the IMPERSONATED
   * org's own stores and a synthetic union of every one of ITS `isSystem`
   * (Admin) roles - "exactly what the tenant's own Admin already has,
   * nothing more" (spec §9: never a raw scope bypass). Everything from here
   * down - `resolveScope()`, `scopeWhere()` at all ~84 existing call sites,
   * menu gating - runs completely unchanged; it has no way to know or care
   * that the caller is impersonating.
   */
  let assignments: Assignment[];
  let organizationForContext: NonNullable<typeof user.organization> | {
    id: string; name: string; themeTokens: unknown; logoPath: string | null; faviconPath: string | null;
    lifecycleState: AccountLifecycleState;
    allowSelfServiceBusinessCreation: boolean; allowLinkedAccounts: boolean;
  };
  let impersonation: AppContext['impersonation'] = null;

  const active = await resolveActiveImpersonation(user.id);
  if (active) {
    const targetOrg = await db.organization.findUnique({
      where: { id: active.organizationId },
      include: {
        stores: {
          include: {
            roles: { where: { isSystem: true }, include: { permissions: { include: { permission: true } } } },
          },
        },
      },
    });
    // The org was deleted/renamed out from under an active session - "no
    // context" is the safe response, same as any other data anomaly here.
    if (!targetOrg) return null;

    assignments = targetOrg.stores.flatMap((store) =>
      store.roles.map((role) => ({
        storeId: store.id,
        roleId: role.id,
        store: { id: store.id, name: store.name, branchCode: store.branchCode },
        role: { name: role.name, permissions: role.permissions },
      })),
    );
    organizationForContext = targetOrg;
    impersonation = { organizationId: targetOrg.id, organizationName: targetOrg.name, eventId: active.eventId };
  } else {
    assignments = user.storeRoles;

    if (assignments.length === 0) return null;
    // A tenant context always has a tenant. `User.organizationId` is nullable
    // now that pure Platform/Reseller staff can exist (they hold
    // `Membership` rows, never `UserStoreRole` ones, so they never reach this
    // line - `assignments.length === 0` already returned null for them
    // above). This check is what lets TypeScript narrow `user.organization`
    // for the rest of the function; if it were ever false here, that would be
    // a real data anomaly (a UserStoreRole with no tenant behind it), and
    // "no context" is the correct, safe response to it.
    if (!user.organization) return null;
    organizationForContext = user.organization;
  }

  if (assignments.length === 0) return null;

  // The branch this person last chose, or their home branch (pickStartStore).
  // Only "Access Tenant" (impersonation) still reads the browser cookie: the
  // saved choice belongs to the person's own business, not the one visited.
  const cookieStore = impersonation
    ? (await cookies()).get(ACTIVE_STORE_COOKIE)?.value ?? null
    : pickStartStore(user.lastStoreChoice, assignments);

  const ctx = await buildContextFromAssignments({
    user: { id: user.id, fullName: user.fullName, username: user.username, email: user.email },
    assignments,
    organization: organizationForContext,
    requestedStoreId: cookieStore,
    impersonation,
    mustChangePassword: user.mustChangePassword,
  });

  // Touch last-active, but only when it has actually gone stale.
  if (Date.now() - session.lastActiveAt.getTime() > ACTIVITY_WRITE_INTERVAL_MS) {
    void db.loginSession
      .update({ where: { id: session.id }, data: { lastActiveAt: new Date() } })
      .catch(() => undefined);
  }

  return ctx;
}

/** The organisation fields the context needs, whichever path supplied them. */
export interface ContextOrganization {
  id: string; name: string; themeTokens: unknown; logoPath: string | null; faviconPath: string | null;
  lifecycleState: AccountLifecycleState;
  allowSelfServiceBusinessCreation: boolean; allowLinkedAccounts: boolean;
}

/**
 * Stores, scope, permissions and menu for one person - THE rule, shared.
 *
 * The website (cookie session, above) and the Vcare app (bearer token,
 * server/auth/mobile-context.ts) both call this, so a phone can never be
 * granted something the website would refuse, or see a menu the website
 * would hide. `requestedStoreId` is the cookie on the web and the
 * `x-store-id` header on the phone; anything not among the person's own
 * stores is ignored and falls back to All Company, exactly as before.
 */
export async function buildContextFromAssignments(input: {
  user: AppContext['user'];
  assignments: Assignment[];
  organization: ContextOrganization;
  requestedStoreId: string | null;
  impersonation: AppContext['impersonation'];
  /**
   * Passed in rather than read here, because `user` is deliberately the narrow
   * four-field shape both the web and the phone can supply - see the note on
   * `AppContext.mustChangePassword`.
   */
  mustChangePassword?: boolean;
}): Promise<AppContext> {
  const { user, assignments, impersonation } = input;
  const organizationForContext = input.organization;

  const storeMap = new Map<string, { id: string; name: string; branchCode: string }>();
  for (const a of assignments) {
    storeMap.set(a.store.id, {
      id: a.store.id, name: a.store.name, branchCode: a.store.branchCode,
    });
  }
  const stores = [...storeMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  const activeStoreId = input.requestedStoreId && storeMap.has(input.requestedStoreId) ? input.requestedStoreId : null;

  /**
   * Superadmin-roadmap Slice 6, D051 - `ACTIVE`/`GRACE_PERIOD` write
   * normally; `READ_ONLY` (and, as a defense-in-depth backstop, anything
   * past it - `SUSPENDED`/`TERMINATED` are already blocked at login, but a
   * session already open when the state changes underneath it should stop
   * writing too) does not. `PENDING`/`ARCHIVED` fall through to the same
   * "not writable" default - neither is a state a live write should ever
   * happen in.
   */
  const writable = organizationForContext.lifecycleState === 'ACTIVE'
    || organizationForContext.lifecycleState === 'GRACE_PERIOD';

  const scope = resolveScope(activeStoreId, [...storeMap.keys()], writable);

  // Only roles that apply to the current scope count.
  const inScope = assignments.filter((a) =>
    scope.kind === 'single' ? a.storeId === scope.storeId : true,
  );

  const rolePermissions = resolvePermissions(inScope.map((a) => a.role.permissions.map((rp) => rp.permission.key)));
  const permissions = await withPersonalAccess(input.user.id, inScope, rolePermissions);
  const roleNames = [...new Set(inScope.map((a) => a.role.name))].sort();

  // ---- menu gating -------------------------------------------------------
  const storeIds = scope.kind === 'single' ? [scope.storeId] : [...storeMap.keys()];
  const roleIds = [...new Set(inScope.map((a) => a.roleId))];

  /**
   * `$transaction` rather than `Promise.all` - deliberately.
   *
   * Promise.all issues three queries concurrently, but a single pooled
   * connection serialises them anyway, so it costs three round trips. A
   * transaction array is sent as one batch and costs one.
   */
  const [storeCfg, roleCfg, allMenus, userCfg] = await db.$transaction([
    db.storeMenuConfig.findMany({
      where: { storeId: { in: storeIds }, isEnabled: true },
      select: { menuId: true },
    }),
    db.roleMenuConfig.findMany({
      where: { storeId: { in: storeIds }, roleId: { in: roleIds }, isVisible: true },
      select: { menuId: true, roleId: true },
    }),
    db.menu.findMany({
      // A hidden row (deletedAt) is out of every sidebar. Since 5 Oct 2026
      // that is how settings screens left the menu for Settings only.
      where: { platform: 'WEB', deletedAt: null },
      orderBy: { sort: 'asc' },
      select: { id: true, label: true, route: true, icon: true, parentId: true },
    }),
    db.userMenuConfig.findMany({
      where: { storeId: { in: storeIds }, userId: user.id },
      select: { menuId: true, isVisible: true },
    }),
  ]);

  const byRole = new Map<string, string[]>();
  for (const rc of roleCfg) {
    byRole.set(rc.roleId, [...(byRole.get(rc.roleId) ?? []), rc.menuId]);
  }

  const overrideMap = new Map(userCfg.map((u) => [u.menuId, u.isVisible]));

  // A page opened only by the person's own access (Settings > Operations &
  // approvals) shows in their menu even though no role of theirs ticks it.
  const ownOnly = permissions === rolePermissions ? [] : allMenus
    .filter((m) => m.route && canOpenRoute(m.route, permissions) && !canOpenRoute(m.route, rolePermissions))
    .map((m) => m.id);
  const visibleIds = resolveMenus(
    storeCfg.map((s) => s.menuId),
    [...byRole.values(), ownOnly],
    overrideMap,
  );

  /**
   * THE PLATFORM OWNER'S LAYER, APPLIED LAST AND WINNING (workstream F).
   *
   * A client configures their own Atlas freely - that is the whole point of
   * the rest of this roadmap. What they cannot do is grant themselves a
   * module their plan does not include. So the entitlement is applied AFTER
   * their own resolution: whatever store, role and user settings concluded,
   * an excluded module is removed.
   *
   * By top-level group, because that is the grain the platform owner sells
   * in. Which screen inside HRM a client sees is their business; whether they
   * have HRM at all is ours.
   */
  const entitlement = await entitlementFor(organizationForContext?.id ?? null);
  const excludedIds = new Set<string>();
  if (entitlement.excludedModules.length > 0) {
    const blocked = new Set(entitlement.excludedModules);
    const roots = allMenus.filter((m) => !m.parentId && blocked.has(m.label));
    const collect = (parentId: string) => {
      excludedIds.add(parentId);
      for (const child of allMenus.filter((m) => m.parentId === parentId)) collect(child.id);
    };
    for (const r of roots) collect(r.id);
  }

  // Build the tree, recursively - the "HRM" group nests a third level (its
  // 14 rows, several of which are themselves expandable, per the
  // HRM-in-Atlas roadmap's §4.1 accordion) so this can no longer stop at
  // one level of children the way it used to. A parent survives if it is
  // itself visible, or if ANY descendant at any depth survived - not just
  // a direct child.
  const byParent = new Map<string | null, typeof allMenus>();
  for (const m of allMenus) {
    const key = m.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(m);
  }

  const excludedSet = new Set<string>(entitlement.excludedModules);
  const hiddenPages = new Set<string>(entitlement.excludedPages);
  function buildChildren(parentId: string | null): MenuNode[] {
    return (byParent.get(parentId) ?? [])
      .map((m): MenuNode | null => {
        if (excludedIds.has(m.id)) return null;
        // Settings screens open from Settings only (5 Oct 2026) - see
        // lib/settings-only-routes. Applied here as well as in the data so a
        // menu rebuilt by hand cannot bring a second door back.
        if (isSettingsOnlyRoute(m.route)) return null;
        // A screen the platform owner switched off for this business -
        // because its whole module is off, or because this one page is
        // (F-01). Wherever its menu row sits, not only top-level groups.
        if (m.route && isPageOff(m.route, excludedSet, hiddenPages)) return null;
        const children = buildChildren(m.id);
        // A group with nothing left in it is not drawn as an empty accordion.
        if (!m.route && children.length === 0) return null;
        // A link the person's permissions cannot open is never shown - the
        // menu tick alone used to show it, and it led to "no access"
        // (Prachi's Leave link, 27 Sep 2026). One rule: lib/route-access.
        const openable = !m.route || canOpenRoute(m.route, permissions);
        // My Desk is everyone's own page - never hidden by a menu setting.
        const personal = m.route === '/my/reminders';
        if (((!visibleIds.has(m.id) && !personal) || !openable) && children.length === 0) return null;
        return { id: m.id, label: m.label, route: m.route, icon: m.icon, children };
      })
      .filter((m): m is MenuNode => m !== null);
  }

  const menu: MenuNode[] = buildChildren(null);

  // The same rows, flat, for the page guard (lib/menu-gate). Rows no one can
  // reach anyway - the plan's off pages, Settings-only screens - are left out,
  // so they never decide anything here.
  const menuRoutes = new Map<string, boolean>();
  for (const m of allMenus) {
    if (!m.route || excludedIds.has(m.id) || isSettingsOnlyRoute(m.route)) continue;
    if (isPageOff(m.route, excludedSet, hiddenPages)) continue;
    menuRoutes.set(m.route, (menuRoutes.get(m.route) ?? false) || visibleIds.has(m.id));
  }

  return {
    user,
    stores,
    activeStoreId,
    scope,
    roleNames,
    permissions,
    menu,
    menuRoutes,
    organization: {
      id: organizationForContext.id,
      name: organizationForContext.name,
      themeTokens: organizationForContext.themeTokens,
      logoPath: organizationForContext.logoPath,
      faviconPath: organizationForContext.faviconPath,
      allowSelfServiceBusinessCreation: organizationForContext.allowSelfServiceBusinessCreation,
      allowLinkedAccounts: organizationForContext.allowLinkedAccounts,
    },
    impersonation,
    readOnly: !writable,
    features: new Set<string>(entitlement.features),
    excludedModules: new Set<string>(entitlement.excludedModules),
    excludedPages: new Set<string>(entitlement.excludedPages),
    mustChangePassword: input.mustChangePassword ?? false,
  };
}

export async function requireContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) throw new Error('UNAUTHENTICATED');
  await enforceRouteAccess(ctx);
  return ctx;
}

/**
 * The route permission map (lib/route-access, health check SEC-1). The path
 * comes from middleware; it is absent for API routes, which check their own.
 */
async function enforceRouteAccess(ctx: AppContext): Promise<void> {
  let path: string | null = null;
  try { path = (await headers()).get('x-atlas-path'); } catch { return; }
  if (!path) return;
  // Switched off by the platform owner - the whole module (5 Oct 2026) or
  // this one page (10 Oct 2026). Not open to anybody in this business,
  // whatever their permissions, and a bookmark gets the same answer as a
  // menu click.
  if (isPageOff(path, ctx.excludedModules, ctx.excludedPages)) {
    redirect(`/no-access?from=${encodeURIComponent(path)}&plan=1`);
  }
  if (!canOpenRoute(path, ctx.permissions)) redirect(`/no-access?from=${encodeURIComponent(path)}`);
  // Hidden in the person's menu = not open to them by link, bookmark or
  // Ctrl+K either (B1, decision P1). The platform owner looking in through
  // Access Tenant is not held to a client's menu.
  if (!ctx.impersonation && ctx.menuRoutes && menuHides(path, ctx.menuRoutes)) {
    redirect(`/no-access?from=${encodeURIComponent(path)}&menu=1`);
  }
}

export { ACTIVE_STORE_COOKIE };

/**
 * Roles in scope, then each branch's own per-person levels (30 Oct 2026,
 * Settings > Operations & approvals), then the union across branches. Per
 * branch, not after the union: a module switched off for someone in DURG must
 * not come back through the All Company view because another branch's role
 * grants it there - only that other branch's own access does.
 */
async function withPersonalAccess(userId: string, inScope: Assignment[], rolePermissions: Set<string>): Promise<Set<string>> {
  const byStore = new Map<string, string[][]>();
  for (const a of inScope) byStore.set(a.storeId, [...(byStore.get(a.storeId) ?? []), a.role.permissions.map((rp) => rp.permission.key)]);
  const own = byStore.size
    ? await db.userAccessOverride.findMany({ where: { userId, storeId: { in: [...byStore.keys()] } }, select: { storeId: true, moduleKey: true, level: true } })
    : [];
  if (!own.length) return rolePermissions;
  const out = new Set<string>();
  for (const [storeId, lists] of byStore) {
    let keys: Set<string> = resolvePermissions(lists);
    for (const o of own) {
      const m = o.storeId === storeId ? moduleByKey(o.moduleKey) : undefined;
      if (m && isModuleLevel(o.level)) keys = applyPersonalLevel(keys, m, o.level);
    }
    for (const k of keys) out.add(k);
  }
  return out;
}
