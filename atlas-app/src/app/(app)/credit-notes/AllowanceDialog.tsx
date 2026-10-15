'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Layout';
import { formatCurrency } from '@/lib/format';
import {
  CREDIT_REASONS, creditForQty, type CreditReason, type InvoiceLineForReturn,
} from '@/lib/returns';
import { loadInvoiceForAllowance, raiseAllowance } from './actions';

/**
 * Credit a customer with no goods coming back.
 *
 * The case the reference app cannot record at all: there a credit note only
 * exists as a consequence of a return, so an allowance for damaged goods the
 * customer keeps, a price correction, or a short supply has no home. Staff work
 * around it by discounting the *next* invoice - which understates that invoice's
 * taxable value and therefore the GST on it. A small, quiet, recurring tax error
 * that nobody ever traces back to a missing screen.
 *
 * Quantities here do not consume the return allowance. Nothing physically came
 * back, so those units can still be returned later.
 */

export interface AllowanceInvoiceOption {
  id: string;
  invoiceNo: string;
  customerName: string;
  grandTotalPaise: number;
}

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

/**
 * Every reason except `goods_returned`, which belongs on the return screen.
 *
 * The predicate is a type guard rather than a plain filter so the narrowed type
 * survives - `raiseAllowance` refuses `goods_returned` at the type level, and
 * without this the filter would widen it straight back to `CreditReason` and the
 * guarantee would only exist at runtime.
 */
type AllowanceReason = Exclude<CreditReason, 'goods_returned'>;

const REASONS = CREDIT_REASONS.filter(
  (r): r is typeof r & { value: AllowanceReason } => r.value !== 'goods_returned',
);

export function AllowanceDialog({
  invoices, onClose, onDone,
}: {
  invoices: AllowanceInvoiceOption[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [invoiceId, setInvoiceId] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<InvoiceLineForReturn[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const [reason, setReason] = useState<AllowanceReason>('damage_allowance');
  const [mode, setMode] = useState<'lines' | 'flat'>('lines');
  const [flat, setFlat] = useState('');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (!invoiceId) { setLines(null); setChosen({}); return; }
    setLoading(true); setError(null);
    loadInvoiceForAllowance(invoiceId).then((r) => {
      setLoading(false);
      if ('error' in r && r.error) { setError(r.error); return; }
      if (!('invoice' in r) || !r.invoice) return;
      setLines(r.invoice.lines);
      setChosen(Object.fromEntries(r.invoice.lines.map((l) => [l.invoiceItemId, ''])));
    });
  }, [invoiceId]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? invoices.filter((i) =>
        i.invoiceNo.toLowerCase().includes(q) || i.customerName.toLowerCase().includes(q))
      : invoices;
    return list.slice(0, 50);
  }, [invoices, search]);

  const picked = useMemo(
    () => Object.entries(chosen)
      .map(([invoiceItemId, v]) => ({ invoiceItemId, qty: Math.trunc(Number(v) || 0) }))
      .filter((p) => p.qty > 0),
    [chosen],
  );

  // Full value of the chosen lines - the ceiling on a flat amount.
  const lineValue = useMemo(() => {
    if (!lines) return 0;
    const byId = new Map(lines.map((l) => [l.invoiceItemId, l]));
    return picked.reduce((n, p) => {
      const l = byId.get(p.invoiceItemId);
      if (!l) return n;
      return n + creditForQty({ qty: l.qty, taxablePaise: l.taxablePaise, returnedQty: 0 }, p.qty);
    }, 0);
  }, [lines, picked]);

  const flatPaise = Math.round((Number(flat.replace(/,/g, '')) || 0) * 100);
  const taxable = mode === 'flat' ? flatPaise : lineValue;

  // Weighted tax, so the preview matches what the server computes per line.
  const tax = useMemo(() => {
    if (!lines || taxable <= 0 || lineValue <= 0) return 0;
    const byId = new Map(lines.map((l) => [l.invoiceItemId, l]));
    return picked.reduce((n, p) => {
      const l = byId.get(p.invoiceItemId);
      if (!l) return n;
      const full = creditForQty({ qty: l.qty, taxablePaise: l.taxablePaise, returnedQty: 0 }, p.qty);
      const share = mode === 'flat' ? Math.round((taxable * full) / lineValue) : full;
      return n + Math.round((share * l.taxRatePct) / 100);
    }, 0);
  }, [lines, picked, taxable, lineValue, mode]);

  const overFlat = mode === 'flat' && flatPaise > lineValue;
  const ready = picked.length > 0 && taxable > 0 && !overFlat;

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await raiseAllowance({
        invoiceId,
        reason,
        lines: picked,
        flatTaxablePaise: mode === 'flat' ? flatPaise : null,
        reasonNote: note.trim() || null,
        creditNoteDate: when || null,
      });
      if (res.error) { setError(res.error); return; }
      onDone(res.message ?? 'Credit note issued.');
    });
  };

  return (
    <Modal
      open
      title="Credit without a return"
      subtitle="An allowance, a price correction, or a short supply"
      icon="receipt"
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {taxable > 0 ? (
              <>
                Credit note for <strong className="text-foreground">{formatCurrency(taxable + tax)}</strong>
                {' '}({formatCurrency(taxable)} + {formatCurrency(tax)} GST)
              </>
            ) : 'Choose the lines this credit relates to.'}
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary" icon="check"
              disabled={!ready || pending} loading={pending} onClick={submit}
            >
              Issue credit note
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="whitespace-pre-line">{error}</span>
          </p>
        )}

        {!invoiceId ? (
          <div>
            <Field label="Which invoice" required hint="A credit note must reference the supply it reduces" htmlFor="a-search">
              <input
                id="a-search" value={search} autoFocus placeholder="Search invoice number or customer…"
                onChange={(e) => setSearch(e.target.value)} className={inputClass}
              />
            </Field>
            <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border">
              {shown.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No issued invoice matches.
                </p>
              ) : shown.map((i) => (
                <button
                  key={i.id} type="button" onClick={() => setInvoiceId(i.id)}
                  className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-start last:border-0 hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-medium">{i.invoiceNo}</span>
                    <span className="block truncate text-xs text-muted-foreground">{i.customerName}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums">
                    {formatCurrency(i.grandTotalPaise)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <span className="text-sm">
                Against <strong className="font-mono">
                  {invoices.find((i) => i.id === invoiceId)?.invoiceNo ?? ''}
                </strong>
                <span className="ms-2 text-muted-foreground">
                  {invoices.find((i) => i.id === invoiceId)?.customerName ?? ''}
                </span>
              </span>
              <Button size="sm" icon="x" onClick={() => setInvoiceId('')}>Change</Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Reason" required htmlFor="a-reason">
                <select
                  id="a-reason" value={reason} className={inputClass}
                  onChange={(e) => setReason(e.target.value as typeof reason)}
                >
                  {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
              <Field label="Dated" htmlFor="a-when">
                <input
                  id="a-when" type="date" value={when}
                  onChange={(e) => setWhen(e.target.value)} className={inputClass}
                />
              </Field>
              <Field label="Detail" hint="Goes on the document" htmlFor="a-note">
                <input
                  id="a-note" value={note} placeholder="Agreed with the customer on the phone"
                  onChange={(e) => setNote(e.target.value)} className={inputClass}
                />
              </Field>
            </div>

            <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {REASONS.find((r) => r.value === reason)?.hint}
              {' '}Nothing comes back into stock, and the quantities below stay returnable -
              you are crediting value, not goods.
            </p>

            {loading ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">Loading lines…</p>
            ) : lines && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[38rem] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Item</th>
                      <th className="px-3 py-2 text-right font-semibold">Invoiced</th>
                      <th className="px-3 py-2 text-right font-semibold">GST</th>
                      <th className="px-3 py-2 text-right font-semibold">Crediting</th>
                      <th className="px-3 py-2 text-right font-semibold">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const v = chosen[l.invoiceItemId] ?? '';
                      const qty = Math.trunc(Number(v) || 0);
                      const over = qty > l.qty;
                      const value = qty > 0
                        ? creditForQty({ qty: l.qty, taxablePaise: l.taxablePaise, returnedQty: 0 }, qty)
                        : 0;
                      return (
                        <tr key={l.invoiceItemId} className="border-b border-border last:border-0">
                          <td className="px-3 py-1.5">
                            <span className="block font-medium">{l.productName}</span>
                            {l.productCode && (
                              <span className="block font-mono text-xs text-muted-foreground">
                                {l.productCode}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{l.qty}</td>
                          <td className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                            {l.taxRatePct}%
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <input
                              value={v} inputMode="numeric"
                              onChange={(e) => setChosen((p) => ({ ...p, [l.invoiceItemId]: e.target.value }))}
                              className={`h-8 w-20 rounded-lg border px-2 text-end text-sm outline-none ${
                                over ? 'border-danger bg-danger/5' : 'border-border bg-card focus:border-brand'
                              }`}
                            />
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {qty > 0 ? formatCurrency(value) : <span className="text-muted-foreground">-</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="mb-2 flex gap-2">
                {(['lines', 'flat'] as const).map((m) => (
                  <button
                    key={m} type="button" onClick={() => setMode(m)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-start transition ${
                      mode === m ? 'border-brand bg-brand/10' : 'border-border hover:bg-muted'
                    }`}
                  >
                    <span className="block text-sm font-medium">
                      {m === 'lines' ? 'Credit the full line value' : 'Credit a set amount'}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {m === 'lines'
                        ? 'What those quantities were charged at'
                        : 'Spread across the chosen lines, taxed at each line’s own rate'}
                    </span>
                  </button>
                ))}
              </div>

              {mode === 'flat' && (
                <Field
                  label="Amount before GST ₹"
                  required
                  hint={picked.length > 0 ? `At most ${formatCurrency(lineValue)}` : 'Choose lines first'}
                  htmlFor="a-flat"
                >
                  <input
                    id="a-flat" value={flat} inputMode="decimal"
                    onChange={(e) => setFlat(e.target.value)}
                    className={`h-9 w-full rounded-lg border px-3 text-sm outline-none sm:w-52 ${
                      overFlat ? 'border-danger bg-danger/5' : 'border-border bg-card focus:border-brand'
                    }`}
                  />
                </Field>
              )}

              {overFlat && (
                <p className="mt-2 text-xs text-danger">
                  Those lines were charged {formatCurrency(lineValue)}. A credit note cannot
                  return more than was invoiced.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
