'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Toolbar, ToolbarIcon } from '@/components/ui/Toolbar';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import type { CustomerAccountCards } from '@/server/customer-accounts';
import { setFollowUpAction, setBadDebtAction } from './actions';

export interface AccountRowVM {
  id: string;
  partyCode: string;
  displayName: string;
  companyName: string | null;
  phone: string;
  status: string;
  duePaise: number;
  creditLimitPaise: number;
  oldestUnpaidDueDate: string | null;
  crossedDueDate: boolean;
  crossedCreditLimit: boolean;
  followUpDate: string | null;
  isBadDebt: boolean;
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-';

export function CustomerAccountClient({
  rows, cards, canEdit,
}: {
  rows: AccountRowVM[];
  cards: CustomerAccountCards;
  canEdit: boolean;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [followUpFor, setFollowUpFor] = useState<AccountRowVM | null>(null);

  const kpis: KpiCard[] = [
    { key: 'all', label: 'All', count: cards.all, icon: 'users' },
    { key: 'open', label: 'Open Accounts', count: cards.openAccounts, icon: 'credit-card', tone: 'brand' },
    { key: 'follow_up', label: 'Follow Up Due', count: cards.followUpDue, icon: 'phone', tone: 'info' },
    { key: 'bad_debts', label: 'Bad Debts', count: cards.badDebts, icon: 'ban', tone: 'danger' },
    { key: 'total_due_ac', label: 'Total Due A/C', count: cards.totalDueAccounts, icon: 'file-text', tone: 'warning' },
    { key: 'crossed_due', label: 'Crossed Due Date', count: cards.crossedDueDate, icon: 'clock', tone: 'danger' },
    { key: 'crossed_limit', label: 'Crossed Credit Limit', count: cards.crossedCreditLimit, icon: 'alert-triangle', tone: 'danger' },
    { key: 'crossed_both', label: 'Crossed Both', count: cards.crossedBoth, icon: 'alert-circle', tone: 'danger' },
    { key: 'total_due', label: 'Total Due ₹', count: formatCurrencyCompact(cards.totalDuePaise), icon: 'trending-up', tone: 'warning' },
  ];

  const visible = useMemo(() => {
    let out = rows;
    if (filter === 'open') out = out.filter((r) => r.duePaise > 0);
    else if (filter === 'follow_up') out = out.filter((r) => r.followUpDate && new Date(r.followUpDate) <= new Date());
    else if (filter === 'bad_debts') out = out.filter((r) => r.isBadDebt);
    else if (filter === 'total_due_ac') out = out.filter((r) => r.duePaise > 0);
    else if (filter === 'crossed_due') out = out.filter((r) => r.crossedDueDate);
    else if (filter === 'crossed_limit') out = out.filter((r) => r.crossedCreditLimit);
    else if (filter === 'crossed_both') out = out.filter((r) => r.crossedDueDate && r.crossedCreditLimit);
    return out;
  }, [rows, filter]);

  const columns: Column<AccountRowVM>[] = [
    {
      key: 'displayName', header: 'Customer',
      render: (r) => (
        <Link href={`/customers/${r.id}`} className="block hover:text-brand">
          <p className="font-medium">{r.displayName}</p>
          {r.companyName && <p className="text-xs text-muted-foreground">{r.companyName}</p>}
        </Link>
      ),
      sortValue: (r) => r.displayName,
    },
    { key: 'partyCode', header: 'Code', width: '8rem',
      render: (r) => <Link href={`/customers/${r.id}`} className="font-mono text-xs font-medium text-brand hover:underline">{r.partyCode}</Link>,
      sortValue: (r) => r.partyCode },
    { key: 'phone', header: 'Phone', render: (r) => <span className="font-mono text-xs">{r.phone}</span>, sortValue: (r) => r.phone },
    {
      key: 'due', header: 'Amount Due', align: 'end',
      render: (r) => (
        <span className={`font-mono text-xs ${r.duePaise > 0 ? 'text-warning' : 'text-muted-foreground'}`}>
          {formatCurrency(r.duePaise)}
        </span>
      ),
      sortValue: (r) => r.duePaise,
    },
    {
      key: 'creditLimit', header: 'Credit Limit', align: 'end',
      render: (r) => (
        <span className={`font-mono text-xs ${r.crossedCreditLimit ? 'text-danger' : 'text-muted-foreground'}`}>
          {r.creditLimitPaise === 0 ? 'No limit' : formatCurrency(r.creditLimitPaise)}
        </span>
      ),
      sortValue: (r) => r.creditLimitPaise,
    },
    {
      key: 'oldestUnpaid', header: 'Oldest Unpaid Due',
      render: (r) => (
        <span className={`text-xs ${r.crossedDueDate ? 'text-danger' : 'text-muted-foreground'}`}>
          {fmtDate(r.oldestUnpaidDueDate)}
        </span>
      ),
      sortValue: (r) => (r.oldestUnpaidDueDate ? new Date(r.oldestUnpaidDueDate).getTime() : null),
      optional: true,
    },
    {
      key: 'followUp', header: 'Follow Up',
      render: (r) => <span className="text-xs">{fmtDate(r.followUpDate)}</span>,
      sortValue: (r) => (r.followUpDate ? new Date(r.followUpDate).getTime() : null),
      optional: true,
    },
    {
      key: 'badDebt', header: 'Bad Debt', align: 'center', width: '6rem',
      render: (r) => (r.isBadDebt ? <Badge tone="danger">Yes</Badge> : <span className="text-xs text-muted-foreground">-</span>),
      sortValue: (r) => (r.isBadDebt ? 1 : 0),
      optional: true,
    },
  ];

  return (
    <div>
      <PageHeader
        badge="CA"
        title="Customer Account"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{rows.length} accounts</span>
            <span className="text-border-strong">·</span>
            <span className={cards.totalDuePaise > 0 ? 'font-medium text-warning' : ''}>
              {formatCurrencyCompact(cards.totalDuePaise)} total due
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

      <KpiStrip cards={kpis} activeKey={filter} onSelect={setFilter} columns={5} />

      <DataGrid
        exportAs={{ title: 'Customer accounts' }}
        rows={visible}
        columns={columns}
        rowKey={(r) => r.id}
        search={search}
        emptyIcon="credit-card"
        emptyMessage={filter ? 'No customer accounts match this card.' : 'No customer accounts found.'}
        emptyHint="Accounts appear here once a customer has an invoice, receipt, or credit note."
        pageSizes={[25, 50, 100, 250, 500]}
        pageSummary={(pageRows) => (
          <>
            <span className="text-muted-foreground">
              Count: <strong className="text-foreground">{pageRows.length}</strong>
            </span>
            <span className="text-muted-foreground">
              Page Due:{' '}
              <strong className="font-mono text-warning">
                {formatCurrency(pageRows.reduce((n, r) => n + Math.max(0, r.duePaise), 0))}
              </strong>
            </span>
          </>
        )}
        actions={[
          {
            label: 'View ledger', icon: 'receipt', iconTone: 'brand',
            onSelect: (r) => { window.location.href = `/customers/${r.id}`; },
          },
          {
            label: 'Set follow-up date', icon: 'phone',
            separatorBefore: true,
            enabled: () => canEdit,
            onSelect: (r) => setFollowUpFor(r),
          },
          {
            label: 'Mark as bad debt', icon: 'ban',
            enabled: (r) => canEdit && !r.isBadDebt,
            onSelect: (r) => {
              void setBadDebtAction(r.id, true).then(() => window.location.reload());
            },
          },
          {
            label: 'Clear bad debt', icon: 'check-circle',
            enabled: (r) => canEdit && r.isBadDebt,
            onSelect: (r) => {
              void setBadDebtAction(r.id, false).then(() => window.location.reload());
            },
          },
        ]}
      />

      {followUpFor && (
        <FollowUpDialog
          row={followUpFor}
          onClose={() => setFollowUpFor(null)}
          onDone={() => { setFollowUpFor(null); window.location.reload(); }}
        />
      )}
    </div>
  );
}

function FollowUpDialog({
  row, onClose, onDone,
}: {
  row: AccountRowVM;
  onClose: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState(row.followUpDate ? row.followUpDate.slice(0, 10) : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const res = await setFollowUpAction(row.id, date || null);
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <Modal
      open
      title="Set follow-up date"
      subtitle={row.displayName}
      icon="phone"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" loading={pending} onClick={save}>
            Save
          </Button>
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
          Follow up on
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
        <button
          type="button"
          onClick={() => setDate('')}
          className="justify-self-start text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          Clear follow-up date
        </button>
      </div>
    </Modal>
  );
}
