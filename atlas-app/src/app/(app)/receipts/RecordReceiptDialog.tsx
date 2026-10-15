'use client';

import { useEffect, useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Field } from '@/components/ui/Layout';
import { formatCurrency } from '@/lib/format';
import { outstandingOn, unallocatedPaise, validateAllocations } from '@/lib/allocation';
import { REFERENCE_LABEL, type ReceiptMethod } from '@/lib/receipt';
import { loadOpenInvoices, recordReceipt, type OpenInvoiceOption } from './actions';
import { BuyerSearch } from '@/components/document/BuyerSearch';
import { searchBuyersAction } from '@/app/actions/search-options';

/**
 * Recording money that has arrived.
 *
 * The shape of this form is the whole argument of the receipts rebuild made
 * visible: **the amount is entered once, and where it goes is a separate,
 * editable decision below it.** The old form asked for a payment against one
 * invoice, which is why an advance or a split cheque could not be typed in at
 * all.
 *
 * The split is suggested, not imposed. Oldest debt first is what people mean
 * nine times out of ten, and the tenth time they need to override it without
 * fighting the software - so every row is editable and the arithmetic is shown
 * as it changes rather than checked on submit.
 *
 * Anything left over is named on screen before saving. Money quietly landing
 * on account is the thing nobody notices until a customer asks for it back.
 */

export interface PartyOption {
  id: string;
  /** Shown alongside the name - several customers share one. */
  code: string;
  name: string;
  company: string | null;
  phone: string;
}

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'tds', label: 'TDS deducted at source' },
  { value: 'adjustment', label: 'Adjustment' },
] as const;

const rupeesToPaise = (v: string) => Math.round((Number(v) || 0) * 100);
const paiseToRupees = (p: number) => (p === 0 ? '' : String(p / 100));

export function RecordReceiptDialog({
  onClose, onDone, presetParty = null, presetSplit,
}: {
  /**
   * From the "What is this payment for?" chooser (11 Oct 2026): exactly these
   * invoices and amounts, already split. `{}` = an advance with no invoice.
   */
  presetSplit?: Record<string, number>;
  /** G-39: opened from a customer's page - the customer is already chosen. */
  presetParty?: { id: string; label: string; sub: string } | null;
  /** No longer read - the customer is searched on the server as you type (26 Sep 2026). */
  parties?: PartyOption[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [partyId, setPartyId] = useState(presetParty?.id ?? '');
  const [partyLabel, setPartyLabel] = useState<{ label: string; sub: string } | null>(presetParty ? { label: presetParty.label, sub: presetParty.sub } : null);
  const [amount, setAmount] = useState(() => {
    const t = presetSplit ? Object.values(presetSplit).reduce((n, v) => n + v, 0) : 0;
    return t > 0 ? String(t / 100) : '';
  });
  const [method, setMethod] = useState<ReceiptMethod>('bank');
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const [invoices, setInvoices] = useState<OpenInvoiceOption[]>([]);
  const [split, setSplit] = useState<Record<string, number>>(presetSplit ?? {});
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(!!presetSplit);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const amountPaise = rupeesToPaise(amount);

  // Load the customer's open invoices, and re-suggest a split while the user
  // has not overridden it. Once they edit a row the suggestion stops moving
  // underneath them - a form that rewrites what you just typed is worse than
  // one that suggests nothing.
  useEffect(() => {
    if (!partyId) {
      setInvoices([]);
      setSplit({});
      setTouched(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadOpenInvoices(partyId, touched ? 0 : amountPaise).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (r.error) return setError(r.error);
      setInvoices(r.invoices);
      if (!touched) {
        setSplit(Object.fromEntries(r.suggested.map((a) => [a.invoiceId, a.amountPaise])));
      }
    });
    return () => { cancelled = true; };
  }, [partyId, amountPaise, touched]);

  const allocations = Object.entries(split)
    .filter(([, v]) => v > 0)
    .map(([invoiceId, amountPaise]) => ({ invoiceId, amountPaise }));

  const leftOver = unallocatedPaise(amountPaise, allocations);

  const problems = amountPaise > 0
    ? validateAllocations(
      amountPaise,
      allocations,
      invoices.map((i) => ({
        id: i.id,
        invoiceNo: i.invoiceNo,
        invoiceDate: new Date(i.invoiceDate),
        dueDate: new Date(i.dueDate),
        grandTotalPaise: i.grandTotalPaise,
        paidPaise: i.paidPaise,
      })),
    )
    : [];

  const canSave = partyId !== '' && amountPaise > 0 && problems.length === 0 && !pending;

  const save = () => {
    setError(null);
    start(async () => {
      const r = await recordReceipt({
        partyId,
        amountPaise,
        method,
        receivedAt: new Date(receivedAt).toISOString(),
        reference: reference.trim() || null,
        note: note.trim() || null,
        allocations,
      });
      if (r.error) return setError(r.error);
      onDone(r.message ?? 'Receipt recorded.');
    });
  };


  return (
    <Modal
      open
      title="Record a receipt"
      subtitle="Money that has arrived, and the invoices it settles"
      icon="credit-card"
      tone="brand"
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {amountPaise > 0 && (
              <>
                {formatCurrency(amountPaise)} received
                {' · '}
                {formatCurrency(amountPaise - leftOver)} applied
                {leftOver > 0 && (
                  <strong className="text-info"> · {formatCurrency(leftOver)} on account</strong>
                )}
              </>
            )}
          </span>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={!canSave} loading={pending} onClick={save}>
            Record receipt
          </Button>
        </div>
      }
    >
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2 text-xs text-on-tint-danger">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="whitespace-pre-line">{error}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From customer" required>
          {/* Type-ahead instead of a list of every customer. The code stays in the
              line under each match: two customers genuinely share a trading
              name often enough, and money applied to the wrong account is the
              worst kind of mistake to unpick. */}
          <BuyerSearch
            search={searchBuyersAction}
            selected={partyId && partyLabel ? { id: partyId, ...partyLabel } : null}
            onPick={(row) => {
              setPartyId(row?.id ?? '');
              setPartyLabel(row ? { label: row.company ? `${row.company} - ${row.name}` : row.name, sub: [row.code, row.phone].filter(Boolean).join(' · ') } : null);
              setTouched(false);
            }}
          />
        </Field>

        <Field label="Amount received" required>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setTouched(false); }}
            placeholder="0.00"
            className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm tabular-nums outline-none focus:border-brand"
          />
        </Field>

        <Field label="How it came in">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as ReceiptMethod)}
            className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm outline-none focus:border-brand"
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Date received">
          <input
            type="date"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm outline-none focus:border-brand"
          />
        </Field>

        <Field label={REFERENCE_LABEL[method]}>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm outline-none focus:border-brand"
          />
        </Field>

        <Field label="Note">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm outline-none focus:border-brand"
          />
        </Field>
      </div>

      {method === 'tds' && (
        <p className="mt-2 flex items-start gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
          {/* Said here because staff otherwise spend weeks chasing the gap. */}
          TDS is not cash you hold - the customer paid it to the government on your
          behalf. It settles the invoice exactly as a bank transfer does, so record
          it as a second receipt for the amount deducted and the invoice closes.
        </p>
      )}

      {/* ---- the split ---------------------------------------------------- */}
      {partyId && (
        <div className="mt-4">
          <div className="mb-2 flex items-baseline gap-2">
            <h4 className="text-sm font-semibold">Apply it to</h4>
            <span className="text-xs text-muted-foreground">
              suggested oldest first - change any row
            </span>
            <div className="flex-1" />
            {touched && (
              <button
                type="button"
                onClick={() => setTouched(false)}
                className="text-xs font-medium text-brand hover:underline"
              >
                Reset to suggestion
              </button>
            )}
          </div>

          {loading && (
            <p className="py-4 text-center text-xs text-muted-foreground">Loading invoices…</p>
          )}

          {!loading && invoices.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center">
              <p className="text-xs font-medium">
                {partyLabel?.label ?? "This customer"} has nothing outstanding.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {/* The case the old model could not record at all. */}
                The whole amount will sit on their account as an advance, ready to
                apply when the next invoice is raised.
              </p>
            </div>
          )}

          {!loading && invoices.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-start font-semibold">Invoice</th>
                    <th className="px-3 py-2 text-start font-semibold">Due</th>
                    <th className="px-3 py-2 text-end font-semibold">Outstanding</th>
                    <th className="px-3 py-2 text-end font-semibold">Apply</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => {
                    const applied = split[i.id] ?? 0;
                    const over = applied > i.outstandingPaise;
                    return (
                      <tr key={i.id} className="border-b border-border/70 last:border-b-0">
                        <td className="px-3 py-1.5 font-mono text-xs">{i.invoiceNo}</td>
                        <td className="px-3 py-1.5 text-xs">
                          {new Date(i.dueDate).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
                            day: '2-digit', month: 'short', year: 'numeric',
                          })}
                          {i.daysOverdue > 0 && (
                            <span className="ms-1.5 text-danger">{i.daysOverdue}d overdue</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-end tabular-nums">
                          {formatCurrency(i.outstandingPaise)}
                        </td>
                        <td className="px-3 py-1.5 text-end">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={paiseToRupees(applied)}
                            placeholder="0"
                            onChange={(e) => {
                              setTouched(true);
                              setSplit((s) => ({ ...s, [i.id]: rupeesToPaise(e.target.value) }));
                            }}
                            className={`h-7 w-28 rounded border bg-card px-2 text-end text-xs tabular-nums outline-none focus:border-brand ${
                              over ? 'border-danger text-danger' : 'border-border'
                            }`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {problems.length > 0 && (
            <ul className="mt-2 space-y-1">
              {problems.map((p) => (
                <li key={p} className="flex items-start gap-1.5 text-xs text-danger">
                  <Icon name="alert-triangle" className="mt-0.5 h-3 w-3 shrink-0" />
                  {p}
                </li>
              ))}
            </ul>
          )}

          {problems.length === 0 && leftOver > 0 && amountPaise > 0 && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs leading-relaxed">
              <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
              <span>
                <strong className="text-info">{formatCurrency(leftOver)} will sit on account.</strong>{' '}
                It counts towards their balance straight away and can be applied to
                a future invoice. Nothing is lost - but nobody will chase it either,
                so apply it if you know where it belongs.
              </span>
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Re-exported so the list screen can size its own columns from the same rule. */
export { outstandingOn };
