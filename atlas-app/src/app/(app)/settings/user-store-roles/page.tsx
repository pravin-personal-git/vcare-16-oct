import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { listUsers } from '@/server/administration';
import { MatrixClient } from './MatrixClient';

/**
 * WHO HOLDS WHICH ROLE, IN WHICH BRANCH.
 *
 * This assignment already decided every menu and every permission in the
 * product. What it did not have was a screen: it could only be changed by
 * seeding the database or one person at a time on the Users screen, which is
 * fine for one change and hopeless for onboarding a branch.
 *
 * Organisation-wide on purpose, not scoped to the active store. Granting
 * somebody a role in the branch you are NOT currently looking at is the normal
 * case - that is what the screen is for - and making an administrator switch
 * store between every grant would be a strange way to do it.
 */
export default async function UserStoreRolesPage() {
  const ctx = await requireContext();

  const [users, roles] = await Promise.all([
    listUsers(ctx.organization.id),
    db.role.findMany({
      where: { store: { organizationId: ctx.organization.id } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: { id: true, storeId: true, name: true, isSystem: true },
    }),
  ]);

  return (
    <MatrixClient
      users={users.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        username: u.username,
        departmentName: u.departmentName,
        isActive: u.isActive,
        assignments: u.assignments,
      }))}
      stores={ctx.stores}
      roles={roles}
      canEdit={ctx.permissions.has('users.edit')}
      currentUserId={ctx.user.id}
    />
  );
}
