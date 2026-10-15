import { requireContext } from '@/server/context';
import { shiftsList } from '@/server/shifts-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { ShiftsClient } from './ShiftsClient';

/**
 * Attendance, from the phones that are already reporting call activity.
 *
 * There is no biometric device, no separate app and no second thing for an
 * employee to remember. Shift start and end came free with the call-log app -
 * the salesperson presses two buttons a day, and payroll gets a record.
 *
 * Seven days by default, matching Call Logs. A month is the period payroll
 * actually cares about, but a month of rows is not what somebody opens this
 * screen to see on a Tuesday morning.
 */
export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  // Filters (date, person, never-ended) live in server/shifts-list, shared with the export.
  const [list, views, roles] = await Promise.all([shiftsList(ctx, sp), listSavedViews(ctx, '/attendance/shifts'), shareableRoles(ctx)]);
  const page = slicePage(list.rows, parseGridQuery(sp));
  const { summary } = list;

  return (
    <ShiftsClient
      rangeLabel={list.filters.range.label}
      problems={list.problems}
      openNow={list.openNow}
      paging={page.paging}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      summary={summary.map((s) => ({
        ...s,
        lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
      }))}
      shifts={page.rows.map((s) => ({
        ...s,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        correctedEndedAt: s.correctedEndedAt?.toISOString() ?? null,
      }))}
      canEdit={ctx.permissions.has('attendance.edit')}
      // Seeing that Rahul worked 08:12 to 19:40 is a different authority from
      // seeing everywhere he went in between. Payroll needs the first; very few
      // people need the second.
      canLocate={ctx.permissions.has('attendance.locate')}
    />
  );
}
