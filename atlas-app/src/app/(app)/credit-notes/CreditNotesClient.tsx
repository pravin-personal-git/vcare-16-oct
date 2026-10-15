'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import { useDebouncedSearch, useListParams } from '@/components/ui/useListParams';
import { DateRangeSelect } from '@/components/ui/DateRangeSelect';
import { useState, useTransition } from 'react';
import { ServerExportButton } from '@/components/ui/ServerExportButton';
import type { CreditNoteTotals } from '@/server/credit-notes-list';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge, Card, Field } from '@/components/ui/Layout';
import { Toolbar, FilterChip, FilterSelect } from '@/components/ui/Toolbar';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import { CREDIT_REASON_LABEL } from '@/lib/returns';
import { AllowanceDialog, type AllowanceInvoiceOption } from './AllowanceDialog';
import { issue, refund, voidCreditNote } from './actions';

/**
 * Credit notes.
 *
 * **Unused** is the column that matters. A credit note that is issued but not
 * applied to anything is money the customer is owed and does not know about -
 * it reduces nothing, appears on no statement, and sits there until somebody
 * looks. It is the mirror of "on account" on the receipts screen, and it goes
 * wrong far more often, because credit notes are raised in a hurry at the point
 * a customer is already annoyed.
 */

export interface CreditNoteVM {
  id: string;
  /** An approval request is open on it (issuing is held). */
  awaitingApproval?: boolean;
  creditNoteNo: string;
  invoiceId: string;
  invoiceNo: string;
  salesReturnId: string | null;
  returnNo: string | null;
  partyId: string | null;
  customerName: string;
  creditNoteDate: string;
  lifecycle: string;
  reason: string;
  taxMode: string;
  taxableBasePaise: number;
  taxTotalPaise: number;
  grandTotalPaise: number;
  allocatedPaise: number;
  refundedPaise: number;
  unusedPaise: number;
  appliedTo: { invoiceId: string; invoiceNo: string; amountPaise: number }[];
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

type Filter = 'all' | 'draft' | 'unused' | 'cancelled' | 'issued' | 'applied';

const REFUND_METHODS = [
  { value: 'bank', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card reversal' },
  { value: 'adjustment', label: 'Adjustment' },
];

export function CreditNotesClient({
  rows, invoices, canCredit, scopeIsAll, paging, totals, customers, reasons, filter, customer, reason,
}: {
  /** One server-side page (F1b): searched, filtered and sorted on the server. */
  rows: CreditNoteVM[];
  paging: ServerPaging;
  /** Counted over every note, whatever the filters. */
  totals: CreditNoteTotals;
  customers: string[];
  reasons: string[];
  filter: string;
  customer: string;
  reason: string;
  invoices: AllowanceInvoiceOption[];
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
  const setReason = (v: string) => list.set({ reason: v || null });
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raising, setRaising] = useState(false);
  const [refunding, setRefunding] = useState<CreditNoteVM | null>(null);
  const [voiding, setVoiding] = useState<CreditNoteVM | null>(null);
  const [, start] = useTransition();

  // Totals come from the server, over every note (not just this page).

  const cards: KpiCard[] = [
    {
      key: 'issued', label: 'Credited', count: formatCurrencyCompact(totals.issued),
      subLabel: `${totals.liveCount} note${totals.liveCount === 1 ? '' : 's'}`, icon: 'receipt',
    },
    {
      key: 'applied', label: 'Set against invoices', count: formatCurrencyCompact(totals.applied),
      subLabel: 'reduces what they owe', icon: 'check', tone: 'success',
    },
    {
      key: 'unused', label: 'Unused credit', count: formatCurrencyCompact(totals.unused),
      subLabel: `${totals.unusedCount} note${totals.unusedCount === 1 ? '' : 's'}`,
      icon: 'info', tone: totals.unused > 0 ? 'warning' : 'default',
    },
    {
      key: 'tax', label: 'GST credited', count: formatCurrencyCompact(totals.tax),
      subLabel: 'reduces output tax', icon: 'receipt', tone: 'info',
    },
  ];

  const run = (fn: () => Promise<{ error?: string; message?: string }>) => {
    setError(null); setFlash(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else { setFlash(res.message ?? 'Done.'); router.refresh(); }
    });
  };

  const columns: Column<CreditNoteVM>[] = [
    {
      key: 'no', header: 'Credit note #', sortValue: (r) => r.creditNoteNo,
      render: (r) => (
        <Link href={`/credit-notes/${r.id}`} className="font-mono text-xs font-medium text-brand hover:underline">
          {r.creditNoteNo}
        </Link>
      ),
    },
    {
      key: 'against', header: 'Against', sortValue: (r) => r.invoiceNo,
      render: (r) => (
        <span className="flex flex-col">
          <Link href={`/invoices/${r.invoiceId}`} className="font-mono text-xs hover:text-brand hover:underline">
            {r.invoiceNo}
          </Link>
          {r.returnNo && r.salesReturnId && (
            <Link
              href={`/sales-return/${r.salesReturnId}`}
              className="font-mono text-xs text-muted-foreground hover:text-brand"
            >
              via {r.returnNo}
            </Link>
          )}
        </span>
      ),
    },
    {
      key: 'customer', header: 'Customer', sortValue: (r) => r.customerName,
      render: (r) => <CustomerLink id={r.partyId} className="font-medium">{r.customerName}</CustomerLink>,
    },
    {
      key: 'date', header: 'Dated', sortValue: (r) => new Date(r.creditNoteDate).getTime(),
      render: (r) => <span className="text-xs">{fmtDate(r.creditNoteDate)}</span>,
    },
    {
      key: 'reason', header: 'Reason', sortValue: (r) => r.reason,
      render: (r) => (
        <span className="text-xs">{CREDIT_REASON_LABEL[r.reason] ?? r.reason}</span>
      ),
    },
    {
      key: 'total', header: 'Amount', align: 'end', sortValue: (r) => r.grandTotalPaise,
      render: (r) => (
        <span className="flex flex-col items-end">
          <span className="tabular-nums font-medium">{formatCurrency(r.grandTotalPaise)}</span>
          <span className="text-xs text-muted-foreground">
            incl. {formatCurrency(r.taxTotalPaise)} {r.taxMode === 'IGST' ? 'IGST' : 'GST'}
          </span>
        </span>
      ),
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
      key: 'unused', header: 'Unused', align: 'end', sortValue: (r) => r.unusedPaise,
      render: (r) => (
        r.lifecycle !== 'issued'
          ? <span className="text-xs text-muted-foreground">-</span>
          : r.unusedPaise > 0
            ? <span className="tabular-nums font-medium text-warning">{formatCurrency(r.unusedPaise)}</span>
            : <span className="text-xs text-muted-foreground">-</span>
      ),
    },
    {
      key: 'status', header: 'Status', sortValue: (r) => r.lifecycle,
      render: (r) => {
        if (r.awaitingApproval) return <Badge tone="warning">Awaiting approval</Badge>;
        if (r.lifecycle === 'cancelled') return <Badge tone="danger">Cancelled</Badge>;
        if (r.lifecycle === 'draft') return <Badge tone="warning">Draft</Badge>;
        if (r.refundedPaise > 0 && r.unusedPaise === 0) return <Badge tone="success">Refunded</Badge>;
        if (r.unusedPaise === 0) return <Badge tone="success">Applied</Badge>;
        if (r.allocatedPaise > 0 || r.refundedPaise > 0) return <Badge tone="info">Part used</Badge>;
        return <Badge tone="warning">Unused</Badge>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        badge="CN"
        title="Credit Notes"
        subtitle={
          `${totals.liveCount} issued · ${formatCurrency(totals.issued)} credited`
          + (totals.unused > 0 ? ` · ${formatCurrency(totals.unused)} unused` : '')
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
            variant="primary" icon="plus" disabled={!canCredit}
            title={
              scopeIsAll ? 'Select a single store first'
                : !canCredit ? 'You do not have permission to issue credit notes' : undefined
            }
            onClick={() => setRaising(true)}
          >
            Credit without a return
          </Button>
        }
        filters={
          <>
            {/* Credited / Set against invoices / Unused are the cards below -
                not repeated here (4 Oct 2026). Draft and Cancelled have no card. */}
            <FilterChip
              label="Draft" count={totals.drafts} icon="clock"
              active={filter === 'draft'} onClick={() => setFilter(filter === 'draft' ? 'all' : 'draft')}
            />
            <FilterChip
              label="Cancelled" count={totals.cancelled} icon="x"
              active={filter === 'cancelled'} onClick={() => setFilter(filter === 'cancelled' ? 'all' : 'cancelled')}
            />
            <FilterSelect id="cn-customer" label="Customer" value={customer} onChange={setCustomer}
              options={customers.map((v) => ({ value: v, label: v }))} />
            <FilterSelect id="cn-reason" label="Reason" value={reason} onChange={setReason}
              options={reasons.map((v) => ({ value: v, label: CREDIT_REASON_LABEL[v] ?? v }))} />
            <DateRangeSelect label="Dated" />
            {rangeOn && (
              <button type="button" className="text-xs text-brand hover:underline"
                onClick={() => list.set({ range: null, from: null, to: null })}>All dates</button>
            )}
          </>
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search credit note, invoice, customer…"
        end={<ServerExportButton screen="creditNotes" />}
      />

      <div className="mb-3">
        <KpiStrip cards={cards} activeKey={['issued', 'applied', 'unused'].includes(filter) ? filter : null}
          onSelect={(k) => setFilter(k === 'issued' || k === 'applied' || k === 'unused' ? k : 'all')} columns={4} />
      </div>

      {totals.unused > 0 && (
        <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-xs leading-relaxed">
            <strong className="text-warning">{formatCurrency(totals.unused)} of credit is unused</strong>
            {' - '}
            issued to a customer, applied to nothing, and not refunded. It reduces no
            invoice and shows on no statement, so the customer has no way of knowing it
            exists. Apply it to an outstanding invoice, or refund it.
          </p>
        </Card>
      )}

      <DataGrid
        rows={rows}
        server={paging}
        columns={columns}
        rowKey={(r) => r.id}
        emptyIcon="receipt"
        emptyMessage="No credit notes yet"
        emptyHint="One is raised automatically when a return is credited. You can also credit without a return - a damage allowance, a price correction, or a short supply."
        actions={[
          {
            label: 'Open credit note',
            icon: 'file-text',
            onSelect: (r: CreditNoteVM) => router.push(`/credit-notes/${r.id}`),
          },
          {
            label: 'Issue',
            icon: 'check',
            enabled: (r: CreditNoteVM) => canCredit && r.lifecycle === 'draft',
            onSelect: (r: CreditNoteVM) => run(() => issue(r.id)),
          },
          {
            label: 'Refund the unused credit',
            icon: 'credit-card',
            enabled: (r: CreditNoteVM) => canCredit && r.lifecycle === 'issued' && r.unusedPaise > 0,
            onSelect: (r: CreditNoteVM) => setRefunding(r),
          },
          {
            label: 'Cancel credit note',
            icon: 'x',
            tone: 'danger' as const,
            enabled: (r: CreditNoteVM) => canCredit && r.lifecycle !== 'cancelled',
            onSelect: (r: CreditNoteVM) => setVoiding(r),
          },
        ]}
        pageSummary={(page) => (
          <>
            <span className="text-muted-foreground">
              Page total <strong className="tabular-nums text-foreground">
                {formatCurrency(page.reduce((n, r) => n + r.grandTotalPaise, 0))}
              </strong>
            </span>
            <span className="text-muted-foreground">
              Unused <strong className="tabular-nums text-warning">
                {formatCurrency(page.reduce((n, r) => n + (r.lifecycle === 'issued' ? r.unusedPaise : 0), 0))}
              </strong>
            </span>
          </>
        )}
      />

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        A credit note is a tax document, not a note. It carries GST at the rates of the
        original supply and in the same mode, it reduces output tax, and its number series
        must stay unbroken - so a cancelled one is marked, never deleted. A credit note
        settles invoices exactly as a receipt does, but no money moved, which is why it is
        counted separately from what a customer has actually paid.
      </p>

      {raising && (
        <AllowanceDialog
          invoices={invoices}
          onClose={() => setRaising(false)}
          onDone={(msg) => { setRaising(false); setFlash(msg); router.refresh(); }}
        />
      )}

      {refunding && (
        <RefundDialog
          note={refunding}
          onClose={() => setRefunding(null)}
          onDone={(msg) => { setRefunding(null); setFlash(msg); router.refresh(); }}
          onError={(e) => { setRefunding(null); setError(e); }}
        />
      )}

      {voiding && (
        <VoidDialog
          note={voiding}
          onClose={() => setVoiding(null)}
          onDone={(msg) => { setVoiding(null); setFlash(msg); router.refresh(); }}
          onError={(e) => { setVoiding(null); setError(e); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function RefundDialog({
  note, onClose, onDone, onError,
}: {
  note: CreditNoteVM;
  onClose: () => void;
  onDone: (m: string) => void;
  onError: (e: string) => void;
}) {
  const [amount, setAmount] = useState((note.unusedPaise / 100).toString());
  const [method, setMethod] = useState('bank');
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [pending, start] = useTransition();

  const paise = Math.round((Number(amount.replace(/,/g, '')) || 0) * 100);
  const over = paise > note.unusedPaise;
  const valid = paise > 0 && !over;

  return (
    <Modal
      open
      title={`Refund ${note.creditNoteNo}`}
      subtitle={`${formatCurrency(note.unusedPaise)} available · ${note.customerName}`}
      icon="credit-card"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" icon="credit-card"
            disabled={!valid || pending} loading={pending}
            onClick={() => start(async () => {
              const r = await refund({
                creditNoteId: note.id,
                amountPaise: paise,
                method,
                refundedAt: when || null,
                reference: reference.trim() || null,
                note: null,
              });
              if (r.error) return onError(r.error);
              onDone(r.message ?? 'Refunded.');
            })}
          >
            Record refund
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        This records money leaving the business. Only the unused part of a credit note can
        be refunded - anything already set against an invoice has to be taken back off it
        first, or the customer would be credited twice for the same goods.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount ₹" required htmlFor="rf-amount">
          <input
            id="rf-amount" value={amount} autoFocus inputMode="decimal"
            onChange={(e) => setAmount(e.target.value)}
            className={`h-9 w-full rounded-lg border px-3 text-sm outline-none ${
              over ? 'border-danger bg-danger/5' : 'border-border bg-card focus:border-brand'
            }`}
          />
        </Field>
        <Field label="How" required htmlFor="rf-method">
          <select
            id="rf-method" value={method} onChange={(e) => setMethod(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand"
          >
            {REFUND_METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Refunded on" htmlFor="rf-when">
          <input
            id="rf-when" type="date" value={when} onChange={(e) => setWhen(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand"
          />
        </Field>
        <Field label="Reference" hint="UTR, cheque number" htmlFor="rf-ref">
          <input
            id="rf-ref" value={reference} onChange={(e) => setReference(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand"
          />
        </Field>
      </div>

      {over && (
        <p className="mt-2 text-xs text-danger">
          Only {formatCurrency(note.unusedPaise)} is unused on this credit note.
        </p>
      )}
    </Modal>
  );
}

function VoidDialog({
  note, onClose, onDone, onError,
}: {
  note: CreditNoteVM;
  onClose: () => void;
  onDone: (m: string) => void;
  onError: (e: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();

  return (
    <Modal
      open
      title={`Cancel ${note.creditNoteNo}`}
      subtitle={`${formatCurrency(note.grandTotalPaise)} · ${note.customerName}`}
      icon="x"
      tone="danger"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Keep it</Button>
          <Button
            variant="danger" icon="x"
            disabled={!reason.trim() || pending} loading={pending}
            onClick={() => start(async () => {
              const r = await voidCreditNote(note.id, reason);
              if (r.error) return onError(r.error);
              onDone(r.message ?? 'Cancelled.');
            })}
          >
            Cancel credit note
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        The document and its number stay on the record. A credit note number series has to
        stay unbroken - a missing one is a question nobody can answer at audit, because the
        obvious reading is that tax was reclaimed and the evidence removed.
      </p>

      {note.appliedTo.length > 0 && (
        <div className="mb-3 rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2">
          <p className="text-xs font-medium">
            {note.appliedTo.length} invoice{note.appliedTo.length === 1 ? '' : 's'} will
            become outstanding again:
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {note.appliedTo.map((a) => a.invoiceNo).join(', ')}
          </p>
        </div>
      )}

      {note.refundedPaise > 0 && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2">
          <p className="text-xs leading-relaxed text-danger">
            {formatCurrency(note.refundedPaise)} has already been refunded against this note.
            Reverse the refund first - otherwise money has left the business with nothing
            behind it.
          </p>
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-xs font-medium">Why <span className="text-danger">*</span></span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Raised against the wrong invoice"
          className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-sm outline-none focus:border-brand"
        />
      </label>
    </Modal>
  );
}
