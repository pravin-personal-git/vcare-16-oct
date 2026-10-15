import { requireContext } from '@/server/context';
import { getMenuMatrix } from '@/server/administration';
import { listAssignableUsers } from '@/server/assets';
import { MODULES } from '../../_modules/catalogue';
import { MenuConfigClient } from './MenuConfigClient';

/**
 * A route is "built" when it is NOT in the placeholder catalogue.
 *
 * Derived rather than listed, deliberately. A second hand-kept list of working
 * screens would drift from the catalogue within a week, and then this screen
 * would confidently mark a shipped module as a placeholder - which is worse
 * than not having the feature.
 */
function builtRoutes(allRoutes: string[]): string[] {
  return allRoutes.filter((r) => !(r in MODULES));
}

export default async function StoreMenuConfigPage() {
  const ctx = await requireContext();
  const scopeIsAll = ctx.scope.kind === 'all';

  const [{ nodes, roles }, users] = scopeIsAll
    ? [{ nodes: [], roles: [] }, []]
    : await Promise.all([getMenuMatrix(ctx.scope), listAssignableUsers(ctx.scope)]);

  const routes = nodes.map((n) => n.route).filter((r): r is string => Boolean(r));

  // Destructured so the narrowing survives into the callback - TypeScript will
  // not carry `ctx.scope.kind === 'single'` through a property access.
  const { scope } = ctx;
  const storeName = scope.kind === 'single'
    ? ctx.stores.find((s) => s.id === scope.storeId)?.name ?? ''
    : '';

  return (
    <MenuConfigClient
      nodes={nodes}
      roles={roles}
      users={users}
      builtRoutes={builtRoutes(routes)}
      canEdit={ctx.permissions.has('settings.edit')}
      scopeIsAll={scopeIsAll}
      storeName={storeName}
    />
  );
}
