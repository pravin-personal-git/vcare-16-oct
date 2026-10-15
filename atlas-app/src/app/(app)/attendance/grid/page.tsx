import { requireContext } from '@/server/context';
import { istYearMonth } from '@/lib/attendance-day';
import { attendanceMonth, listLeaveRequests } from '@/server/attendance';
import { inPeopleReach, peopleReach } from '@/server/people-reach';
import { listLeaveTypes } from '@/server/leave-types';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { GridClient } from './GridClient';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { istDate } from '@/lib/date-ranges';

/**
 * The month attendance grid.
 *
 * Everybody down the side, every day across the top, one coloured box per
 * person per day. It is the densest screen in the product and the one a
 * manager reads fastest - the whole month's shape is visible without reading a
 * single number.
 *
 * The three sources behind it - phone shifts, approved leave, the holiday
 * calendar - never knew about each other. `attendanceMonth` is where they meet.
 */
export default async function AttendanceGridPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  const now = new Date();

  // `m` is `YYYY-MM`. Falls back to this month on anything unparseable rather
  // than throwing - a mistyped URL should show the current month, not a stack
  // trace.
  // This month in India - the server runs in UTC (lib/ist).
  let { year, month } = istYearMonth(now);
  if (sp.m && /^\d{4}-\d{2}$/.test(sp.m)) {
    const [y, m] = sp.m.split('-').map(Number);
    if (m >= 1 && m <= 12) {
      year = y;
      month = m - 1;
    }
  }

  // Whose attendance and leave this person sees (B4 step 4) - the today cards follow.
  const reach = await peopleReach(ctx);
  const [fullGrid, allRequests, leaveTypes, views, roles] = await Promise.all([
    attendanceMonth(ctx.scope, year, month, now, reach),
    listLeaveRequests(ctx.scope, { take: LIST_MAX_ROWS }),
    ctx.scope.kind === 'all' ? Promise.resolve([]) : listLeaveTypes(ctx.scope, { activeOnly: true }),
    listSavedViews(ctx, '/attendance/grid'),
    shareableRoles(ctx),
  ]);
  const requests = inPeopleReach(allRequests, reach);
  // Person search (F1). The "today" counts above the grid stay for everyone.
  const q = (sp.q ?? '').trim().toLowerCase();
  const grid = q ? { ...fullGrid, rows: fullGrid.rows.filter((r) => r.userName.toLowerCase().includes(q)) } : fullGrid;

  return (
    <GridClient
      grid={grid}
      requests={requests.map((r) => ({
        ...r,
        fromDate: istDate(r.fromDate),
        toDate: istDate(r.toDate),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }))}
      leaveTypes={leaveTypes.map((lt) => ({ id: lt.id, code: lt.code, name: lt.name }))}
      canEdit={ctx.permissions.has('attendance.edit')}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
    />
  );
}
