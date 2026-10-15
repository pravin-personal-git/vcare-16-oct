import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { replacementsList } from '@/server/replacements-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { RmaClient } from './RmaClient';

export default async function ReplacementsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!ctx.permissions.has('complaints.view') && !ctx.permissions.has('complaints.edit')) {
    return <p className="p-6 text-sm text-muted-foreground">You do not have access to replacement cases.</p>;
  }

  const [list, products, parties, views, roles] = await Promise.all([
    replacementsList(ctx, sp),
    db.product.findMany({
      where: { ...scopeWhere(ctx.scope), isActive: true, kind: 'goods' },
      select: { id: true, productName: true, productCode: true },
      orderBy: { productName: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    db.party.findMany({
      where: { ...scopeWhere(ctx.scope), status: 'active' },
      select: { id: true, title: true, firstName: true, lastName: true, companyName: true, phone: true, isCustomer: true, isSupplier: true },
      orderBy: { firstName: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    listSavedViews(ctx, '/services/replacements'),
    shareableRoles(ctx),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp));

  const iso = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return (
    <RmaClient
      rows={iso(page.rows)}
      paging={page.paging}
      totals={list.totals}
      stuck={iso(list.stuck)}
      totalAll={list.totalAll}
      filter={list.filter}
      rangeLabel={list.filters.range.label}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      products={products.map((p) => ({ id: p.id, name: p.productName, code: p.productCode }))}
      parties={parties.map((p) => ({
        id: p.id,
        name: p.companyName?.trim() || [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim(),
        phone: p.phone, isCustomer: p.isCustomer, isSupplier: p.isSupplier,
      }))}
      canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('complaints.edit')}
      initialOpenId={sp.open ?? null}
    />
  );
}
