/**
 * Permission resolution.
 *
 * A user holds MANY roles per store. Permissions resolve as a UNION across
 * those roles. Menu visibility is gated twice: the store config is the outer
 * bound, and the role config narrows within it.
 *
 * Spec: 03-technical-docs/01-specification/12-users-roles-permissions.md §7
 */

export interface ResolvedAccess {
  permissions: Set<string>;
  menuIds: Set<string>;
}

export function resolvePermissions(rolePermissionKeys: string[][]): Set<string> {
  const union = new Set<string>();
  for (const keys of rolePermissionKeys) {
    for (const key of keys) union.add(key);
  }
  return union;
}

/**
 * effective_menus = store_config ∩ (user_override ?? ⋃ role_config)
 *
 * A third, narrower tier on top of the original two. Per menu: an explicit
 * user-override entry wins over the role union either way (show something
 * the role hides, or hide something it shows) - but the store intersection
 * still applies on top of that regardless, exactly as it always has. A user
 * override can never resurrect a menu the store itself switched off; that
 * bound is absolute, the same as it was before this tier existed.
 */
export function resolveMenus(
  storeEnabledMenuIds: string[],
  roleVisibleMenuIds: string[][],
  userOverrideMenuIds?: Map<string, boolean>,
): Set<string> {
  const storeBound = new Set(storeEnabledMenuIds);
  const roleUnion = new Set<string>();
  for (const ids of roleVisibleMenuIds) {
    for (const id of ids) roleUnion.add(id);
  }

  if (!userOverrideMenuIds || userOverrideMenuIds.size === 0) {
    return new Set([...roleUnion].filter((id) => storeBound.has(id)));
  }

  const candidateIds = new Set([...roleUnion, ...userOverrideMenuIds.keys()]);
  const result = new Set<string>();
  for (const id of candidateIds) {
    if (!storeBound.has(id)) continue;
    const overridden = userOverrideMenuIds.get(id);
    const visible = overridden !== undefined ? overridden : roleUnion.has(id);
    if (visible) result.add(id);
  }
  return result;
}

export function can(access: ResolvedAccess, permissionKey: string): boolean {
  return access.permissions.has(permissionKey);
}
