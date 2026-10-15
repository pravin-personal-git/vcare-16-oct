'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge, Card } from '@/components/ui/Layout';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { useListParams } from '@/components/ui/useListParams';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
// From lib, not server/receipts - that module is server-only and importing a
// runtime value from it pulls the database client into this bundle.
import { METHOD_LABEL, type ReceiptRow } from '@/lib/receipt';
import { PayChooser } from './PayChooser';
import { markReceiptFailed } from './actions';

/**
 * Every rupee that has come in, and where it went.
 *
 * The column that matters and does not exist on an invoice-centric payment
 * screen is **On account**: money received and not yet applied. It is the one
 * figure that explains why a customer thinks they have paid and the system
 * thinks they have not.
 */

const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });


export function ReceiptsClient({
  rows, paging, totals, f, rangeLabel, olderOnAccount, canExport, views, canRecord, scopeIsAll, openPay = false,
}: {
  /** Open "Who paid? / What is it for?" on arrival (`/receipts?pay=1`, G4). */
  openPay?: boolean;
  /** The receipt-date range in force, in words. */
  rangeLabel: string;
  /** Receipts dated before the range that still hold money on account. */
  olderOnAccount: number;
  canExport: boolean;
  views: FilterBarViews;
  /** One page, filtered and sorted on the server. */
  rows: ReceiptRow[];
  paging: ServerPaging;
  /** Counted over every receipt in scope. */
  totals: { count: number; liveCount: number; received: number; onAccount: number; failed: number; failedCount: number; unappliedCount: number };
  /** all | unapplied | failed | received - from ?f=. */
  f: string;
  canRecord: boolean;
  scopeIsAll: boolean;
}) {
  const router = useRouter();
  const list = useListParams();
  const kpi = f === 'all' ? null : f;
  const setKpi = (k: string | null) => list.set({ f: k && k !== 'all' ? k : null });
  const [recording, setRecording] = useState(false);
  // `?pay=1` opens the chooser once the page is in the browser - opening it in
  // the server render made a hydration mismatch that production does not
  // recover from (G4 live check, 11 Oct 2026).
  useEffect(() => { if (openPay && canRecord) setRecording(true); }, [openPay, canRecord]);
  const [reversing, setReversing] = useState<ReceiptRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);


  const cards: KpiCard[] = [
    { key: 'all', label: 'Receipts', count: totals.count, icon: 'credit-card' },
    {
      key: 'received', label: 'Received', count: formatCurrencyCompact(totals.received),
      subLabel: `${totals.liveCount} cleared`, icon: 'check', tone: 'success',
    },
    {
      key: 'unapplied', label: 'On account', count: formatCurrencyCompact(totals.onAccount),
      subLabel: `${totals.unappliedCount} receipt${totals.unappliedCount === 1 ? '' : 's'}`,
      icon: 'info', tone: totals.onAccount > 0 ? 'info' : 'default',
    },
    {
      key: 'failed', label: 'Did not clear', count: totals.failedCount,
      subLabel: formatCurrencyCompact(totals.failed), icon: 'alert-triangle',
      tone: totals.failedCount > 0 ? 'danger' : 'default',
    },
  ];


  const columns: Column<ReceiptRow>[] = [
    {
      key: 'receiptNo', header: 'Receipt #', sortValue: (r) => r.receiptNo,
      render: (r) => (
        <Link href={`/receipts/${r.id}`} className="font-mono text-xs font-medium text-brand hover:underline">{r.receiptNo}</Link>
      ),
    },
    {
      key: 'party', header: 'From', sortValue: (r) => r.partyName,
      render: (r) => (
        <Link href={`/customers/${r.partyId}`} className="font-medium text-brand hover:underline">
          {r.partyName}
        </Link>
      ),
    },
    {
      key: 'date', header: 'Received', sortValue: (r) => r.receivedAt.getTime(),
      render: (r) => <span className="text-xs">{fmtDate(r.receivedAt)}</span>,
    },
    {
      key: 'method', header: 'Method', sortValue: (r) => METHOD_LABEL[r.method] ?? r.method,
      render: (r) => (
        <span className="text-xs">
          {METHOD_LABEL[r.method] ?? r.method}
          {r.reference && <span className="ms-1 text-muted-foreground">· {r.reference}</span>}
        </span>
      ),
    },
    {
      key: 'amount', header: 'Amount', align: 'end', sortValue: (r) => r.amountPaise,
      render: (r) => <span className="tabular-nums font-medium">{formatCurrency(r.amountPaise)}</span>,
    },
    {
      key: 'applied', header: 'Applied to', sortValue: (r) => r.appliedTo.length,
      render: (r) => (
        r.appliedTo.length === 0
          ? <span className="text-xs text-muted-foreground">-</span>
          : (
            <span className="flex flex-wrap gap-1">
              {r.appliedTo.map((a) => (
                <Link
                  key={a.invoiceId}
                  href={`/invoices/${a.invoiceId}`}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-brand/10 hover:text-brand"
                  title={formatCurrency(a.amountPaise)}
                >
                  {a.invoiceNo}
                </Link>
              ))}
            </span>
          )
      ),
    },
    {
      key: 'onAccount', header: 'On account', align: 'end',
      sortValue: (r) => r.unallocatedPaise,
      render: (r) => (
        r.status !== 'received'
          ? <span className="text-xs text-muted-foreground">-</span>
          : r.unallocatedPaise > 0
            ? <span className="tabular-nums font-medium text-info">{formatCurrency(r.unallocatedPaise)}</span>
            : <span className="text-xs text-muted-foreground">-</span>
      ),
    },
    {
      key: 'status', header: 'Status', sortValue: (r) => r.status,
      render: (r) => {
        if (r.status !== 'received') {
          return <Badge tone="danger">{r.status === 'bounced' ? 'Bounced' : 'Reversed'}</Badge>;
        }
        // Three states, not two. A pure advance had nothing applied at all and
        // reading "Part applied" against an empty Applied-to column is simply
        // untrue - which is what this said until somebody looked at it.
        if (r.allocatedPaise === 0) return <Badge tone="info">On account</Badge>;
        if (r.unallocatedPaise > 0) return <Badge tone="info">Part applied</Badge>;
        return <Badge tone="success">Applied</Badge>;
      },
    },
    {
      key: 'note', header: 'Note', optional: true, sortValue: (r) => r.note ?? '',
      render: (r) => <span className="text-xs text-muted-foreground">{r.note ?? '-'}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        badge="RCP"
        title="Receipts"
        subtitle={
          `${totals.count.toLocaleString('en-IN')} in ${rangeLabel} · ${formatCurrency(totals.received)} received`
          + (totals.onAccount > 0 ? ` · ${formatCurrency(totals.onAccount)} on account` : '')
        }
        actions={
          <Button
            variant="primary"
            icon="plus"
            disabled={!canRecord}
            title={
              scopeIsAll ? 'Select a single store first'
                : !canRecord ? 'You do not have permission to record receipts' : undefined
            }
            onClick={() => setRecording(true)}
          >
            Record payment
          </Button>
        }
      />

      {flash && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-success/30 bg-success/[0.06] px-3 py-2 text-xs">
          <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <span className="flex-1">{flash}</span>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss">
            <Icon name="x" className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      )}

      <FilterBar
        searchPlaceholder="Receipt no, customer, reference, invoice no, note…"
        dates={{ defaultPreset: 'all', label: 'Received', activeLabel: rangeLabel }}
        shown={paging.total}
        clearKeys={['f']}
        exportScreen={canExport ? 'receipts' : null}
        views={views}
      />

      {olderOnAccount > 0 && (
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <Icon name="alert-triangle" className="h-4 w-4 shrink-0 text-warning" />
          <span><strong>{olderOnAccount.toLocaleString('en-IN')}</strong> receipt{olderOnAccount === 1 ? '' : 's'} dated before this range still {olderOnAccount === 1 ? 'holds' : 'hold'} money on account.</span>
          <button type="button" onClick={() => list.set({ range: 'all', f: 'unapplied' })} className="font-medium text-brand hover:underline">Show them</button>
        </p>
      )}

      <div className="mb-3">
        <KpiStrip cards={cards} activeKey={kpi} onSelect={setKpi} columns={4} />
      </div>

      {totals.onAccount > 0 && (
        <Card className="mb-3 flex items-start gap-2.5 border-info/30 bg-info/[0.06] px-3 py-2.5">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <p className="text-xs leading-relaxed">
            <strong className="text-info">{formatCurrency(totals.onAccount)} is on account</strong>
            {' - '}
            received, counted in the customer&rsquo;s balance, but not set against any
            invoice. It is not lost, but nobody is chasing it either. Apply it before
            sending a reminder to anyone on this list.
          </p>
        </Card>
      )}

      <DataGrid
        rows={rows}
        server={paging}
        columns={columns}
        rowKey={(r) => r.id}
        emptyIcon="credit-card"
        emptyMessage={totals.count === 0 && f === 'all' ? 'No receipts in this range' : 'No receipts match'}
        emptyHint="Try a wider date range or Clear all filters. Record one when money arrives - from a customer, not against an invoice. Where it goes is a separate decision you can change later."
        mobileCard={(r) => (
          <Link href={`/customers/${r.partyId}`} className="block">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/receipts/${r.id}`} className="font-mono text-xs font-semibold text-brand hover:underline">{r.receiptNo}</Link>
              <span className="font-mono text-sm font-semibold tabular-nums">{formatCurrency(r.amountPaise)}</span>
            </div>
            <p className="mt-1 truncate text-sm font-medium">{r.partyName}</p>
            <p className="text-xs text-muted-foreground">
              {fmtDate(r.receivedAt)} · {METHOD_LABEL[r.method as keyof typeof METHOD_LABEL] ?? r.method}
              {r.status !== 'received' ? <span className="ms-1 font-semibold text-danger">· did not clear</span>
                : r.unallocatedPaise > 0 ? <span className="ms-1 text-info">· {formatCurrency(r.unallocatedPaise)} on account</span> : null}
            </p>
          </Link>
        )}
        actions={[
          {
            label: 'Open customer',
            icon: 'users',
            onSelect: (r: ReceiptRow) => router.push(`/customers/${r.partyId}`),
          },
          {
            label: 'Mark bounced',
            icon: 'alert-triangle',
            tone: 'danger' as const,
            enabled: (r: ReceiptRow) => canRecord && r.status === 'received',
            onSelect: (r: ReceiptRow) => setReversing(r),
          },
        ]}
        pageSummary={(page) => (
          <>
            <span className="text-muted-foreground">
              Page total <strong className="tabular-nums text-foreground">
                {formatCurrency(page.reduce((n, r) => n + r.amountPaise, 0))}
              </strong>
            </span>
            <span className="text-muted-foreground">
              On account <strong className="tabular-nums text-info">
                {formatCurrency(page.reduce((n, r) => n + (r.status === 'received' ? r.unallocatedPaise : 0), 0))}
              </strong>
            </span>
          </>
        )}
      />

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        A receipt is money arriving from a customer. Which invoices it settles is
        recorded separately and can be changed without altering what the bank saw.
        A receipt that does not clear is marked, never deleted - the invoices it was
        settling reopen on their own.
      </p>

      {recording && (
        // One way in (G4, 11 Oct 2026): the same "What is this payment for?" as
        // the customer page - an invoice payment is typed on the invoice.
        <PayChooser
          onClose={() => setRecording(false)}
          onDone={(msg) => { setRecording(false); setFlash(msg); router.refresh(); }}
        />
      )}

      {reversing && (
        <ReverseDialog
          receipt={reversing}
          onClose={() => setReversing(null)}
          onDone={(msg) => { setReversing(null); setFlash(msg); router.refresh(); }}
        />
      )}
    </>
  );
}

function ReverseDialog({
  receipt, onClose, onDone,
}: {
  receipt: ReceiptRow;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<'bounced' | 'reversed'>('bounced');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const go = () => {
    setError(null);
    start(async () => {
      const r = await markReceiptFailed(receipt.id, status, reason);
      if (r.error) return setError(r.error);
      onDone(r.message ?? 'Done.');
    });
  };

  return (
    <Modal
      open
      title={`Mark ${receipt.receiptNo} as not cleared`}
      subtitle={`${formatCurrency(receipt.amountPaise)} from ${receipt.partyName}`}
      icon="alert-triangle"
      tone="danger"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger" icon="alert-triangle"
            disabled={!reason.trim() || pending} loading={pending} onClick={go}
          >
            Mark {status}
          </Button>
        </div>
      }
    >
      {error && (
        <p className="mb-3 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2 text-xs text-on-tint-danger">
          {error}
        </p>
      )}

      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        The receipt stays on the record - it is marked, not removed. Deleting it
        would make the money look as though it never arrived, and the bank charge
        that follows a bounce has to hang off something.
      </p>

      {receipt.appliedTo.length > 0 && (
        <div className="mb-3 rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2">
          <p className="text-xs font-medium">
            {receipt.appliedTo.length} invoice{receipt.appliedTo.length === 1 ? '' : 's'} will
            become outstanding again:
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {receipt.appliedTo.map((a) => a.invoiceNo).join(', ')}
          </p>
        </div>
      )}

      <div className="mb-3 flex gap-2">
        {(['bounced', 'reversed'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`flex-1 rounded-lg border px-3 py-2 text-start transition ${
              status === s ? 'border-brand bg-brand/10' : 'border-border hover:bg-muted'
            }`}
          >
            <span className="block text-sm font-medium capitalize">{s}</span>
            <span className="block text-xs text-muted-foreground">
              {s === 'bounced' ? 'The bank returned it unpaid' : 'Recorded in error'}
            </span>
          </button>
        ))}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium">Why <span className="text-danger">*</span></span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Cheque returned - insufficient funds"
          className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-sm outline-none focus:border-brand"
        />
      </label>
    </Modal>
  );
}
