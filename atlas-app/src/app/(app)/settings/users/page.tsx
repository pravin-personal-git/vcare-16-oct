import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { listUsers } from '@/server/administration';
import { UsersClient } from './UsersClient';

export default async function UsersPage() {
  const ctx = await requireContext();

  // Roles and departments come from every store this organisation has, not just
  // the active one - assigning someone to another branch is the normal case and
  // making them switch scope first would be a strange way to do it.
  const [users, roles, departments] = await Promise.all([
    listUsers(ctx.organization.id),
    db.role.findMany({
      where: { store: { organizationId: ctx.organization.id } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: { id: true, storeId: true, name: true, isSystem: true },
    }),
    db.department.findMany({
      where: { store: { organizationId: ctx.organization.id }, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <UsersClient
      users={users}
      stores={ctx.stores}
      roles={roles}
      departments={departments}
      canEdit={ctx.permissions.has('users.edit')}
      canViewPasswords={ctx.permissions.has('users.viewPasswords')}
      currentUserId={ctx.user.id}
    />
  );
}
