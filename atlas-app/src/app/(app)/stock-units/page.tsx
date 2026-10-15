import { redirect } from 'next/navigation';
import { StockTabs } from '@/components/stock/StockTabs';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import {
  listUnits, serialStockGaps, listStockFields, getWarrantyBasis, findUnitsBySerial,
} from '@/server/stock-units';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { countPools } from '@/lib/stock-units';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { unitsList } from '@/server/units-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { canReadUnits } from './actions';
import { StockUnitsClient } from './StockUnitsClient';

export default async function StockUnitsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  if (!(await canReadUnits(ctx.permissions))) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        You do not have access to stock units. Ask a manager for complaints or stock access.
      </p>
    );
  }

  const [units, gaps, fields, basis, categories, serialProducts, lookup, views, roles] = await Promise.all([
    listUnits(ctx.scope),
    serialStockGaps(ctx.scope),
    listStockFields(ctx.scope),
    getWarrantyBasis(ctx.scope),
    db.category.findMany({
      where: { ...scopeWhere(ctx.scope), isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    // Customers and suppliers, for "who is it going to". Searchable on the
    // screen rather than a dropdown - there are thousands.
    db.product.findMany({
      where: { ...scopeWhere(ctx.scope), trackingMode: 'serial' },
      select: { id: true, productName: true, productCode: true },
      orderBy: { productName: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    // `?q=` - a global-search hit on a serial lands on that unit, not on the
    // whole list with the serial sitting in the address bar.
    sp.q ? findUnitsBySerial(ctx.scope, sp.q) : Promise.resolve([]),
    listSavedViews(ctx, '/stock-units'),
    shareableRoles(ctx),
  ]);

  const iso = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  // Counted over every unit here; the Units tab gets one page (PERF-1). The
  // party list for moving a unit loads when its drawer opens (PERF-2).
  const now = new Date();
  const asPool = (u: (typeof units)[number]) => ({ ...u, receivedAt: new Date(u.receivedAt) });
  const pools = countPools(units.map(asPool), now);
  const waiting: Record<string, number> = {};
  for (const u of units) if (!u.serialNo && u.status !== 'scrapped') waiting[u.productId] = (waiting[u.productId] ?? 0) + 1;
  // "Stock vs units" moved to Stock > Checks (15 Oct 2026) - it was the same
  // question as Checks' first section, asked on two screens.
  if (sp.tab === 'gaps') redirect('/reports/stock-health');
  const tab = sp.tab ?? (sp.q ? 'lookup' : null);
  // The Units tab: filtered in server/units-list (shared with the export), one page sent.
  const unitList = tab === 'units' ? await unitsList(ctx, sp, units) : null;
  const unitPage = slicePage(unitList?.rows ?? [], parseGridQuery(sp));
  const pool = unitList?.pool ?? 'in_stock';

  return (
    <>
    <StockTabs active="serials" checks={gaps.length} />
    <StockUnitsClient
      units={iso(unitPage.rows)}
      unitPaging={unitPage.paging}
      unitCount={units.length}
      pools={pools}
      pool={pool}
      rangeLabel={unitList?.filters.range.label ?? 'All time'}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      waiting={waiting}
      gaps={gaps}
      fields={fields}
      warrantyBasis={basis}
      categories={categories}
      serialProducts={serialProducts.map((p) => ({ id: p.id, name: p.productName, code: p.productCode }))}
      initialSearch={sp.q ?? ''}
      initialLookup={iso(lookup)}
      initialOpenId={sp.open ?? null}
      initialTab={tab}
      canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('purchase.edit')}
      canConfigure={ctx.scope.kind === 'single' && ctx.permissions.has('settings.edit')}
      isSingleStore={ctx.scope.kind === 'single'}
    />
    </>
  );
}
