import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { listTechnicians } from '@/server/complaints';
import { visitsList } from '@/server/visits-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { ServiceCallsClient } from './ServiceCallsClient';

/**
 * Visit Scheduler (was "Service Calls" - renamed so it is not confused with
 * the service team's phone calls, health check SVC-1). The complaint picker
 * searches as you type; ?complaint= (from a complaint's page) opens the
 * schedule form with that complaint already chosen.
 */
export default async function VisitSchedulerPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [list, technicians, preset, views, roles] = await Promise.all([
    visitsList(ctx, sp),
    listTechnicians(ctx.scope),
    sp.complaint
      ? db.complaint.findFirst({
        where: { id: sp.complaint, ...scopeWhere(ctx.scope) },
        select: { id: true, complaintNo: true, customer: { select: { firstName: true, lastName: true, companyName: true, phone: true } } },
      })
      : Promise.resolve(null),
    listSavedViews(ctx, '/services/visits'),
    shareableRoles(ctx),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp, 25));

  return (
    <ServiceCallsClient
      paging={page.paging}
      counts={list.counts}
      kindCounts={list.kindCounts}
      status={list.status}
      kind={list.kind}
      reason={list.reason}
      rangeLabel={list.filters.range.label}
      totalAll={list.totalAll}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      visits={page.rows.map((v) => ({
        ...v,
        scheduledAt: v.scheduledAt.toISOString(),
        checkedInAt: v.checkedInAt ? v.checkedInAt.toISOString() : null,
      }))}
      technicians={technicians}
      presetComplaint={preset ? {
        id: preset.id, label: preset.complaintNo,
        sub: `${preset.customer.companyName || [preset.customer.firstName, preset.customer.lastName].filter(Boolean).join(' ')} · ${preset.customer.phone}`,
      } : null}
    />
  );
}
