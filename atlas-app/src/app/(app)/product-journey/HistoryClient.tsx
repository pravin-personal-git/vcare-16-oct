'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader, Badge, Card, EmptyState, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { UnitTrail } from './UnitTrail';
import { openProductAction, openUnitAction, searchHistoryAction } from './actions';
import type { ProductHistoryVM, UnitJourneyVM } from './serialise';
import type { BrowseCatalogue, ProductHit } from '@/server/product-history';

type Catalogue = BrowseCatalogue;

/**
 * A product's whole life, from purchase to customer (rebuilt 2 Oct 2026).
 *
 * WHY THE MODEL COMES FIRST AND THE UNITS SECOND.
 *
 * The first version of this screen asked for a serial number. On real data
 * that is a dead end - no unit on record carries its sale yet - so the page
 * looked broken for a reason that had nothing to do with the page. The trail
 * that IS complete is the model's: every receipt in, every invoice out, what
 * each cost, what each earned, what is still owed, what is left on the shelf.
 * That works for a kirana store that labels nothing and for a CCTV installer
 * that labels everything.
 *
 * So: one search box that takes a code, a name, a barcode or a serial; a money
 * summary; the trail in date order; and the individual units or batches
 * underneath, each one drillable, where the client tracks them.
 *
 * The amber panel is the point of the whole screen. It names what Atlas cannot
 * answer for this product, in words, instead of printing a zero and letting
 * somebody trust it.
 */

type View =
  | { kind: 'idle' }
  | { kind: 'hits'; hits: ProductHit[] }
  | { kind: 'product'; product: ProductHistoryVM }
  | { kind: 'unit'; unit: UnitJourneyVM; product: ProductHistoryVM | null };

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

const when = (iso: string | null) =>
  (iso
    ? new Date(iso).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    })
    : 'date unknown');

const TRACKING_WORDS: Record<string, string> = {
  none: 'Not stocked',
  quantity: 'Counted by quantity',
  batch: 'Tracked by batch',
  serial: 'Tracked by serial',
};

const STATUS_WORDS: Record<string, string> = {
  in_stock: 'On the shelf',
  reserved: 'Reserved',
  with_customer: 'With a customer',
  with_supplier: 'Back with the supplier',
  scrapped: 'Scrapped',
  lost: 'Lost',
};

export function HistoryClient({ catalogue, initialProduct, initialUnit }: {
  /** The whole catalogue, so a product can be picked instead of typed. */
  catalogue: Catalogue;
  initialProduct: ProductHistoryVM | null;
  initialUnit: UnitJourneyVM | null;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(
    initialUnit
      ? { kind: 'unit', unit: initialUnit, product: initialProduct }
      : initialProduct
        ? { kind: 'product', product: initialProduct }
        : { kind: 'idle' },
  );

  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true); setError(null);
    const r = await searchHistoryAction(q);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    if (r.product) setView({ kind: 'product', product: r.product });
    else setView({ kind: 'hits', hits: r.hits ?? [] });
  };

  const openProduct = async (id: string) => {
    setBusy(true); setError(null);
    const r = await openProductAction(id);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    if (r.product) setView({ kind: 'product', product: r.product });
  };

  const openUnit = async (id: string, product: ProductHistoryVM) => {
    setBusy(true); setError(null);
    const r = await openUnitAction(id);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    if (r.unit) setView({ kind: 'unit', unit: r.unit, product });
  };

  return (
    <>
      <PageHeader
        badge="TRL"
        title="Product history"
        subtitle="Everything bought and sold of one product, what it cost, what it earned, and where each item went"
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block font-medium">Product code, name, barcode or serial number</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
              placeholder="Type or scan whatever is printed on the item"
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand"
            />
          </label>
          <Button icon="search" loading={busy} onClick={() => void search()}>Find it</Button>
        </div>
        {/* Said once, here, because it is the question people ask first. */}
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Any of the four works. A serial number opens the product it belongs to, with that
          item marked in the list below.
        </p>
      </Card>

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/10 p-3 text-sm text-on-tint-danger">{error}</Card>
      )}

      <ProductPicker catalogue={catalogue} busy={busy} onPick={(id) => void openProduct(id)} />

      {view.kind === 'hits' && (
        view.hits.length === 0 ? (
          <EmptyState
            icon="search"
            title="Nothing matches that"
            hint="Check the number against the label. Partial codes and names work."
          />
        ) : (
          <SectionCard
            title={`${view.hits.length} match${view.hits.length === 1 ? '' : 'es'}`}
            icon="package" bodyClassName="p-0"
          >
            <ul className="divide-y divide-border">
              {view.hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button" onClick={() => void openProduct(h.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-muted/50"
                  >
                    <span className="font-mono text-sm font-semibold text-brand">{h.productCode}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {h.productName}
                      {(h.categoryName || h.subCategoryName) && (
                        <span className="ms-1.5 text-xs text-muted-foreground">
                          {[h.categoryName, h.subCategoryName].filter(Boolean).join(' › ')}
                        </span>
                      )}
                    </span>
                    {/* The barcode, so a scanned code can be checked against what came back. */}
                    {h.barcode && (
                      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                        {h.barcode}
                      </span>
                    )}
                    {h.matchedSerial && (
                      <Badge tone="info">matched serial {h.matchedSerial}</Badge>
                    )}
                    <Icon name="chevron-right" className="ms-auto h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </SectionCard>
        )
      )}

      {view.kind === 'unit' && (
        <UnitTrail
          j={view.unit}
          onClose={view.product
            ? () => setView({ kind: 'product', product: view.product! })
            : undefined}
        />
      )}

      {view.kind === 'product' && (
        <ProductView
          p={view.product}
          busy={busy}
          onOpenUnit={(id) => void openUnit(id, view.product)}
        />
      )}

      {view.kind === 'idle' && (
        <EmptyState
          icon="package"
          title="Look up any product"
          hint="You will get every purchase and every sale of it in order, what it cost, what it earned, and where each item went. Clicking a product name in the catalogue lands here too."
        />
      )}
    </>
  );
}

/**
 * Pick a product without knowing its code (3 Oct 2026).
 *
 * The screen offered one text box and nothing else. That is exactly right for a
 * technician holding an item and reading the label off it - which is what the box
 * is for - and useless for anybody working through a category, who had to know
 * the code by heart or fetch it from another tab first.
 *
 * So: category, then sub-category, then the products in it. The whole catalogue
 * is already in the browser, so every keystroke is instant and nothing is
 * fetched. Collapsed by default, because the person who HAS the label should not
 * have to scroll past a browser to reach the box.
 */
function ProductPicker({ catalogue, onPick, busy }: {
  catalogue: Catalogue;
  onPick: (productId: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [subCategoryId, setSubCategoryId] = useState('');
  const [q, setQ] = useState('');

  // Only the sub-categories of the chosen category, so this is never a list of
  // every sub-category in the business.
  const subCategories = useMemo(
    () => catalogue.subCategories.filter((sc) => !categoryId || sc.parentId === categoryId),
    [catalogue.subCategories, categoryId],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalogue.products.filter((p) => {
      if (categoryId && p.categoryId !== categoryId) return false;
      if (subCategoryId && p.subCategoryId !== subCategoryId) return false;
      if (!needle) return true;
      return p.productName.toLowerCase().includes(needle)
        || p.productCode.toLowerCase().includes(needle)
        || (p.barcode ?? '').toLowerCase().includes(needle);
    });
  }, [catalogue.products, categoryId, subCategoryId, q]);

  /**
   * Capped at what a person will actually read down.
   *
   * Rendering 1,339 rows makes the panel scroll forever and the browser work for
   * no benefit - nobody reads past the first screenful, they narrow instead. The
   * count below says how many were left out, so the cap is never silent.
   */
  const shown = rows.slice(0, 200);
  const selectClass = 'h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand';

  if (catalogue.products.length === 0) return null;

  return (
    <Card className="mb-4 p-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-start text-sm font-medium"
      >
        <Icon name={open ? 'chevron-up' : 'chevron-down'} className="h-4 w-4 text-muted-foreground" />
        Or browse by category
        <span className="font-normal text-muted-foreground">
          &mdash; {catalogue.products.length.toLocaleString('en-IN')} products, no code needed
        </span>
      </button>

      {open && (
        <div className="mt-3 grid gap-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-xs">
              <span className="mb-1 block font-medium">Category</span>
              <select
                value={categoryId}
                onChange={(e) => { setCategoryId(e.target.value); setSubCategoryId(''); }}
                className={selectClass}
              >
                <option value="">All categories</option>
                {catalogue.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>

            <label className="text-xs">
              <span className="mb-1 block font-medium">Sub-category</span>
              <select
                value={subCategoryId}
                onChange={(e) => setSubCategoryId(e.target.value)}
                className={selectClass}
                disabled={subCategories.length === 0}
              >
                <option value="">{subCategories.length === 0 ? 'None here' : 'All sub-categories'}</option>
                {subCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>

            <label className="text-xs">
              <span className="mb-1 block font-medium">Narrow it down</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name, code or barcode"
                className={selectClass}
              />
            </label>
          </div>

          <p className="text-xs text-muted-foreground">
            {rows.length.toLocaleString('en-IN')} match
            {rows.length === 1 ? 'es' : ''}
            {rows.length > shown.length && ` · showing the first ${shown.length}, narrow it to see the rest`}
          </p>

          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {shown.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPick(p.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-muted/50 disabled:opacity-50"
                >
                  <span className="font-mono text-xs font-semibold text-brand">{p.productCode}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{p.productName}</span>
                  {p.barcode && (
                    <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                      {p.barcode}
                    </span>
                  )}
                  {p.trackingMode === 'serial' && <Badge tone="info">serial</Badge>}
                  {p.trackingMode === 'batch' && <Badge tone="info">batch</Badge>}
                  <Icon name="chevron-right" className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-3 py-4 text-sm text-muted-foreground">
                Nothing matches. Try a different category, or clear the box.
              </li>
            )}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ model */

interface TrailRow {
  key: string;
  /** `repair` (10 Oct 2026): a customer's unit moved and our stock did not. */
  dir: 'in' | 'out' | 'repair';
  at: string;
  title: string;
  party: string;
  docNo: string | null;
  docHref: string | null;
  qty: number;
  amountPaise: number | null;
  detail: string | null;
  open: boolean;
}

function ProductView({ p, busy, onOpenUnit }: {
  p: ProductHistoryVM; busy: boolean; onOpenUnit: (id: string) => void;
}) {
  /**
   * Purchases and sales on ONE line in date order.
   *
   * Two separate lists would make the reader interleave them by eye to answer
   * the only question the order matters for: did we buy more before or after
   * that big sale.
   */
  const trail: TrailRow[] = [
    ...p.purchases.map((r) => ({
      key: `in-${r.grnId}-${r.at}`,
      dir: 'in' as const,
      at: r.at,
      title: 'Received into stock',
      party: r.supplierName,
      docNo: r.grnNo,
      docHref: `/goods-receipt/${r.grnId}`,
      qty: r.qty,
      amountPaise: r.unitCostPaise !== null ? -(r.unitCostPaise * r.qty) : null,
      detail: r.supplierInvoiceNo ? `Their bill ${r.supplierInvoiceNo}` : null,
      open: false,
    })),
    ...p.sales.map((r) => ({
      key: `out-${r.invoiceId}-${r.at}-${r.lineTotalPaise}`,
      dir: 'out' as const,
      at: r.at,
      title: 'Sold',
      party: r.customerName,
      docNo: r.invoiceNo,
      docHref: `/invoices/${r.invoiceId}`,
      qty: r.qty,
      amountPaise: r.lineTotalPaise,
      detail: r.owedPaise > 0 ? `${rupees(r.owedPaise)} still to collect on this invoice` : null,
      open: r.owedPaise > 0,
    })),
    // Jobs, returns, adjustments and the repair loop (10 Oct 2026).
    ...p.moves.map((r) => ({
      key: r.key,
      dir: (r.repair ? 'repair' : r.qty < 0 ? 'out' : 'in') as TrailRow['dir'],
      at: r.at,
      title: r.title,
      party: r.serialNo ? `S/N ${r.serialNo}` : '',
      docNo: r.docNo,
      docHref: r.docHref,
      qty: Math.abs(r.qty),
      amountPaise: null,
      detail: r.detail,
      open: false,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const marked = p.units.filter((u) => u.status === 'in_stock').length;

  return (
    <>
      <Card className="mb-3 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold">{p.productName}</p>
            <p className="font-mono text-xs text-muted-foreground">{p.productCode}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={p.trackingMode === 'serial' ? 'info' : 'neutral'}>
              {TRACKING_WORDS[p.trackingMode] ?? p.trackingMode}
            </Badge>
            <Badge tone={p.stock.onHandQty > 0 ? 'success' : 'warning'}>
              {p.stock.onHandQty} {p.unitLabel} on the shelf
            </Badge>
            {p.money.theyOwePaise > 0 && (
              <Badge tone="danger">{rupees(p.money.theyOwePaise)} still to collect</Badge>
            )}
          </div>
        </div>

        {/* Money first, because it is the question behind the question. */}
        <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label={`Bought · ${p.money.boughtQty} ${p.unitLabel}`}
            value={p.money.boughtPaise} tone="text-danger"
          />
          <Figure
            label={`Sold · ${p.money.soldQty} ${p.unitLabel}${p.money.jobQty > 0 ? ` · ${p.money.jobQty} more used on jobs` : ''}`}
            value={p.money.soldPaise} tone="text-success"
          />
          <Figure label="Cost of what sold" value={p.money.costOfSoldPaise} tone="text-muted-foreground" />
          <Figure
            label="Made on it" value={p.money.marginPaise} strong
            tone={p.money.marginPaise !== null && p.money.marginPaise < 0 ? 'text-danger' : 'text-foreground'}
          />
        </div>

        {p.stock.valuePaise !== null && (
          <p className="mt-2 text-xs text-muted-foreground">
            Stock on hand is worth about {rupees(p.stock.valuePaise)} at average cost. &ldquo;Made on
            it&rdquo; counts only what has actually been sold, so stock still on the shelf is not
            held against it.
          </p>
        )}
      </Card>

      {/*
        The honest panel. Amber and not red: none of these is a fault, they are
        things nobody has recorded yet, and each one names what to do about it.
      */}
      {p.gaps.length > 0 && (
        <Card className="mb-3 border-warning/40 bg-warning/10 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-warning">
            <Icon name="alert-triangle" className="h-4 w-4" />
            What this trail cannot tell you
          </p>
          <ul className="mt-1.5 grid gap-1">
            {p.gaps.map((g) => (
              <li key={g} className="flex gap-2 text-xs leading-relaxed text-foreground">
                <span aria-hidden="true" className="text-warning">&bull;</span>
                <span className="min-w-0">{g}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SectionCard
        title="Everything in and out, newest first" icon="clock"
        action={<span className="text-xs text-muted-foreground">{trail.length} entries</span>}
      >
        {trail.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No receipt and no invoice recorded against this product yet.
          </p>
        ) : (
          <ol className="relative grid gap-0">
            <span aria-hidden="true" className="absolute inset-y-3 start-[15px] w-px bg-border" />
            {trail.map((t) => (
              <li key={t.key} className="relative flex gap-3 py-2.5">
                <span className={`z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border ${
                  t.open
                    ? 'border-warning bg-warning/15 text-on-tint-warning'
                    : 'border-border bg-card text-muted-foreground'
                }`}>
                  <Icon name={t.dir === 'in' ? 'package' : t.dir === 'repair' ? 'wrench' : 'trending-up'} className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold">{t.title}</span>
                    <span className="truncate text-sm text-muted-foreground">{t.party}</span>
                    {t.dir !== 'repair' && (
                      <Badge tone="neutral">
                        {t.dir === 'in' ? '+' : '−'}{t.qty} {p.unitLabel}
                      </Badge>
                    )}
                    {t.open && <Badge tone="warning">unpaid</Badge>}

                    {t.amountPaise !== null && (
                      <span className={`ms-auto whitespace-nowrap font-mono text-sm font-semibold tabular-nums ${
                        t.amountPaise < 0 ? 'text-danger' : 'text-success'
                      }`}>
                        {t.amountPaise < 0 ? '−' : '+'}{rupees(Math.abs(t.amountPaise))}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{when(t.at)}</span>
                    {t.docNo && (t.docHref
                      ? <Link href={t.docHref} className="font-mono text-brand hover:underline">{t.docNo}</Link>
                      : <span className="font-mono">{t.docNo}</span>)}
                    {t.detail && <span className="min-w-0">{t.detail}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      {(p.trackingMode === 'serial' || p.units.length > 0) && (
        <SectionCard
          className="mt-3" title="The individual items" icon="scan" bodyClassName="p-0"
          action={
            <span className="text-xs text-muted-foreground">
              {marked} on the shelf of {p.units.length} labelled
            </span>
          }
        >
          {p.units.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              This product is set to serial tracking but no item has been given a number yet.
              Numbers are issued when stock is received.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b border-border bg-muted/40 text-micro uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-start font-medium">Number</th>
                    <th className="px-4 py-2 text-start font-medium">Where it is</th>
                    <th className="px-4 py-2 text-start font-medium">Who has it</th>
                    <th className="px-4 py-2 text-start font-medium">Invoice</th>
                    <th className="px-4 py-2 text-start font-medium">Received</th>
                    <th className="px-4 py-2 text-end font-medium">Cost</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {p.units.map((u) => (
                    <tr
                      key={u.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => onOpenUnit(u.id)}
                    >
                      <td className="px-4 py-2 font-mono font-semibold">
                        {u.serialNo ?? <span className="text-muted-foreground">not yet numbered</span>}
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={u.status === 'in_stock' ? 'success' : 'info'}>
                          {STATUS_WORDS[u.status] ?? u.status.replace(/_/g, ' ')}
                        </Badge>
                        {u.condition !== 'new' && <Badge tone="warning" className="ms-1">{u.condition}</Badge>}
                      </td>
                      <td className="px-4 py-2">
                        {u.holderName ?? (
                          u.status === 'in_stock'
                            ? <span className="text-muted-foreground">us</span>
                            /* The 1,215-unit hole, visible per row instead of
                               only in the amber panel above. */
                            : <span className="text-warning">not recorded</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {u.invoiceNo ?? <span className="text-muted-foreground">&mdash;</span>}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{when(u.receivedAt)}</td>
                      <td className="px-4 py-2 text-end font-mono tabular-nums">
                        {u.unitCostPaise !== null
                          ? rupees(u.unitCostPaise)
                          : <span className="text-muted-foreground">not recorded</span>}
                      </td>
                      <td className="pe-2">
                        <Icon name="chevron-right" className="h-4 w-4 text-muted-foreground" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {busy && <p className="px-4 py-2 text-xs text-muted-foreground">Opening&hellip;</p>}
        </SectionCard>
      )}

      {p.trackingMode === 'batch' && (
        <SectionCard className="mt-3" title="The batches" icon="box" bodyClassName="p-0">
          {p.lots.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No batch recorded for this product yet. Batches are created when stock is received
              with a lot number on the pack.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="border-b border-border bg-muted/40 text-micro uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-start font-medium">Batch</th>
                    <th className="px-4 py-2 text-start font-medium">Made</th>
                    <th className="px-4 py-2 text-start font-medium">Expires</th>
                    <th className="px-4 py-2 text-start font-medium">Received</th>
                    <th className="px-4 py-2 text-end font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {p.lots.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2 font-mono font-semibold">{l.lotNo}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{when(l.mfgDate)}</td>
                      <td className="px-4 py-2">
                        {l.expiryDate === null ? (
                          <span className="text-xs text-muted-foreground">no date on the pack</span>
                        ) : (
                          <ExpiryCell iso={l.expiryDate} daysLeft={l.daysLeft} />
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{when(l.receivedAt)}</td>
                      <td className="px-4 py-2 text-end font-mono tabular-nums">
                        {l.unitCostPaise !== null
                          ? rupees(l.unitCostPaise)
                          : <span className="text-muted-foreground">not recorded</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </>
  );
}

function ExpiryCell({ iso, daysLeft }: { iso: string; daysLeft: number | null }) {
  const tone = daysLeft === null ? 'neutral'
    : daysLeft < 0 ? 'danger'
      : daysLeft <= 30 ? 'warning' : 'success';
  const words = daysLeft === null ? ''
    : daysLeft < 0 ? `expired ${-daysLeft} days ago`
      : daysLeft === 0 ? 'expires today'
        : `${daysLeft} days left`;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs">{when(iso)}</span>
      {words && <Badge tone={tone}>{words}</Badge>}
    </span>
  );
}

function Figure({ label, value, tone, strong = false }: {
  label: string; value: number | null; tone: string; strong?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {value === null ? (
        /* Not "0". Unknown and zero are different, and only one of them is a
           claim about the business. */
        <p className="mt-1 text-sm text-muted-foreground">Not recorded</p>
      ) : (
        <p className={`mt-1 tabular-nums ${strong ? 'text-xl font-bold' : 'text-lg font-semibold'} ${tone}`}>
          {rupees(value)}
        </p>
      )}
    </div>
  );
}
