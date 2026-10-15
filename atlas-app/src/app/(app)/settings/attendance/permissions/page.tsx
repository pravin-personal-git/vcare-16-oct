import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { getMarkPolicy } from '@/server/attendance-mark-policy';
import { listRoles, listAllPermissions, getRoleDetail } from '@/server/roles';
import { scopeWhere } from '@/server/store-scope';
import { PermissionsClient } from './PermissionsClient';

export default async function AttendancePermissionsPage() {
  const ctx = await requireContext();
  const { scope } = ctx;
  const scopeIsAll = scope.kind === 'all';

  if (scopeIsAll) {
    return (
      <PermissionsClient
        markPolicy={null}
        roles={[]}
        attendancePermissions={[]}
        rolePermissionIds={{}}
        users={[]}
        canEditPolicy={false}
        canEditPrivilege={false}
        scopeIsAll
      />
    );
  }

  const [markPolicy, roles, allPermissions, users] = await Promise.all([
    getMarkPolicy(scope),
    listRoles(scope),
    listAllPermissions(),
    db.user.findMany({
      where: { storeRoles: { some: { ...scopeWhere(scope) } }, isActive: true },
      select: { id: true, fullName: true, username: true },
      orderBy: { fullName: 'asc' },
    }),
  ]);

  const attendancePermissions = allPermissions.filter((p) => p.key.startsWith('attendance.'));

  const details = await Promise.all(roles.map((r) => getRoleDetail(scope, r.id)));
  const rolePermissionIds: Record<string, string[]> = {};
  roles.forEach((r, i) => { rolePermissionIds[r.id] = details[i]?.permissionIds ?? []; });

  return (
    <PermissionsClient
      markPolicy={{
        ...markPolicy,
        updatedAt: markPolicy.updatedAt?.toISOString() ?? null,
      }}
      roles={roles.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem }))}
      attendancePermissions={attendancePermissions}
      rolePermissionIds={rolePermissionIds}
      users={users.map((u) => ({ id: u.id, name: u.fullName, username: u.username }))}
      canEditPolicy={ctx.permissions.has('attendance.edit')}
      canEditPrivilege={ctx.permissions.has('users.edit')}
      scopeIsAll={false}
    />
  );
}
