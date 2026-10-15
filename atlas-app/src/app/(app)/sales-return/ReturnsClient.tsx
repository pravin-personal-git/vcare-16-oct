'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import { useDebouncedSearch, useListParams } from '@/components/ui/useListParams';
import { DateRangeSelect } from '@/components/ui/DateRangeSelect';
import { useState, useTransition } from 'react';
import { ServerExportButton } from '@/components/ui/ServerExportButton';
import type { ReturnTotals } from '@/server/returns-list';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge, Card } from '@/components/ui/Layout';
import { Toolbar, FilterChip, FilterSelect } from '@/components/ui/Toolbar';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import { RETURN_REASON_LABEL } from '@/lib/returns';
import { NewReturnDialog, type InvoiceOption } from './NewReturnDialog';
import { creditReturn, markReceived, voidReturn } from './actions';

/**
 * Goods that came back.
 *
 * The column that carries the module is **Credit**, because the question this
 * screen exists to answer is not "what came back" - the warehouse knows that -
 * but *"who is still owed money for goods we already have back on the shelf"*.
 * A return that has been received and never credited is the customer's money
 * sitting in your stock, and nothing else in the product surfaces it.
 */

export interface ReturnRowVM {
  id: string;
  returnNo: string;
  invoiceId: string;
  invoiceNo: string;
  partyId?: string | null;
  customerName: string;
  returnedAt: Date | string;
  lifecycle: string;
  reason: string;
  lineCount: number;
  totalQty: number;
  valuePaise: number;
  restockQty: number;
  damagedQty: number;
  creditNotes: { id: string; creditNoteNo: string; lifecycle: string; grandTotalPaise: number }[];
  creditedPaise: number;
}

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

type Filter = 'all' | 'draft' | 'uncredited' | 'cancelled' | 'damaged';

/** Received, not cancelled, and no credit note standing against it. */
const isUncredited = (r: ReturnRowVM) =>
  r.lifecycle === 'received' && !r.creditNotes.some((c) => c.lifecycle === 'issued');

export function ReturnsClient({
  rows, invoices, canEdit, canCredit, scopeIsAll, paging, totals, customers, filter, customer,
}: {
  /** One server-side page (F1b): searched, filtered and sorted on the server. */
  rows: ReturnRowVM[];
  paging: ServerPaging;
  /** Counted over every return. */
  totals: ReturnTotals;
  customers: string[];
  filter: string;
  customer: string;
  invoices: InvoiceOption[];
  canEdit: boolean;
  canCredit: boolean;
  scopeIsAll: boolean;
}) {
  const router = useRouter();
  // Every filter lives in the address and runs on the server (F1b server paging).
  const list = useListParams();
  // The date filter (9 Oct 2026) - ?range= &from= &to=, read by the server list.
  const rangeOn = Boolean(list.get('range') || list.get('from') || list.get('to'));
  const { value: search, setValue: setSearch } = useDebouncedSearch('q');
  const setFilter = (f: Filter) => list.set({ card: f === 'all' ? null : f });
  const setCustomer = (v: string) => list.set({ cust: v || null });
  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState<ReturnRowVM | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  // Totals come from the server, over every return.

  const cards: KpiCard[] = [
    { key: 'all', label: 'Returns', count: totals.all, icon: 'rotate-ccw' },
    {
      key: 'draft', label: 'Awaiting goods', count: totals.drafts,
      subLabel: 'raised, not received', icon: 'clock',
      tone: totals.drafts > 0 ? 'warning' : 'default',
    },
    {
      key: 'uncredited', label: 'Not credited', count: formatCurrencyCompact(totals.uncreditedValue),
      subLabel: `${totals.uncreditedCount} return${totals.uncreditedCount === 1 ? '' : 's'}`,
      icon: 'alert-triangle', tone: totals.uncreditedValue > 0 ? 'danger' : 'success',
    },
    {
      key: 'damaged', label: 'Not resellable', count: totals.damaged,
      subLabel: 'damaged or scrapped', icon: 'x',
      tone: totals.damaged > 0 ? 'warning' : 'default',
    },
  ];

  const run = (fn: () => Promise<{ error?: string; message?: string }>) => {
    setError(null);
    setFlash(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else { setFlash(res.message ?? 'Done.'); router.refresh(); }
    });
  };

  const columns: Column<ReturnRowVM>[] = [
    {
      key: 'returnNo', header: 'Return #', sortValue: (r) => r.returnNo,
      render: (r) => (
        <Link href={`/sales-return/${r.id}`} className="font-mono text-xs font-medium text-brand hover:underline">
          {r.returnNo}
        </Link>
      ),
    },
    {
      key: 'invoice', header: 'Against', sortValue: (r) => r.invoiceNo,
      render: (r) => (
        <Link href={`/invoices/${r.invoiceId}`} className="font-mono text-xs hover:text-brand hover:underline">
          {r.invoiceNo}
        </Link>
      ),
    },
    {
      key: 'customer', header: 'Customer', sortValue: (r) => r.customerName,
      render: (r) => <CustomerLink id={r.partyId} className="font-medium">{r.customerName}</CustomerLink>,
    },
    {
      key: 'date', header: 'Returned', sortValue: (r) => new Date(r.returnedAt).getTime(),
      render: (r) => <span className="text-xs">{fmtDate(r.returnedAt)}</span>,
    },
    {
      key: 'items', header: 'Items', align: 'end', sortValue: (r) => r.totalQty,
      render: (r) => (
        <span className="text-xs tabular-nums">
          {r.totalQty}
          <span className="ms-1 text-muted-foreground">
            in {r.lineCount} line{r.lineCount === 1 ? '' : 's'}
          </span>
        </span>
      ),
    },
    {
      key: 'disposition', header: 'Condition', sortValue: (r) => r.damagedQty,
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.restockQty > 0 && <Badge tone="success">{r.restockQty} restocked</Badge>}
          {r.damagedQty > 0 && <Badge tone="warning">{r.damagedQty} not resellable</Badge>}
        </span>
      ),
    },
    {
      key: 'value', header: 'Value', align: 'end', sortValue: (r) => r.valuePaise,
      render: (r) => (
        <span className="tabular-nums font-medium">{formatCurrency(r.valuePaise)}</span>
      ),
    },
    {
      key: 'credit', header: 'Credit', sortValue: (r) => r.creditedPaise,
      render: (r) => {
        if (r.lifecycle === 'cancelled') return <span className="text-xs text-muted-foreground">-</span>;
        const issued = r.creditNotes.filter((c) => c.lifecycle === 'issued');
        if (issued.length > 0) {
          return (
            <span className="flex flex-wrap gap-1">
              {issued.map((c) => (
                <Link
                  key={c.id}
                  href={`/credit-notes/${c.id}`}
                  className="rounded bg-success/10 px-1.5 py-0.5 font-mono text-xs text-on-tint-success hover:bg-success/20"
                  title={formatCurrency(c.grandTotalPaise)}
                >
                  {c.creditNoteNo}
                </Link>
              ))}
            </span>
          );
        }
        return r.lifecycle === 'received'
          ? <Badge tone="danger">Owed</Badge>
          : <span className="text-xs text-muted-foreground">-</span>;
      },
    },
    {
      key: 'status', header: 'Status', sortValue: (r) => r.lifecycle,
      render: (r) => {
        if (r.lifecycle === 'cancelled') return <Badge tone="danger">Cancelled</Badge>;
        if (r.lifecycle === 'draft') return <Badge tone="warning">Awaiting goods</Badge>;
        return <Badge tone="success">Received</Badge>;
      },
    },
    {
      key: 'reason', header: 'Reason', optional: true, sortValue: (r) => r.reason,
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {RETURN_REASON_LABEL[r.reason] ?? r.reason}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        badge="SR"
        title="Sales Return"
        subtitle={
          `${totals.liveCount} return${totals.liveCount === 1 ? '' : 's'} · ${formatCurrency(totals.value)} of goods back`
          + (totals.uncreditedValue > 0 ? ` · ${formatCurrency(totals.uncreditedValue)} not yet credited` : '')
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
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2 text-xs text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1 whitespace-pre-line">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <Toolbar
        primary={
          <Button
            variant="primary"
            icon="plus"
            disabled={!canEdit}
            title={
              scopeIsAll ? 'Select a single store first'
                : !canEdit ? 'You do not have permission to record returns' : undefined
            }
            onClick={() => setCreating(true)}
          >
            New return
          </Button>
        }
        filters={
          <>
            {/* All / Awaiting goods / Not credited are the cards below - not
                repeated here (4 Oct 2026). Cancelled has no card, so it stays. */}
            <FilterChip
              label="Cancelled" count={totals.cancelled} icon="x"
              active={filter === 'cancelled'} onClick={() => setFilter(filter === 'cancelled' ? 'all' : 'cancelled')}
            />
            <FilterSelect id="ret-customer" label="Customer" value={customer} onChange={setCustomer}
              options={customers.map((v) => ({ value: v, label: v }))} />
            <DateRangeSelect label="Returned" />
            {rangeOn && (
              <button type="button" className="text-xs text-brand hover:underline"
                onClick={() => list.set({ range: null, from: null, to: null })}>All dates</button>
            )}
          </>
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search return, invoice, customer…"
        end={<ServerExportButton screen="salesReturns" />}
      />

      <div className="mb-3">
        <KpiStrip cards={cards} activeKey={filter === 'all' || filter === 'cancelled' ? null : filter}
          onSelect={(k) => setFilter((k ?? 'all') as Filter)} columns={4} />
      </div>

      {totals.uncreditedValue > 0 && (
        <Card className="mb-3 flex items-start gap-2.5 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="text-xs leading-relaxed">
            <strong className="text-danger">
              {formatCurrency(totals.uncreditedValue)} of goods is back with no credit note
            </strong>
            {' - '}
            you have the stock and the customer still shows as owing for it. Until a credit
            note is issued they will keep appearing on statements and reminders for goods
            already sitting on your shelf.
          </p>
        </Card>
      )}

      <DataGrid
        rows={rows}
        server={paging}
        columns={columns}
        rowKey={(r) => r.id}
        emptyIcon="rotate-ccw"
        emptyMessage="Nothing has been returned"
        emptyHint="A return is raised against an invoice. Goods come back into stock, and a credit note settles what the customer is owed."
        actions={[
          {
            label: 'Open return',
            icon: 'file-text',
            onSelect: (r: ReturnRowVM) => router.push(`/sales-return/${r.id}`),
          },
          {
            label: 'Mark goods received',
            icon: 'check',
            enabled: (r: ReturnRowVM) => canEdit && r.lifecycle === 'draft',
            onSelect: (r: ReturnRowVM) => run(() => markReceived(r.id)),
          },
          {
            label: 'Issue credit note',
            icon: 'receipt',
            enabled: (r: ReturnRowVM) => canCredit && isUncredited(r),
            onSelect: (r: ReturnRowVM) => run(() => creditReturn(r.id)),
          },
          {
            label: 'Cancel return',
            icon: 'x',
            tone: 'danger' as const,
            enabled: (r: ReturnRowVM) => canEdit && r.lifecycle !== 'cancelled',
            onSelect: (r: ReturnRowVM) => setVoiding(r),
          },
        ]}
        pageSummary={(page) => (
          <>
            <span className="text-muted-foreground">
              Page value <strong className="tabular-nums text-foreground">
                {formatCurrency(page.reduce((n, r) => n + r.valuePaise, 0))}
              </strong>
            </span>
            <span className="text-muted-foreground">
              Not credited <strong className="tabular-nums text-danger">
                {formatCurrency(page.filter(isUncredited).reduce((n, r) => n + r.valuePaise, 0))}
              </strong>
            </span>
          </>
        )}
      />

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        A return is the goods. A credit note is the money. They are separate documents
        because they do not always go together - a replacement sends goods back with no
        credit, and a damage allowance credits money with nothing returned. Only items
        marked <strong>back into stock</strong> are added to stock; damaged and scrapped
        items are recorded but never made sellable again.
      </p>

      {creating && (
        <NewReturnDialog
          invoices={invoices}
          canCredit={canCredit}
          onClose={() => setCreating(false)}
          onDone={(msg) => { setCreating(false); setFlash(msg); router.refresh(); }}
        />
      )}

      {voiding && (
        <VoidDialog
          row={voiding}
          onClose={() => setVoiding(null)}
          onDone={(msg) => { setVoiding(null); setFlash(msg); router.refresh(); }}
          onError={(e) => { setVoiding(null); setError(e); }}
        />
      )}
    </>
  );
}

function VoidDialog({
  row, onClose, onDone, onError,
}: {
  row: ReturnRowVM;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (error: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();

  const issued = row.creditNotes.filter((c) => c.lifecycle === 'issued');

  return (
    <Modal
      open
      title={`Cancel ${row.returnNo}`}
      subtitle={`${row.totalQty} item${row.totalQty === 1 ? '' : 's'} from ${row.customerName}`}
      icon="x"
      tone="danger"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Keep it</Button>
          <Button
            variant="danger" icon="x"
            disabled={!reason.trim() || pending || issued.length > 0}
            loading={pending}
            onClick={() => start(async () => {
              const r = await voidReturn(row.id, reason);
              if (r.error) return onError(r.error);
              onDone(r.message ?? 'Cancelled.');
            })}
          >
            Cancel return
          </Button>
        </div>
      }
    >
      {issued.length > 0 ? (
        <div className="rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <p className="text-xs leading-relaxed">
            <strong className="text-danger">
              {issued.map((c) => c.creditNoteNo).join(', ')} has already been issued against this return.
            </strong>
            {' '}
            Cancel the credit note first. The goods and the money have to be withdrawn
            together, or the credit note ends up citing a return that officially never
            happened - which is exactly what an audit looks for.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            The return stays on the record, marked cancelled. If the goods had been
            received, a reversing stock movement takes them back out - the original is
            never deleted, so &ldquo;restocked on the 3rd, cancelled on the 5th&rdquo; is
            still readable. The invoice becomes returnable again.
          </p>

          <label className="block">
            <span className="mb-1 block text-xs font-medium">
              Why <span className="text-danger">*</span>
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Raised against the wrong invoice"
              className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
        </>
      )}
    </Modal>
  );
}
