import { requireContext } from '@/server/context';
import { repairsList } from '@/server/repairs-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { RepairTrackerClient } from './RepairTrackerClient';

/**
 * Repair Tracker - 6,819 Vcare challans, searched and paged on the server
 * (PERF-1); totals cover every challan. The number on the paper slip finds
 * its rows by the source reference too (legacyRef), so "?q=" from the global
 * search lands on them. On the F1 list standard since 26 Sep 2026 (filters in
 * server/repairs-list, shared with the export).
 */
export default async function RepairTrackerPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [list, views, roles] = await Promise.all([
    repairsList(ctx, sp),
    listSavedViews(ctx, '/services/repairs'),
    shareableRoles(ctx),
  ]);

  const page = slicePage(list.rows, parseGridQuery(sp));

  return (
    <RepairTrackerClient
      challans={page.rows.map((c) => ({ ...c, dispatchedAt: c.dispatchedAt.toISOString() }))}
      paging={page.paging}
      totals={list.totals}
      counts={list.counts}
      status={list.status}
      rangeLabel={list.filters.range.label}
      technicians={list.technicians}
      canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('complaints.edit')}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
    />
  );
}
