import { requireContext } from '@/server/context';
import { gdnList } from '@/server/gdn-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { GoodsDispatchClient } from './GoodsDispatchClient';
import { JobGdnPointer } from './JobGdnPointer';
import { jobGdnList } from '@/server/job-challans';
import { stageNamer } from '@/server/order-stages';

/**
 * Goods Dispatch Note register on the F1 list standard (26 Sep 2026):
 * filtered and paged on the server (server/gdn-list, shared with the export).
 */
export default async function GoodsDispatchPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [list, views, roles, jobGdns, stageName] = await Promise.all([gdnList(ctx, sp), listSavedViews(ctx, '/goods-dispatch'), shareableRoles(ctx), jobGdnList(ctx.scope), stageNamer(ctx.scope)]);
  const jobGdnCount = jobGdns.length;
  const page = slicePage(list.rows, parseGridQuery(sp));

  return (
    <>
    <GoodsDispatchClient
      rows={page.rows.map((r) => ({
        ...r,
        stageLabel: stageName(r.fulfilmentStatus),
        orderDate: r.orderDate.toISOString(),
        expectedDeliveryDate: r.expectedDeliveryDate?.toISOString() ?? null,
      }))}
      paging={page.paging}
      counts={list.counts}
      card={list.card}
      rangeLabel={list.filters.range.label}
      olderInTransit={list.olderInTransit}
      totalAll={list.totalAll}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      banner={<JobGdnPointer count={jobGdnCount} />}
    />
    </>
  );
}
