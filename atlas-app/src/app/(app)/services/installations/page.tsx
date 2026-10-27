import { redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere, userInScope } from '@/server/store-scope';
import { installationsList } from '@/server/installations-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { InstallationsClient } from './InstallationsClient';

/**
 * Installation Challans on the F1 list standard (26 Sep 2026): filtered and
 * paged on the server (server/installations-list, shared with the export)
 * instead of all 906 Vcare slips being drawn and filtered in the browser.
 */
export default async function InstallationsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  // An installation has its own page now (11 Oct 2026); old ?open= links land there.
  if (sp.open) redirect(`/services/installations/${sp.open}`);
  const ctx = await requireContext();

  // Orders and products are searched as you type in the form (PERF-2).
  const [list, staff, views, roles] = await Promise.all([
    installationsList(ctx, sp),
    // Scoped through the storeRoles relation - `User` has no storeId of its own.
    db.user.findMany({
      where: { isActive: true, ...userInScope(ctx.scope) },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    }),
    listSavedViews(ctx, '/services/installations'),
    shareableRoles(ctx),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp, 25));

  // "Raise a challan from this survey" (27 Oct 2026): the form opens on its customer.
  const survey = sp.survey
    ? await db.serviceVisit.findFirst({
      where: { id: sp.survey, ...scopeWhere(ctx.scope), reason: 'installation_survey', installationChallanId: null },
      select: { id: true, siteAddress: true, customer: { select: { id: true, firstName: true, lastName: true, companyName: true, phone: true, addressLine1: true } } },
    })
    : null;

  return (
    <InstallationsClient
      canEdit={ctx.permissions.has('installations.edit')}
      challans={page.rows.map((c) => ({
        ...c,
        dispatchedAt: c.dispatchedAt.toISOString(),
        completedAt: c.completedAt ? c.completedAt.toISOString() : null,
      }))}
      paging={page.paging}
      counts={list.counts}
      status={list.status}
      rangeLabel={list.filters.range.label}
      totalAll={list.totalAll}
      technicians={list.technicians}
      staff={staff}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      initialOpenId={sp.open ?? null}
      fromSurvey={survey?.customer ? {
        visitId: survey.id,
        customer: {
          id: survey.customer.id, label: survey.customer.companyName || [survey.customer.firstName, survey.customer.lastName].filter(Boolean).join(' '),
          sub: survey.customer.phone, address: survey.customer.addressLine1,
        },
        site: survey.siteAddress ?? survey.customer.addressLine1,
      } : null}
    />
  );
}
