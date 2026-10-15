import { requireContext } from '@/server/context';
import { listTechnicians, listFieldConfigs } from '@/server/complaints';
import { fieldSetup } from '@/server/custom-fields';
import { complaintsList } from '@/server/complaints-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { customerPrefill } from '@/server/customer-prefill';
import { customisationFor } from '@/server/ui-customisation';
import { ComplaintsClient } from './ComplaintsClient';

/**
 * Customer Complaints - searched, filtered and paged on the server
 * (health check PERF-1 / SVC-4), on the F1 list standard since 26 Sep 2026:
 * one FilterBar (search, raised date, technician incl. "Assigned to me",
 * saved views, export), status cards, phone cards. The filtering itself lives
 * in server/complaints-list so the export matches the screen exactly.
 */
export default async function ComplaintsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  const [list, technicians, fieldConfigs, views, roles, rules, raiseFor, custom] = await Promise.all([
    complaintsList(ctx, sp),
    listTechnicians(ctx.scope),
    listFieldConfigs(ctx.scope),
    listSavedViews(ctx, '/services/complaints'),
    shareableRoles(ctx),
    // Which built-in fields this branch shows and demands (Field rules).
    fieldSetup(ctx.scope, 'complaint'),
    // G-39: Raise complaint from a customer's page opens with that customer chosen.
    customerPrefill(ctx.scope, sp.raise),
    // Stage colours an admin set on the Jobs Dashboard (11 Oct 2026) - one set for both.
    customisationFor(ctx, 'services.board'),
  ]);

  const { query } = list;
  const pageCount = Math.max(1, Math.ceil(list.rows.length / query.pageSize));
  const page = Math.min(query.page, pageCount - 1);

  return (
    <ComplaintsClient
      raiseFor={raiseFor ? { id: raiseFor.id, label: raiseFor.label, sub: raiseFor.sub } : null}
      rows={list.rows.slice(page * query.pageSize, (page + 1) * query.pageSize).map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
      paging={{ total: list.rows.length, page, pageSize: query.pageSize, sort: query.sort }}
      counts={list.counts}
      card={list.card}
      rangeLabel={list.filters.range.label}
      categories={list.categories}
      categoryId={list.categoryId}
      technicians={technicians}
      fieldConfigs={fieldConfigs}
      rules={rules}
      canEdit={ctx.permissions.has('complaints.edit')}
      stageColors={custom.value.colors}
      canConfigure={ctx.permissions.has('settings.edit')}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
    />
  );
}
