import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { listEmployees } from '@/server/employees';
import { EmployeesClient } from './EmployeesClient';

/**
 * Employees - every person in the branch, and their details, editable here
 * (health check HR-2). Pay details (bank account, IFSC) are shown only to
 * people with payroll permission.
 */
export default async function EmployeesPage() {
  const ctx = await requireContext();
  const canSeeBank = ctx.permissions.has('payroll.view') || ctx.permissions.has('payroll.process') || ctx.permissions.has('payroll.configure');
  const [employees, departments, designations] = await Promise.all([
    listEmployees(ctx.scope, ctx.organization.id, canSeeBank),
    db.department.findMany({ where: { ...scopeWhere(ctx.scope), isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.role.findMany({
      where: { store: { organizationId: ctx.organization.id }, designationCode: { not: null } },
      select: { id: true, name: true, designationCode: true, store: { select: { name: true } } },
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
    }),
  ]);
  return (
    <EmployeesClient
      employees={employees}
      departments={departments}
      designations={designations.map((d) => ({ id: d.id, label: `${d.designationCode} - ${d.name}${ctx.stores.length > 1 ? ` (${d.store.name})` : ''}` }))}
      branches={ctx.stores.map((s) => ({ id: s.id, name: s.name }))}
      canEdit={ctx.permissions.has('users.edit') || ctx.permissions.has('hrm.edit')}
      canSeeBank={canSeeBank}
      canEditBank={ctx.permissions.has('payroll.process') || ctx.permissions.has('payroll.configure')}
    />
  );
}
