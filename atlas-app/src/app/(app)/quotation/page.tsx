import { requireContext } from '@/server/context';
import { quotationsList } from '@/server/quotations-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { customerPrefill } from '@/server/customer-prefill';
import { QuotationClient } from './QuotationClient';

export default async function QuotationPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  // Customers, leads and products for the form load when it opens (PERF-2).
  const [list, store, categories, views, roles, forCustomer] = await Promise.all([
    quotationsList(ctx, sp),
    ctx.scope.kind === 'single'
      ? db.store.findUnique({ where: { id: ctx.scope.storeId }, select: { stateId: true } })
      : Promise.resolve(null),
    db.category.findMany({
      where: { ...scopeWhere(ctx.scope), isActive: true, parentId: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, codePrefix: true },
    }),
    listSavedViews(ctx, '/quotation'),
    shareableRoles(ctx),
    // G-39: New quotation from a customer's page - the form opens for them.
    customerPrefill(ctx.scope, sp.customer),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp));

  // Cost per product, so the form can show a live margin as lines are added
  // and discounts typed. Two queries for the whole catalogue - see `costsFor`.
  //
  // This is a PREVIEW. The figure that gets stored is recomputed server-side on
  // save, because a browser that can set its own cost can report any profit it
  // likes, and a margin is what a discount is argued against.

  return (
    <QuotationClient
      forCustomer={forCustomer}
      rows={page.rows}
      paging={page.paging}
      counts={list.counts}
      bySource={list.bySource}
      card={list.card}
      source={list.source}
      rangeLabel={list.filters.range.label}
      olderOpen={list.olderOpen}
      openValuePaise={list.openValuePaise}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      storeState={store?.stateId ?? null}
      categories={categories}
      canAddProduct={ctx.scope.kind === 'single' && ctx.permissions.has('products.edit')}
      canCreate={ctx.scope.kind === 'single' && ctx.permissions.has('quotation.create')}
      scopeIsAll={ctx.scope.kind === 'all'}
      view={list.view}
      filterOptions={list.options}
      picked={list.picked}
    />
  );
}
