import { requireContext } from '@/server/context';
import { listWorkTypes, listShifts, listEmployeeAssignments } from '@/server/work-schedules';
import { WorkSchedulesClient } from './WorkSchedulesClient';

/**
 * Work Schedules (roadmap §4.2, Employee submenu) - Work Types and Shifts,
 * plus which employee is assigned to which. See `work-schedules.ts` for the
 * deliberate scope limit: configuration and assignment only, not yet wired
 * into attendance classification.
 */
export default async function WorkSchedulesPage() {
  const ctx = await requireContext();
  const { scope } = ctx;
  const scopeIsAll = scope.kind === 'all';

  const [workTypes, shifts, assignments] = scopeIsAll
    ? [[], [], []]
    : await Promise.all([
      listWorkTypes(scope),
      listShifts(scope),
      listEmployeeAssignments(scope),
    ]);

  return (
    <WorkSchedulesClient
      workTypes={workTypes}
      shifts={shifts}
      assignments={assignments}
      scopeIsAll={scopeIsAll}
      canEdit={ctx.permissions.has('hrm.edit')}
    />
  );
}
