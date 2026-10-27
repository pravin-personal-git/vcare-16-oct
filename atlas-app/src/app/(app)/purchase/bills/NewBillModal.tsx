'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, Field, SectionCard, SummaryRow } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { ScanButton } from '@/components/scan/ScanButton';
import { AiScanButton } from '@/components/scan/AiScanButton';
import { computeBillTotals } from '@/lib/purchase';
import {
  billSourcesAction, createBillAction, quickAddSupplierAction, searchBillProductsAction, searchSuppliersAction,
  type BillProductPick, type SupplierPick,
} from './actions';

/**
 * NEW PURCHASE BILL (rebuilt 28 Oct 2026, Vcare - purchase-flow demo).
 *
 * The supplier and every product are search boxes. A serial-tracked line
 * takes its serials right here - a USB / Bluetooth scanner types into the box,
 * the phone camera scans many in a row, a label photo reads them, or paste a
 * list. And the bill says once whether the goods have arrived, so stock moves
 * exactly once: with the bill, on an earlier goods receipt, or later.
 */

type Goods = 'received' | 'on_receipt' | 'awaited';
type Sources = Awaited<ReturnType<typeof billSourcesAction>>;

interface Line {
  product: BillProductPick | null;
  productName: string;
  qty: string;
  unitCost: string;
  discountPct: string;
  taxRatePct: string;
  serials: string[];
  /** From a goods receipt: quantity and serials are what arrived. */
  fromReceipt?: string;
}

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function toPaise(v: string): number {
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}
const blank = (): Line => ({ product: null, productName: '', qty: '1', unitCost: '', discountPct: '0', taxRatePct: '18', serials: [] });
const input = 'w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm';
const num = 'w-full rounded-md border border-border bg-card px-2 py-1.5 text-right text-sm tabular-nums';

const GOODS: { key: Goods; title: string; hint: string }[] = [
  { key: 'received', title: 'Yes, they arrived with this bill', hint: 'Stock goes in when you post, with the serials on the lines.' },
  { key: 'on_receipt', title: 'Already received on a goods receipt', hint: 'Pick the receipt above - stock does not move again.' },
  { key: 'awaited', title: 'Not yet - still to come', hint: 'You owe it once posted; receive the goods on the bill when they arrive.' },
];

export function NewBillModal({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [supplier, setSupplier] = useState<SupplierPick | null>(null);
  const [adding, setAdding] = useState<{ name: string; phone: string; gstin: string } | null>(null);
  const [supplierBillNo, setSupplierBillNo] = useState('');
  const [billDate, setBillDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [freight, setFreight] = useState('0');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [goods, setGoods] = useState<Goods>('received');
  const [sources, setSources] = useState<Sources | null>(null);
  const [receiptIds, setReceiptIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What this supplier has that the bill could be against.
  const supplierId = supplier?.id ?? null;
  useEffect(() => {
    if (!supplierId) return;
    let live = true;
    void billSourcesAction(supplierId).then((r) => { if (live) setSources(r); });
    return () => { live = false; };
  }, [supplierId]);

  const preview = useMemo(() => computeBillTotals(
    lines.map((l) => ({ qty: Number(l.qty) || 0, unitCostPaise: toPaise(l.unitCost), discountPct: Number(l.discountPct) || 0, taxRatePct: Number(l.taxRatePct) || 0 })),
    toPaise(freight), 'IGST',
  ), [lines, freight]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const pickSupplier = (s: SupplierPick | null) => {
    setSupplier(s); setSources(null); setReceiptIds([]);
    setLines((ls) => ls.filter((l) => !l.fromReceipt).length ? ls.filter((l) => !l.fromReceipt) : [blank()]);
    if (goods === 'on_receipt') setGoods('received');
  };

  /** A receipt toggled on: its lines come in as they arrived (quantity and serials fixed). */
  const toggleReceipt = (id: string) => {
    const r = sources?.receipts.find((x) => x.id === id);
    if (!r) return;
    const on = !receiptIds.includes(id);
    const next = on ? [...receiptIds, id] : receiptIds.filter((x) => x !== id);
    setReceiptIds(next);
    setGoods(next.length ? 'on_receipt' : 'received');
    setLines((ls) => {
      const kept = ls.filter((l) => l.fromReceipt !== r.grnNo && (next.length ? !!l.fromReceipt : true));
      if (!on) return kept.length ? kept : [blank()];
      const fromIt: Line[] = r.items.map((i) => ({
        product: i.productId ? { id: i.productId, label: i.productName, sub: i.productCode, code: i.productCode ?? '', hsnCode: null, kind: 'goods', unit: '', serial: i.serials.length > 0, lastCostPaise: i.unitCostPaise, taxRatePct: i.taxRatePct } : null,
        productName: i.productName, qty: String(i.qty), unitCost: (i.unitCostPaise / 100).toFixed(2), discountPct: '0',
        taxRatePct: String(i.taxRatePct), serials: i.serials, fromReceipt: r.grnNo,
      }));
      return [...kept.filter((l) => l.fromReceipt), ...fromIt];
    });
  };

  /** A purchase order fills the lines with what is still to bill; nothing else is linked. */
  const fromOrder = (id: string) => {
    const o = sources?.orders.find((x) => x.id === id);
    if (!o) return;
    setLines(o.items.map((i) => ({
      product: i.productId ? { id: i.productId, label: i.productName, sub: i.productCode, code: i.productCode ?? '', hsnCode: null, kind: 'goods', unit: '', serial: i.serial, lastCostPaise: i.unitCostPaise, taxRatePct: i.taxRatePct } : null,
      productName: i.productName, qty: String(Math.max(1, i.qty)), unitCost: (i.unitCostPaise / 100).toFixed(2), discountPct: '0',
      taxRatePct: String(i.taxRatePct), serials: [],
    })));
    setNotes((n) => n || `Against ${o.no}`);
  };

  const pickProduct = (i: number, p: BillProductPick | null) => setLine(i, p ? {
    product: p, productName: p.label, serials: [],
    unitCost: p.lastCostPaise ? (p.lastCostPaise / 100).toFixed(2) : lines[i].unitCost,
    taxRatePct: p.taxRatePct != null ? String(p.taxRatePct) : lines[i].taxRatePct,
  } : { product: null, serials: [] });

  /** Serials in - scanned, typed, pasted or read from a label. None twice on the bill. */
  const addSerials = (i: number, raw: string[]) => {
    const onBill = new Set(lines.flatMap((l) => l.serials.map((s) => s.toUpperCase())));
    const fresh: string[] = [];
    let dup = 0;
    for (const s of raw.flatMap((x) => x.split(/[\s,;]+/)).map((x) => x.trim()).filter(Boolean)) {
      if (onBill.has(s.toUpperCase())) { dup++; continue; }
      onBill.add(s.toUpperCase()); fresh.push(s);
    }
    if (dup) setError(`${dup} serial${dup === 1 ? ' is' : 's are'} already on this bill - skipped.`); else setError(null);
    if (!fresh.length) return;
    setLines((prev) => prev.map((l, j) => {
      if (j !== i) return l;
      const serials = [...l.serials, ...fresh];
      return { ...l, serials, qty: String(Math.max(Number(l.qty) || 0, serials.length)) };
    }));
  };

  const real = lines.filter((l) => l.productName.trim() && Number(l.qty) > 0);
  const serialLines = real.filter((l) => l.product?.serial);
  const units = serialLines.reduce((n, l) => n + (Number(l.qty) || 0), 0);
  const scanned = serialLines.reduce((n, l) => n + Math.min(l.serials.length, Number(l.qty) || 0), 0);
  const ready = !!supplier && supplierBillNo.trim() && real.length > 0 && (goods !== 'on_receipt' || receiptIds.length > 0);

  const submit = async (post: boolean) => {
    setBusy(true); setError(null);
    const r = await createBillAction({
      partyId: supplier!.id, supplierBillNo, billDate, dueDate, freightPaise: toPaise(freight), notes: notes.trim() || null,
      lines: real.map((l) => ({
        productId: l.product?.id ?? null, productName: l.productName.trim(), productCode: l.product?.code || null, hsnCode: l.product?.hsnCode ?? null,
        qty: Number(l.qty), unitCostPaise: toPaise(l.unitCost), discountPct: Number(l.discountPct) || 0, taxRatePct: Number(l.taxRatePct) || 0,
        serials: goods === 'received' ? l.serials : [],
      })),
      post, goods, grnIds: goods === 'on_receipt' ? receiptIds : [],
    });
    setBusy(false);
    if (r.error) setError(r.error); else onSaved(r.message ?? 'Saved.');
  };

  const effect = goods === 'received'
    ? { stock: `+${real.reduce((n, l) => n + (Number(l.qty) || 0), 0)} on the shelf when posted`, serials: units ? `${scanned} real serial${scanned === 1 ? '' : 's'}${units - scanned ? `, ${units - scanned} house tag${units - scanned === 1 ? '' : 's'}` : ''}` : 'No serial items', shows: 'Received' }
    : goods === 'on_receipt'
      ? { stock: receiptIds.length ? 'Nothing - already on the shelf from the receipt' : 'Pick the receipt above', serials: 'Already on the receipt', shows: 'Received · on its receipt' }
      : { stock: 'Nothing yet - received on the bill when the goods come', serials: 'Scanned when they arrive', shows: 'Goods awaited' };

  return (
    <Modal title="New purchase bill" subtitle="What arrived, what it cost, and when it has to be paid" icon="receipt" size="xl" onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">
            Total <strong className="tabular-nums">{rupees(preview.grandTotalPaise)}</strong>
            <span className="ms-2 text-xs text-muted-foreground">incl. {rupees(preview.igstPaise + preview.cgstPaise + preview.sgstPaise)} tax</span>
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={() => submit(false)} disabled={!ready || busy} loading={busy}>Save draft</Button>
            <Button variant="primary" onClick={() => submit(true)} disabled={!ready || busy} loading={busy}>Save &amp; post</Button>
          </div>
        </div>
      }>
      {error && (
        <Card className="mb-3 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <p role="alert" className="text-xs leading-relaxed text-danger">{error}</p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier" required htmlFor="bill-supplier">
          {adding ? (
            <div className="grid gap-2 rounded-lg border border-border p-2.5">
              <input aria-label="Supplier name" className={input} placeholder="Firm name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} autoFocus />
              <div className="grid grid-cols-2 gap-2">
                <input aria-label="Phone" className={input} placeholder="Phone (10 digits)" inputMode="tel" value={adding.phone} onChange={(e) => setAdding({ ...adding, phone: e.target.value })} />
                <input aria-label="GSTIN" className={input} placeholder="GSTIN (optional)" value={adding.gstin} onChange={(e) => setAdding({ ...adding, gstin: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => setAdding(null)}>Cancel</Button>
                <Button size="sm" variant="primary" loading={busy} onClick={async () => {
                  setBusy(true);
                  const r = await quickAddSupplierAction({ name: adding.name, phone: adding.phone, gstin: adding.gstin || null });
                  setBusy(false);
                  if (r.error || !r.supplier) { setError(r.error ?? 'Could not add the supplier.'); return; }
                  setAdding(null); pickSupplier(r.supplier);
                }}>Add supplier</Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-1">
              <SearchSelect id="bill-supplier" label="Supplier" value={supplier} onChange={(o) => pickSupplier(o as SupplierPick | null)}
                search={searchSuppliersAction} placeholder="Supplier name, phone or GSTIN…" />
              {!supplier && (
                <button type="button" className="justify-self-start text-xs font-medium text-brand hover:underline" onClick={() => setAdding({ name: '', phone: '', gstin: '' })}>
                  + New supplier - not on file yet
                </button>
              )}
            </div>
          )}
        </Field>
        <Field label="Their bill number" required hint="What the supplier calls it. Goes on the GST return." htmlFor="bill-no">
          <input id="bill-no" className={input} value={supplierBillNo} onChange={(e) => setSupplierBillNo(e.target.value)} placeholder="e.g. INV/2026/1184" />
        </Field>
        <Field label="Bill date" htmlFor="bill-date">
          <input id="bill-date" type="date" className={input} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
        </Field>
        <Field label="Payment due" htmlFor="bill-due">
          <input id="bill-due" type="date" className={input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>

      {/* ---- what this bill is against ---------------------------------- */}
      {supplier && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Against</p>
          {!sources ? <p className="text-xs text-muted-foreground">Looking for open receipts and orders…</p> : (
            <div className="flex flex-wrap gap-2">
              {sources.receipts.map((r) => {
                const on = receiptIds.includes(r.id);
                return (
                  <button key={r.id} type="button" onClick={() => toggleReceipt(r.id)} aria-pressed={on}
                    className={`rounded-lg border px-3 py-2 text-start text-xs ${on ? 'border-brand bg-brand/[0.08] font-semibold' : 'border-border hover:bg-muted/50'}`}>
                    <Icon name="package" className="me-1 inline h-3.5 w-3.5" />
                    {r.grnNo} · {new Date(r.receivedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} · {r.items.reduce((n, i) => n + i.qty, 0)} items · not billed
                  </button>
                );
              })}
              {sources.orders.map((o) => (
                <button key={o.id} type="button" onClick={() => fromOrder(o.id)} className="rounded-lg border border-border px-3 py-2 text-start text-xs hover:bg-muted/50">
                  <Icon name="file-text" className="me-1 inline h-3.5 w-3.5" />
                  Fill from {o.no} · {o.items.length} line{o.items.length === 1 ? '' : 's'}
                </button>
              ))}
              {!sources.receipts.length && !sources.orders.length && <p className="text-xs text-muted-foreground">No unbilled goods receipts or open orders from this supplier - a new purchase.</p>}
            </div>
          )}
        </div>
      )}

      {/* ---- lines ------------------------------------------------------- */}
      <SectionCard title="Items" icon="package" className="mt-4" bodyClassName="p-0">
        <div className="divide-y divide-border">
          {lines.map((l, i) => {
            const qty = Number(l.qty) || 0;
            const left = qty - l.serials.length;
            const locked = !!l.fromReceipt;
            return (
              <div key={i} className="grid gap-2 p-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_7rem_4.5rem_4.5rem_7rem_2rem] sm:items-end">
                  <div className="col-span-2 sm:col-span-1">
                    <span className="mb-1 block text-micro font-semibold uppercase text-muted-foreground">Item{locked ? ` · from ${l.fromReceipt}` : ''}</span>
                    {locked ? <p className="rounded-md bg-muted/50 px-2 py-1.5 text-sm">{l.productName}</p> : (
                      <>
                        <SearchSelect id={`bill-product-${i}`} label="Product" value={l.product} onChange={(o) => pickProduct(i, o as BillProductPick | null)}
                          search={searchBillProductsAction} placeholder="Product name, code or barcode…" />
                        {!l.product && (
                          <input className={`${input} mt-1 text-xs`} value={l.productName} onChange={(e) => setLine(i, { productName: e.target.value })}
                            placeholder="Not in the catalogue? Describe it" aria-label="Description" />
                        )}
                      </>
                    )}
                  </div>
                  <NumField label="Qty" value={l.qty} disabled={locked} onChange={(v) => setLine(i, { qty: v })} />
                  <NumField label="Unit cost ₹" value={l.unitCost} onChange={(v) => setLine(i, { unitCost: v })} />
                  <NumField label="Disc %" value={l.discountPct} onChange={(v) => setLine(i, { discountPct: v })} />
                  <NumField label="GST %" value={l.taxRatePct} onChange={(v) => setLine(i, { taxRatePct: v })} />
                  <div className="text-right">
                    <span className="mb-1 block text-micro font-semibold uppercase text-muted-foreground">Taxable</span>
                    <span className="block py-1.5 text-sm tabular-nums">{rupees(preview.lines[i]?.taxablePaise ?? 0)}</span>
                  </div>
                  <div className="flex justify-end sm:pb-1">
                    {lines.length > 1 && (
                      <button type="button" aria-label="Remove this line" title="Remove this line" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger"
                        onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>
                        <Icon name="trash" className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {l.product?.serial && goods === 'received' && !locked && (
                  <SerialBox line={l} left={left} onAdd={(codes) => addSerials(i, codes)}
                    onRemove={(k) => setLine(i, { serials: l.serials.filter((_, j) => j !== k) })} />
                )}
                {locked && l.serials.length > 0 && (
                  <p className="text-xs text-muted-foreground">Serials on the receipt: <span className="font-mono">{l.serials.slice(0, 8).join(', ')}{l.serials.length > 8 ? ` +${l.serials.length - 8}` : ''}</span></p>
                )}
                {l.product?.serial && goods === 'awaited' && <p className="text-xs text-muted-foreground">Serials are scanned when the goods arrive.</p>}
              </div>
            );
          })}
        </div>
        {goods !== 'on_receipt' && (
          <div className="border-t border-border bg-muted/20 px-3 py-2">
            <Button size="sm" icon="plus" onClick={() => setLines((p) => [...p, blank()])}>Add line</Button>
          </div>
        )}
      </SectionCard>

      {/* ---- have the goods arrived? ---------------------------------------- */}
      <fieldset className="mt-4">
        <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Have these goods arrived? *</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {GOODS.map((g) => (
            <label key={g.key} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 ${goods === g.key ? 'border-brand bg-brand/[0.06]' : 'border-border hover:bg-muted/40'}`}>
              <input type="radio" name="bill-goods" className="mt-0.5" checked={goods === g.key}
                onChange={() => { setGoods(g.key); if (g.key !== 'on_receipt' && receiptIds.length) { setReceiptIds([]); setLines((ls) => ls.filter((x) => !x.fromReceipt).length ? ls.filter((x) => !x.fromReceipt) : [blank()]); } }} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{g.title}</span>
                <span className="block text-xs text-muted-foreground">{g.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {goods === 'on_receipt' && !receiptIds.length && <p className="mt-1.5 text-xs text-danger">Pick the goods receipt under &ldquo;Against&rdquo;.</p>}
      </fieldset>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Freight / delivery ₹" hint="Spread across the lines by value, so unit costs stay true." htmlFor="bill-freight">
          <input id="bill-freight" className={input} value={freight} onChange={(e) => setFreight(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Notes" htmlFor="bill-notes">
          <input id="bill-notes" className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What posting this bill does</p>
          <SummaryRow label="Stock" value={effect.stock} />
          <SummaryRow label="Serial units" value={effect.serials} />
          <SummaryRow label="You owe" value={supplier ? `+${rupees(preview.grandTotalPaise)} to ${supplier.label}` : '—'} />
          <SummaryRow label="Bill shows" value={effect.shows} />
          {goods === 'received' && units - scanned > 0 && (
            <p className="mt-2 text-xs text-warning">{units - scanned} serial item{units - scanned === 1 ? '' : 's'} without a serial will get Atlas house tags - scan them now if the boxes carry one.</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <SummaryRow label="Subtotal" value={rupees(preview.subtotalPaise)} />
          {preview.itemDiscountPaise > 0 && <SummaryRow label="Less discount" value={`− ${rupees(preview.itemDiscountPaise)}`} />}
          {toPaise(freight) > 0 && <SummaryRow label="Freight" value={rupees(toPaise(freight))} />}
          <SummaryRow label="Taxable value" value={rupees(preview.taxableBasePaise)} />
          <SummaryRow label="GST" value={rupees(preview.igstPaise + preview.cgstPaise + preview.sgstPaise)} />
          <SummaryRow label="Total" value={rupees(preview.grandTotalPaise)} strong />
          <p className="mt-2 text-xs text-muted-foreground">IGST or CGST+SGST is decided by the supplier&apos;s state when saved; the total does not change.</p>
        </div>
      </div>
    </Modal>
  );
}

function NumField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-micro font-semibold uppercase text-muted-foreground">{label}</span>
      <input className={num} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} inputMode="decimal" aria-label={label} />
    </label>
  );
}

/** One line's serials: a scanner or typing (Enter), paste a list, the camera, or a label photo. */
export function SerialBox({ line, left, onAdd, onRemove }: {
  line: { serials: string[]; qty: string }; left: number; onAdd: (codes: string[]) => void; onRemove: (k: number) => void;
}) {
  const [text, setText] = useState('');
  const qty = Number(line.qty) || 0;
  return (
    <div className="grid gap-2 rounded-lg bg-muted/40 p-2.5">
      <p className="text-xs">
        <strong>Serials</strong> - {line.serials.length} of {qty}
        {left > 0 ? <span className="text-muted-foreground"> · {left} without a serial get a house tag</span>
          : left < 0 ? <strong className="text-danger"> · {-left} more serials than the quantity</strong>
            : <span className="text-success"> · all scanned ✓</span>}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Serial number"
          placeholder="Scan with the scanner, or type and press Enter - paste a list too"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (text.trim()) onAdd([text]); setText(''); } }}
          onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/[\s,;]/.test(t.trim())) { e.preventDefault(); onAdd([t]); } }}
          className="h-9 min-w-[12rem] flex-1 rounded-md border border-border bg-card px-2 font-mono text-sm" />
        <ScanButton className="h-9 w-9" title="Scan serials with the camera, one after another" onScanMany={(codes) => onAdd(codes)} />
        <AiScanButton kind="product_label" label="Read the label" onResult={(r) => { if (r.data.serials.length) onAdd(r.data.serials); }} />
      </div>
      {line.serials.length > 0 && (
        <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
          {line.serials.map((s, k) => (
            <span key={`${s}-${k}`} className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-xs">
              {s}
              <button type="button" aria-label={`Remove ${s}`} className="text-muted-foreground hover:text-danger" onClick={() => onRemove(k)}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
