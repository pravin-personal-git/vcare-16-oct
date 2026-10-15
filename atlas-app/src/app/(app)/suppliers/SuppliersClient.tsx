'use client';

import { SupplierLink } from '@/components/document/SupplierLink';
import Link from 'next/link';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { useListParams } from '@/components/ui/useListParams';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import { netPositionPaise, type PartyRow } from '@/lib/party-metrics';

/**
 * Suppliers is the same party data filtered to isSupplier. A firm that is both
 * appears on this screen and on Customers, with one set of contact details.
 * ADR-0003.
 */
export function SuppliersClient({
  rows, paging, counts, card, canExport, views,
}: {
  /** One page, filtered on the server (server/suppliers-list). */
  rows: PartyRow[];
  paging: ServerPaging;
  counts: { all: number; both: number; product: number; service: number; payablePaise: number };
  card: string | null;
  canExport: boolean;
  views: FilterBarViews;
}) {
  const list = useListParams();
  const totalPayable = counts.payablePaise;

  const cards: KpiCard[] = [
    { key: 'all', label: 'Total Suppliers', count: counts.all, icon: 'truck' },
    { key: 'payable', label: 'Amount Payable', count: formatCurrencyCompact(totalPayable), icon: 'credit-card', tone: 'warning' },
    { key: 'both', label: 'Also Customers', count: counts.both, icon: 'users', subLabel: 'buy and sell', tone: 'success' },
    { key: 'product', label: 'Product Suppliers', count: counts.product, icon: 'package' },
    { key: 'service', label: 'Service Suppliers', count: counts.service, icon: 'sliders' },
  ];

  const columns: Column<PartyRow>[] = [
    { key: 'displayName', header: 'Supplier',
      render: (r) => (
        <div>
          <p className="font-medium"><SupplierLink id={r.id}>{r.companyName ?? r.displayName}</SupplierLink></p>
          {r.companyName && <p className="text-xs text-muted-foreground">{r.displayName}</p>}
        </div>
      ),
      sortValue: (r) => r.companyName ?? r.displayName },
    { key: 'partyCode', header: 'Code', width: '7rem',
      render: (r) => <SupplierLink id={r.id} className="font-mono text-xs font-medium text-brand">{r.partyCode}</SupplierLink>,
      sortValue: (r) => r.partyCode },
    { key: 'roles', header: 'Roles',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone="info" icon="truck">Supplier</Badge>
          {r.isCustomer && <Badge tone="success" icon="users">Customer</Badge>}
        </div>
      ) },
    { key: 'supplierType', header: 'Type', render: (r) => r.supplierType ?? '-', sortValue: (r) => r.supplierType },
    { key: 'phone', header: 'Phone',
      render: (r) => <span className="font-mono text-xs">{r.phone}</span>, sortValue: (r) => r.phone },
    { key: 'city', header: 'City', render: (r) => r.city ?? '-', sortValue: (r) => r.city },
    { key: 'payable', header: 'We owe', align: 'end',
      render: (r) => (
        <span className={`font-mono text-xs ${r.payablePaise > 0 ? 'text-warning' : 'text-muted-foreground'}`}>
          {formatCurrency(r.payablePaise)}
        </span>
      ),
      sortValue: (r) => r.payablePaise },
    { key: 'receivable', header: 'They owe', align: 'end',
      render: (r) => (
        <span className="font-mono text-xs text-muted-foreground">
          {r.isCustomer ? formatCurrency(r.currentBalancePaise) : '-'}
        </span>
      ),
      sortValue: (r) => r.currentBalancePaise },
    { key: 'net', header: 'Net', align: 'end',
      render: (r) => {
        if (!r.isCustomer) return <span className="text-xs text-muted-foreground">-</span>;
        const net = netPositionPaise(r);
        return (
          <span className={`font-mono text-xs font-semibold ${
            net > 0 ? 'text-success' : net < 0 ? 'text-danger' : ''
          }`}>
            {formatCurrency(Math.abs(net))} {net > 0 ? 'in' : net < 0 ? 'out' : ''}
          </span>
        );
      },
      sortValue: (r) => netPositionPaise(r) },
    { key: 'gstin', header: 'GSTIN',
      render: (r) => <span className="font-mono text-xs">{r.gstin ?? '-'}</span>,
      sortValue: (r) => r.gstin, optional: true },
  ];

  return (
    <div>
      <PageHeader
        badge="SU"
        title="Suppliers"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{counts.all} in this scope</span>
            <span className="text-border-strong">·</span>
            <span>{counts.both} also buy from you</span>
            <span className="text-border-strong">·</span>
            <span className={totalPayable > 0 ? 'font-medium text-warning' : ''}>
              {formatCurrencyCompact(totalPayable)} payable
            </span>
          </span>
        }
        actions={
          <Link
            href="/customers"
            className="inline-flex h-9 items-center gap-2 rounded bg-brand px-3 text-sm font-medium text-brand-fg shadow-card transition hover:bg-brand-hover"
          >
            <Icon name="plus" className="h-4 w-4" />
            Add Party
          </Link>
        }
      />

      <FilterBar
        searchPlaceholder="Name, company, code, phone, city, GSTIN…"
        shown={paging.total}
        clearKeys={['card']}
        exportScreen={canExport ? 'suppliers' : null}
        views={views}
      />

      <KpiStrip cards={cards} activeKey={card} onSelect={(k) => list.set({ card: k && k !== 'all' ? k : null })} columns={5} />

      <DataGrid
        rows={rows} server={paging} columns={columns} rowKey={(r) => r.id}
        mobileCard={(r) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold">{r.companyName ?? r.displayName}</span>
              <span className={`font-mono text-xs tabular-nums ${r.payablePaise > 0 ? 'font-semibold text-warning' : 'text-muted-foreground'}`}>{formatCurrency(r.payablePaise)}</span>
            </div>
            <p className="text-xs text-muted-foreground">{r.partyCode} · {r.phone}{r.city ? ` · ${r.city}` : ''}{r.isCustomer ? ' · also a customer' : ''}</p>
          </div>
        )}
        emptyIcon="truck"
        emptyMessage={counts.all === 0 ? 'No suppliers yet.' : 'No suppliers match'}
        emptyHint="Add a party from Customers and tick “Also a supplier” - one record serves both sides."
        /* Inherits the shared sizes - this list holds every supplier now. */
        actions={[
          {
            label: 'Ledger',
            icon: 'receipt',
            onSelect: () => { window.location.href = '/supplier/account'; },
          },
        ]}
      />

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground shadow-card">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <span>
          Suppliers and Customers are the same records with role flags - one
          firm, one address, one GSTIN. Tick &ldquo;Also a supplier&rdquo; on the
          customer form to add a party here. The Net column only means something
          for a firm in both roles. Purchase orders live under Purchase, and the
          supplier ledger is the Ledger action above.
        </span>
      </p>
    </div>
  );
}
