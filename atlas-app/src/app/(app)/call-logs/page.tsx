import { requireContext } from '@/server/context';
import { listDevices } from '@/server/call-logs';
import { callsList } from '@/server/calls-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { CallLogsClient } from './CallLogsClient';

/**
 * Call Logs on the F1 list standard (26 Sep 2026): call date (default last
 * 7 days; old ?days= links still work), employee (?person=, old ?user=),
 * type, search, views, export - filtered on the server in server/calls-list.
 * Without calls.view a person sees only their own calls.
 */
export default async function CallLogsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  const [list, allDevices, views, roles] = await Promise.all([
    callsList(ctx, sp),
    listDevices(ctx.scope),
    listSavedViews(ctx, '/call-logs'),
    shareableRoles(ctx),
  ]);
  const devices = list.seesTeam ? allDevices : allDevices.filter((d) => d.userId === ctx.user.id);
  const page = slicePage(list.rows, parseGridQuery(sp));

  return (
    <CallLogsClient
      rangeLabel={list.filters.range.label}
      activeUserId={list.activeUserId}
      ownOnly={!list.seesTeam}
      type={list.type}
      team={list.team}
      capped={list.capped}
      paging={page.paging}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      summary={list.summary.map((s) => ({
        ...s,
        lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
      }))}
      calls={page.rows.map((c) => ({
        ...c,
        startedAt: c.startedAt.toISOString(),
        syncedAt: c.syncedAt.toISOString(),
      }))}
      devices={devices
        .filter((d) => d.isActive)
        .map((d) => ({
          userId: d.userId,
          userName: d.userName,
          lastSyncedAt: d.lastSyncedAt?.toISOString() ?? null,
          callHealth: d.callHealth,
        }))}
      canManage={ctx.permissions.has('calls.manage')}
    />
  );
}
