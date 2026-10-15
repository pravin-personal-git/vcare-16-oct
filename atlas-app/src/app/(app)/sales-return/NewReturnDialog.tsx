'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Badge, Field } from '@/components/ui/Layout';
import { formatCurrency } from '@/lib/format';
import {
  DISPOSITIONS, RETURN_REASONS, creditForQty, validateReturn,
  type Disposition, type InvoiceLineForReturn,
} from '@/lib/returns';
import { loadInvoiceLines, saveReturn } from './actions';

/**
 * Take goods back against an invoice.
 *
 * Two things this form does that the reference app's return screen does not,
 * both because they are where the money actually goes wrong:
 *
 *  - It shows **what is still returnable per line**, counting earlier returns.
 *    Without it, a second partial return silently over-credits, and nobody
 *    notices until the customer's account is negative.
 *
 *  - It asks **what condition each item came back in**, and says plainly that
 *    only good stock goes back on the shelf. The reference app restocks
 *    everything, so a broken item is immediately sellable again.
 *
 * The credit preview uses the same `creditForQty` the server will use, so the
 * figure shown before saving is the figure written after. It is a proportion of
 * the invoice line's taxable value - not qty × price - because the line carries
 * a share of the order-level discount that a unit price cannot express.
 */

export interface InvoiceOption {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  customerName: string;
  grandTotalPaise: number;
  soldQty: number;
  returnedQty: number;
}

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

interface LineState {
  qty: string;
  disposition: Disposition;
}

export function NewReturnDialog({
  invoices, canCredit, onClose, onDone,
}: {
  invoices: InvoiceOption[];
  canCredit: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [invoiceId, setInvoiceId] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<InvoiceLineForReturn[] | null>(null);
  const [state, setState] = useState<Record<string, LineState>>({});
  const [loading, setLoading] = useState(false);

  const [reason, setReason] = useState('defective');
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [receiveNow, setReceiveNow] = useState(true);
  const [creditNow, setCreditNow] = useState(true);

  useEffect(() => {
    if (!invoiceId) { setLines(null); setState({}); return; }
    setLoading(true);
    setError(null);
    loadInvoiceLines(invoiceId).then((r) => {
      setLoading(false);
      if ('error' in r && r.error) { setError(r.error); return; }
      if (!('invoice' in r) || !r.invoice) return;
      setLines(r.invoice.lines);
      setState(Object.fromEntries(
        r.invoice.lines.map((l) => [l.invoiceItemId, { qty: '', disposition: 'restock' as const }]),
      ));
    });
  }, [invoiceId]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices.slice(0, 50);
    return invoices
      .filter((i) =>
        i.invoiceNo.toLowerCase().includes(q) || i.customerName.toLowerCase().includes(q))
      .slice(0, 50);
  }, [invoices, search]);

  const proposed = useMemo(
    () => Object.entries(state)
      .map(([invoiceItemId, s]) => ({
        invoiceItemId,
        qty: Math.trunc(Number(s.qty) || 0),
        disposition: s.disposition,
      }))
      .filter((p) => p.qty > 0),
    [state],
  );

  // The same validator the server runs. Shown live so a mistake is visible
  // while typing rather than after pressing Save.
  const problems = lines ? validateReturn(proposed, lines) : [];
  const ready = proposed.length > 0 && problems.length === 0;

  const creditPreview = useMemo(() => {
    if (!lines) return { taxable: 0, tax: 0, total: 0 };
    const byId = new Map(lines.map((l) => [l.invoiceItemId, l]));
    let taxable = 0;
    let tax = 0;
    for (const p of proposed) {
      const line = byId.get(p.invoiceItemId);
      if (!line) continue;
      const t = creditForQty(line, p.qty);
      taxable += t;
      tax += Math.round((t * line.taxRatePct) / 100);
    }
    return { taxable, tax, total: taxable + tax };
  }, [lines, proposed]);

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await saveReturn({
        invoiceId,
        lines: proposed,
        reason,
        returnedAt: when || null,
        notes: notes.trim() || null,
        receiveNow,
        creditNow: creditNow && receiveNow && canCredit,
      });
      if (res.error) { setError(res.error); return; }
      onDone(res.message ?? 'Return recorded.');
    });
  };

  return (
    <Modal
      open
      title="New return"
      subtitle="Goods coming back against an invoice"
      icon="rotate-ccw"
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {proposed.length === 0
              ? 'Enter a quantity against at least one line.'
              : (
                <>
                  Credit of <strong className="text-foreground">{formatCurrency(creditPreview.total)}</strong>
                  {' '}({formatCurrency(creditPreview.taxable)} + {formatCurrency(creditPreview.tax)} GST)
                </>
              )}
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary" icon="check"
              disabled={!ready || pending} loading={pending} onClick={submit}
            >
              {receiveNow && creditNow && canCredit ? 'Record and credit' : 'Record return'}
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

        {/* ---- pick the invoice ------------------------------------------ */}
        {!invoiceId ? (
          <div>
            <Field label="Which invoice" required hint="Only issued invoices with something left to return" htmlFor="r-search">
              <input
                id="r-search" value={search} autoFocus placeholder="Search invoice number or customer…"
                onChange={(e) => setSearch(e.target.value)} className={inputClass}
              />
            </Field>

            <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border">
              {shown.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {invoices.length === 0
                    ? 'No issued invoice has anything left to return.'
                    : 'Nothing matches that search.'}
                </p>
              ) : shown.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setInvoiceId(i.id)}
                  className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-start last:border-0 hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-medium">{i.invoiceNo}</span>
                    <span className="block truncate text-xs text-muted-foreground">{i.customerName}</span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="block text-xs tabular-nums">{formatCurrency(i.grandTotalPaise)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {i.returnedQty > 0
                        ? `${i.soldQty - i.returnedQty} of ${i.soldQty} left`
                        : `${i.soldQty} item${i.soldQty === 1 ? '' : 's'}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <span className="text-sm">
                Against{' '}
                <strong className="font-mono">
                  {invoices.find((i) => i.id === invoiceId)?.invoiceNo ?? ''}
                </strong>
                <span className="ms-2 text-muted-foreground">
                  {invoices.find((i) => i.id === invoiceId)?.customerName ?? ''}
                </span>
              </span>
              <Button size="sm" icon="x" onClick={() => setInvoiceId('')}>Change</Button>
            </div>

            {/* ---- the lines --------------------------------------------- */}
            {loading ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">Loading lines…</p>
            ) : lines && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[52rem] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Item</th>
                      <th className="px-3 py-2 text-right font-semibold">Sold</th>
                      <th className="px-3 py-2 text-right font-semibold">Already back</th>
                      <th className="px-3 py-2 text-right font-semibold">Can return</th>
                      <th className="px-3 py-2 text-right font-semibold">Returning</th>
                      <th className="px-3 py-2 font-semibold">Condition</th>
                      <th className="px-3 py-2 text-right font-semibold">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const s = state[l.invoiceItemId] ?? { qty: '', disposition: 'restock' as const };
                      const qty = Math.trunc(Number(s.qty) || 0);
                      const left = Math.max(0, l.qty - l.returnedQty);
                      const credit = qty > 0 ? creditForQty(l, qty) : 0;
                      const over = qty > left;

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
                          <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                            {l.returnedQty || '-'}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {left === 0
                              ? <Badge tone="neutral">all back</Badge>
                              : <span className="tabular-nums font-medium">{left}</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <input
                              value={s.qty}
                              inputMode="numeric"
                              disabled={left === 0}
                              onChange={(e) => setState((p) => ({
                                ...p,
                                [l.invoiceItemId]: { ...s, qty: e.target.value },
                              }))}
                              className={`h-8 w-20 rounded-lg border px-2 text-end text-sm outline-none disabled:bg-muted disabled:text-muted-foreground ${
                                over ? 'border-danger bg-danger/5' : 'border-border bg-card focus:border-brand'
                              }`}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <select
                              value={s.disposition}
                              disabled={qty === 0}
                              onChange={(e) => setState((p) => ({
                                ...p,
                                [l.invoiceItemId]: { ...s, disposition: e.target.value as Disposition },
                              }))}
                              className="h-8 rounded-lg border border-border bg-card px-2 text-xs outline-none focus:border-brand disabled:bg-muted disabled:text-muted-foreground"
                            >
                              {DISPOSITIONS.map((d) => (
                                <option key={d.value} value={d.value}>{d.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {qty > 0 ? formatCurrency(credit) : <span className="text-muted-foreground">-</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {problems.length > 0 && proposed.length > 0 && (
              <ul className="rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2 text-xs text-on-tint-danger">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}

            {/* ---- why, when, and what happens next ---------------------- */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Reason" required htmlFor="r-reason">
                <select
                  id="r-reason" value={reason}
                  onChange={(e) => setReason(e.target.value)} className={inputClass}
                >
                  {RETURN_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Returned on" htmlFor="r-when">
                <input
                  id="r-when" type="date" value={when}
                  onChange={(e) => setWhen(e.target.value)} className={inputClass}
                />
              </Field>
              <Field label="Note" htmlFor="r-note">
                <input
                  id="r-note" value={notes} placeholder="Optional"
                  onChange={(e) => setNotes(e.target.value)} className={inputClass}
                />
              </Field>
            </div>

            <div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox" checked={receiveNow} className="mt-0.5"
                  onChange={(e) => setReceiveNow(e.target.checked)}
                />
                <span className="text-xs leading-relaxed">
                  <strong>The goods are here now.</strong> Stock moves immediately for
                  anything marked <em>back into stock</em>. Leave this off if the customer
                  has only told you they are sending it - you can mark it received when the
                  box actually arrives.
                </span>
              </label>

              <label className={`flex items-start gap-2.5 ${receiveNow && canCredit ? 'cursor-pointer' : 'opacity-50'}`}>
                <input
                  type="checkbox" checked={creditNow && receiveNow && canCredit}
                  disabled={!receiveNow || !canCredit} className="mt-0.5"
                  onChange={(e) => setCreditNow(e.target.checked)}
                />
                <span className="text-xs leading-relaxed">
                  <strong>Issue the credit note too.</strong> It settles their outstanding
                  invoices, starting with this one; anything left over sits on their account.
                  {!canCredit && (
                    <span className="block text-muted-foreground">
                      You do not have the <code>returns.credit</code> permission, so someone
                      else will need to issue it.
                    </span>
                  )}
                  {receiveNow === false && canCredit && (
                    <span className="block text-muted-foreground">
                      Only available once the goods are received - crediting items still in
                      transit is how a customer gets paid twice for one return.
                    </span>
                  )}
                </span>
              </label>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
