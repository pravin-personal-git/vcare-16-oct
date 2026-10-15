'use client';

import { customColumns } from '@/components/custom-fields/list-columns';
import type { ListColumns } from '@/server/custom-fields';

import Link from 'next/link';

import { useState } from 'react';
import { DataGrid, type Column, type QuickAction, type ServerPaging } from '@/components/ui/DataGrid';
import { useListParams } from '@/components/ui/useListParams';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { SavedViewsMenu } from '@/components/ui/SavedViewsMenu';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader } from '@/components/ui/Layout';
import { Button, ToggleChip } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import { daysOverdue, type PartyRow } from '@/lib/party-metrics';
import { CustomerForm } from './CustomerForm';
import { contactActions } from '@/lib/quick-actions';

interface Props {
  /** Settings > Custom Fields marked "Show in list". */
  extraColumns?: ListColumns;
  /** One page, filtered and sorted on the server. */
  rows: PartyRow[];
  paging: ServerPaging;
  /** The active KPI card (?card=) and Active/Dormant (?status=). */
  card: string | null;
  dormant: boolean;
  summary: ReturnType<typeof import('@/lib/party-metrics').summarise>;
  customerTypes: { id: string; name: string }[];
  /** Customer type filter (?type=, by name). */
  type: string | null;
  /** City filter (?city=) and the cities anybody is actually in. */
  city: string | null;
  cities: string[];
  /** Balance filter (?due=due|clear). */
  due: string | null;
  /** The "customer since" range in force, in words. */
  rangeLabel: string;
  canExport: boolean;
  views: FilterBarViews;
  canCreate: boolean;
  scopeIsAll: boolean;
  /**
   * Every customer in scope, not just the ones in `rows`.
   *
   * Counted separately from `rows` rather than read off it - reading the row
   * count as the answer is what made this screen say 500 for a store with
   * 4,743.
   */
  totalCount?: number;
  /** From ?open= - opens this customer straight away. */
  openId?: string | null;
}

const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-';

const daysSince = (d: Date | null) =>
  d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null;

/** One look for every dropdown on the filter row; lit when it is narrowing. */
const selectClass = (active: boolean) =>
  `h-10 rounded-lg border bg-card px-2.5 text-sm outline-none focus:border-brand ${
    active ? 'border-brand bg-brand/5 font-medium text-on-tint-brand' : 'border-border'
  }`;

export function CustomersClient({
  rows, paging, card, dormant, type, city, due, cities, rangeLabel, canExport, views, summary, customerTypes,
  canCreate, scopeIsAll, openId, totalCount, extraColumns,
}: Props) {
  const list = useListParams();
  const filter = card;
  const setFilter = (k: string | null) => list.set({ card: k });
  const showActive = !dormant;
  const setShowActive = (on: boolean) => list.set({ status: on ? null : 'dormant' });
  const [formOpen, setFormOpen] = useState(false);
  // Seeded from ?open= so 'View Customer' on an invoice opens that customer,
  // not a list you then have to search.
  const [editId, setEditId] = useState<string | null>(openId ?? null);

  /**
   * The row's quick actions. WhatsApp and Call come from the shared helper;
   * Ledger and Edit are specific to a customer and stay here, because Leads
   * and Invoices share that helper and neither wants a ledger icon.
   */
  const customerActions = (r: PartyRow): QuickAction[] => [
    ...contactActions(r.phone),
    { label: 'Ledger', icon: 'receipt', href: `/customers/${r.id}`, tone: 'brand' },
    { label: 'Edit details', icon: 'pencil', onClick: () => setEditId(r.id) },
  ];

  const cards: KpiCard[] = [
    { key: 'total_due', label: 'Total Due', count: summary.total_due, icon: 'credit-card',
      subLabel: formatCurrencyCompact(summary.total_due_paise), tone: 'warning' },
    { key: 'due_date_over', label: 'Due Date Over', count: summary.due_date_over, icon: 'clock', tone: 'danger' },
    { key: 'cr_days_over', label: 'CR Days Over', count: summary.cr_days_over, icon: 'calendar', tone: 'danger' },
    { key: 'crossed_limit', label: 'Crossed Limit', count: summary.crossed_limit, icon: 'alert-triangle', tone: 'danger' },
    { key: 'no_order_30', label: 'No Ord in 30 Days', count: summary.no_order_30, icon: 'shopping-cart', subLabel: 'last 30d' },
    { key: 'no_comm_30', label: 'No Com in 30 Days', count: summary.no_comm_30, icon: 'phone', subLabel: 'last 30d' },
    { key: 'birthday_week', label: "B'day This Week", count: summary.birthday_week, icon: 'sparkles', tone: 'success' },
  ];


  const columns: Column<PartyRow>[] = [
    {
      key: 'displayName', header: 'Customer Name',
      render: (r) => (
        // Links to the ledger, not to an edit form. "How much does this person
        // owe me and why" is what you open a customer to find out; editing
        // their phone number is the rarer errand and stays in the row menu.
        <Link href={`/customers/${r.id}`} className="block hover:text-brand">
          <p className="font-medium">{r.displayName}</p>
          {r.companyName && <p className="text-xs text-muted-foreground">{r.companyName}</p>}
        </Link>
      ),
      sortValue: (r) => r.displayName,
    },
    { key: 'partyCode', header: 'Code', width: '8rem',
      render: (r) => (
        <Link href={`/customers/${r.id}`} className="font-mono text-xs font-medium text-brand hover:underline">
          {r.partyCode}
        </Link>
      ),
      sortValue: (r) => r.partyCode },
    { key: 'phone', header: 'Phone', render: (r) => <span className="font-mono text-xs">{r.phone}</span>, sortValue: (r) => r.phone },
    { key: 'city', header: 'City', render: (r) => r.city ?? '-', sortValue: (r) => r.city },
    { key: 'state', header: 'State', render: (r) => r.state ?? '-', sortValue: (r) => r.state, optional: true },
    { key: 'customerTypeName', header: 'Type', render: (r) => r.customerTypeName ?? '-', sortValue: (r) => r.customerTypeName },
    {
      key: 'balance', header: 'Balance', align: 'end',
      render: (r) => {
        const over = daysOverdue(r);
        return (
          <div className="text-end">
            <span className={`font-mono text-xs ${r.currentBalancePaise > 0 ? 'text-warning' : ''}`}>
              {formatCurrency(r.currentBalancePaise)}
            </span>
            {over !== null && (
              <p className="text-xs text-danger">{over}d overdue</p>
            )}
          </div>
        );
      },
      sortValue: (r) => r.currentBalancePaise,
    },
    {
      key: 'creditLimit', header: 'Credit Limit', align: 'end',
      render: (r) => {
        const crossed = r.creditLimitPaise > 0 && r.currentBalancePaise > r.creditLimitPaise;
        return (
          <div className="text-end">
            <span className={`font-mono text-xs ${crossed ? 'text-danger' : 'text-muted-foreground'}`}>
              {r.creditLimitPaise === 0 ? 'No credit' : formatCurrency(r.creditLimitPaise)}
            </span>
            {r.creditLimitDays > 0 && (
              <p className="text-xs text-muted-foreground">{r.creditLimitDays} days</p>
            )}
          </div>
        );
      },
      sortValue: (r) => r.creditLimitPaise,
    },
    {
      key: 'lastPurchaseAt', header: 'Last Order',
      render: (r) => {
        const d = daysSince(r.lastPurchaseAt);
        return (
          <div>
            <p className="text-xs">{fmtDate(r.lastPurchaseAt)}</p>
            {d !== null && <p className="text-xs text-muted-foreground">{d} days ago</p>}
          </div>
        );
      },
      sortValue: (r) => r.lastPurchaseAt?.getTime() ?? null,
    },
    { key: 'lastCommunicationAt', header: 'Last Contact',
      render: (r) => <span className="text-xs">{fmtDate(r.lastCommunicationAt)}</span>,
      sortValue: (r) => r.lastCommunicationAt?.getTime() ?? null, optional: true },
    { key: 'rewardPoints', header: 'Points', align: 'end',
      render: (r) => <Badge tone={r.rewardPoints > 0 ? 'brand' : 'neutral'}>{r.rewardPoints}</Badge>,
      sortValue: (r) => r.rewardPoints, optional: true },
    { key: 'gstin', header: 'GSTIN', render: (r) => <span className="font-mono text-xs">{r.gstin ?? '-'}</span>, sortValue: (r) => r.gstin, optional: true },
    { key: 'birthday', header: 'Birthday', render: (r) => fmtDate(r.birthday), sortValue: (r) => r.birthday?.getTime() ?? null, optional: true },
    { key: 'customerSince', header: 'Since', render: (r) => fmtDate(r.customerSince), sortValue: (r) => r.customerSince.getTime(), optional: true },
    { key: 'addressLine1', header: 'Address', render: (r) => <span className="text-xs text-muted-foreground">{r.addressLine1 ?? '-'}</span>, sortValue: (r) => r.addressLine1, optional: true },
    { key: 'email', header: 'Email', render: (r) => r.email ?? '-', sortValue: (r) => r.email, optional: true },
  ];

  /**
   * From `summary`, not from `rows`.
   *
   * `rows` used to be capped at 500, so summing it reported the receivable of
   * the first page as though it were the whole book - and the header said "500
   * in this scope" for a store with 4,743 customers. The cap is gone, but the
   * separation stays: `summary` is counted over every party in scope by
   * `summariseAllParties`, using the same rules this grid filters with, so it
   * cannot drift back to describing whatever subset the grid is holding.
   */
  const totalDuePaise = summary.total_due_paise;

  return (
    <div>
      <PageHeader
        badge="CU"
        title="Customers"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {(totalCount ?? paging.total).toLocaleString('en-IN')} in this scope
            </span>
            <span className="text-border-strong">·</span>
            <span className={totalDuePaise > 0 ? 'font-medium text-warning' : ''}>
              {formatCurrencyCompact(totalDuePaise)} receivable
            </span>
          </span>
        }
        actions={
          // Views sits here rather than on the filter bar (4 Oct 2026): it is a
          // layout control, not a filter, and the filter row needs the width.
          <div className="flex items-center gap-2">
            <SavedViewsMenu source={{ initial: views.initial, roles: views.roles }} />
            <Button
              variant="primary"
              icon="user-plus"
              disabled={!canCreate}
              title={scopeIsAll ? 'Select a single store to add a customer' : undefined}
              onClick={() => setFormOpen(true)}
            >
              Add Customer
            </Button>
          </div>
        }
      />

      <FilterBar
        searchPlaceholder="Name, company, code, phone, city, email, GSTIN…"
        dates={{ defaultPreset: 'all', label: 'Customer since', activeLabel: rangeLabel }}
        extra={
          <>
            <ToggleChip on={showActive} onChange={setShowActive} label="Active" offLabel="Dormant" />
            {customerTypes.length > 0 && (
              <>
                <label htmlFor="fb-ctype" className="sr-only">Customer type</label>
                <select id="fb-ctype" value={type ?? ''} onChange={(e) => list.set({ type: e.target.value || null })}
                  className={selectClass(Boolean(type))}>
                  <option value="">Type: all</option>
                  {customerTypes.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </>
            )}
            {cities.length > 0 && (
              <>
                <label htmlFor="fb-city" className="sr-only">City</label>
                <select id="fb-city" value={city ?? ''} onChange={(e) => list.set({ city: e.target.value || null })}
                  className={selectClass(Boolean(city))}>
                  <option value="">City: all</option>
                  {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </>
            )}
            <label htmlFor="fb-due" className="sr-only">Balance</label>
            <select id="fb-due" value={due ?? ''} onChange={(e) => list.set({ due: e.target.value || null })}
              className={selectClass(Boolean(due))}>
              <option value="">Balance: all</option>
              <option value="due">Has due</option>
              <option value="clear">Clear</option>
            </select>
          </>
        }
        shown={paging.total}
        total={totalCount}
        clearKeys={['card', 'status', 'type', 'city', 'due']}
        exportScreen={canExport ? 'customers' : null}
      />

      <KpiStrip cards={cards} activeKey={filter} onSelect={setFilter} columns={8} />

      <DataGrid
        rows={rows}
        server={paging}
        columns={[...columns, ...customColumns<PartyRow>(extraColumns)]}
        rowKey={(r) => r.id}
        quickActions={(r) => customerActions(r)}
        mobileCard={(r) => (
          <Link href={`/customers/${r.id}`} className="block">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold">{r.displayName}</span>
              <span className={`font-mono text-xs tabular-nums ${r.currentBalancePaise > 0 ? 'font-semibold text-danger' : 'text-muted-foreground'}`}>
                {formatCurrency(r.currentBalancePaise)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {r.partyCode} · {r.phone}{r.city ? ` · ${r.city}` : ''}{r.customerTypeName ? ` · ${r.customerTypeName}` : ''}
            </p>
          </Link>
        )}
        emptyIcon="users"
        emptyMessage={filter ? 'No customers match this card.' : `No ${showActive ? 'active' : 'dormant'} customers.`}
        emptyHint={
          filter
            ? 'Clear the card to see every customer.'
            : 'Add one directly, or convert a lead once it turns into real business.'
        }
        /* Inherits the shared sizes - this list holds every customer now. */
        pageSummary={(pageRows) => (
          <>
            <span className="text-muted-foreground">
              Count: <strong className="text-foreground">{pageRows.length}</strong>
            </span>
            <span className="text-muted-foreground">
              Page Receivable:{' '}
              <strong className="font-mono text-warning">
                {formatCurrency(pageRows.reduce((n, r) => n + Math.max(0, r.currentBalancePaise), 0))}
              </strong>
            </span>
          </>
        )}
        actions={[
          {
            label: 'View ledger', icon: 'receipt', iconTone: 'brand',
            onSelect: (r) => { window.location.href = `/customers/${r.id}`; },
          },
          { label: 'Edit details', icon: 'pencil', onSelect: (r) => setEditId(r.id) },
          // A third entry used to sit here, also labelled with a receipt icon,
          // that ignored the row and jumped to the global Customer Accounts
          // page. Two items, same icon, different destinations. Removed
          // 4 Oct 2026; Customer Accounts lives under the Accounts menu.
        ]}
      />

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground shadow-card">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <span>
          Service tickets, open quotations, meetings and pending tasks are also
          KPI cards in the specification. They are omitted here because those
          modules do not exist yet - a hard-coded zero would be worse than
          showing nothing.
        </span>
      </p>

      {editId && (
        <CustomerForm customerTypes={customerTypes} editId={editId}
          onClose={() => { setEditId(null); window.location.reload(); }} />
      )}

      {formOpen && (
        <CustomerForm customerTypes={customerTypes} onClose={() => setFormOpen(false)} />
      )}
    </div>
  );
}
