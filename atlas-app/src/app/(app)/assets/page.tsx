import { requireContext } from '@/server/context';
import { listAssetRequests, listAssetBatches, getAssetDashboard } from '@/server/assets';
import { ASSET_LIST, runCardList } from '@/server/card-lists';
import { AssetsClient } from './AssetsClient';

export default async function AssetsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [assets, requests, batches, dashboard] = await Promise.all([
    ASSET_LIST.load(ctx),
    listAssetRequests(ctx.scope),
    listAssetBatches(ctx.scope),
    getAssetDashboard(ctx.scope),
  ]);

  // ?status=, search and page run here (F1b server paging, 6 Oct 2026). The
  // status counts and the spare-asset picker read every asset, not the page.
  const list = runCardList(ASSET_LIST, assets, sp, ctx);
  const statuses = ['unassigned', 'assigned', 'maintenance', 'retired'] as const;
  const statusCounts = Object.fromEntries(statuses.map((st) => [st, assets.filter((a) => a.status === st).length]));
  const spare = assets.filter((a) => a.status === 'unassigned').map((a) => ({ ...a, purchaseDate: a.purchaseDate ? a.purchaseDate.toISOString() : null }));

  return (
    <AssetsClient
      listPage={{ server: list.server, chipCounts: list.chipCounts, total: list.all }}
      statusFilter={sp.status && (statuses as readonly string[]).includes(sp.status) ? sp.status : 'all'}
      statusCounts={statusCounts}
      spare={spare}
      assets={list.rows.map((a) => ({
        ...a,
        purchaseDate: a.purchaseDate ? a.purchaseDate.toISOString() : null,
      }))}
      requests={requests.map((r) => ({
        ...r,
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      }))}
      batches={batches.map((b) => ({ ...b, purchaseDate: b.purchaseDate ? b.purchaseDate.toISOString() : null }))}
      dashboard={dashboard}
      currentUserId={ctx.user.id}
      canEdit={ctx.permissions.has('assets.edit')}
      isSingleStore={ctx.scope.kind === 'single'}
    />
  );
}
