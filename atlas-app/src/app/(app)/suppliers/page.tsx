import { requireContext } from '@/server/context';
import { suppliersList } from '@/server/suppliers-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { SuppliersClient } from './SuppliersClient';

/** Suppliers on the F1 list standard (26 Sep 2026) - filtered and paged on the server. */
export default async function SuppliersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [list, views, roles] = await Promise.all([suppliersList(ctx, sp), listSavedViews(ctx, '/suppliers'), shareableRoles(ctx)]);
  const page = slicePage(list.rows, parseGridQuery(sp));
  return (
    <SuppliersClient
      rows={page.rows}
      paging={page.paging}
      counts={list.counts}
      card={list.card}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
    />
  );
}
