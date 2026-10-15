'use client';

import { SupplierLink } from '@/components/document/SupplierLink';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { PageHeader } from '@/components/ui/Layout';
import { Toolbar, ToolbarIcon } from '@/components/ui/Toolbar';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import type { SupplierAccountCards, SupplierAccountRow } from '@/server/supplier-accounts';

export function SupplierAccountClient({
  rows, cards,
}: {
  rows: SupplierAccountRow[];
  cards: SupplierAccountCards;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const kpis: KpiCard[] = [
    { key: 'total', label: 'Total Accounts', count: cards.totalAccounts, icon: 'users' },
    {
      key: 'opening', label: 'Opening Balance', count: formatCurrencyCompact(cards.openingBalancePaise),
      icon: 'file-text', subLabel: 'not tracked per supplier',
    },
    { key: 'payable', label: 'Amount Payable', count: formatCurrencyCompact(cards.amountPayablePaise), icon: 'credit-card', tone: 'warning' },
    { key: 'paid', label: 'Total Paid', count: formatCurrencyCompact(cards.totalPaidPaise), icon: 'check-circle', tone: 'success' },
  ];

  const visible = useMemo(() => {
    if (filter === 'payable') return rows.filter((r) => r.payablePaise > 0);
    return rows;
  }, [rows, filter]);

  const columns: Column<SupplierAccountRow>[] = [
    {
      key: 'displayName', header: 'Supplier',
      render: (r) => (
        <Link href={`/suppliers`} className="block hover:text-brand">
          <p className="font-medium"><SupplierLink id={r.id}>{r.displayName}</SupplierLink></p>
          {r.companyName && <p className="text-xs text-muted-foreground">{r.companyName}</p>}
        </Link>
      ),
      sortValue: (r) => r.displayName,
    },
    { key: 'partyCode', header: 'Code', width: '8rem',
      render: (r) => <SupplierLink id={r.id} className="font-mono text-xs text-brand">{r.partyCode}</SupplierLink>,
      sortValue: (r) => r.partyCode },
    { key: 'phone', header: 'Phone', render: (r) => <span className="font-mono text-xs">{r.phone}</span>, sortValue: (r) => r.phone },
    {
      key: 'payable', header: 'Amount Payable', align: 'end',
      render: (r) => (
        <span className={`font-mono text-xs ${r.payablePaise > 0 ? 'text-warning' : 'text-muted-foreground'}`}>
          {formatCurrency(r.payablePaise)}
        </span>
      ),
      sortValue: (r) => r.payablePaise,
    },
    {
      key: 'paid', header: 'Total Paid', align: 'end',
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{formatCurrency(r.totalPaidPaise)}</span>,
      sortValue: (r) => r.totalPaidPaise,
      optional: true,
    },
  ];

  return (
    <div>
      <PageHeader
        badge="SA"
        title="Supplier Account"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{rows.length} accounts</span>
            <span className="text-border-strong">·</span>
            <span className={cards.amountPayablePaise > 0 ? 'font-medium text-warning' : ''}>
              {formatCurrencyCompact(cards.amountPayablePaise)} payable
            </span>
          </span>
        }
      />

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Name, code, phone…"
        count={`Total (${visible.length})`}
        end={
          <>
            <ToolbarIcon icon="refresh" label="Refresh" onClick={() => window.location.reload()} />
            <ToolbarIcon
              icon="x-circle" label="Clear filters"
              active={filter !== null || search !== ''}
              onClick={() => { setFilter(null); setSearch(''); }}
            />
          </>
        }
      />

      <KpiStrip cards={kpis} activeKey={filter} onSelect={setFilter} columns={4} />

      <DataGrid
        exportAs={{ title: 'Supplier accounts' }}
        rows={visible}
        columns={columns}
        rowKey={(r) => r.id}
        search={search}
        emptyIcon="credit-card"
        emptyMessage={filter ? 'No supplier accounts match this card.' : 'No supplier accounts found.'}
        emptyHint="Accounts appear here once a supplier has a purchase bill or a payment."
        pageSizes={[10, 20, 50, 75, 100]}
        pageSummary={(pageRows) => (
          <>
            <span className="text-muted-foreground">
              Count: <strong className="text-foreground">{pageRows.length}</strong>
            </span>
            <span className="text-muted-foreground">
              Page Payable:{' '}
              <strong className="font-mono text-warning">
                {formatCurrency(pageRows.reduce((n, r) => n + Math.max(0, r.payablePaise), 0))}
              </strong>
            </span>
          </>
        )}
        actions={[
          {
            label: 'View supplier', icon: 'building', iconTone: 'brand',
            onSelect: () => { window.location.href = '/suppliers'; },
          },
        ]}
      />
    </div>
  );
}
