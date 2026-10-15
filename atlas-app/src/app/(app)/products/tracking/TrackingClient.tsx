'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge, Card } from '@/components/ui/Layout';
import { Toolbar } from '@/components/ui/Toolbar';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  TRACKING_MODES, TRACKING_MODE_HINT, TRACKING_MODE_LABEL, type TrackingMode,
} from '@/lib/stock-tracking';
import type { TrackingRow } from '@/server/stock-tracking';
import { applyTrackingAction } from './actions';

type Filter = 'service' | TrackingMode;

const MODE_TONE: Record<TrackingMode, 'neutral' | 'info' | 'brand' | 'success'> = {
  none: 'neutral', quantity: 'info', batch: 'brand', serial: 'success',
};

/**
 * How closely each product is tracked, set in bulk.
 *
 * A client arriving with 1,325 products will not set them one at a time, so
 * the unit of work here is a filtered selection: filter to what you mean
 * ("services", "cameras"), tick, apply. Refusals come back by product name -
 * a product with stock on hand cannot stop being tracked - so a partial
 * success says exactly which rows need attention.
 */
export function TrackingClient({
  rows, canEdit, initialSearch, initialFilter,
}: {
  rows: TrackingRow[];
  canEdit: boolean;
  initialSearch: string;
  initialFilter: string | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<Filter | null>(
    initialFilter === 'service' || TRACKING_MODES.includes(initialFilter as TrackingMode) ? (initialFilter as Filter) : null,
  );
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ tone: 'ok' | 'bad'; lines: string[] } | null>(null);

  const categories = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.categoryId && r.categoryName) m.set(r.categoryId, r.categoryName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const shown = rows.filter((r) =>
    (!filter || (filter === 'service' ? r.kind === 'service' : r.trackingMode === filter))
    && (!category || r.categoryId === category));

  const count = (f: Filter) => rows.filter((r) => (f === 'service' ? r.kind === 'service' : r.trackingMode === f)).length;
  const cards: KpiCard[] = [
    { key: 'serial', label: TRACKING_MODE_LABEL.serial, count: count('serial'), icon: 'tag', tone: 'success' },
    { key: 'batch', label: TRACKING_MODE_LABEL.batch, count: count('batch'), icon: 'package' },
    { key: 'quantity', label: TRACKING_MODE_LABEL.quantity, count: count('quantity'), icon: 'box', tone: 'info' },
    { key: 'none', label: TRACKING_MODE_LABEL.none, count: count('none'), icon: 'ban' },
    { key: 'service', label: 'Services (SAC)', count: count('service'), icon: 'users', subLabel: 'labour and charges' },
  ];

  async function apply(ids: string[], change: { type: 'mode' | 'kind'; to: string }, clear: () => void) {
    setBusy(true);
    setReport(null);
    const res = await applyTrackingAction(ids, change);
    setBusy(false);
    if (res.error || !res.result) { setReport({ tone: 'bad', lines: [res.error ?? 'Failed.'] }); return; }
    const r = res.result;
    setReport({
      tone: r.refused.length ? 'bad' : 'ok',
      lines: [
        `${r.changed} changed${r.unchanged ? `, ${r.unchanged} already set` : ''}${r.refused.length ? `, ${r.refused.length} refused` : ''}.`,
        ...r.refused.slice(0, 20).map((x) => x.reason),
        ...r.warnings.slice(0, 10),
      ],
    });
    clear();
    router.refresh();
  }

  const columns: Column<TrackingRow>[] = [
    { key: 'code', header: 'Code', sortValue: (r) => r.productCode, render: (r) => <span className="font-mono text-xs">{r.productCode}</span> },
    { key: 'name', header: 'Product', sortValue: (r) => r.productName, render: (r) => <span className={r.isActive ? '' : 'text-muted-foreground line-through'}>{r.productName}</span> },
    { key: 'category', header: 'Category', sortValue: (r) => r.categoryName ?? '', render: (r) => <span className="text-xs">{r.categoryName ?? ''}</span> },
    {
      key: 'kind', header: 'Is', sortValue: (r) => r.kind,
      render: (r) => <span className="text-xs">{r.kind === 'service' ? `Service${r.sacCode ? ` · SAC ${r.sacCode}` : ''}` : `Goods${r.hsnCode ? ` · HSN ${r.hsnCode}` : ''}`}</span>,
    },
    {
      key: 'mode', header: 'Tracked', sortValue: (r) => r.trackingMode,
      render: (r) => <Badge tone={MODE_TONE[r.trackingMode as TrackingMode] ?? 'neutral'}>{TRACKING_MODE_LABEL[r.trackingMode as TrackingMode] ?? r.trackingMode}</Badge>,
    },
    { key: 'onhand', header: 'On hand', align: 'end', sortValue: (r) => r.onHand, render: (r) => <span className="tabular-nums">{r.onHand}</span> },
    {
      key: 'units', header: 'Units', align: 'end', sortValue: (r) => r.unitsOnShelf, optional: true,
      render: (r) => (r.trackingMode === 'serial'
        ? <span className={`tabular-nums ${r.unitsOnShelf !== r.onHand ? 'text-warning' : ''}`}>{r.unitsOnShelf}</span>
        : null),
    },
  ];

  return (
    <>
      <PageHeader
        badge="sliders"
        title="Stock tracking by product"
        subtitle="How closely each product is counted - set per product, in bulk"
        actions={<Link href="/stock-units"><Button variant="outline" icon="box">Serial & batch stock</Button></Link>}
      />

      <Card className="mb-3 px-3 py-2.5">
        <ul className="grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
          {TRACKING_MODES.map((m) => (
            <li key={m}><strong>{TRACKING_MODE_LABEL[m]}</strong> - <span className="text-muted-foreground">{TRACKING_MODE_HINT[m]}</span></li>
          ))}
        </ul>
      </Card>

      {report && (
        <Card className={`mb-3 px-3 py-2 ${report.tone === 'ok' ? 'border-success/30 bg-success/[0.06]' : 'border-warning/40 bg-warning/10'}`}>
          {report.lines.map((l, i) => (
            <p key={i} className={`flex items-start gap-2 text-xs ${i === 0 ? 'font-medium' : ''}`}>
              {i === 0 && <Icon name={report.tone === 'ok' ? 'check-circle' : 'alert-triangle'} className="mt-0.5 h-4 w-4 shrink-0" />}
              {l}
            </p>
          ))}
        </Card>
      )}

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search code or name…"
        filters={
          <select
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
            value={category} onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        }
      />
      <div className="mb-3">
        <KpiStrip cards={cards} activeKey={filter} onSelect={(k) => setFilter(k as Filter | null)} columns={5} />
      </div>

      <DataGrid
        exportAs={{ title: 'Product tracking' }}
        rows={shown}
        columns={columns}
        rowKey={(r) => r.id}
        search={search}
        emptyIcon="package"
        emptyMessage="No products match"
        bulkActions={canEdit ? (ids, clear) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="me-1 text-xs text-muted-foreground">Track {ids.length} by:</span>
            {(['serial', 'batch', 'quantity', 'none'] as const).map((m) => (
              <Button key={m} size="sm" variant="outline" disabled={busy} onClick={() => apply(ids, { type: 'mode', to: m }, clear)}>
                {TRACKING_MODE_LABEL[m]}
              </Button>
            ))}
            <span className="mx-1 text-xs text-muted-foreground">or mark as</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => apply(ids, { type: 'kind', to: 'goods' }, clear)}>Goods</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => apply(ids, { type: 'kind', to: 'service' }, clear)}>Service</Button>
          </div>
        ) : undefined}
      />
    </>
  );
}
