'use client';

import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ScanButton } from '@/components/scan/ScanButton';
import { COVERAGE_TERMS_LABEL } from '@/lib/amc-status';
import { contractNeedsTaxRate } from '@/lib/amc-tax';
import {
  createAmcContractAction, updateAmcContractAction,
  type ActionState, type AmcFormInput,
} from './actions';
import type { AmcRow } from './AmcClient';

export interface CustomerOption {
  id: string; name: string; phone: string; city: string | null;
}
export interface ProductOption {
  id: string; name: string; code: string; warrantyMonths: number | null;
}
export interface InvoiceOption {
  id: string; invoiceNo: string; customerName: string; partyId: string | null;
}

interface LineDraft {
  key: string;
  productId: string | null;
  productName: string;
  qty: number;
  serialNo: string;
}

/** `YYYY-MM-DD` for a date input, in LOCAL time - see `parseDay` in actions.ts. */
function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Same clamping rule as lib/expiry's addMonths - 31 Jan + 12 months is 31 Jan. */
function addMonthsClamped(d: Date, months: number): Date {
  const out = new Date(d);
  const day = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + months);
  const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, last));
  return out;
}

const rupeesToPaise = (s: string) => Math.round((Number(s) || 0) * 100);
const paiseToRupees = (p: number) => (p / 100).toFixed(2);

export function AmcForm({
  existing, customers, products, invoices, busy, onClose, onDone, setBusy,
}: {
  existing: AmcRow | null;
  customers: CustomerOption[];
  products: ProductOption[];
  invoices: InvoiceOption[];
  busy: boolean;
  onClose: () => void;
  onDone: (res: ActionState) => void;
  setBusy: (b: boolean) => void;
}) {
  const today = new Date();

  const [customerId, setCustomerId] = useState(existing?.customerId ?? '');
  const [customerQuery, setCustomerQuery] = useState('');
  const [siteLabel, setSiteLabel] = useState(existing?.siteLabel ?? '');
  const [invoiceId, setInvoiceId] = useState(existing?.invoiceId ?? '');
  const [startDate, setStartDate] = useState(
    existing ? isoDay(new Date(existing.startDate)) : isoDay(today),
  );
  const [endDate, setEndDate] = useState(
    existing
      ? isoDay(new Date(existing.endDate))
      // A year less a day: 1 Apr 2026 to 31 Mar 2027, which is how this trade
      // writes an annual contract and what the financial year does anyway.
      : isoDay(new Date(addMonthsClamped(today, 12).getTime() - 86_400_000)),
  );
  const [amount, setAmount] = useState(existing ? paiseToRupees(existing.amountPaise) : '');
  const [coverageTerms, setCoverageTerms] = useState(existing?.coverageTerms ?? 'labour_only');
  const [visitsIncluded, setVisitsIncluded] = useState(
    existing?.visitsIncluded === null || existing === null ? '' : String(existing.visitsIncluded),
  );
  const [reminderDays, setReminderDays] = useState(String(existing?.reminderDays ?? 30));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [legacyRef, setLegacyRef] = useState(existing?.legacyRef ?? '');
  /**
   * The GST rate, typed by hand. Starts EMPTY on a new contract - no 18
   * pre-filled - because a pre-filled rate gets accepted, not checked, and
   * the client's instruction is that this number is entered, not assumed.
   * Held as the raw string so blank survives to the server as blank.
   */
  const [taxRatePct, setTaxRatePct] = useState(
    existing?.taxRatePct === null || existing?.taxRatePct === undefined ? '' : String(existing.taxRatePct),
  );
  const [sacCode, setSacCode] = useState(existing?.sacCode ?? '');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  /**
   * The customer list holds every customer in scope - 4,556 for this tenant -
   * so it is a searchable list rather than a <select>. A dropdown of four and
   * a half thousand options is technically complete and practically unusable.
   */
  const matches = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q))
      .slice(0, 12);
  }, [customers, customerQuery]);

  const chosen = customers.find((c) => c.id === customerId) ?? null;

  /** Only this customer's invoices - the rest cannot have sold them a contract. */
  const theirInvoices = useMemo(
    () => (customerId ? invoices.filter((i) => i.partyId === customerId) : []),
    [invoices, customerId],
  );

  const addLine = () => setLines((ls) => [
    ...ls,
    { key: `l${Date.now()}${ls.length}`, productId: null, productName: '', qty: 1, serialNo: '' },
  ]);

  const setLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit() {
    setError(null);

    if (!customerId) { setError('Choose the customer this contract covers.'); return; }
    if (!startDate || !endDate) { setError('Both dates are required.'); return; }
    if (new Date(`${endDate}T00:00:00`) <= new Date(`${startDate}T00:00:00`)) {
      setError('The end date must be after the start date.');
      return;
    }

    const blank = lines.find((l) => !l.productName.trim());
    if (blank) { setError('Every covered line needs a product. Remove the empty row or pick one.'); return; }

    // Checked here for a quick answer; the server checks again and is the
    // one that counts.
    if (contractNeedsTaxRate(rupeesToPaise(amount)) && taxRatePct.trim() === '') {
      setError('Enter the GST rate this contract is billed at. Type 0 if it is exempt.');
      return;
    }

    const form: AmcFormInput = {
      customerId,
      siteLabel: siteLabel.trim() || null,
      invoiceId: invoiceId || null,
      startDate,
      endDate,
      amountPaise: rupeesToPaise(amount),
      coverageTerms,
      // Blank means unlimited, which is a different promise from zero.
      visitsIncluded: visitsIncluded.trim() === '' ? null : Number(visitsIncluded),
      reminderDays: Number(reminderDays) || 0,
      notes: notes.trim() || null,
      legacyRef: legacyRef.trim() || null,
      taxRatePct,
      sacCode,
      items: lines.map((l) => ({
        productId: l.productId,
        productName: l.productName.trim(),
        qty: l.qty,
        serialNo: l.serialNo.trim() || null,
      })),
    };

    setBusy(true);
    const res = existing
      ? await updateAmcContractAction(existing.id, form)
      : await createAmcContractAction(form);
    setBusy(false);

    if (res.error) setError(res.error);
    onDone(res);
  }

  const field = 'h-9 w-full rounded border border-border bg-card px-2.5 text-sm outline-none focus:border-brand';
  const label = 'mb-1 block text-micro font-semibold uppercase tracking-wide text-muted-foreground';

  return (
    <Modal
      title={existing ? `Edit ${existing.contractNo}` : 'New maintenance contract'}
      subtitle={existing ? undefined : 'Record a contract so its renewal is flagged before it lapses'}
      icon="receipt"
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} icon="check">
            {existing ? 'Save contract' : 'Create contract'}
          </Button>
        </div>
      }
    >
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded border border-danger/30 bg-danger/[0.06] px-3 py-2 text-xs">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span>{error}</span>
        </p>
      )}

      {/* ---- customer */}
      <section className="mb-4">
        <span className={label}>Customer *</span>
        {chosen ? (
          <div className="flex items-center justify-between gap-2 rounded border border-border bg-muted/30 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{chosen.name}</p>
              <p className="text-xs text-muted-foreground">
                {chosen.phone}{chosen.city ? ` · ${chosen.city}` : ''}
              </p>
            </div>
            <Button
              variant="ghost" size="sm" icon="x"
              onClick={() => { setCustomerId(''); setInvoiceId(''); }}
            >
              Change
            </Button>
          </div>
        ) : (
          <>
            <input
              autoFocus
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              placeholder="Search by name or phone…"
              className={field}
            />
            <div className="thin-scroll mt-1 max-h-44 overflow-y-auto rounded border border-border">
              {matches.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Nothing matches &ldquo;{customerQuery}&rdquo;.
                </p>
              )}
              {matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setCustomerId(c.id); setCustomerQuery(''); }}
                  className="flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-start text-xs transition last:border-b-0 hover:bg-brand/10"
                >
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.phone}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ---- period and money */}
      <section className="mb-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="amcform-f263" className={label}>Starts *</label>
          <input id="amcform-f263" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="amcform-f267" className={label}>Ends * (inclusive)</label>
          <input id="amcform-f267" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="amcform-f271" className={label}>Contract value (₹)</label>
          <input id="amcform-f271"
            type="number" min="0" step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00" className={`${field} font-mono tabular-nums`}
          />
        </div>
        <div>
          <label className={label}>
            GST rate (%){contractNeedsTaxRate(rupeesToPaise(amount)) ? ' *' : ''}
          </label>
          <input
            type="text" inputMode="decimal" value={taxRatePct}
            onChange={(e) => setTaxRatePct(e.target.value)}
            placeholder="Enter the rate, e.g. 18 - or 0 if exempt"
            className={`${field} font-mono tabular-nums`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Typed in by hand - there is no default. Charged on this contract&apos;s invoice.
          </p>
        </div>
        <div>
          <label htmlFor="amcform-f293" className={label}>SAC code</label>
          <input id="amcform-f293"
            value={sacCode} onChange={(e) => setSacCode(e.target.value)}
            placeholder="From your accountant, e.g. 998713" className={`${field} font-mono`}
          />
        </div>
        <div>
          <label htmlFor="amcform-f300" className={label}>Warn me this many days before it ends</label>
          <input id="amcform-f300"
            type="number" min="0" value={reminderDays}
            onChange={(e) => setReminderDays(e.target.value)} className={field}
          />
        </div>
      </section>

      {/* ---- terms */}
      <section className="mb-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="amcform-f311" className={label}>What it covers</label>
          <select id="amcform-f311"
            value={coverageTerms}
            onChange={(e) => setCoverageTerms(e.target.value)}
            className={field}
          >
            {Object.entries(COVERAGE_TERMS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="amcform-f323" className={label}>Visits included</label>
          <input id="amcform-f323"
            type="number" min="0" value={visitsIncluded}
            onChange={(e) => setVisitsIncluded(e.target.value)}
            placeholder="Blank = unlimited" className={field}
          />
        </div>
        <div>
          <label htmlFor="amcform-f331" className={label}>Site / premises</label>
          <input id="amcform-f331"
            value={siteLabel} onChange={(e) => setSiteLabel(e.target.value)}
            placeholder="Gate 3, warehouse…" className={field}
          />
        </div>
        <div>
          <label htmlFor="amcform-f338" className={label}>Their old contract number</label>
          <input id="amcform-f338"
            value={legacyRef} onChange={(e) => setLegacyRef(e.target.value)}
            placeholder="If it already exists on paper" className={`${field} font-mono`}
          />
        </div>
      </section>

      {/* ---- invoice link */}
      {customerId && (
        <section className="mb-4">
          <label htmlFor="amcform-f349" className={label}>Sold on invoice</label>
          <select id="amcform-f349" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} className={field}>
            <option value="">Not linked - contract predates the system</option>
            {theirInvoices.map((i) => (
              <option key={i.id} value={i.id}>{i.invoiceNo}</option>
            ))}
          </select>
          {theirInvoices.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              This customer has no issued invoices, so there is nothing to link to yet.
            </p>
          )}
        </section>
      )}

      {/* ---- covered equipment */}
      <section className="mb-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className={`${label} mb-0`}>Equipment covered</span>
          <Button variant="outline" size="sm" icon="plus" onClick={addLine}>Add item</Button>
        </div>

        {lines.length === 0 ? (
          <p className="flex items-start gap-2 rounded border border-info/25 bg-info/[0.05] px-3 py-2 text-xs">
            <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <span>
              No items listed, so this contract covers the <strong>whole site</strong> -
              including equipment nobody has matched to the catalogue yet. Add items
              only if the agreement is limited to specific units.
            </span>
          </p>
        ) : (
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.key} className="grid gap-2 rounded border border-border p-2 sm:grid-cols-[1fr_5rem_10.5rem_2.25rem]">
                <select
                  value={l.productId ?? ''}
                  onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value);
                    setLine(l.key, {
                      productId: p?.id ?? null,
                      productName: p?.name ?? '',
                    });
                  }}
                  className={field}
                >
                  <option value="">Choose a product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                  ))}
                </select>
                <input
                  type="number" min="1" value={l.qty}
                  onChange={(e) => setLine(l.key, { qty: Number(e.target.value) || 1 })}
                  className={`${field} tabular-nums`} aria-label="Quantity"
                />
                <div className="flex gap-1">
                  <input
                    value={l.serialNo}
                    onChange={(e) => setLine(l.key, { serialNo: e.target.value })}
                    placeholder="Serial / barcode"
                    className={`${field} min-w-0 font-mono text-xs`}
                  />
                  <ScanButton className="h-9 w-9" title="Scan the equipment serial" onScan={(code) => setLine(l.key, { serialNo: code })} />
                </div>
                <Button
                  variant="ghost" size="icon" icon="trash"
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  aria-label="Remove line"
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <label htmlFor="amcform-f426" className={label}>Notes</label>
        <textarea id="amcform-f426"
          value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          placeholder="Anything the technician should know before attending…"
          className="w-full rounded border border-border bg-card px-2.5 py-2 text-sm outline-none focus:border-brand"
        />
      </section>
    </Modal>
  );
}
