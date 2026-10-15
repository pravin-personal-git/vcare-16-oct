'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DataGrid, type Column, type RowAction, type ServerPaging } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { useListParams } from '@/components/ui/useListParams';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import { AMC_STATUS_LABEL, COVERAGE_TERMS_LABEL } from '@/lib/amc-status';
import { describeAllowance } from '@/lib/amc-offer';
import { AmcForm, type CustomerOption, type ProductOption, type InvoiceOption } from './AmcForm';
import { AmcDetail } from './AmcDetail';
import { CancelAmcDialog, RenewAmcDialog } from './AmcDialogs';
import {
  setAmcStatusAction, raiseAmcInvoiceAction, type ActionState,
} from './actions';

/**
 * Dates cross the server/client boundary as ISO strings, so the row type here
 * is the server's row with those two fields widened. Same approach the other
 * service screens take.
 */
export interface AmcRow {
  id: string;
  contractNo: string;
  legacyRef: string | null;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  siteLabel: string | null;
  invoiceId: string | null;
  invoiceNo: string | null;
  startDate: string;
  endDate: string;
  amountPaise: number;
  status: string;
  coverageTerms: string;
  visitsIncluded: number | null;
  reminderDays: number;
  /** Typed in by hand. Null = not entered yet, and the contract cannot be invoiced. */
  taxRatePct: number | null;
  sacCode: string | null;
  notes: string | null;
  renewedFromId: string | null;
  isRenewed: boolean;
  itemCount: number;
  coveredProducts: string[];
  daysToExpiry: number;
  isDue: boolean;
  isOverdue: boolean;
  billing: 'no_fee' | 'awaiting_invoice' | 'invoiced';
  originInvoiceId: string | null;
  originInvoiceNo: string | null;
  coverageNote: string | null;
  allowance: {
    used: number;
    included: number | null;
    remaining: number | null;
    exhausted: boolean;
    exceededBy: number;
    unlimited: boolean;
  };
}

export interface AmcTotalsView {
  total: number;
  byStatus: Record<string, number>;
  dueForRenewal: number;
  lapsed: number;
  activeValuePaise: number;
  awaitingInvoice: number;
  awaitingInvoicePaise: number;
}


const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/**
 * How much cover is left, in words a person can act on.
 *
 * Reads from `daysToExpiry`, which the server computed with the shared
 * lib/expiry rule - not recomputed here. Two implementations of "is this
 * expired" would agree until one was edited, and this one would be the copy
 * nobody remembered to change.
 */
function remaining(r: AmcRow): { text: string; tone: 'danger' | 'warning' | 'muted' | 'ok' } {
  if (r.status === 'cancelled') return { text: 'Cancelled', tone: 'muted' };
  if (r.status === 'draft') return { text: 'Not started', tone: 'muted' };
  if (r.isOverdue) {
    const d = Math.abs(r.daysToExpiry);
    return { text: d === 1 ? 'Lapsed yesterday' : `Lapsed ${d} days ago`, tone: 'danger' };
  }
  if (r.daysToExpiry === 0) return { text: 'Expires today', tone: 'danger' };
  if (r.isDue) return { text: `${r.daysToExpiry} days left`, tone: 'warning' };
  return { text: `${r.daysToExpiry} days left`, tone: 'ok' };
}

export function AmcClient({
  rows, totals, customers, products, invoices, canEdit, isSingleStore,
  filter, rangeLabel, canExport, views, initialOpenId = null, paging,
}: {
  /** One server-side page (F1b): rows are already searched, sorted and sliced. */
  paging?: ServerPaging;
  /** The active card (?filter=), applied on the server (server/amc-list). */
  filter: string | null;
  /** The end-date range in force, in words. */
  rangeLabel: string;
  canExport: boolean;
  views: FilterBarViews;
  /** From `?open=`, so a global-search hit opens the record itself. */
  initialOpenId?: string | null;

  rows: AmcRow[];
  totals: AmcTotalsView;
  customers: CustomerOption[];
  products: ProductOption[];
  invoices: InvoiceOption[];
  canEdit: boolean;
  isSingleStore: boolean;
}) {
  const list = useListParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AmcRow | null>(null);
  const [viewing, setViewing] = useState<string | null>(initialOpenId);
  const [cancelling, setCancelling] = useState<AmcRow | null>(null);
  const [renewing, setRenewing] = useState<AmcRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionState | null>(null);

  const cards: KpiCard[] = [
    {
      key: 'active',
      label: 'Active',
      count: totals.byStatus.active ?? 0,
      icon: 'check-circle',
      subLabel: formatCurrencyCompact(totals.activeValuePaise),
      tone: 'success',
    },
    {
      key: 'due',
      label: 'Renewal due',
      count: totals.dueForRenewal,
      icon: 'clock',
      subLabel: 'inside reminder window',
      tone: 'warning',
    },
    {
      key: 'lapsed',
      label: 'Lapsed',
      count: totals.lapsed,
      icon: 'alert-triangle',
      subLabel: 'past end date',
      tone: 'danger',
    },
    {
      // The number that matters most here: an AMC sold and never billed is
      // revenue the business agreed to and then forgot to ask for.
      key: 'unbilled',
      label: 'Not invoiced',
      count: totals.awaitingInvoice,
      icon: 'receipt',
      subLabel: formatCurrencyCompact(totals.awaitingInvoicePaise),
      tone: totals.awaitingInvoice > 0 ? 'danger' : 'default',
    },
    { key: 'draft', label: 'Draft', count: totals.byStatus.draft ?? 0, icon: 'file-text' },
    { key: 'expired', label: 'Expired', count: totals.byStatus.expired ?? 0, icon: 'ban' },
  ];


  async function run(fn: () => Promise<ActionState>) {
    setBusy(true);
    setMessage(null);
    const res = await fn();
    setBusy(false);
    setMessage(res);
    if (res.ok) {
      setFormOpen(false);
      setEditing(null);
    }
  }

  /**
   * Row menu. Annotated as `RowAction<AmcRow>[]` and then filtered, rather
   * than assembled with conditional spreads - a spread of a ternary widens
   * `icon` to `string` and loses the parameter types, which is what made the
   * first attempt at this fail to compile.
   *
   * "Open" is available to everyone who can see the screen; everything that
   * writes is behind `canEdit`.
   */
  const allActions: RowAction<AmcRow>[] = [
    {
      label: 'Open',
      icon: 'eye',
      onSelect: (r) => setViewing(r.id),
    },
    {
      label: 'Edit',
      icon: 'pencil',
      onSelect: (r) => { setEditing(r); setFormOpen(true); },
      enabled: (r) => canEdit && r.status !== 'cancelled',
    },
    {
      label: 'Activate',
      icon: 'check-circle',
      iconTone: 'success',
      onSelect: (r) => run(() => setAmcStatusAction(r.id, 'active')),
      enabled: (r) => canEdit && (r.status === 'draft' || r.status === 'expired'),
    },
    {
      label: 'Raise AMC invoice',
      icon: 'receipt',
      iconTone: 'brand',
      separatorBefore: true,
      onSelect: (r) => run(() => raiseAmcInvoiceAction(r.id)),
      // Only when there is a fee and it has not been billed. An included AMC
      // has nothing to invoice, and invoicing twice would charge twice.
      enabled: (r) => canEdit && r.billing === 'awaiting_invoice' && r.status !== 'cancelled',
    },
    {
      label: 'Renew…',
      icon: 'refresh',
      iconTone: 'brand',
      separatorBefore: true,
      // A dialog, so the period and the price can both be set - every
      // maintenance business reprices on renewal.
      onSelect: (r) => setRenewing(r),
      // Renewing twice would create two overlapping successors, so the server
      // refuses it; greying it out here says so before the click.
      enabled: (r) => canEdit && r.status !== 'cancelled' && !r.isRenewed,
    },
    {
      label: 'Cancel contract…',
      icon: 'ban',
      tone: 'danger',
      separatorBefore: true,
      onSelect: (r) => setCancelling(r),
      enabled: (r) => canEdit && r.status !== 'cancelled',
    },
  ];

  // Filtered in a separate statement: chaining `.filter()` onto the literal
  // above discards the annotation, because TypeScript infers the array before
  // the declared type can apply to it.
  const rowActions = canEdit
    ? allActions
    : allActions.filter((a) => a.label === 'Open');

  const columns: Column<AmcRow>[] = [
    {
      key: 'contractNo',
      header: 'Contract',
      width: '13rem',
      render: (r) => (
        <div>
          <button type="button" onClick={() => setViewing(r.id)} className="block font-mono text-xs font-semibold text-brand hover:underline">{r.contractNo}</button>
          {r.legacyRef && r.legacyRef !== r.contractNo && (
            <p className="font-mono text-xs text-muted-foreground">was {r.legacyRef}</p>
          )}
        </div>
      ),
      sortValue: (r) => r.contractNo,
    },
    {
      key: 'customerName',
      header: 'Customer',
      render: (r) => (
        <div className="min-w-0">
          <Link href={`/customers/${r.customerId}`} className="block truncate font-medium hover:text-brand">
            {r.customerName}
          </Link>
          {r.siteLabel && (
            <p className="truncate text-xs text-muted-foreground">
              <Icon name="map-pin" className="me-1 inline h-3 w-3" />
              {r.siteLabel}
            </p>
          )}
        </div>
      ),
      sortValue: (r) => r.customerName,
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (r) => <span className="font-mono text-xs">{r.customerPhone ?? '-'}</span>,
      sortValue: (r) => r.customerPhone,
      optional: true,
    },
    {
      key: 'period',
      header: 'Period',
      render: (r) => (
        <div>
          <p className="text-xs">{fmtDate(r.startDate)}</p>
          <p className="text-xs text-muted-foreground">to {fmtDate(r.endDate)}</p>
        </div>
      ),
      sortValue: (r) => new Date(r.startDate).getTime(),
    },
    {
      key: 'remaining',
      header: 'Cover left',
      render: (r) => {
        const { text, tone } = remaining(r);
        return (
          <span className={`text-xs font-medium ${
            tone === 'danger' ? 'text-danger'
              : tone === 'warning' ? 'text-warning'
                : tone === 'muted' ? 'text-muted-foreground' : ''
          }`}>
            {text}
          </span>
        );
      },
      sortValue: (r) => r.daysToExpiry,
    },
    {
      key: 'covers',
      header: 'Covers',
      render: (r) => (
        r.itemCount === 0
          ? <Badge tone="info" icon="building">Whole site</Badge>
          : (
            <div>
              <p className="text-xs font-medium">{r.itemCount} item{r.itemCount === 1 ? '' : 's'}</p>
              <p className="truncate text-xs text-muted-foreground" title={r.coveredProducts.join(', ')}>
                {r.coveredProducts.slice(0, 2).join(', ')}
                {r.coveredProducts.length > 2 && ` +${r.coveredProducts.length - 2}`}
              </p>
            </div>
          )
      ),
      sortValue: (r) => r.itemCount,
    },
    {
      key: 'coverageTerms',
      header: 'Terms',
      render: (r) => (
        <span className="text-xs">{COVERAGE_TERMS_LABEL[r.coverageTerms] ?? r.coverageTerms}</span>
      ),
      sortValue: (r) => r.coverageTerms,
    },
    {
      // Used against included, not just the promise. `visitsIncluded` used to
      // be shown on its own here, which told you what had been agreed and
      // nothing about whether it had been honoured or overspent.
      key: 'visits',
      header: 'Visits',
      align: 'center',
      render: (r) => {
        const a = r.allowance;
        if (a.unlimited) {
          return (
            <span className="text-xs">
              {a.used}
              <span className="text-muted-foreground"> / unlimited</span>
            </span>
          );
        }
        return (
          <span
            title={describeAllowance(a)}
            className={`text-xs font-medium tabular-nums ${
              a.exceededBy > 0 ? 'text-danger' : a.exhausted ? 'text-warning' : ''
            }`}
          >
            {a.used} / {a.included}
            {a.exceededBy > 0 && (
              <span className="block text-xs font-normal">{a.exceededBy} over</span>
            )}
          </span>
        );
      },
      // Sorts by how overspent a contract is, so the ones to look at come
      // first - a plain count would bury them among the unlimited rows.
      sortValue: (r) => (r.allowance.unlimited ? -1 : r.allowance.exceededBy * 1000 + r.allowance.used),
    },
    {
      key: 'amount',
      header: 'Value',
      align: 'end',
      render: (r) => (
        <span className="font-mono text-xs tabular-nums">{formatCurrency(r.amountPaise)}</span>
      ),
      sortValue: (r) => r.amountPaise,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge status={r.status} label={AMC_STATUS_LABEL[r.status] ?? r.status} />
          {r.isRenewed && <Badge tone="info" icon="refresh">Renewed</Badge>}
        </div>
      ),
      sortValue: (r) => r.status,
    },
    {
      key: 'billing',
      header: 'Fee',
      render: (r) => {
        if (r.billing === 'no_fee') {
          return <span className="text-xs text-muted-foreground">Included in sale</span>;
        }
        if (r.billing === 'invoiced') {
          return r.invoiceId ? (
            <Link href={`/invoices/${r.invoiceId}`} className="font-mono text-xs text-brand hover:underline">
              {r.invoiceNo}
            </Link>
          ) : <span className="text-xs">Invoiced</span>;
        }
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/[0.07] px-1.5 py-0.5 text-xs font-medium text-on-tint-danger">
            <Icon name="alert-triangle" className="h-2.5 w-2.5" />
            Not invoiced
          </span>
        );
      },
      sortValue: (r) => r.billing,
    },
    {
      key: 'originInvoiceNo',
      header: 'Sold on',
      render: (r) => (
        r.originInvoiceId
          ? (
            <Link href={`/invoices/${r.originInvoiceId}`} className="font-mono text-xs text-brand hover:underline">
              {r.originInvoiceNo}
            </Link>
          )
          // No origin invoice means somebody typed this contract in by hand -
          // usually one that was already running before Atlas.
          : <span className="text-xs text-muted-foreground">Entered by hand</span>
      ),
      sortValue: (r) => r.originInvoiceNo,
      optional: true,
    },
  ];

  return (
    <div>
      <PageHeader
        badge="AM"
        title="Maintenance Contracts"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{totals.total} on file</span>
            <span className="text-border-strong">·</span>
            <span className="font-medium text-success">
              {formatCurrencyCompact(totals.activeValuePaise)} under active cover
            </span>
            {totals.dueForRenewal > 0 && (
              <>
                <span className="text-border-strong">·</span>
                <span className="font-medium text-warning">{totals.dueForRenewal} due to renew</span>
              </>
            )}
            {totals.lapsed > 0 && (
              <>
                <span className="text-border-strong">·</span>
                <span className="font-medium text-danger">{totals.lapsed} lapsed</span>
              </>
            )}
          </span>
        }
        actions={canEdit && isSingleStore ? (
          <Button onClick={() => { setEditing(null); setFormOpen(true); }} icon="plus">
            New contract
          </Button>
        ) : undefined}
      />

      {message?.error && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2.5 text-xs text-foreground">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span>{message.error}</span>
        </p>
      )}

      {message?.ok && message.message && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-success/30 bg-success/[0.06] px-3 py-2.5 text-xs text-foreground">
          <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <span>{message.message}</span>
        </p>
      )}

      <FilterBar
        searchPlaceholder="Contract no, old no, customer, phone, site, invoice…"
        dates={{ defaultPreset: 'all', label: 'Ends', activeLabel: rangeLabel }}
        shown={paging?.total ?? rows.length}
        clearKeys={['filter']}
        exportScreen={canExport ? 'amc' : null}
        views={views}
      />

      <KpiStrip cards={cards} activeKey={filter} onSelect={(k) => list.set({ filter: k })} columns={6} />

      <DataGrid
        rows={rows}
        server={paging}
        columns={columns}
        rowKey={(r) => r.id}
        mobileCard={(r) => {
          const left = remaining(r);
          return (
            <button type="button" onClick={() => setViewing(r.id)} className="block w-full text-start">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-brand">{r.contractNo}</span>
                <StatusBadge status={r.status} label={AMC_STATUS_LABEL[r.status] ?? r.status} />
              </div>
              <p className="mt-1 truncate text-sm font-medium">{r.customerName}</p>
              <p className="text-xs text-muted-foreground">
                {fmtDate(r.startDate)} – {fmtDate(r.endDate)} · {formatCurrency(r.amountPaise)}
              </p>
              <p className={`text-xs font-medium ${left.tone === 'danger' ? 'text-danger' : left.tone === 'warning' ? 'text-warning' : 'text-muted-foreground'}`}>{left.text}</p>
            </button>
          );
        }}
        emptyIcon="receipt"
        emptyMessage={
          totals.total === 0
            ? 'No maintenance contracts yet.'
            : 'No contracts match this filter.'
        }
        emptyHint={
          totals.total === 0
            ? 'Nothing was migrated here - the previous system held one AMC line on '
              + 'one invoice and no contract records, so this screen starts empty. '
              + 'Add the contracts already running on paper and every renewal after '
              + 'them will be flagged before it lapses.'
            : undefined
        }
        actions={rowActions}
        pageSummary={(pageRows) => (
          <>
            <span className="text-muted-foreground">
              Contracts on this page: <strong className="text-foreground">{pageRows.length}</strong>
            </span>
            <span className="text-muted-foreground">
              Page value:{' '}
              <strong className="text-foreground">
                {formatCurrency(pageRows.reduce((n, r) => n + r.amountPaise, 0))}
              </strong>
            </span>
          </>
        )}
      />

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground shadow-card">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <span>
          A contract with no listed equipment covers the <strong>whole site</strong>.
          List equipment only when the agreement is limited to specific units.
          Renewing creates a new contract starting the day after this one ends,
          so there is never a gap - the old period stays on file because it is
          what covered last year&rsquo;s service calls.
        </span>
      </p>

      {viewing && (
        <AmcDetail
          contractId={viewing}
          onClose={() => setViewing(null)}
        />
      )}

      {cancelling && (
        <CancelAmcDialog
          contractId={cancelling.id}
          contractNo={cancelling.contractNo}
          customerName={cancelling.customerName}
          onClose={() => setCancelling(null)}
          onDone={(res) => { setMessage(res); setCancelling(null); }}
        />
      )}

      {renewing && (
        <RenewAmcDialog
          contractId={renewing.id}
          contractNo={renewing.contractNo}
          customerName={renewing.customerName}
          currentEnd={renewing.endDate}
          currentAmountPaise={renewing.amountPaise}
          onClose={() => setRenewing(null)}
          onDone={(res) => { setMessage(res); setRenewing(null); }}
        />
      )}

      {formOpen && (
        <AmcForm
          existing={editing}
          customers={customers}
          products={products}
          invoices={invoices}
          busy={busy}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onDone={(res) => {
            setMessage(res);
            if (res.ok) { setFormOpen(false); setEditing(null); }
          }}
          setBusy={setBusy}
        />
      )}
    </div>
  );
}
