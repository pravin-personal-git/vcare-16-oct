import { requireContext } from '@/server/context';
import {
  listLeaveTypes, listAllocations, listPendingCompOffRequests, listPendingLeaveAllocationRequests,
  listRestrictedPeriods,
} from '@/server/leave-types';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { LeaveTypesClient } from './LeaveTypesClient';

/**
 * Leave categories, and what each employee is allowed of them.
 *
 * Split from `/settings/attendance` on purpose - working hours and the holiday
 * calendar answer "was this person supposed to be at work today"; this
 * answers "how many paid days off does this person have left", a different
 * question with its own master data and its own per-employee grid.
 */
export default async function LeaveTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string }>;
}) {
  const ctx = await requireContext();
  const { y } = await searchParams;
  const year = Number(y) || new Date().getFullYear();

  /*
    Destructured, and tested inline rather than through `scopeIsAll` - see
    the same note on hierarchy/page.tsx and holiday/config/page.tsx.
    TypeScript will not carry a narrowing through a property access on a
    mutable field, so `ctx.scope.storeId` errors even right after
    `ctx.scope.kind === 'single'` was checked one line above.
  */
  const { scope } = ctx;
  const scopeIsAll = scope.kind === 'all';

  const [leaveTypes, allocations, pendingCompOff, pendingAllocationRequests, restrictedPeriods, departments] = scope.kind === 'all'
    ? [[], { leaveTypes: [], rows: [] }, [], [], [], []]
    : await Promise.all([
      listLeaveTypes(scope),
      listAllocations(scope, year),
      listPendingCompOffRequests(scope),
      listPendingLeaveAllocationRequests(scope),
      listRestrictedPeriods(scope),
      db.department.findMany({ where: { ...scopeWhere(scope), isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);

  const storeName = scope.kind === 'single'
    ? ctx.stores.find((s) => s.id === scope.storeId)?.name ?? ''
    : '';

  return (
    <LeaveTypesClient
      leaveTypes={leaveTypes}
      allocations={allocations}
      pendingCompOff={pendingCompOff.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
      pendingAllocationRequests={pendingAllocationRequests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
      restrictedPeriods={restrictedPeriods.map((r) => ({ ...r, startDate: r.startDate.toISOString(), endDate: r.endDate.toISOString() }))}
      departments={departments}
      year={year}
      storeName={storeName}
      scopeIsAll={scopeIsAll}
      canEdit={ctx.permissions.has('attendance.edit')}
    />
  );
}
