'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import { ProductLink } from '@/components/document/ProductLink';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge, Card, Segmented, SectionCard } from '@/components/ui/Layout';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { useListParams } from '@/components/ui/useListParams';
import { WithFormOptions } from '@/components/document/WithFormOptions';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ScanButton } from '@/components/scan/ScanButton';
import {
  UNIT_POOLS, UNIT_POOL_LABEL, UNIT_STATUS_LABEL, UNIT_STATUS_TONE, UNIT_CONDITION_LABEL, type UnitPool, type UnitStatus, type UnitCondition,
} from '@/lib/stock-units';
import { DEAD_STOCK_DAYS } from '@/lib/product-metrics';
import { STOCK_FIELD_TYPE_LABEL, type StockFieldDef, type StockFieldType } from '@/lib/stock-fields';
import type { UnitRow } from '@/server/stock-units';
import type { SerialGap } from '@/server/stock-units';
import {
  lookupUnitsAction, setStockFieldActiveAction, setWarrantyBasisAction, type UnitActionState,
} from './actions';
import { UnitDetail } from './UnitDetail';
import {
  FillSerialsDialog, OpeningStockDialog, StockFieldDialog, type PartyOption,
} from './UnitDialogs';

type Tab = 'lookup' | 'units' | 'settings';

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' });

const POOL_ICON: Record<UnitPool, 'check-circle' | 'refresh' | 'clock' | 'pencil' | 'truck' | 'users'> = {
  in_stock: 'check-circle', refurbished: 'refresh', dead_stock: 'clock',
  awaiting_serial: 'pencil', with_supplier: 'truck', with_customer: 'users', in_repair: 'refresh',
};

export function StockUnitsClient({
  units, unitPaging, unitCount, pools, pool, waiting, fields, warrantyBasis, categories, serialProducts,
  initialSearch, initialLookup, initialOpenId, initialTab, canEdit, canConfigure, isSingleStore, rangeLabel, canExport, views,
}: {
  /** One page of the Units tab, filtered and sorted on the server. */
  units: UnitRow[];
  unitPaging: ServerPaging;
  unitCount: number;
  /** Counted over every unit in scope. */
  pools: Record<UnitPool, number>;
  /** The active pool card (?pool=), null for all. */
  pool: UnitPool | null;
  /** Units waiting for a serial, per product. */
  waiting: Record<string, number>;
  gaps: SerialGap[];
  fields: StockFieldDef[];
  warrantyBasis: string;
  categories: { id: string; name: string }[];
  serialProducts: { id: string; name: string; code: string }[];
  initialSearch: string;
  initialLookup: UnitRow[];
  /** From `?open=<unit id>` - a link to one unit opens that unit (G-38). */
  initialOpenId?: string | null;
  initialTab: string | null;
  canEdit: boolean;
  canConfigure: boolean;
  isSingleStore: boolean;
  /** The Units tab filters (F1). */
  rangeLabel: string;
  canExport: boolean;
  views: FilterBarViews;
}) {
  const router = useRouter();
  const list = useListParams();
  const tab: Tab = (['lookup', 'units', 'settings'] as const).find((t) => t === initialTab) ?? 'lookup';
  const setTab = (t: Tab) => list.set({ tab: t, pool: null, uq: null, sort: null, dir: null });
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? (initialLookup.length === 1 ? initialLookup[0].id : null));
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'fill' | 'opening' | { field: StockFieldDef | null }>(null);

  const done = (res: UnitActionState) => {
    if (res.error) { setError(res.error); return; }
    setError(null);
    setFlash(res.message ?? 'Saved.');
    router.refresh();
  };


  return (
    <>
      <PageHeader
        badge="box"
        title="Serial & Batch Stock"
        subtitle="Every tracked unit - where it is, who has it, and whether it is covered"
        actions={
          <>
            <Link href="/products/tracking"><Button variant="outline" icon="sliders">Tracking by product</Button></Link>
            {canEdit && <Link href="/goods-receipt"><Button variant="primary" icon="download">Receive goods</Button></Link>}
          </>
        }
      />

      {!isSingleStore && (
        <Card className="mb-3 border-warning/40 bg-warning/10 p-3">
          <p className="text-sm"><strong>All Company</strong> is read-only. Select a single store to change units.</p>
        </Card>
      )}
      {flash && (
        <Card className="mb-3 border-success/30 bg-success/[0.06] px-3 py-2">
          <p className="flex items-center gap-2 text-xs"><Icon name="check-circle" className="h-4 w-4 text-success" />{flash}</p>
        </Card>
      )}
      {error && (
        <Card className="mb-3 border-danger/30 bg-danger/[0.06] px-3 py-2">
          <p className="text-xs text-danger">{error}</p>
        </Card>
      )}

      <div className="mb-3">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'lookup', label: 'Look up a serial', icon: 'search' },
            { value: 'units', label: `Units (${unitCount.toLocaleString('en-IN')})`, icon: 'box' },
            { value: 'settings', label: 'Fields & settings', icon: 'settings' },
          ]}
        />
      </div>

      {tab === 'lookup' && <LookupTab initialSearch={initialSearch} initialRows={initialLookup} onOpen={setOpenId} />}

      {tab === 'units' && (
        <UnitsTab
          units={units} paging={unitPaging} unitCount={unitCount} pools={pools} pool={pool}
          rangeLabel={rangeLabel} canExport={canExport} views={views}
          waitingTotal={Object.values(waiting).reduce((a, b) => a + b, 0)}
          canEdit={canEdit} onOpen={setOpenId}
          onFill={() => setDialog('fill')} onOpening={() => setDialog('opening')}
        />
      )}


      {tab === 'settings' && (
        <SettingsTab
          fields={fields} categories={categories} warrantyBasis={warrantyBasis} canConfigure={canConfigure}
          onEdit={(f) => setDialog({ field: f })}
          onToggle={async (f) => done(await setStockFieldActiveAction(f.fieldKey, !f.isActive))}
          onBasis={async (b) => done(await setWarrantyBasisAction(b))}
        />
      )}

      {openId && (
        <WithFormOptions need={['parties']} onClose={() => setOpenId(null)}>
          {(o) => (
            <UnitDetail
              unitId={openId} parties={o.parties as PartyOption[]} fields={fields} canEdit={canEdit}
              onClose={() => setOpenId(null)} onChanged={done}
            />
          )}
        </WithFormOptions>
      )}
      {dialog === 'fill' && (
        <FillSerialsDialog products={serialProducts} waiting={waiting}
          onClose={() => setDialog(null)} onDone={(r) => { setDialog(null); done(r); }} />
      )}
      {dialog === 'opening' && (
        <OpeningStockDialog onClose={() => setDialog(null)} onDone={(r) => { setDialog(null); done(r); }} />
      )}
      {dialog && typeof dialog === 'object' && (
        <StockFieldDialog existing={dialog.field} categories={categories}
          onClose={() => setDialog(null)} onDone={(r) => { setDialog(null); done(r); }} />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- lookup */

/**
 * One box. The cursor lives in it; a scanner types the serial and presses
 * Enter, and the answer appears. A single exact hit opens straight away,
 * because the person holding the camera wants the answer, not a list of one.
 */
function LookupTab({
  initialSearch, initialRows, onOpen,
}: { initialSearch: string; initialRows: UnitRow[]; onOpen: (id: string) => void }) {
  const [q, setQ] = useState(initialSearch);
  const [rows, setRows] = useState<UnitRow[]>(initialRows);
  const [searched, setSearched] = useState(initialSearch !== '');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  async function go(scanned?: string) {
    const needle = scanned ?? q;
    if (needle.trim().length < 3) return;
    setBusy(true);
    const res = await lookupUnitsAction(needle);
    setBusy(false);
    setSearched(true);
    setRows(res.rows);
    if (res.rows.length === 1) onOpen(res.rows[0].id);
    box.current?.select();
  }

  return (
    <SectionCard title="Scan or type a serial" icon="search">
      <div className="flex gap-2">
        <input
          ref={box} autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void go(); }}
          placeholder="Serial or barcode - at least 3 characters"
          className="h-11 w-full rounded border border-border bg-card px-3 font-mono text-base outline-none focus:border-brand"
        />
        <ScanButton className="h-11 w-11" title="Scan a serial" onScan={(code) => { setQ(code); void go(code); }} />
        <Button variant="primary" icon="search" onClick={() => go()} loading={busy}>Find</Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Exact match first, ignoring case; otherwise anything containing what you typed - so the last few
        digits off a worn label still find it.
      </p>

      {searched && (
        rows.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No unit with that serial. If it was sold before units were tracked, it may only exist on an old challan.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded border border-border">
            {rows.map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => onOpen(u.id)}
                  className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-start text-sm hover:bg-brand/5">
                  <span className="font-mono font-medium">{u.serialNo ?? 'Serial to follow'}</span>
                  <span className="text-muted-foreground">{u.productName}</span>
                  <span className="ms-auto flex items-center gap-2">
                    <Badge tone={UNIT_STATUS_TONE[u.status as UnitStatus] ?? 'neutral'}>{UNIT_STATUS_LABEL[u.status as UnitStatus] ?? u.status}</Badge>
                    {u.holderName && <span className="text-xs">{u.holderName}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </SectionCard>
  );
}

/* ----------------------------------------------------------------- pools */

function UnitsTab({
  units, paging, unitCount, pools, pool, waitingTotal, canEdit, onOpen, onFill, onOpening, rangeLabel, canExport, views,
}: {
  rangeLabel: string;
  canExport: boolean;
  views: FilterBarViews;
  units: UnitRow[];
  paging: ServerPaging;
  unitCount: number;
  pools: Record<UnitPool, number>;
  pool: UnitPool | null;
  waitingTotal: number;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onFill: () => void;
  onOpening: () => void;
}) {
  const list = useListParams();
  const setPool = (k: UnitPool | null) => list.set({ pool: k ?? 'all' });

  const cards: KpiCard[] = UNIT_POOLS.map((p) => ({
    key: p,
    label: UNIT_POOL_LABEL[p],
    count: pools[p],
    icon: POOL_ICON[p],
    tone: p === 'dead_stock' && pools[p] > 0 ? 'warning' : p === 'awaiting_serial' && pools[p] > 0 ? 'info' : 'default',
    subLabel: p === 'dead_stock' ? `on the shelf ${DEAD_STOCK_DAYS}+ days` : undefined,
  }));

  const columns: Column<UnitRow>[] = [
    {
      key: 'serial', header: 'Serial', sortValue: (u) => u.serialNo ?? '',
      render: (u) => (
        <button type="button" className="font-mono text-xs font-medium hover:text-brand" onClick={() => onOpen(u.id)}>
          {u.serialNo ?? <span className="italic text-muted-foreground">to follow</span>}
        </button>
      ),
    },
    { key: 'product', header: 'Product', sortValue: (u) => u.productName, render: (u) => <ProductLink id={u.productId} className="text-xs">{u.productName}</ProductLink> },
    {
      key: 'status', header: 'Where', sortValue: (u) => u.status,
      render: (u) => <Badge tone={UNIT_STATUS_TONE[u.status as UnitStatus] ?? 'neutral'}>{UNIT_STATUS_LABEL[u.status as UnitStatus] ?? u.status}</Badge>,
    },
    { key: 'holder', header: 'Held by', sortValue: (u) => u.holderName ?? '', render: (u) => <CustomerLink id={u.holderId} className="text-xs">{u.holderName ?? ''}</CustomerLink> },
    {
      key: 'condition', header: 'Condition', sortValue: (u) => u.condition, optional: true,
      render: (u) => <span className="text-xs">{UNIT_CONDITION_LABEL[u.condition as UnitCondition] ?? u.condition}</span>,
    },
    { key: 'arrived', header: 'Arrived', sortValue: (u) => new Date(u.receivedAt).getTime(), render: (u) => <span className="text-xs">{fmt(u.receivedAt)}</span> },
    { key: 'grn', header: 'Receipt', sortValue: (u) => u.grnNo ?? '', optional: true, render: (u) => <span className="font-mono text-xs">{u.grnNo ?? (u.legacyRef ? `was ${u.legacyRef}` : 'opening')}</span> },
    { key: 'supplier', header: 'Supplier', sortValue: (u) => u.supplierName ?? '', optional: true, render: (u) => <span className="text-xs">{u.supplierName ?? ''}</span> },
  ];

  return (
    <>
      <FilterBar
        searchParam="uq"
        searchPlaceholder="Serial, product, customer, receipt, supplier, old number…"
        dates={{ defaultPreset: 'all', label: 'Arrived', activeLabel: rangeLabel }}
        shown={paging.total}
        clearKeys={['pool']}
        exportScreen={canExport ? 'units' : null}
        views={views}
        tools={canEdit ? (
          <>
            <Button variant="outline" icon="pencil" onClick={onFill} disabled={waitingTotal === 0}>
              Record serials to follow{waitingTotal ? ` (${waitingTotal})` : ''}
            </Button>
            <Button variant="outline" icon="upload" onClick={onOpening}>Import opening stock</Button>
          </>
        ) : undefined}
      />
      <div className="mb-3">
        <KpiStrip cards={cards} activeKey={pool} onSelect={(k) => setPool(k as UnitPool | null)} columns={6} />
      </div>
      <DataGrid
        rows={units}
        server={paging}
        columns={columns}
        rowKey={(u) => u.id}
        mobileCard={(u) => (
          <button type="button" onClick={() => onOpen(u.id)} className="block w-full text-start">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold">{u.serialNo ?? 'serial to follow'}</span>
              <Badge tone={UNIT_STATUS_TONE[u.status as UnitStatus] ?? 'neutral'}>{UNIT_STATUS_LABEL[u.status as UnitStatus] ?? u.status}</Badge>
            </div>
            <p className="mt-1 truncate text-sm font-medium">{u.productName}</p>
            <p className="text-xs text-muted-foreground">Arrived {fmt(u.receivedAt)}{u.holderName ? ` · ${u.holderName}` : ''}</p>
          </button>
        )}
        emptyIcon="box"
        emptyMessage={unitCount === 0 ? 'No units tracked yet' : 'No units in this view'}
        emptyHint={unitCount === 0
          ? 'Units appear when a serialised product is received, or when opening stock is imported. Set which products are tracked by serial under "Tracking by product".'
          : undefined}
      />
    </>
  );
}

/* ------------------------------------------------------------------ gaps */

/**
 * Stock vs units, with a way to cut it down (3 Oct 2026).
 *
 * This tab had no filters at all - not a search box, not a category, nothing -
 * and on real data it opens with 93 rows. A list that long with no way to narrow
 * it is a list nobody works through, which rather defeats a screen whose whole
 * job is to get worked through.
 *
 * Filtered in the browser rather than through the URL and the server: the gaps
 * are already loaded in full (one row per diverging product, and a catalogue of
 * 1,339 cannot produce many), so a round trip per keystroke would be slower and
 * buy nothing.
 *
 * The category options are built FROM THE ROWS, not from the full category list.
 * Offering a category with nothing in it means somebody picks it, sees an empty
 * table, and concludes the screen is broken.
 */
function SettingsTab({
  fields, categories, warrantyBasis, canConfigure, onEdit, onToggle, onBasis,
}: {
  fields: StockFieldDef[];
  categories: { id: string; name: string }[];
  warrantyBasis: string;
  canConfigure: boolean;
  onEdit: (f: StockFieldDef | null) => void;
  onToggle: (f: StockFieldDef) => void;
  onBasis: (b: string) => void;
}) {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <SectionCard
        title="Unit fields"
        icon="sliders"
        bodyClassName="p-0"
        action={canConfigure ? <Button size="sm" variant="outline" icon="plus" onClick={() => onEdit(null)}>Add field</Button> : undefined}
      >
        {fields.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No extra fields yet. Add what your trade records on each unit - a MAC address, a lens size, engine hours.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {fields.map((f) => (
              <li key={f.fieldKey} className={`flex items-center gap-2 px-4 py-2 text-sm ${f.isActive ? '' : 'opacity-50'}`}>
                <span className="font-medium">{f.label}</span>
                <span className="text-xs text-muted-foreground">
                  {STOCK_FIELD_TYPE_LABEL[f.fieldType as StockFieldType] ?? f.fieldType}
                  {f.required ? ' · required' : ''}
                  {' · '}{f.categoryId ? `only ${catName.get(f.categoryId) ?? 'one category'}` : 'all serialised products'}
                </span>
                {canConfigure && (
                  <span className="ms-auto flex gap-1">
                    <Button size="sm" variant="ghost" icon="pencil" onClick={() => onEdit(f)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => onToggle(f)}>{f.isActive ? 'Switch off' : 'Switch on'}</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Customer warranty starts on" icon="calendar">
        {(['invoice', 'install'] as const).map((b) => (
          <label key={b} className="mb-2 flex items-start gap-2 text-sm">
            <input type="radio" name="basis" disabled={!canConfigure} checked={warrantyBasis === b} onChange={() => onBasis(b)} className="mt-1" />
            <span>
              {b === 'invoice' ? 'The invoice date' : 'The installation date'}
              <span className="block text-xs text-muted-foreground">
                {b === 'invoice'
                  ? 'The date on a document the customer holds. The default.'
                  : 'Fairer when installation follows the sale by weeks - counted from the invoice, those weeks of cover are lost.'}
              </span>
            </span>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">If the chosen date is missing for a unit, the other one is used.</p>
      </SectionCard>
    </div>
  );
}
