import { requireContext } from '@/server/context';
import { listRoles, listAllPermissions, listAllMenus } from '@/server/roles';
import { RolesClient } from './RolesClient';
import { roleAccessSummaries } from '@/server/app-access';

export default async function RolesPage() {
  const ctx = await requireContext();
  const [roles, permissions, menus] = await Promise.all([
    listRoles(ctx.scope),
    listAllPermissions(),
    listAllMenus(),
  ]);

  const appAccess = await roleAccessSummaries(ctx.scope, roles.map((r) => r.id));

  return (
    <RolesClient
      appAccess={appAccess}
      roles={roles}
      permissions={permissions}
      menus={menus}
      stores={ctx.stores}
      canEdit={ctx.permissions.has('users.edit')}
      excludedModules={[...ctx.excludedModules]}
      excludedPages={[...ctx.excludedPages]}
    />
  );
}
