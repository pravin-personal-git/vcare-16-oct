'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import { sayIfHeld, toast } from '@/lib/held-message';
import Link from 'next/link';
import { useState } from 'react';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { useListParams } from '@/components/ui/useListParams';
import { WithFormOptions } from '@/components/document/WithFormOptions';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { Icon, type IconName } from '@/components/ui/Icon';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import {
  ALL_STATUSES, STATUS_LABEL, ageBucket, daysOverdue,
  type InvoiceStatus,
} from '@/lib/invoice-status';
import { statusTone } from '@/lib/status-tones';
import type { InvoiceRow } from '@/server/invoices';
import { ConvertOrder, type InvoiceableOrder } from './ConvertOrder';
import { BillSite } from './BillSite';
import type { BillableCustomer } from '@/server/consolidated-invoice';
import { InvoiceForm } from './InvoiceForm';
import { ViewToggle } from '@/components/ui/ViewToggle';
import { AttachmentBadge } from '@/components/ui/Attachments';
import { PaymentDialog } from './PaymentDialog';
import { issue, cancel, closeInvoice, reopenInvoice, removeInvoice, getInvoiceShareLink } from './actions';
import { docMessage } from '@/lib/wa-message';
import { openWhatsApp } from '@/lib/wa-open';
import { contactActions } from '@/lib/quick-actions';
import { ask } from '@/components/ui/ask';

/**
 * WhatsApp the customer their invoice (6 Oct 2026). wa.me carries text only,
 * so the message ends with the invoice's own no-login link (/i/<token>) -
 * before this the customer got one line and nothing to open.
 */
async function whatsappInvoice(r: InvoiceRow) {
  const err = await openWhatsApp(r.phone, async () => {
    const res = await getInvoiceShareLink(r.id);
    if (res.error || !res.url) return { error: res.error ?? 'Could not create a link.' };
    return docMessage({
      kind: 'invoice', number: r.invoiceNo, customerName: r.customerName,
      amountPaise: r.grandTotalPaise, duePaise: r.duePaise, url: res.url,
    });
  });
  if (err) toast(err);
}

const STATUS_ICON: Record<InvoiceStatus, IconName> = {
  draft: 'file-text',
  pending: 'clock',
  sent: 'send',
  partially_paid: 'credit-card',
  paid: 'check-circle',
  overdue: 'alert-triangle',
  cancelled: 'ban',
};

const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/**
 * The invoice list.
 *
 * Seven status cards, not eight - the reference renders OVERDUE twice, which is
 * a bug in the live app and not worth copying faithfully.
 *
 * Status is computed per row rather than read from a column, so an invoice
 * becomes overdue the moment its due date passes, with no nightly job involved.
 */
export function InvoicesClient({
  rows, paging, card, counts, rangeLabel, olderUnpaid, canExport, views, orders, billable,
  storeState, canCreate, canApprove, scopeIsAll, view,
  totals,
}: {
  /** One page, filtered and sorted on the server. */
  rows: InvoiceRow[];
  paging: ServerPaging;
  /** The active status card (?card=). */
  card: string | null;
  /** Invoices per status inside the chosen date range - what the cards show. */
  counts: Record<InvoiceStatus, number>;
  /** The invoice-date range in force, in words. */
  rangeLabel: string;
  /** Unpaid invoices dated outside the range - offered in one click. */
  olderUnpaid: number;
  canExport: boolean;
  views: FilterBarViews;
  /**
   * Figures counted over EVERY invoice in scope, independently of `rows`.
   *
   * Optional so the component still renders if a caller has not been updated;
   * without it the header and tiles fall back to summing `rows`, which is what
   * made a 3,380-invoice store report "500 raised".
   */
  totals?: {
    total: number;
    receivablePaise: number;
    overduePaise: number;
    byStatus: Record<string, number>;
  };
  orders: InvoiceableOrder[];
  billable: BillableCustomer[];
  storeState: string | null;
  canCreate: boolean;
  canApprove: boolean;
  scopeIsAll: boolean;
  /** Which list the server handed us - Active, or the closed ones. */
  view: 'active' | 'history';
}) {
  const list = useListParams();
  const filter = card;
  const setFilter = (k: string | null | ((f: string | null) => string | null)) =>
    list.set({ card: typeof k === 'function' ? k(filter) : k });
  const [convertOpen, setConvertOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<InvoiceRow | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * From `totals` where we have it, not from `rows`.
   *
   * `rows` used to be capped at 500, so these tiles added up to exactly 500 on
   * a store with 3,380 invoices - which reads as two thirds of the data being
   * missing. The cap is gone, but the separation stays: `totals` is counted
   * over every invoice in scope by `summariseAllInvoices`, through this same
   * `countByStatus` rule, so the tiles can never drift back to describing
   * whatever subset the grid happens to be holding.
   */

  const cards: KpiCard[] = ALL_STATUSES.map((s) => ({
    key: s,
    label: STATUS_LABEL[s],
    count: counts[s],
    icon: STATUS_ICON[s],
    tone: (statusTone(s) === 'neutral' ? 'default' : statusTone(s)) as KpiCard['tone'],
  }));


  const receivable = totals?.receivablePaise ?? rows
    .filter((r) => r.lifecycle !== 'cancelled')
    .reduce((n, r) => n + r.duePaise, 0);
  const overdueValue = totals?.overduePaise ?? rows
    .filter((r) => r.status === 'overdue')
    .reduce((n, r) => n + r.duePaise, 0);

  const columns: Column<InvoiceRow>[] = [
    { key: 'invoiceNo', header: 'Invoice #', width: '12rem',
      render: (r) => (
        <Link href={`/invoices/${r.id}`} className="font-mono text-xs font-semibold text-brand hover:underline">
          {r.invoiceNo}
        </Link>
      ),
      sortValue: (r) => r.invoiceNo },
    { key: 'orderNo', header: 'Order #',
      render: (r) => r.orderNo
        ? (r.salesOrderId
          ? <Link href={`/sales/orders/${r.salesOrderId}`} className="font-mono text-xs text-muted-foreground hover:text-brand hover:underline">{r.orderNo}</Link>
          : <span className="font-mono text-xs text-muted-foreground">{r.orderNo}</span>)
        : <span className="text-muted-foreground">Direct</span>,
      sortValue: (r) => r.orderNo, optional: true },
    { key: 'customerName', header: 'Customer Name',
      render: (r) => (
        <div className="flex items-start gap-2">
          <div className="min-w-0">
          <p className="truncate font-medium"><CustomerLink id={r.partyId}>{r.customerName}</CustomerLink></p>
          {r.organizationName && (
            <p className="truncate text-xs text-muted-foreground">{r.organizationName}</p>
          )}
          </div>
          <AttachmentBadge count={r.attachmentCount} />
        </div>
      ),
      sortValue: (r) => r.customerName },
    { key: 'gstin', header: 'GST No',
      render: (r) => <span className="font-mono text-xs">{r.gstin ?? '-'}</span>,
      sortValue: (r) => r.gstin, optional: true },
    { key: 'stateId', header: 'State', render: (r) => r.stateId ?? '-',
      sortValue: (r) => r.stateId, optional: true },
    { key: 'invoiceDate', header: 'Date', render: (r) => fmtDate(r.invoiceDate),
      sortValue: (r) => r.invoiceDate.getTime() },
    { key: 'dueDate', header: 'Due',
      render: (r) => {
        // A draft is not with the customer yet - never "overdue" (Impeccable review, 13 Oct 2026).
        if (r.status === 'paid' || r.status === 'cancelled' || r.status === 'draft') {
          return <span className="text-xs text-muted-foreground">{fmtDate(r.dueDate)}</span>;
        }
        const d = daysOverdue(r);
        return (
          <div>
            <p className={`text-xs ${d > 0 ? 'font-medium text-danger' : ''}`}>
              {fmtDate(r.dueDate)}
            </p>
            <p className="text-xs text-muted-foreground">
              {d > 0 ? `${d}d overdue · ${ageBucket(r)}` : d === 0 ? 'due today' : `in ${-d}d`}
            </p>
          </div>
        );
      },
      sortValue: (r) => r.dueDate.getTime() },
    // Optional so Status is not cut off under the Actions column at 1440px.
    { key: 'taxableBase', header: 'Basic Amount', align: 'end', optional: true,
      render: (r) => (
        <span className="font-mono text-xs tabular-nums">{formatCurrency(r.taxableBasePaise)}</span>
      ),
      sortValue: (r) => r.taxableBasePaise },
    { key: 'cgst', header: 'CGST', align: 'end',
      render: (r) => <span className="font-mono text-xs tabular-nums">{formatCurrency(r.cgstPaise)}</span>,
      sortValue: (r) => r.cgstPaise, optional: true },
    { key: 'sgst', header: 'SGST', align: 'end',
      render: (r) => <span className="font-mono text-xs tabular-nums">{formatCurrency(r.sgstPaise)}</span>,
      sortValue: (r) => r.sgstPaise, optional: true },
    { key: 'igst', header: 'IGST', align: 'end',
      render: (r) => <span className="font-mono text-xs tabular-nums">{formatCurrency(r.igstPaise)}</span>,
      sortValue: (r) => r.igstPaise, optional: true },
    { key: 'grandTotal', header: 'Total', align: 'end',
      render: (r) => (
        <span className="font-mono text-xs font-semibold tabular-nums">
          {formatCurrency(r.grandTotalPaise)}
        </span>
      ),
      sortValue: (r) => r.grandTotalPaise },
    { key: 'due', header: 'Balance', align: 'end',
      render: (r) => (
        <span className={`font-mono text-xs tabular-nums ${r.duePaise > 0 && r.status !== 'draft' ? 'font-semibold text-danger' : 'text-muted-foreground'}`}>
          {formatCurrency(r.duePaise)}
        </span>
      ),
      sortValue: (r) => r.duePaise },
    { key: 'status', header: 'Status',
      render: (r) => (
        <span className="inline-flex flex-col items-start gap-0.5">
          <StatusBadge status={r.status} label={STATUS_LABEL[r.status]} icon={STATUS_ICON[r.status]} />
          {r.awaitingApproval && <Badge tone="warning">Awaiting approval</Badge>}
        </span>
      ),
      sortValue: (r) => STATUS_LABEL[r.status] },
    { key: 'salespersonName', header: 'Salesperson', render: (r) => r.salespersonName ?? '-',
      sortValue: (r) => r.salespersonName, optional: true },
  ];

  const run = async (fn: () => Promise<{ error?: string; message?: string }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.error) await ask.error(r.error);
    // A held action ("Sent for approval…") says so before the page reloads.
    else { sayIfHeld(r); window.location.reload(); }
  };

  return (
    <div>
      <PageHeader
        badge="IN"
        title="Invoices"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {(totals?.total ?? rows.length).toLocaleString('en-IN')} raised
              {totals && totals.total > rows.length
                && <span className="text-muted-foreground"> ({rows.length} shown)</span>}
            </span>
            <span className="text-border-strong">·</span>
            <span className={receivable > 0 ? 'font-semibold text-foreground' : ''}>
              {formatCurrencyCompact(receivable)} receivable
            </span>
            {overdueValue > 0 && (
              <>
                <span className="text-border-strong">·</span>
                <span className="font-medium text-danger">
                  {formatCurrencyCompact(overdueValue)} overdue
                </span>
              </>
            )}
          </span>
        }
        actions={
          <>
            <Button
              variant="outline" icon="rotate-ccw"
              disabled={!canCreate || orders.length === 0}
              title={
                orders.length === 0
                  ? 'No orders waiting to be invoiced'
                  : scopeIsAll ? 'Select a single store first' : undefined
              }
              onClick={() => setConvertOpen(true)}
            >
              Convert {orders.length > 0 && `(${orders.length})`}
            </Button>
            {/*
              One bill for a whole site, where Convert next door is one bill per
              order. Shown alongside rather than replacing it: a shop that sells
              by the order still wants the simple path, and a job that ran for
              four weeks across three challans cannot use it at all.
            */}
            <Button
              variant="outline" icon="file-text"
              disabled={!canCreate || billable.length === 0}
              title={
                billable.length === 0
                  ? 'No dispatched work waiting to be billed'
                  : scopeIsAll ? 'Select a single store first' : undefined
              }
              onClick={() => setBillOpen(true)}
            >
              Bill a site {billable.length > 0 && `(${billable.length})`}
            </Button>
            <Button
              variant="primary" icon="plus" disabled={!canCreate}
              title={scopeIsAll ? 'Select a single store first' : 'Counter sale - no order needed'}
              onClick={() => setCreateOpen(true)}
            >
              Invoice
            </Button>
          </>
        }
      />

      <FilterBar
        searchPlaceholder="Search invoice, customer, phone, GSTIN…"
        dates={{ defaultPreset: 'all', label: 'Dated', activeLabel: rangeLabel }}
        extra={<ViewToggle view={view} basePath="/invoices" />}
        shown={paging.total}
        clearKeys={['card']}
        exportScreen={canExport ? 'invoices' : null}
        views={views}
      />

      {olderUnpaid > 0 && (
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <Icon name="alert-triangle" className="h-4 w-4 shrink-0 text-warning" />
          <span>
            <strong>{olderUnpaid.toLocaleString('en-IN')}</strong> unpaid invoice{olderUnpaid === 1 ? ' is' : 's are'} dated before this range.
          </span>
          <button type="button" onClick={() => list.set({ range: 'all' })} className="font-medium text-brand hover:underline">
            Show all dates
          </button>
        </p>
      )}

      <KpiStrip cards={cards} activeKey={filter} onSelect={setFilter} columns={8} />

      <DataGrid
        rows={rows}
        server={paging}
        columns={columns}
        rowKey={(r) => r.id}
        /* WhatsApp carries the reminder - the one thing this list is chased for. */
        quickActions={(r) => [
          ...contactActions(
            r.phone,
            `Hello ${r.customerName},

Invoice ${r.invoiceNo} for ${formatCurrency(r.grandTotalPaise)}.`
              + (r.duePaise > 0 ? ` ${formatCurrency(r.duePaise)} is outstanding.` : ' It is fully paid - thank you.'),
          ).map((q) => (q.tone !== 'whatsapp' ? q : {
            ...q,
            label: r.duePaise > 0 ? 'Send reminder on WhatsApp' : 'WhatsApp',
            // An issued invoice goes with its link; a draft has none to send.
            ...(r.lifecycle !== 'draft' ? { href: undefined, onClick: () => { void whatsappInvoice(r); } } : {}),
          })),
          ...(r.lifecycle === 'sent' && r.duePaise > 0
            ? [{ label: 'Record payment', icon: 'credit-card' as const, tone: 'brand' as const, onClick: () => setPayTarget(r) }]
            : []),
        ]}
        emptyIcon="receipt"
        emptyMessage={
          filter
            ? 'No invoices with this status in this range.'
            : view === 'history'
              ? 'No closed invoices.'
              : 'No invoices match.'
        }
        emptyHint={
          filter
            ? 'Clear the card to see every invoice.'
            : view === 'history'
              ? 'Closing an invoice moves it here. It stays searchable and can be reopened.'
              : orders.length > 0
                ? `${orders.length} sales order${orders.length === 1 ? '' : 's'} are waiting - press Convert.`
                : 'Raise a sales order first, then convert it here.'
        }
        /* Inherits the shared sizes - this list holds every invoice now. */
        mobileCard={(r) => (
          <Link href={`/invoices/${r.id}`} className="block">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-brand">{r.invoiceNo}</span>
              <StatusBadge status={r.status} label={STATUS_LABEL[r.status]} />
            </div>
            <p className="mt-1 truncate text-sm font-medium">{r.customerName}</p>
            <p className="mt-0.5 flex justify-between text-xs text-muted-foreground">
              <span>{fmtDate(r.invoiceDate)}</span>
              <span className="font-mono tabular-nums">
                {formatCurrency(r.grandTotalPaise)}
                {r.duePaise > 0 && r.status !== 'draft' && <span className="ms-1.5 font-semibold text-danger">· {formatCurrency(r.duePaise)} due</span>}
              </span>
            </p>
          </Link>
        )}
        pageSummary={(pageRows) => (
          <>
            <span className="text-muted-foreground">
              Count: <strong className="text-foreground">{pageRows.length}</strong>
            </span>
            <span className="text-muted-foreground">
              Page Total:{' '}
              <strong className="font-mono text-foreground">
                {formatCurrency(pageRows.reduce((n, r) => n + r.grandTotalPaise, 0))}
              </strong>
            </span>
            <span className="text-muted-foreground">
              Page Balance:{' '}
              <strong className="font-mono text-danger">
                {formatCurrency(pageRows.reduce((n, r) => n + r.duePaise, 0))}
              </strong>
            </span>
          </>
        )}
        actions={[
          {
            label: 'View / Print', icon: 'eye',
            onSelect: (r) => { window.location.href = `/invoices/${r.id}`; },
          },
          {
            label: 'Issue invoice', icon: 'send', separatorBefore: true,
            enabled: (r) => r.lifecycle === 'draft',
            onSelect: (r) => run(() => issue(r.id)),
          },
          {
            label: 'Record payment', icon: 'credit-card', tone: 'success',
            enabled: (r) => r.lifecycle === 'sent' && r.duePaise > 0,
            onSelect: (r) => setPayTarget(r),
          },
          {
            label: 'View Customer', icon: 'users',
            enabled: (r) => !!r.partyId,
            onSelect: (r) => { window.location.href = `/customers?open=${r.partyId}`; },
          },
          {
            label: 'Send WhatsApp', icon: 'whatsapp', iconTone: 'success', separatorBefore: true,
            enabled: (r) => r.lifecycle !== 'draft',
            onSelect: (r) => { void whatsappInvoice(r); },
          },
          {
            label: 'Copy invoice link', icon: 'copy',
            enabled: (r) => r.lifecycle !== 'draft',
            onSelect: async (r) => {
              const res = await getInvoiceShareLink(r.id);
              if (res.error || !res.url) return toast(res.error ?? 'Could not create a link.');
              const copied = await navigator.clipboard.writeText(res.url).then(() => true, () => false);
              toast(copied ? `Link copied - anyone with it can view the invoice: ${res.url}` : res.url);
            },
          },
          {
            label: 'Download PDF', icon: 'printer',
            onSelect: (r) => window.open(`/invoices/${r.id}?print=1`, '_blank'),
          },
          {
            label: 'Cancel invoice', icon: 'ban', tone: 'danger', separatorBefore: true,
            enabled: (r) => r.lifecycle !== 'cancelled' && r.amountPaidPaise === 0 && canApprove,
            onSelect: async (r) => {
              const reason = await ask.text({
                tone: 'danger', icon: 'ban',
                title: `Cancel ${r.invoiceNo}?`,
                message: 'The invoice stays on record, marked cancelled. Your reason goes on the audit trail.',
                label: 'Why is it being cancelled?',
                multiline: true, required: true,
                confirmLabel: 'Cancel invoice', cancelLabel: 'Keep it',
              });
              if (reason === null) return;
              run(() => cancel(r.id, reason));
            },
          },
          {
            label: view === 'history' ? 'Reopen Invoice' : 'Close Invoice',
            icon: view === 'history' ? 'rotate-ccw' : 'lock',
            onSelect: async (r) => {
              const res = view === 'history' ? await reopenInvoice(r.id) : await closeInvoice(r.id);
              if (res.error) await ask.error(res.error);
              else window.location.reload();
            },
          },
          {
            label: 'Delete Invoice', icon: 'trash', tone: 'danger', separatorBefore: true,
            // Only an unissued draft with no money against it. Once issued, the
            // invoice is in the customer's hands - cancelling leaves a record,
            // deleting leaves a hole in the number sequence.
            enabled: (r) => r.lifecycle === 'draft' && r.amountPaidPaise === 0,
            onSelect: async (r) => {
              if (!(await ask.confirm({
                tone: 'danger', icon: 'trash',
                title: `Delete draft ${r.invoiceNo}?`,
                message: 'This draft was never issued, so it can be removed. It cannot be brought back.',
                confirmLabel: 'Delete draft', cancelLabel: 'Keep it',
              }))) return;
              const res = await removeInvoice(r.id);
              if (res.error) await ask.error(res.error);
              else window.location.reload();
            },
          },
        ]}
      />

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground shadow-card">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <span>
          An invoice starts as a <strong>draft</strong> and can still be
          corrected. Once <strong>issued</strong> it is a document in the
          customer&rsquo;s hands, so it can no longer be edited - the remedy for
          a mistake is a credit note. <strong>Overdue</strong> and{' '}
          <strong>paid</strong> are worked out from the due date and the money
          received, never set by hand.
        </span>
      </p>

      {convertOpen && (
        <ConvertOrder orders={orders} onClose={() => setConvertOpen(false)} />
      )}

      {billOpen && (
        <BillSite customers={billable} onClose={() => setBillOpen(false)} />
      )}

      {createOpen && (
        <WithFormOptions need={['catalogue']} onClose={() => setCreateOpen(false)}>
          {(o) => (
            <InvoiceForm
              parties={o.buyers}
              products={o.catalogue}
              storeState={storeState}
              onClose={() => setCreateOpen(false)}
            />
          )}
        </WithFormOptions>
      )}

      {payTarget && (
        <PaymentDialog
          invoiceId={payTarget.id}
          invoiceNo={payTarget.invoiceNo}
          customerName={payTarget.customerName}
          duePaise={payTarget.duePaise}
          onClose={() => setPayTarget(null)}
        />
      )}

      {busy && (
        <div role="status" aria-label="Loading" className="fixed inset-0 z-[300] grid place-items-center bg-navy/20">
          <span className="rounded-lg bg-card px-4 py-2 text-sm shadow-overlay">Working…</span>
        </div>
      )}
    </div>
  );
}
