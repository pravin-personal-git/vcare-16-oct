'use client';

import { stockMatches } from '@/lib/stock-search';
import { useState } from 'react';
import Link from 'next/link';
import { PageHeader, Badge } from '@/components/ui/Layout';
import { Toolbar } from '@/components/ui/Toolbar';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Icon } from '@/components/ui/Icon';
import { COST_METHODS } from '@/lib/costing';
import type { StockReport, StockRow } from '@/server/stock-report';

/**
 * Stock on hand.
 *
 * THE TWO WARNINGS ABOVE THE TABLE ARE NOT DECORATION.
 *
 * Negative stock is always a data error - goods left without being recorded, or
 * an opening balance never entered. Unpriced stock is missing from the
 * valuation entirely. Both make the headline number wrong, in opposite
 * directions, and both are invisible if you only read the total.
 */

const rupees = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Filter = 'all' | 'reorder' | 'out' | 'negative' | 'unpriced';

const TRACKING_LABEL: Record<string, string> = {
  serial: 'By serial', batch: 'By batch', quantity: 'By quantity', none: 'Not stocked',
};

/** One look for the filter dropdowns; lit when it is narrowing. */
const pickClass = (active: boolean) =>
  `h-ctl rounded-sm border bg-card px-2.5 text-sm font-medium outline-none transition focus:border-brand ${
    active ? 'border-brand bg-brand/5 text-on-tint-brand' : 'border-border hover:border-border-strong'
  }`;

export function StockClient({ report }: { report: StockReport }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [tracking, setTracking] = useState('');

  // Only categories and modes something is actually in, so a choice can never
  // return an empty table.
  const categories = [...new Set(report.rows.map((r) => r.categoryName).filter((c): c is string => Boolean(c)))]
    .sort((a, b) => a.localeCompare(b));
  const trackingModes = [...new Set(report.rows.map((r) => r.trackingMode))].sort();
  // Sub-categories narrow to the chosen category, so every choice has rows.
  const subCategories = [...new Set(report.rows
    .filter((r) => !category || r.categoryName === category)
    .map((r) => r.subCategoryName).filter((c): c is string => Boolean(c)))]
    .sort((a, b) => a.localeCompare(b));
  const brands = [...new Set(report.rows.map((r) => r.brandName).filter((b): b is string => Boolean(b)))]
    .sort((a, b) => a.localeCompare(b));

  const methodLabel =
    COST_METHODS.find((m) => m.value === report.method)?.label ?? report.method;

  // These tiles ARE the filter. Until 4 Oct 2026 the same four numbers were
  // drawn twice, once as chips on the toolbar and again as tiles, and the
  // tiles were wired to nothing (activeKey null, onSelect a no-op).
  const cards: KpiCard[] = [
    {
      key: 'all', label: 'Stock value', count: rupees(report.totalValuePaise),
      subLabel: `${report.productsHeld} products held`, icon: 'package', tone: 'brand',
    },
    {
      key: 'reorder', label: 'Need reordering', count: report.reorderCount,
      subLabel: report.reorderCount > 0 ? 'at or below level' : 'nothing low',
      icon: 'alert-triangle', tone: report.reorderCount > 0 ? 'warning' : 'success',
    },
    {
      key: 'out', label: 'Out of stock', count: report.outOfStockCount,
      subLabel: 'nothing on the shelf', icon: 'alert-circle',
      tone: report.outOfStockCount > 0 ? 'warning' : 'default',
    },
    ...(report.negativeCount > 0 ? [{
      key: 'negative', label: 'Negative stock', count: report.negativeCount,
      subLabel: 'always a data error', icon: 'alert-circle' as const, tone: 'danger' as const,
    }] : []),
    {
      key: 'unpriced', label: 'No cost on record', count: report.unpricedCount,
      subLabel: report.unpricedCount > 0 ? 'value not counted' : 'all priced',
      icon: 'file-text', tone: report.unpricedCount > 0 ? 'danger' : 'success',
    },
  ];

  const rows = report.rows.filter((r) => {
    // Barcode, SKU and every serial included - see lib/stock-search.
    if (!stockMatches(r, search)) return false;
    if (category && r.categoryName !== category) return false;
    if (subCategory && r.subCategoryName !== subCategory) return false;
    if (brand && r.brandName !== brand) return false;
    if (tracking && r.trackingMode !== tracking) return false;
    if (filter === 'reorder') return r.needsReorder;
    if (filter === 'out') return r.qty === 0;
    if (filter === 'negative') return r.negative;
    if (filter === 'unpriced') return r.qty > 0 && !r.costKnown;
    return true;
  });

  const columns: Column<StockRow>[] = [
    {
      key: 'product', header: 'Product', sortValue: (r) => r.productName,
      render: (r) => (
        // Code and category both have their own columns now, so the cell is
        // just the name.
        <Link href={`/product-journey?product=${r.productId}`} className="font-medium text-brand hover:underline">
          {r.productName}
        </Link>
      ),
    },
    {
      // Its own column, and filterable. Two of every three Vcare products sit
      // in one category, and until this column existed nobody could see that
      // from the stock screen, let alone narrow to "show me every camera".
      key: 'category', header: 'Category', sortValue: (r) => r.categoryName,
      render: (r) => (
        r.categoryName
          ? <span className="text-xs">{r.categoryName}</span>
          : <span className="text-xs text-muted-foreground">-</span>
      ),
    },
    {
      key: 'qty', header: 'On hand', align: 'end', sortValue: (r) => r.qty,
      render: (r) => (
        <span className="flex items-center justify-end gap-1.5">
          <span
            className={`tabular-nums font-medium ${
              r.negative ? 'text-danger' : r.qty === 0 ? 'text-muted-foreground' : ''
            }`}
          >
            {r.qty}
          </span>
          <span className="text-xs text-muted-foreground">{r.unit}</span>
        </span>
      ),
    },
    {
      key: 'reorder', header: 'Reorder at', align: 'end', sortValue: (r) => r.reorderLevel,
      render: (r) => (
        r.reorderLevel > 0
          ? (
            <span className={`tabular-nums ${r.needsReorder ? 'font-medium text-warning' : 'text-muted-foreground'}`}>
              {r.reorderLevel}
            </span>
          )
          : <span className="text-xs text-muted-foreground">not set</span>
      ),
    },
    {
      key: 'cost', header: 'Unit cost', align: 'end', sortValue: (r) => r.unitCostPaise,
      render: (r) => (
        r.costKnown
          ? <span className="tabular-nums">{rupees(r.unitCostPaise)}</span>
          : <Badge tone="danger">Unknown</Badge>
      ),
    },
    {
      key: 'value', header: 'Value', align: 'end', sortValue: (r) => r.valuePaise,
      render: (r) => (
        r.valuePaise > 0
          ? <span className="tabular-nums font-medium">{rupees(r.valuePaise)}</span>
          : <span className="text-muted-foreground">-</span>
      ),
    },
    {
      // NOT optional. The code is how somebody identifies a thing on a shelf -
      // "Anchor Roma One Way Switch 6A White" and "…10A White" are two lines of
      // near-identical text, and SWT-D001 versus SWT-D002 is not. Hiding it
      // behind the column chooser meant the one unambiguous field was the one
      // you had to go looking for.
      key: 'code', header: 'Code', sortValue: (r) => r.productCode,
      render: (r) => (
        <span className="font-mono text-xs font-medium">{r.productCode}</span>
      ),
    },
    {
      // Shown, not tucked behind the column chooser: a barcode is what is on
      // the box in somebody's hand.
      key: 'barcode', header: 'Barcode', sortValue: (r) => r.barcode ?? '',
      render: (r) => (
        r.barcode
          ? <span className="font-mono text-xs">{r.barcode}</span>
          : <span className="text-xs text-muted-foreground">-</span>
      ),
    },
    {
      // A dash for a product with no serials that is not serial-tracked, rather
      // than a misleading zero. Any product holding serials shows them, whatever
      // its setting (15 Oct 2026: migrated serials sat on `quantity` products).
      key: 'serials', header: 'Serials', align: 'end', sortValue: (r) => r.serialCount,
      render: (r) => (
        r.trackingMode !== 'serial' && r.serialCount === 0
          ? <span className="text-xs text-muted-foreground">-</span>
          : r.serialCount === 0
            ? <span className="text-xs text-muted-foreground">none</span>
            : (
              <Link
                href={`/stock-units?q=${encodeURIComponent(r.productCode)}`}
                className="font-mono text-xs font-medium text-brand hover:underline"
                title={r.serialSample.join(', ') + (r.serialCount > r.serialSample.length ? ` and ${r.serialCount - r.serialSample.length} more` : '')}
              >
                {r.serialCount}
              </Link>
            )
      ),
    },
    {
      key: 'status', header: 'Status', optional: true, sortValue: (r) => (
        r.negative ? 'a' : r.needsReorder ? 'b' : r.qty === 0 ? 'c' : 'd'
      ),
      render: (r) => {
        if (r.negative) return <Badge tone="danger">Negative</Badge>;
        if (r.needsReorder) return <Badge tone="warning">Reorder</Badge>;
        if (r.qty === 0) return <Badge tone="neutral">Out</Badge>;
        return <Badge tone="success">In stock</Badge>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        badge="ST"
        title="Stock on Hand"
        subtitle={`${rupees(report.totalValuePaise)} across ${report.productsHeld} products · valued at ${methodLabel.toLowerCase()}`}
        actions={
          /* G-06 (6 Oct 2026): two stock pages with similar names. This one is
             the shelf; Stock Checks checks the records behind it. */
          <Link href="/reports/stock-health" className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
            title="Checks the stock records: serial numbers the count cannot account for, and batches expiring">
            <Icon name="alert-triangle" className="h-3.5 w-3.5" />
            Numbers look wrong? Stock Checks
          </Link>
        }
      />
      <p className="-mt-3 mb-3 text-xs text-muted-foreground">
        What is on the shelf now, what it is worth and what to reorder. Opened daily.
      </p>

      {/* One line each, expandable. The wording is worth keeping word for
          word; a quarter of the first screen was not. */}
      {report.negativeCount > 0 && (
        <details className="mb-2 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2">
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <Icon name="alert-circle" className="h-4 w-4 shrink-0 text-danger" />
            <span>{report.negativeCount} product{report.negativeCount === 1 ? ' has' : 's have'} negative stock</span>
          </summary>
          <p className="mt-2 text-xs leading-relaxed">
            <strong>
              {report.negativeCount} product{report.negativeCount === 1 ? ' has' : 's have'} negative
              stock.
            </strong>{' '}
            That is never a real state - it means goods left without being recorded, or an
            opening balance was never entered. Until it is fixed, every figure that depends on
            those products is wrong.
          </p>
        </details>
      )}

      {report.unpricedCount > 0 && (
        <details className="mb-3 rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2">
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <Icon name="alert-triangle" className="h-4 w-4 shrink-0 text-warning" />
            <span>{report.unpricedQty} units across {report.unpricedCount} product{report.unpricedCount === 1 ? '' : 's'} have no cost on record</span>
          </summary>
          <p className="mt-2 text-xs leading-relaxed">
            <strong>
              {report.unpricedQty} units across {report.unpricedCount} product
              {report.unpricedCount === 1 ? '' : 's'} have no cost on record.
            </strong>{' '}
            They are counted but not valued, so the stock value above is understated by whatever
            they are actually worth.{' '}
            <Link href="/purchase/bills" className="font-medium text-brand hover:underline">
              Enter a purchase bill
            </Link>{' '}
            for them, or set a standard cost on the product.
          </p>
        </details>
      )}

      <div className="mb-3">
        <KpiStrip
          cards={cards}
          activeKey={filter === 'all' ? null : filter}
          onSelect={(k) => setFilter((k ?? 'all') as Filter)}
          columns={5}
        />
      </div>

      <Toolbar
        filters={
          <>
            <label htmlFor="st-cat" className="sr-only">Category</label>
            <select id="st-cat" value={category} onChange={(e) => { setCategory(e.target.value); setSubCategory(''); }}
              className={pickClass(Boolean(category))}>
              <option value="">Category: all</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {subCategories.length > 0 && (
              <>
                <label htmlFor="st-sub" className="sr-only">Sub-category</label>
                <select id="st-sub" value={subCategory} onChange={(e) => setSubCategory(e.target.value)}
                  className={pickClass(Boolean(subCategory))}>
                  <option value="">Sub-category: all</option>
                  {subCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </>
            )}
            {brands.length > 0 && (
              <>
                <label htmlFor="st-brand" className="sr-only">Brand</label>
                <select id="st-brand" value={brand} onChange={(e) => setBrand(e.target.value)}
                  className={pickClass(Boolean(brand))}>
                  <option value="">Brand: all</option>
                  {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </>
            )}
            <label htmlFor="st-track" className="sr-only">Tracking</label>
            <select id="st-track" value={tracking} onChange={(e) => setTracking(e.target.value)}
              className={pickClass(Boolean(tracking))}>
              <option value="">Tracking: all</option>
              {trackingModes.map((m) => <option key={m} value={m}>{TRACKING_LABEL[m] ?? m}</option>)}
            </select>
            {(category || subCategory || brand || tracking || filter !== 'all') && (
              <button
                type="button"
                onClick={() => { setCategory(''); setSubCategory(''); setBrand(''); setTracking(''); setFilter('all'); }}
                className="h-ctl rounded-sm px-2.5 text-sm font-medium text-brand hover:underline"
              >
                Clear filters
              </button>
            )}
            <span className="text-xs text-muted-foreground">
              Showing {rows.length.toLocaleString('en-IN')} of {report.rows.length.toLocaleString('en-IN')}
            </span>
          </>
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Product, code, barcode, SKU or serial…"
      />

      <DataGrid
        exportAs={{ title: 'Stock on hand' }}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.productId}
        /* No `search` prop: the page matched it above, serials included.
           DataGrid only searches column values, and a serial is not one. */
        emptyIcon="package"
        emptyMessage={
          report.rows.length === 0 ? 'No stock-holding products yet' : 'Nothing matches this filter'
        }
        emptyHint={
          report.rows.length === 0
            ? 'Add products, then enter a purchase bill to put stock on the shelf.'
            : undefined
        }
        pageSummary={(pageRows) => (
          <span className="tabular-nums">
            Page value {rupees(pageRows.reduce((n, r) => n + r.valuePaise, 0))}
          </span>
        )}
      />

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Valued at <strong>{methodLabel.toLowerCase()}</strong>, set in System Settings. Services
        are excluded - they hold no stock. Quantities are summed across warehouses; the reorder
        level shown is the highest set for the product, because a level is a threshold per
        location and adding them together would fire alerts far too early.
        {report.noReorderLevelCount > 0 && (
          <>
            {' '}
            <strong>{report.noReorderLevelCount} products have no reorder level set</strong> and
            can never raise an alert.
          </>
        )}
      </p>
    </>
  );
}
