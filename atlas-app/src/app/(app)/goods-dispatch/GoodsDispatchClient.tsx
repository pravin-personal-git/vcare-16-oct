'use client';
import { CustomerLink } from '@/components/document/CustomerLink';
import type { ReactNode } from 'react';

import { useState } from 'react';
import { PageHeader, StatusBadge } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { useListParams } from '@/components/ui/useListParams';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import type { FulfilmentStatus } from '@/lib/sales-order-status';
import { GdnDocument } from './GdnDocument';

interface RowVM {
  id: string;
  orderNo: string;
  partyId: string | null;
  customerName: string;
  organizationName: string | null;
  orderDate: string;
  expectedDeliveryDate: string | null;
  fulfilmentStatus: FulfilmentStatus;
  /** The business's own stage name (G3). */
  stageLabel: string;
  courierName: string | null;
  awbNo: string | null;
  deliveryMode: string | null;
  grandTotalPaise: number;
}

const rupees = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' });


export function GoodsDispatchClient({
  rows, paging, counts, card, rangeLabel, olderInTransit, totalAll, canExport, views, banner,
}: {
  /** One page, filtered on the server (server/gdn-list). */
  rows: RowVM[];
  paging: ServerPaging;
  counts: Record<string, number>;
  card: string | null;
  rangeLabel: string;
  olderInTransit: number;
  totalAll: number;
  canExport: boolean;
  views: FilterBarViews;
  /**
   * Shown between the heading and the search box. Passed in rather than
   * imported so it stays a server component - and so this register does not
   * need to know what is being signposted.
   */
  banner?: ReactNode;
}) {
  const list = useListParams();
  const [opening, setOpening] = useState<string | null>(null);

  const cards: KpiCard[] = [
    { key: 'in_transit', label: 'In transit', count: counts.in_transit ?? 0, subLabel: 'dispatched or shipped', icon: 'truck', tone: 'warning' },
    { key: 'delivered', label: 'Delivered', count: counts.delivered ?? 0, subLabel: 'reached the customer', icon: 'check-circle', tone: 'success' },
    { key: 'returned', label: 'Returned / damaged', count: counts.returned ?? 0, subLabel: 'came back or lost', icon: 'alert-triangle', tone: (counts.returned ?? 0) > 0 ? 'danger' : 'default' },
  ];

  const columns: Column<RowVM>[] = [
    {
      key: 'orderNo', header: 'Order', sortValue: (r) => r.orderNo,
      render: (r) => (
        <button type="button" className="font-medium text-brand hover:underline" onClick={() => setOpening(r.id)}>
          {r.orderNo}
        </button>
      ),
    },
    {
      key: 'customer', header: 'Customer', sortValue: (r) => r.customerName,
      render: (r) => <CustomerLink id={r.partyId} className="font-medium">{r.organizationName ?? r.customerName}</CustomerLink>,
    },
    {
      key: 'date', header: 'Order date', sortValue: (r) => new Date(r.orderDate).getTime(),
      render: (r) => <span className="text-xs">{fmtDate(r.orderDate)}</span>,
    },
    {
      key: 'courier', header: 'Courier', sortValue: (r) => r.courierName ?? '',
      render: (r) => <span className="text-xs">{r.courierName ?? '-'}</span>,
    },
    {
      key: 'awb', header: 'AWB', sortValue: (r) => r.awbNo ?? '',
      render: (r) => <span className="font-mono text-xs">{r.awbNo ?? '-'}</span>,
    },
    {
      key: 'total', header: 'Value', align: 'end', sortValue: (r) => r.grandTotalPaise,
      render: (r) => <span className="tabular-nums">{rupees(r.grandTotalPaise)}</span>,
    },
    {
      key: 'status', header: 'Status', sortValue: (r) => r.fulfilmentStatus,
      render: (r) => (
        <StatusBadge status={r.fulfilmentStatus} label={r.stageLabel} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        badge="GD"
        title="Goods Dispatch Note"
        subtitle="What physically left, against which order - a register, not a second place to move stock"
      />

      {/* Above the search, not under the table. Once this register holds a few
          hundred rows, anything below the paging is never seen. */}
      {banner}

      <FilterBar
        searchPlaceholder="Order no, customer, company, courier, AWB…"
        dates={{ defaultPreset: 'all', label: 'Ordered', activeLabel: rangeLabel }}
        shown={paging.total}
        clearKeys={['card']}
        exportScreen={canExport ? 'gdn' : null}
        views={views}
      />

      {olderInTransit > 0 && (
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <Icon name="alert-triangle" className="h-4 w-4 shrink-0 text-warning" />
          <span><strong>{olderInTransit.toLocaleString('en-IN')}</strong> dispatch{olderInTransit === 1 ? ' still in transit is' : 'es still in transit are'} dated before this range.</span>
          <button type="button" onClick={() => list.set({ range: 'all', card: 'in_transit' })} className="font-medium text-brand hover:underline">Show them</button>
        </p>
      )}

      <KpiStrip cards={cards} activeKey={card} onSelect={(k) => list.set({ card: k })} columns={4} />

      <DataGrid
        rows={rows}
        server={paging}
        columns={columns}
        rowKey={(r) => r.id}
        emptyIcon="truck"
        emptyMessage={totalAll === 0 ? 'Nothing dispatched yet' : 'No dispatches match'}
        emptyHint={totalAll === 0 ? 'A Goods Dispatch Note appears here the moment a sales order is marked Dispatched.' : 'Try another card, a wider date range, or Clear all filters.'}
        actions={[{ label: 'Open dispatch note', icon: 'file-text', onSelect: (r) => setOpening(r.id) }]}
        mobileCard={(r) => (
          <button type="button" onClick={() => setOpening(r.id)} className="block w-full text-start">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-brand">{r.orderNo}</span>
              <StatusBadge status={r.fulfilmentStatus} label={r.stageLabel} />
            </div>
            <p className="mt-1 truncate text-sm font-medium">{r.organizationName ?? r.customerName}</p>
            <p className="text-xs text-muted-foreground">{fmtDate(r.orderDate)}{r.courierName ? ` · ${r.courierName}` : ''}{r.awbNo ? ` · AWB ${r.awbNo}` : ''}</p>
          </button>
        )}
      />

      {opening && <GdnDocument id={opening} onClose={() => setOpening(null)} />}
    </>
  );
}
