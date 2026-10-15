import { requireContext } from '@/server/context';
import { listColumnValues } from '@/server/custom-fields';
import { customersList } from '@/server/customers-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { CustomersClient } from './CustomersClient';

/**
 * Customers - filtered, searched, sorted and paged on the server; the browser
 * receives one page (health check PERF-1). The cards are counted over every
 * customer in scope from the same rows, with the same rules the list filters by.
 */
export default async function CustomersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [list, types, views, roles] = await Promise.all([
    customersList(ctx, sp),
    db.customerType.findMany({
      where: { ...scopeWhere(ctx.scope), isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    listSavedViews(ctx, '/customers'),
    shareableRoles(ctx),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp));

  const extraColumns = await listColumnValues(ctx.scope, 'customer', page.rows.map((r) => r.id));

  return (
    <CustomersClient
      extraColumns={extraColumns}
      openId={sp.open ?? null}
      rows={page.rows}
      paging={page.paging}
      summary={list.summary}
      totalCount={list.totalAll}
      card={list.card}
      dormant={list.dormant}
      type={list.type}
      city={list.city}
      due={list.due}
      cities={list.cities}
      rangeLabel={list.filters.range.label}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      customerTypes={types}
      canCreate={ctx.scope.kind === 'single' && ctx.permissions.has('customers.create')}
      scopeIsAll={ctx.scope.kind === 'all'}
    />
  );
}
