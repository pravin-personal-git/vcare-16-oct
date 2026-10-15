'use client';

import { sayIfHeld } from '@/lib/held-message';
import { customColumns } from '@/components/custom-fields/list-columns';
import type { ListColumns } from '@/server/custom-fields';

import { useState } from 'react';
import Link from 'next/link';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { useListParams } from '@/components/ui/useListParams';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader } from '@/components/ui/Layout';
import { Button, ToggleChip } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { AmcOfferBadge } from '@/components/ui/AmcOfferBadge';
import { StockAdjustDialog } from './StockAdjustDialog';
import { ToolbarMenu } from '@/components/ui/Toolbar';
import { ConfirmDialog } from '@/components/ui/Modal';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import { type ProductFilter, type ProductRow } from '@/lib/product-metrics';
import { ProductForm } from './ProductForm';
import { editProduct } from './actions';
import { PurchasePriceDialog } from './PurchasePriceDialog';
import { changeCostMethod } from './cost-actions';
import { COST_METHODS, type CostMethod, type CostResult, type Margin } from '@/lib/costing';
import type { StockValuation } from '@/server/product-cost';
import { ask } from '@/components/ui/ask';

interface Props {
  /** Settings > Custom Fields marked "Show in list". */
  extraColumns?: ListColumns;
  /** One page, filtered and sorted on the server. */
  rows: ProductRow[];
  paging: ServerPaging;
  /** Over every product in scope. */
  totals: { count: number; stockValuePaise: number; negative: number };
  /** The active card (?card=) and Active/Inactive (?status=). */
  card: string | null;
  inactive: boolean;
  summary: Record<ProductFilter, number>;
  categories: { id: string; name: string; parentId: string | null; codePrefix: string | null }[];
  brands: { id: string; name: string }[];
  /** productId → resolved cost and the margin it implies against DLP. */
  costs: Record<string, { cost: CostResult; margin: Margin }>;
  /** productId -> serials on the shelf. Opens the product's history, which lists every one. */
  serials?: Record<string, number>;
  /** `web.show.margin` (F1a). Off hides the Margin column entirely. */
  showMargin?: boolean;
  /** lib/plans `PLATFORM_FEATURES` - whether the expiry fields exist at all. */
  expiryEnabled?: boolean;
  /** Null in All Company - branches may cost differently, so there is no total. */
  valuation: StockValuation | null;
  costMethod: CostMethod;
  canCreate: boolean;
  scopeIsAll: boolean;
  /** Category and brand filters (?category= ?brand=, by name). */
  category: string | null;
  brand: string | null;
  canExport: boolean;
  views: FilterBarViews;
}

export function ProductsClient({
  rows, paging, totals, card, inactive, summary, categories, brands, costs, valuation, costMethod, canCreate, scopeIsAll,
  category, brand, canExport, views, extraColumns, showMargin = true, serials = {},
  expiryEnabled = false,
}: Props) {
  // In the address, so the server filters - and a link with ?q= from the
  // stock report or the command palette lands on the product asked for.
  const list = useListParams();
  const filter = card;
  const setFilter = (k: string | null) => list.set({ card: k });
  const showActive = !inactive;
  const setShowActive = (on: boolean) => list.set({ status: on ? null : 'inactive' });
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deactivate, setDeactivate] = useState<ProductRow | null>(null);
  const [adjust, setAdjust] = useState<ProductRow | null>(null);
  const [costFor, setCostFor] = useState<ProductRow | null>(null);

  const cards: KpiCard[] = [
    { key: 'in_offer',     label: 'In Offer',     count: summary.in_offer, icon: 'tag', tone: 'success' },
    { key: 'combo',        label: 'Combo',        count: summary.combo, icon: 'package', tone: 'info' },
    { key: 'low_stock',    label: 'Low Stock',    count: summary.low_stock, icon: 'alert-triangle', tone: 'warning' },
    { key: 'out_of_stock', label: 'Out of Stock', count: summary.out_of_stock, icon: 'x-circle', tone: 'danger' },
    // Its own card because it is a different problem with a different fix.
    // Out of stock means reorder; negative means the books and the shelf
    // disagree, and only counting fixes that.
    { key: 'negative_stock', label: 'Negative Stock', count: summary.negative_stock,
      icon: 'alert-circle', tone: 'danger', subLabel: 'sold more than we had' },
    { key: 'dead_stock',   label: 'Dead Stock',   count: summary.dead_stock, icon: 'clock', subLabel: 'not sold in 1 year' },
    { key: 'no_sale',      label: 'No Sale',      count: summary.no_sale, icon: 'trending-up', subLabel: 'not sold in 3 months' },
  ];

  const stockValue = totals.stockValuePaise;

  const columns: Column<ProductRow>[] = [
    {
      key: 'productCode', header: 'Product Code', width: '9rem',
      render: (r) => (
        <Link href={`/product-journey?product=${r.id}`} className="font-mono text-xs font-medium text-brand hover:underline">{r.productCode}</Link>
      ),
      sortValue: (r) => r.productCode,
    },
    {
      key: 'productName', header: 'Product Name',
      render: (r) => (
        <div>
          {/*
            The name is the way into the product's history - every receipt,
            every invoice, what it cost, what it earned, and where each item
            went. It used to be plain text, and the history screen had no
            entry point except typing a serial number nobody had to hand.
          */}
          <Link
            href={`/product-journey?product=${r.id}`}
            className="font-medium hover:text-brand hover:underline"
            title="Open this product's full history"
          >
            {r.productName}
          </Link>
          {/* G2 (12 Oct 2026): created from a scan with the selling price left for later. */}
          {r.mrpPaise === 0 && r.dlpPaise === 0 && (
            <span className="ms-1.5 rounded-full bg-warning/15 px-1.5 py-px text-micro font-semibold uppercase tracking-wide text-on-tint-warning">price missing</span>
          )}
          {r.sku && <p className="text-xs text-muted-foreground">SKU {r.sku}</p>}
          {/*
            The barcode, shown at last (3 Oct 2026). The column has always been
            there and editable, and appeared on no screen - so somebody could
            type one in and never see it again, let alone check it against the
            box. It is also searchable now, so scanning into the search box finds
            the row.
          */}
          {r.barcode && (
            <p className="font-mono text-xs text-muted-foreground">{r.barcode}</p>
          )}
          {/*
            The AMC offer and the warranty, shown on the catalogue row itself.
            The badge renders nothing when a product carries no AMC, which
            keeps 1,325 cables and connectors quiet and makes the handful of
            products that DO carry one stand out.
          */}
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            <AmcOfferBadge offer={{
              amcAvailable: r.amcAvailable ?? false,
              amcPricingMode: r.amcPricingMode ?? null,
              amcDurationMonths: r.amcDurationMonths ?? null,
              amcAnnualPricePaise: r.amcAnnualPricePaise ?? null,
              amcTerms: r.amcTerms ?? null,
            }} />
            {r.warrantyMonths != null && r.warrantyMonths > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                <Icon name="check-circle" className="h-2.5 w-2.5" />
                {r.warrantyMonths} mo warranty
              </span>
            )}
          </span>
        </div>
      ),
      sortValue: (r) => r.productName,
    },
    {
      /*
        Hidden while nobody uses barcodes - an empty column on 1,339 rows is
        noise - and shown on its own once any product on the page has one
        (4 Oct 2026). Before that it stayed in the column chooser even after
        barcodes were entered, so it looked as if they had not saved.
      */
      key: 'barcode', header: 'Barcode', optional: !rows.some((r) => r.barcode),
      sortValue: (r) => r.barcode ?? '',
      render: (r) => (
        <span className="font-mono text-xs">
          {r.barcode ?? <span className="text-muted-foreground">-</span>}
        </span>
      ),
    },
    {
      // Sortable and filterable on its own, so "show me everything we sell an
      // AMC on" is one click rather than a scan.
      key: 'amc', header: 'AMC',
      render: (r) => (
        r.amcAvailable
          ? (
            <span className="text-xs">
              {r.amcPricingMode === 'included'
                ? `Included ${r.amcDurationMonths ?? 12}m`
                : r.amcAnnualPricePaise
                  ? `${formatCurrency(r.amcAnnualPricePaise)}/yr`
                  : <span className="text-warning">Not priced</span>}
            </span>
          )
          : <span className="text-xs text-muted-foreground">-</span>
      ),
      sortValue: (r) => (r.amcAvailable ? (r.amcPricingMode ?? 'yes') : ''),
      optional: true,
    },
    { key: 'categoryName', header: 'Category', render: (r) => r.categoryName ?? '-', sortValue: (r) => r.categoryName },
    { key: 'subCategoryName', header: 'Sub Category', render: (r) => r.subCategoryName ?? '-', sortValue: (r) => r.subCategoryName },
    { key: 'brandName', header: 'Brand', render: (r) => r.brandName ?? '-', sortValue: (r) => r.brandName, optional: true },
    { key: 'hsnCode', header: 'HSN', render: (r) => r.hsnCode ?? '-', sortValue: (r) => r.hsnCode, optional: true },
    { key: 'location', header: 'Location', render: (r) => r.location ?? '-', sortValue: (r) => r.location, optional: true },
    {
      key: 'dlp', header: 'DLP', align: 'end',
      render: (r) => <span className="font-mono text-xs">{formatCurrency(r.dlpPaise)}</span>,
      sortValue: (r) => r.dlpPaise,
    },
    {
      key: 'mrp', header: 'MRP', align: 'end',
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{formatCurrency(r.mrpPaise)}</span>,
      sortValue: (r) => r.mrpPaise,
    },
    {
      key: 'cost', header: 'Cost', align: 'end',
      render: (r) => {
        const c = costs[r.id]?.cost;
        // An em dash, not ₹0.00. A product nobody has priced does not cost
        // nothing, and showing zero here would flow into a 100% margin.
        if (!c || c.basis === 'none') {
          return <span className="text-xs text-muted-foreground" title="No purchase price recorded">-</span>;
        }
        return (
          <span
            className="font-mono text-xs"
            title={
              c.basis === 'average_3'
                ? `Average of the last ${c.samples} purchase${c.samples === 1 ? '' : 's'}`
                : c.basis === 'last_purchase' ? 'Last purchase price' : 'Standard cost'
            }
          >
            {formatCurrency(c.unitCostPaise)}
          </span>
        );
      },
      sortValue: (r) => costs[r.id]?.cost.unitCostPaise ?? -1,
    },
    ...(showMargin ? [{
      key: 'margin', header: 'Margin', align: 'end' as const,
      render: (r: ProductRow) => {
        const m = costs[r.id]?.margin;
        if (!m || m.unknown || m.marginPct === null) {
          return <span className="text-xs text-muted-foreground">-</span>;
        }
        const bad = m.marginPct < 0;
        return (
          <span
            className={`font-mono text-xs ${bad ? 'font-semibold text-danger' : 'text-success'}`}
            title={`${formatCurrency(m.marginPaise)} per unit · ${m.markupPct}% mark-up on cost`}
          >
            {m.marginPct.toFixed(1)}%
          </span>
        );
      },
      sortValue: (r: ProductRow) => costs[r.id]?.margin.marginPct ?? -9999,
    }] satisfies Column<ProductRow>[] : []),
    {
      key: 'currentQty', header: 'Stock', align: 'end',
      render: (r) => {
        const negative = r.currentQty < 0;
        const out = r.currentQty === 0;
        const low = !out && !negative && r.currentQty <= r.reorderLevel;
        return (
          <span
            title={negative
              ? 'More has been dispatched than the system ever received. Count the shelf and record an adjustment.'
              : undefined}
            className={`inline-flex items-center gap-1 font-mono text-xs tabular-nums ${
              negative
                ? 'rounded bg-danger/10 px-1.5 py-0.5 font-bold text-on-tint-danger'
                : out ? 'font-semibold text-danger' : low ? 'font-semibold text-warning' : ''
            }`}
          >
            {negative && <Icon name="alert-triangle" className="h-3 w-3" />}
            {r.currentQty}
            <span className="text-xs font-normal text-muted-foreground">{r.unit}</span>
          </span>
        );
      },
      sortValue: (r) => r.currentQty,
    },
    {
      key: 'serials', header: 'Serials', align: 'end', optional: !rows.some((r) => serials[r.id]),
      render: (r) => (serials[r.id]
        ? (
          <Link
            href={`/product-journey?product=${r.id}`}
            onClick={(e) => e.stopPropagation()}
            title="Serials on the shelf - open to see every one and its history"
            className="font-mono text-xs font-medium text-brand hover:underline"
          >
            {serials[r.id]}
          </Link>
        )
        : <span className="text-xs text-muted-foreground">-</span>),
      sortValue: (r) => serials[r.id] ?? 0,
    },
    {
      key: 'flags', header: 'Flags',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.isInOffer && <Badge tone="success" icon="tag">Offer</Badge>}
          {r.isCombo && <Badge tone="info" icon="package">Combo</Badge>}
          {!r.isInOffer && !r.isCombo && <span className="text-muted-foreground">-</span>}
        </div>
      ),
      optional: true,
    },
  ];

  return (
    <div>
      <PageHeader
        badge="PR"
        title="Products"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{totals.count.toLocaleString('en-IN')} in this scope</span>
            <span className="text-border-strong">·</span>
            <span title="Valued at the selling price - what the stock would fetch, not what it cost">
              {formatCurrencyCompact(stockValue)} at DLP
            </span>
            {valuation && (
              <>
                <span className="text-border-strong">·</span>
                <span
                  className="font-medium text-foreground"
                  title={
                    'Valued at cost - the figure a balance sheet wants. '
                    + `Basis: ${COST_METHODS.find((m) => m.value === valuation.method)?.label}`
                  }
                >
                  {formatCurrencyCompact(valuation.valuePaise)} at cost
                </span>
                {valuation.productsUnvalued > 0 && (
                  <Badge
                    tone="warning"
                    title={
                      `${valuation.productsUnvalued} product(s) have no purchase price, so `
                      + `${valuation.unitsUnvalued} unit(s) are not in the figure above. `
                      + 'They are excluded rather than valued at zero.'
                    }
                  >
                    {valuation.productsUnvalued} unpriced
                  </Badge>
                )}
              </>
            )}
          </span>
        }
        actions={
          <>
            {/* How each product is counted - none, quantity, batch or serial -
                set in bulk on its own screen rather than one form at a time. */}
            <Link href="/products/tracking">
              <Button variant="outline" icon="sliders">Stock tracking</Button>
            </Link>
            <Button
              variant="primary"
              icon="plus"
              disabled={!canCreate}
              title={
                scopeIsAll
                  ? 'Select a single store to add a product'
                  : canCreate ? undefined : 'You do not have permission to add products'
              }
              onClick={() => setFormOpen(true)}
            >
              Add Product
            </Button>
          </>
        }
      />

      {totals.negative > 0 && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2.5"
        >
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <div className="text-xs leading-relaxed">
            <p className="font-semibold text-danger">
              {totals.negative} product{totals.negative === 1 ? '' : 's'} showing
              negative stock
            </p>
            <p className="mt-0.5 text-muted-foreground">
              More has been dispatched than the system ever received - either the
              opening stock was never entered, or goods went out without being
              recorded. This makes the stock valuation wrong, so the dashboard
              figure is wrong too. Count the shelf and record an adjustment;
              reordering will not fix it.{' '}
              <button
                type="button"
                onClick={() => setFilter('negative_stock')}
                className="font-medium text-danger underline"
              >
                Show them
              </button>
            </p>
          </div>
        </div>
      )}

      <FilterBar
        searchPlaceholder="Name, code, category, brand, HSN, location…"
        extra={
          <>
            <ToggleChip on={showActive} onChange={setShowActive} label="Active" offLabel="Inactive" />
            <label htmlFor="fb-cat" className="sr-only">Category</label>
            <select id="fb-cat" value={category ?? ''} onChange={(e) => list.set({ category: e.target.value || null })}
              className={`h-10 max-w-[12rem] rounded-lg border bg-card px-2.5 text-sm outline-none focus:border-brand ${category ? 'border-brand bg-brand/5 font-medium text-brand' : 'border-border'}`}>
              <option value="">Category: all</option>
              {[...new Set(categories.map((c) => c.name))].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <label htmlFor="fb-brand" className="sr-only">Brand</label>
            <select id="fb-brand" value={brand ?? ''} onChange={(e) => list.set({ brand: e.target.value || null })}
              className={`h-10 max-w-[12rem] rounded-lg border bg-card px-2.5 text-sm outline-none focus:border-brand ${brand ? 'border-brand bg-brand/5 font-medium text-brand' : 'border-border'}`}>
              <option value="">Brand: all</option>
              {brands.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </>
        }
        shown={paging.total}
        clearKeys={['card', 'status', 'category', 'brand']}
        exportScreen={canExport ? 'products' : null}
        views={views}
        tools={
          <>
            {/*
              The costing basis. A decision rather than a preference - it moves
              every margin on this grid and the stock valuation in the header -
              so it sits here in the open rather than buried in settings, which
              is where the reference app hides it (System Configuration card 9).
            */}
            <ToolbarMenu label="Costing" icon="sliders" width="w-72">
              {(close) => (
                <div className="py-1">
                  <p className="px-3 pb-1.5 pt-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                    How cost is decided
                  </p>
                  {COST_METHODS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      disabled={scopeIsAll || busy}
                      onClick={() => {
                        close();
                        setBusy(true);
                        changeCostMethod(m.value).then(() => window.location.reload());
                      }}
                      className={`block w-full px-3 py-2 text-start transition hover:bg-muted disabled:opacity-40 ${
                        m.value === costMethod ? 'bg-brand/10' : ''
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {m.value === costMethod && <Icon name="check" className="h-3.5 w-3.5 text-brand" />}
                        {m.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">{m.hint}</span>
                    </button>
                  ))}
                  {scopeIsAll && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      Set per branch - select a single store to change it.
                    </p>
                  )}
                </div>
              )}
            </ToolbarMenu>
          </>
        }
      />

      <KpiStrip cards={cards} activeKey={filter} onSelect={setFilter} columns={6} />

      <DataGrid
        rows={rows}
        server={paging}
        columns={[...columns, ...customColumns<ProductRow>(extraColumns)]}
        rowKey={(r) => r.id}
        mobileCard={(r) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold">{r.productName}</span>
              <span className={`font-mono text-xs tabular-nums ${r.currentQty <= 0 ? 'font-semibold text-danger' : ''}`}>{r.currentQty} {r.unit}</span>
            </div>
            <p className="text-xs text-muted-foreground">{r.productCode}{r.categoryName ? ` · ${r.categoryName}` : ''}{r.brandName ? ` · ${r.brandName}` : ''} · DLP {formatCurrency(r.dlpPaise)}</p>
          </div>
        )}
        emptyIcon="package"
        emptyMessage={
          filter ? 'No products match this card.' : `No ${showActive ? 'active' : 'inactive'} products.`
        }
        emptyHint={
          filter
            ? 'Clear the card to see the whole catalogue.'
            : 'Add one from the button above, or create one on the fly while writing a quotation.'
        }
        actions={[
          { label: 'Edit details', icon: 'pencil', onSelect: (r) => setEditId(r.id) },
          {
            label: 'Purchase price',
            icon: 'truck',
            onSelect: (r) => setCostFor(r),
            enabled: () => !scopeIsAll,
          },
          {
            label: 'Adjust stock', icon: 'package',
            onSelect: (r) => setAdjust(r),
          },
          {
            label: 'Change rate',
            icon: 'tag',
            separatorBefore: true,
            onSelect: async (r) => {
              const v = await ask.text({
                icon: 'tag',
                title: 'Change the rate',
                message: r.productName,
                label: 'New DLP (₹)',
                defaultValue: String(r.dlpPaise / 100),
                inputMode: 'decimal', required: true,
                validate: (x) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? null : 'Enter an amount, like 1250 or 1250.50.'),
                confirmLabel: 'Save rate',
              });
              if (v === null) return;
              const n = Number(v);
              setBusy(true);
              const res = await editProduct(r.id, { dlp: n });
              setBusy(false);
              if (res.error) await ask.error(res.error); else { sayIfHeld(res); window.location.reload(); }
            },
          },
          {
            label: 'Set reorder level',
            icon: 'alert-triangle',
            onSelect: async (r) => {
              const v = await ask.text({
                icon: 'box',
                title: 'Set the reorder level',
                message: `${r.productName}: you are told to reorder when stock falls to this many.`,
                label: 'Reorder level',
                defaultValue: String(r.reorderLevel),
                inputMode: 'numeric', required: true,
                validate: (x) => (Number.isInteger(Number(x)) && Number(x) >= 0 ? null : 'Enter a whole number, like 5.'),
                confirmLabel: 'Save level',
              });
              if (v === null) return;
              const n = Number(v);
              setBusy(true);
              const res = await editProduct(r.id, { reorderLevel: n });
              setBusy(false);
              if (res.error) await ask.error(res.error); else window.location.reload();
            },
          },
          {
            label: 'Toggle offer',
            icon: 'sparkles',
            onSelect: async (r) => {
              setBusy(true);
              const res = await editProduct(r.id, { isInOffer: !r.isInOffer });
              setBusy(false);
              if (res.error) await ask.error(res.error); else window.location.reload();
            },
          },
          {
            label: showActive ? 'Deactivate' : 'Reactivate',
            icon: 'ban',
            tone: 'danger',
            separatorBefore: true,
            onSelect: (r) => setDeactivate(r),
          },
        ]}
      />

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground shadow-card">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <span>
          Changing a rate creates a new price record rather than overwriting the
          old one, so a quotation issued last month still shows the price it was
          quoted at. Deactivating hides a product from new quotations but leaves
          it on past ones. CSV import and stock movements are still to come.
        </span>
      </p>

      {costFor && (
        <PurchasePriceDialog
          product={{
            id: costFor.id,
            productName: costFor.productName,
            productCode: costFor.productCode,
            dlpPaise: costFor.dlpPaise,
          }}
          onClose={() => setCostFor(null)}
        />
      )}

      {adjust && (
        <StockAdjustDialog product={adjust} onClose={() => setAdjust(null)} />
      )}

      {deactivate && (
        <ConfirmDialog
          title={`${deactivate.isActive ? 'Deactivate' : 'Reactivate'} ${deactivate.productName}?`}
          confirmLabel={deactivate.isActive ? 'Deactivate' : 'Reactivate'}
          tone={deactivate.isActive ? 'danger' : 'brand'}
          busy={busy}
          onClose={() => setDeactivate(null)}
          onConfirm={async () => {
            setBusy(true);
            const res = await editProduct(deactivate.id, { isActive: !deactivate.isActive });
            setBusy(false);
            setDeactivate(null);
            if (res.error) await ask.error(res.error); else window.location.reload();
          }}
          message={
            deactivate.isActive
              ? 'It disappears from new quotations and orders, but stays on every document it already appears on. Nothing is deleted.'
              : 'It becomes selectable again on new quotations and orders.'
          }
        />
      )}

      {editId && (
        <ProductForm
          categories={categories} brands={brands} editId={editId}
          expiryEnabled={expiryEnabled}
          onClose={() => { setEditId(null); window.location.reload(); }}
        />
      )}

      {formOpen && (
        <ProductForm
          categories={categories}
          brands={brands}
          expiryEnabled={expiryEnabled}
          onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  );
}
