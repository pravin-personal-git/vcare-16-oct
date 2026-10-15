import { requireContext } from '@/server/context';
import { receiptsList } from '@/server/receipts-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { ReceiptsClient } from './ReceiptsClient';

/**
 * Receipts - filtered, searched and paged on the server (PERF-1), on the F1
 * list standard since 26 Sep 2026: receipt date (default this financial
 * year), the ?f= cards, views, export. Filtering lives in
 * server/receipts-list so the export matches the screen.
 */
export default async function ReceiptsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [list, views, roles] = await Promise.all([
    receiptsList(ctx, sp),
    listSavedViews(ctx, '/receipts'),
    shareableRoles(ctx),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp));

  return (
    <ReceiptsClient
      rows={page.rows}
      paging={page.paging}
      totals={list.totals}
      f={list.f}
      rangeLabel={list.filters.range.label}
      olderOnAccount={list.olderOnAccount}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      canRecord={ctx.scope.kind === 'single' && ctx.permissions.has('accounts.edit')}
      scopeIsAll={ctx.scope.kind === 'all'}
      // `?pay=1` (dashboards' Record payment): open the chooser straight away (G4).
      openPay={sp.pay === '1'}
    />
  );
}
