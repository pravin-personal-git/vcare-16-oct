import { requireContext } from '@/server/context';
import { listEmployeeTypes, listEmployeeTags, listEmployeeConfigAssignments } from '@/server/employee-config';
import { EmployeeConfigClient } from './EmployeeConfigClient';

/**
 * Employee Configuration (roadmap §4.2, Employee submenu) - Employee Types
 * and Employee Tags, plus which employee has which. See
 * `employee-config.ts` for why these are separate from `employmentType`.
 */
export default async function EmployeeConfigPage() {
  const ctx = await requireContext();
  const { scope } = ctx;
  const scopeIsAll = scope.kind === 'all';

  const [employeeTypes, employeeTags, assignments] = scopeIsAll
    ? [[], [], []]
    : await Promise.all([
      listEmployeeTypes(scope),
      listEmployeeTags(scope),
      listEmployeeConfigAssignments(scope),
    ]);

  return (
    <EmployeeConfigClient
      employeeTypes={employeeTypes}
      employeeTags={employeeTags}
      assignments={assignments}
      scopeIsAll={scopeIsAll}
      canEdit={ctx.permissions.has('hrm.edit')}
    />
  );
}
