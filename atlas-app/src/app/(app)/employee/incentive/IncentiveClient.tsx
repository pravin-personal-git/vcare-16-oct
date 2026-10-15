'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { DateRangeSelect, useUrlDateRange } from '@/components/ui/DateRangeSelect';
import { inRange } from '@/lib/date-ranges';
import { useListParams } from '@/components/ui/useListParams';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Toolbar, ToolbarIcon } from '@/components/ui/Toolbar';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import type { IncentiveCards } from '@/server/incentives';
import { payIncentiveAction, reverseIncentiveAction } from './actions';

export interface IncentiveRowVM {
  quotationId: string;
  quotationNo: string;
  customerName: string;
  salespersonId: string;
  salespersonName: string;
  quotationDate: string;
  status: string;
  incentivePaise: number;
  paid: boolean;
  paidTxnId: string | null;
  paidAt: string | null;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function IncentiveClient({
  rows, cards, canPay,
}: {
  rows: IncentiveRowVM[];
  cards: IncentiveCards;
  canPay: boolean;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [paying, setPaying] = useState<IncentiveRowVM | null>(null);
  const [reversing, setReversing] = useState<IncentiveRowVM | null>(null);

  const kpis: KpiCard[] = [
    { key: 'total', label: 'Total Incentives', count: cards.totalIncentives, icon: 'trending-up' },
    { key: 'amount', label: 'Total Amount', count: formatCurrencyCompact(cards.totalAmountPaise), icon: 'credit-card', tone: 'brand' },
    { key: 'pending', label: 'Pending', count: formatCurrencyCompact(cards.pendingPaise), icon: 'clock', tone: 'warning' },
    { key: 'paid', label: 'Paid', count: formatCurrencyCompact(cards.paidPaise), icon: 'check-circle', tone: 'success' },
  ];

  // The date filter (9 Oct 2026): ?range= &from= &to=, default all time.
  // Everything below - tiles, chips, the grid - works on these rows.
  const range = useUrlDateRange();
  const list = useListParams();
  const rangeOn = range.from !== null || range.to !== null;
  const dated = useMemo(() => rows.filter((r) => inRange(r.quotationDate, range)), [rows, range]);

  const visible = useMemo(() => {
    if (filter === 'pending') return dated.filter((r) => !r.paid);
    if (filter === 'paid') return dated.filter((r) => r.paid);
    return dated;
  }, [dated, filter]);

  const columns: Column<IncentiveRowVM>[] = [
    { key: 'quotationNo', header: 'Quotation', width: '10rem',
      render: (r) => <Link href={`/quotation/${r.quotationId}`} className="font-mono text-xs font-medium text-brand hover:underline">{r.quotationNo}</Link>,
      sortValue: (r) => r.quotationNo },
    { key: 'customer', header: 'Customer', render: (r) => r.customerName, sortValue: (r) => r.customerName },
    { key: 'salesperson', header: 'Salesperson', render: (r) => r.salespersonName, sortValue: (r) => r.salespersonName },
    { key: 'date', header: 'Date', render: (r) => <span className="text-xs">{fmtDate(r.quotationDate)}</span>, sortValue: (r) => r.quotationDate, optional: true },
    { key: 'status', header: 'Deal Status', render: (r) => <Badge tone="info">{r.status}</Badge>, sortValue: (r) => r.status, optional: true },
    {
      key: 'amount', header: 'Incentive', align: 'end',
      render: (r) => <span className="font-mono text-xs">{formatCurrency(r.incentivePaise)}</span>,
      sortValue: (r) => r.incentivePaise,
    },
    {
      key: 'paid', header: 'Payment',
      render: (r) => (r.paid
        ? <Badge tone="success">Paid {r.paidAt ? fmtDate(r.paidAt) : ''}</Badge>
        : <Badge tone="warning">Pending</Badge>),
      sortValue: (r) => (r.paid ? 1 : 0),
    },
  ];

  return (
    <div>
      <PageHeader badge="SI" title="Sales Incentive" subtitle={`${rows.length} earned incentives`} />

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Quotation no., customer, salesperson…"
        count={`Total (${visible.length})`}
        filters={<DateRangeSelect label="Quotation date" />}
        end={
          <>
            <ToolbarIcon icon="refresh" label="Refresh" onClick={() => window.location.reload()} />
            <ToolbarIcon
              icon="x-circle" label="Clear filters"
              active={filter !== null || search !== '' || rangeOn}
              onClick={() => { setFilter(null); setSearch(''); list.set({ range: null, from: null, to: null }); }}
            />
          </>
        }
      />

      <KpiStrip cards={kpis} activeKey={filter} onSelect={setFilter} columns={4} />

      <DataGrid
        exportAs={{ title: 'Employee incentive' }}
        rows={visible}
        columns={columns}
        rowKey={(r) => r.quotationId}
        search={search}
        emptyIcon="trending-up"
        emptyMessage={filter ? 'No incentives match this card.' : 'No incentives earned yet.'}
        emptyHint="An incentive appears here once a quotation carrying one is accepted or converted."
        pageSizes={[10, 25, 50, 100]}
        pageSummary={(pageRows) => (
          <>
            <span className="text-muted-foreground">
              Count: <strong className="text-foreground">{pageRows.length}</strong>
            </span>
            <span className="text-muted-foreground">
              Page Total:{' '}
              <strong className="font-mono text-brand">
                {formatCurrency(pageRows.reduce((n, r) => n + r.incentivePaise, 0))}
              </strong>
            </span>
          </>
        )}
        actions={[
          {
            label: 'Pay incentive', icon: 'credit-card', iconTone: 'success',
            enabled: (r) => canPay && !r.paid,
            onSelect: (r) => setPaying(r),
          },
          {
            label: 'Reverse payment', icon: 'rotate-ccw',
            enabled: (r) => canPay && r.paid,
            onSelect: (r) => setReversing(r),
          },
        ]}
      />

      {paying && (
        <PayDialog row={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); window.location.reload(); }} />
      )}
      {reversing && (
        <ReverseDialog row={reversing} onClose={() => setReversing(null)} onDone={() => { setReversing(null); window.location.reload(); }} />
      )}
    </div>
  );
}

function PayDialog({ row, onClose, onDone }: { row: IncentiveRowVM; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('cash');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const res = await payIncentiveAction(row.quotationId, method);
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <Modal
      open
      title="Pay incentive"
      subtitle={`${row.salespersonName} · ${formatCurrency(row.incentivePaise)} on ${row.quotationNo}`}
      icon="credit-card"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={pending} loading={pending} onClick={save}>Pay</Button>
        </div>
      }
    >
      <div className="grid gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
          </select>
        </label>
      </div>
    </Modal>
  );
}

function ReverseDialog({ row, onClose, onDone }: { row: IncentiveRowVM; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const res = await reverseIncentiveAction(row.quotationId, reason);
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <Modal
      open
      title="Reverse incentive payment"
      subtitle={`${row.salespersonName} · ${formatCurrency(row.incentivePaise)} on ${row.quotationNo}`}
      icon="rotate-ccw"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="rotate-ccw" disabled={!reason.trim() || pending} loading={pending} onClick={save}>Reverse</Button>
        </div>
      }
    >
      <div className="grid gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Reason
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
      </div>
    </Modal>
  );
}
