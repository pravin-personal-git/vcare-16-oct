import { requireContext } from '@/server/context';
import { listColumnValues } from '@/server/custom-fields';
import { productsList } from '@/server/products-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { costAndMarginFor, getCostMethod, stockValuation } from '@/server/product-cost';
import { configFor } from '@/server/config';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import Link from 'next/link';
import { duplicateBarcodes } from '@/server/product-barcode';
import { ProductsClient } from './ProductsClient';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  const [list, categories, brands, views, roles] = await Promise.all([
    productsList(ctx, sp),
    db.category.findMany({
      where: { ...scopeWhere(ctx.scope), isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, parentId: true, codePrefix: true },
    }),
    db.brand.findMany({
      where: { ...scopeWhere(ctx.scope), isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    listSavedViews(ctx, '/products'),
    shareableRoles(ctx),
  ]);
  const rows = list.all;

  // Cost is resolved for the whole page in two queries, never per row - see
  // `costsFor`. Valuation is skipped in All Company because each branch may
  // cost differently and summing across them would be a number with no meaning.
  // Filtered, searched and paged here (PERF-1); cost and margin are worked
  // out for the page on screen, and the totals over every product.
  const query = parseGridQuery(sp);
  const { summary, card, inactive } = list;
  // Cost and margin need the costing pass - run over the filtered rows only
  // when someone sorts by them, then sorted here; every other sort was done
  // by server/products-list.
  let sorted = list.rows;
  if (query.sort && (query.sort.key === 'cost' || query.sort.key === 'margin')) {
    const allCosts = await costAndMarginFor(ctx.scope, sorted.map((r) => ({ id: r.id, dlpPaise: r.dlpPaise })));
    const val = (id: string) => (query.sort!.key === 'cost' ? allCosts.get(id)?.cost.unitCostPaise ?? -1 : allCosts.get(id)?.margin.marginPct ?? -9999);
    const dir = query.sort.dir === 'asc' ? 1 : -1;
    sorted = [...sorted].sort((a, b) => (val(a.id) - val(b.id)) * dir);
  }
  const page = slicePage(sorted, query);

  const [costs, valuation, costMethod] = await Promise.all([
    costAndMarginFor(ctx.scope, page.rows.map((r) => ({ id: r.id, dlpPaise: r.dlpPaise }))),
    ctx.scope.kind === 'single' ? stockValuation(ctx.scope) : Promise.resolve(null),
    getCostMethod(ctx.scope),
  ]);

  const extraColumns = await listColumnValues(ctx.scope, 'product', page.rows.map((r) => r.id));
  // Serials on the shelf per product (15 Oct 2026), whatever the product's
  // tracking setting - migrated serials sit on `quantity` products too.
  const serialCounts = await db.stockUnit.groupBy({
    by: ['productId'],
    where: { ...scopeWhere(ctx.scope), productId: { in: page.rows.map((r) => r.id) }, deletedAt: null, status: 'in_stock', serialNo: { not: null } },
    _count: { _all: true },
  });

  /**
   * `web.show.margin` (F1a, wired 1 Oct 2026).
   *
   * Margin is what the business makes on each item. Plenty of owners do not
   * want it on a screen their counter staff use, and the permission system
   * cannot express that on its own - a person may need the product list and
   * not the profit on it. The switch has existed since F1a and nothing read
   * it; it was on the PENDING_WIRING burn-down.
   *
   * Default ON, so nothing changes for a client who has not thought about it.
   */
  const showMargin = (await configFor(ctx).catch(() => null))?.on('web.show.margin') !== false;
  // G8 (12 Oct 2026): barcodes on more than one product, from before the rule.
  const dupes = await duplicateBarcodes(ctx.scope).catch(() => []);

  return (
    <>
    {dupes.length > 0 && (
      <Link href="/products/barcode-duplicates" className="mb-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm hover:border-warning">
        <b>{dupes.length} barcode{dupes.length === 1 ? ' is' : 's are'} on more than one product.</b>
        <span className="text-muted-foreground">A scan can land on the wrong one. Open the list to clean up →</span>
      </Link>
    )}
    {ctx.scope.kind === 'single' && ctx.permissions.has('products.edit') && (
      <div className="mb-2 flex justify-end">
        <Link href="/products/stock-in" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
          Stock in by scan (opening / found stock) →
        </Link>
      </div>
    )}
    <ProductsClient
      showMargin={showMargin}
      /*
        The PLATFORM owner's switch, not the client's (lib/plans
        `PLATFORM_FEATURES`). Off for everybody by default, because an expiry
        box on every product form is noise for a client who sells cameras.
      */
      expiryEnabled={ctx.features.has('expiry')}
      extraColumns={extraColumns}
      rows={page.rows}
      paging={page.paging}
      totals={{
        count: rows.length,
        stockValuePaise: rows.filter((r) => r.isActive).reduce((n, r) => n + r.currentQty * r.dlpPaise, 0),
        negative: rows.filter((r) => r.isActive && r.currentQty < 0).length,
      }}
      card={card}
      inactive={inactive}
      category={list.category}
      brand={list.brand}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      summary={summary}
      categories={categories}
      brands={brands}
      costs={Object.fromEntries(costs)}
      serials={Object.fromEntries(serialCounts.map((s) => [s.productId, s._count._all]))}
      valuation={valuation}
      costMethod={costMethod}
      canCreate={ctx.scope.kind === 'single' && ctx.permissions.has('products.edit')}
      scopeIsAll={ctx.scope.kind === 'all'}
      // `?q=` was accepted by every link that pointed here and read by nothing,
      // so arriving from the stock report landed you on the full catalogue with
      // the code you wanted sitting in the address bar. The link looked broken
      // and the page looked fine, which is the hardest kind of bug to report.
    />
    </>
  );
}
