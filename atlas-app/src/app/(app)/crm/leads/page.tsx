import { requireContext } from '@/server/context';
import { listColumnValues } from '@/server/custom-fields';
import { leadsList } from '@/server/leads-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import Link from 'next/link';
import { newShopRequestCount } from '@/server/shop-requests';
import { LeadsClient } from './LeadsClient';

export default async function LeadsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const where = scopeWhere(ctx.scope);

  const [list, stages, dealStages, sources, users, views, roles, newShop] = await Promise.all([
    leadsList(ctx, sp),
    db.leadStage.findMany({
      where: { ...where, isActive: true },
      orderBy: { sort: 'asc' },
      select: { id: true, name: true, isGroupHeader: true, parentId: true },
    }),
    db.leadDealStage.findMany({
      where: { ...where, isActive: true }, orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.leadSource.findMany({
      where: { ...where, isActive: true }, orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true } }),
    listSavedViews(ctx, '/crm/leads'),
    shareableRoles(ctx),
    // Customers waiting from the online shop (13 Oct 2026) - shown above the list until somebody picks them up.
    newShopRequestCount(ctx.scope).catch(() => 0),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp));
  // The person filter offers the people who actually hold leads here.
  const holders = new Set(list.holderIds);

  const extraColumns = await listColumnValues(ctx.scope, 'lead', page.rows.map((r) => r.id));

  return (
    <>
    {newShop > 0 && (
      <Link href="/sales/shop-requests" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-brand/40 bg-brand/5 px-4 py-3 text-sm font-semibold text-on-tint-brand hover:bg-brand/10">
        <span>{newShop} new {newShop === 1 ? 'request' : 'requests'} from the online shop - nobody has picked {newShop === 1 ? 'it' : 'them'} up yet</span>
        <span aria-hidden>&rarr;</span>
      </Link>
    )}
    <LeadsClient
      extraColumns={extraColumns}
      openId={sp.open ?? null}
      rows={page.rows}
      paging={page.paging}
      summary={list.summary}
      card={list.card}
      closed={list.closed}
      rangeLabel={list.filters.range.label}
      people={users.filter((u) => holders.has(u.id) || u.id === ctx.user.id).sort((a, b) => a.fullName.localeCompare(b.fullName))}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      stages={stages}
      dealStages={dealStages}
      sources={sources}
      users={users}
      canCreate={ctx.scope.kind === 'single' && ctx.permissions.has('leads.create')}
      scopeIsAll={ctx.scope.kind === 'all'}
    />
    </>
  );
}
