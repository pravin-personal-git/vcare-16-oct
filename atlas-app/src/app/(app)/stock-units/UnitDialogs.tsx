'use client';

import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ScanButton } from '@/components/scan/ScanButton';
import { appendCodes } from '@/lib/scan/codes';
import {
  HOLDER_FOR, UNIT_CONDITION_LABEL, UNIT_STATUS_LABEL, UNIT_TRANSITIONS,
  type UnitStatus,
} from '@/lib/stock-units';
import { OPENING_STOCK_HEADERS, parseSerialList } from '@/lib/stock-intake';
import { STOCK_FIELD_TYPE_LABEL, STOCK_FIELD_TYPES, type StockFieldDef } from '@/lib/stock-fields';
import {
  moveUnitAction, fillPlaceholdersAction, planOpeningAction, importOpeningAction,
  saveStockFieldAction, type UnitActionState,
} from './actions';

export interface PartyOption {
  id: string; name: string; phone: string; isCustomer: boolean; isSupplier: boolean;
}

export const field = 'h-9 w-full rounded border border-border bg-card px-2.5 text-sm outline-none focus:border-brand';
export const label = 'mb-1 block text-micro font-semibold uppercase tracking-wide text-muted-foreground';

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="mb-3 flex items-start gap-2 rounded border border-danger/30 bg-danger/[0.06] px-3 py-2 text-xs">
      <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
      <span>{text}</span>
    </p>
  );
}

/**
 * Pick a customer or supplier out of thousands. Searchable, not a <select>:
 * a dropdown of four and a half thousand names is complete and unusable.
 */
export function PartyPicker({
  parties, kind, value, onChange,
}: {
  parties: PartyOption[];
  kind: 'customer' | 'supplier';
  value: string;
  onChange: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const pool = useMemo(
    () => parties.filter((p) => (kind === 'customer' ? p.isCustomer : p.isSupplier)),
    [parties, kind],
  );
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? pool.filter((p) => p.name.toLowerCase().includes(s) || p.phone.includes(s)) : pool).slice(0, 10);
  }, [pool, q]);
  const chosen = parties.find((p) => p.id === value) ?? null;

  if (chosen) {
    return (
      <div className="flex items-center justify-between gap-2 rounded border border-border bg-muted/30 px-3 py-2">
        <span className="truncate text-sm font-medium">{chosen.name}</span>
        <Button variant="ghost" size="sm" icon="x" onClick={() => onChange('')}>Change</Button>
      </div>
    );
  }
  return (
    <>
      <input
        value={q} onChange={(e) => setQ(e.target.value)} className={field}
        placeholder={`Search ${kind === 'customer' ? 'customers' : 'suppliers'} by name or phone…`}
      />
      <div className="thin-scroll mt-1 max-h-40 overflow-y-auto rounded border border-border">
        {matches.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Nothing matches.</p>}
        {matches.map((p) => (
          <button
            key={p.id} type="button" onClick={() => { onChange(p.id); setQ(''); }}
            className="flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 text-start text-xs last:border-b-0 hover:bg-brand/10"
          >
            <span className="truncate font-medium">{p.name}</span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.phone}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- move unit */

export function MoveUnitDialog({
  unit, parties, onClose, onDone,
}: {
  unit: { id: string; serialNo: string | null; productName: string; status: string; condition: string };
  parties: PartyOption[];
  onClose: () => void;
  onDone: (res: UnitActionState) => void;
}) {
  const allowed = UNIT_TRANSITIONS[unit.status as UnitStatus] ?? [];
  const [to, setTo] = useState<string>(allowed[0] ?? '');
  const [partyId, setPartyId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [condition, setCondition] = useState(unit.condition);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const holder = HOLDER_FOR[to as UnitStatus] ?? null;

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await moveUnitAction(unit.id, {
      to, partyId: holder ? partyId || null : null,
      invoiceNo: to === 'with_customer' ? invoiceNo || null : null,
      condition, note: note || null,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onDone(res);
  }

  return (
    <Modal
      title={`Move ${unit.serialNo ?? 'unit'}`}
      subtitle={unit.productName}
      icon="truck"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!to} icon="check">Move</Button>
        </div>
      }
    >
      <ErrorNote text={error} />
      {allowed.length === 0 ? (
        <p className="text-sm text-muted-foreground">A {UNIT_STATUS_LABEL[unit.status as UnitStatus]?.toLowerCase()} unit cannot move anywhere.</p>
      ) : (
        <div className="space-y-3">
          <div>
            <label className={label}>Now {UNIT_STATUS_LABEL[unit.status as UnitStatus] ?? unit.status}. Moving to</label>
            <select className={field} value={to} onChange={(e) => { setTo(e.target.value); setPartyId(''); }}>
              {allowed.map((s) => <option key={s} value={s}>{UNIT_STATUS_LABEL[s]}</option>)}
            </select>
          </div>

          {holder && (
            <div>
              <label className={label}>Which {holder} *</label>
              <PartyPicker parties={parties} kind={holder} value={partyId} onChange={setPartyId} />
            </div>
          )}

          {to === 'with_customer' && (
            <div>
              <label htmlFor="unitdial-f159" className={label}>Sold on invoice (optional)</label>
              <input id="unitdial-f159"
                className={`${field} font-mono`} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)}
                placeholder="INV-…"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                If it went out on an invoice, give its number. The invoice already took it off stock,
                so linking it records which unit it was without counting it twice. Leave blank for a
                unit going out any other way, and stock is reduced by one here.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="unitdial-f173" className={label}>Condition</label>
            <select id="unitdial-f173" className={field} value={condition} onChange={(e) => setCondition(e.target.value)}>
              {Object.entries(UNIT_CONDITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="unitdial-f180" className={label}>Note</label>
            <input id="unitdial-f180" className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why, or where" />
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ----------------------------------------------------------- fill serials */

export function FillSerialsDialog({
  products, waiting, onClose, onDone,
}: {
  products: { id: string; name: string; code: string }[];
  /** Placeholders waiting, per product id. */
  waiting: Record<string, number>;
  onClose: () => void;
  onDone: (res: UnitActionState) => void;
}) {
  const candidates = products.filter((p) => (waiting[p.id] ?? 0) > 0);
  const [productId, setProductId] = useState(candidates[0]?.id ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseSerialList(text);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fillPlaceholdersAction(productId, text);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onDone(res);
  }

  return (
    <Modal
      title="Record serials that were to follow"
      subtitle="Paste a column from the supplier's sheet, or scan one per line"
      icon="pencil"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!productId || parsed.serials.length === 0} icon="check">
            Record {parsed.serials.length || ''} serial{parsed.serials.length === 1 ? '' : 's'}
          </Button>
        </div>
      }
    >
      <ErrorNote text={error} />
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No units are waiting for a serial.</p>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor="unitdial-f238" className={label}>Product</label>
            <select id="unitdial-f238" className={field} value={productId} onChange={(e) => setProductId(e.target.value)}>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({waiting[p.id]} waiting)</option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className={label}>Serials</span>
              <ScanButton label="Scan with camera" title="Scan serials" existing={parsed.serials}
                hint="Point at each serial barcode in turn. Press Done when finished."
                onScanMany={(codes) => setText((t) => appendCodes(t, codes))} />
            </div>
            <textarea
              autoFocus rows={8} value={text} onChange={(e) => setText(e.target.value)}
              className="w-full rounded border border-border bg-card px-2.5 py-2 font-mono text-xs outline-none focus:border-brand"
              placeholder={'SN0001\nSN0002\n…'}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {parsed.serials.length} serial{parsed.serials.length === 1 ? '' : 's'} read
              {parsed.duplicates.length > 0 && <span className="text-danger"> · repeated: {parsed.duplicates.join(', ')}</span>}
              . They go onto the oldest waiting units first.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------- opening stock */

interface PlanView {
  lines: { productCode: string; productName: string; trackingMode: string; qty: number; units: (string | null)[]; lotNo: string | null }[];
  errors: { row: number; reason: string }[];
}

export function OpeningStockDialog({ onClose, onDone }: { onClose: () => void; onDone: (res: UnitActionState) => void }) {
  const [csv, setCsv] = useState('');
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = `${OPENING_STOCK_HEADERS.join(',')}\n`;

  async function readFile(f: File) {
    const text = await f.text();
    setCsv(text);
    setPlan(null);
  }

  async function check() {
    setBusy(true);
    setError(null);
    const res = await planOpeningAction(csv);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setPlan(res.plan ?? null);
  }

  async function commit() {
    setBusy(true);
    setError(null);
    const res = await importOpeningAction(csv);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onDone(res);
  }

  const units = plan?.lines.reduce((n, l) => n + l.units.filter(Boolean).length, 0) ?? 0;
  const placeholders = plan?.lines.reduce((n, l) => n + l.units.filter((u) => !u).length, 0) ?? 0;

  return (
    <Modal
      title="Import opening stock"
      subtitle="What you hold on the day you start - counted, not guessed"
      icon="upload"
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          <a
            className="text-xs text-brand hover:underline"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}
            download="opening-stock-template.csv"
          >
            Download the template
          </a>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            {plan && plan.errors.length === 0 ? (
              <Button variant="primary" onClick={commit} loading={busy} icon="check">Import {plan.lines.length} lines</Button>
            ) : (
              <Button variant="primary" onClick={check} loading={busy} disabled={!csv.trim()} icon="check-circle">Check the file</Button>
            )}
          </div>
        </div>
      }
    >
      <ErrorNote text={error} />
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        Columns: <span className="font-mono">{OPENING_STOCK_HEADERS.join(', ')}</span>. A serialised product takes
        one row per unit with its serial; a row with a quantity and no serial becomes that many units whose serials
        are to follow. Nothing is written until the whole file checks clean - half an opening balance looks finished
        and is not.
      </p>
      <input
        type="file" accept=".csv,text/csv"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }}
        className="mb-2 block text-xs"
      />
      <textarea
        rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setPlan(null); }}
        className="w-full rounded border border-border bg-card px-2.5 py-2 font-mono text-xs outline-none focus:border-brand"
        placeholder={template}
      />

      {plan && (
        <div className="mt-3 space-y-2">
          {plan.errors.length > 0 ? (
            <div className="rounded border border-danger/30 bg-danger/[0.05] p-2">
              <p className="mb-1 text-xs font-semibold text-danger">{plan.errors.length} row(s) to fix. Nothing will be imported until they are.</p>
              <ul className="thin-scroll max-h-40 overflow-y-auto text-xs">
                {plan.errors.map((e) => <li key={`${e.row}-${e.reason}`}>Row {e.row}: {e.reason}</li>)}
              </ul>
            </div>
          ) : (
            <p className="rounded border border-success/30 bg-success/[0.06] p-2 text-xs">
              Ready: {plan.lines.length} lines, {plan.lines.reduce((n, l) => n + l.qty, 0)} in total,
              {' '}{units} with serials and {placeholders} with serials to follow.
            </p>
          )}
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th>Product</th><th>Tracked</th><th>Lot</th><th className="text-right">Qty</th></tr></thead>
            <tbody>
              {plan.lines.slice(0, 50).map((l, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1">{l.productName} <span className="font-mono text-muted-foreground">{l.productCode}</span></td>
                  <td>{l.trackingMode}</td>
                  <td>{l.lotNo ?? ''}</td>
                  <td className="text-right tabular-nums">{l.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------ field editor */

export function StockFieldDialog({
  existing, categories, onClose, onDone,
}: {
  existing: StockFieldDef | null;
  categories: { id: string; name: string }[];
  onClose: () => void;
  onDone: (res: UnitActionState) => void;
}) {
  const [labelText, setLabelText] = useState(existing?.label ?? '');
  const [fieldType, setFieldType] = useState(existing?.fieldType ?? 'text');
  const [options, setOptions] = useState(existing?.options ?? '');
  const [required, setRequired] = useState(existing?.required ?? false);
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '');
  const [sortOrder, setSortOrder] = useState(String(existing?.sortOrder ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await saveStockFieldAction({
      fieldKey: existing?.fieldKey ?? null, label: labelText, fieldType, options: options || null,
      required, categoryId: categoryId || null, sortOrder: Number(sortOrder) || 0,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onDone(res);
  }

  return (
    <Modal
      title={existing ? `Edit "${existing.label}"` : 'Add a unit field'}
      subtitle="Recorded on every unit it applies to - no developer needed"
      icon="sliders"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} icon="check">Save field</Button>
        </div>
      }
    >
      <ErrorNote text={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="unitdial-f438" className={label}>Name *</label>
          <input id="unitdial-f438" className={field} value={labelText} onChange={(e) => setLabelText(e.target.value)} placeholder="MAC address, Lens size, Engine hours…" />
        </div>
        <div>
          <label htmlFor="unitdial-f442" className={label}>Type</label>
          <select id="unitdial-f442" className={field} value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
            {STOCK_FIELD_TYPES.map((t) => <option key={t} value={t}>{STOCK_FIELD_TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="unitdial-f448" className={label}>Applies to</label>
          <select id="unitdial-f448" className={field} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Every serialised product</option>
            {categories.map((c) => <option key={c.id} value={c.id}>Only {c.name}</option>)}
          </select>
        </div>
        {fieldType === 'select' && (
          <div className="sm:col-span-2">
            <label htmlFor="unitdial-f456" className={label}>Choices, separated by commas</label>
            <input id="unitdial-f456" className={field} value={options} onChange={(e) => setOptions(e.target.value)} placeholder="2.8mm, 3.6mm, 6mm" />
          </div>
        )}
        <div>
          <label htmlFor="unitdial-f461" className={label}>Order</label>
          <input id="unitdial-f461" className={field} type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Required
        </label>
      </div>
    </Modal>
  );
}
