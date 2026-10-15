import { requireContext } from '@/server/context';
import { renewalsList } from '@/server/renewals-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { RenewalClient } from './RenewalClient';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';

/** Insurance & Policy on the F1 list standard (26 Sep 2026) - filtered on the server. */
export default async function PolicyRenewalPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [list, views, roles, people] = await Promise.all([
    renewalsList(ctx, sp), listSavedViews(ctx, '/hrm/renewal'), shareableRoles(ctx),
    // For 'Responsible person' - the people in this branch.
    db.user.findMany({ where: { isActive: true, storeRoles: { some: scopeWhere(ctx.scope) } }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp, 25));

  return (
    <RenewalClient
      items={page.rows.map((i) => ({
        ...i, expiryDate: i.expiryDate.toISOString(),
        lastPaid: i.lastPaid ? { dueDate: i.lastPaid.dueDate.toISOString(), amountPaise: i.lastPaid.amountPaise, paidAt: i.lastPaid.paidAt.toISOString() } : null,
      }))}
      people={people}
      paging={page.paging}
      counts={list.counts}
      card={list.card}
      type={list.type}
      types={list.types}
      rangeLabel={list.filters.range.label}
      totalAll={list.totalAll}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      canEdit={ctx.permissions.has('renewals.edit')}
      isSingleStore={ctx.scope.kind === 'single'}
    />
  );
}
