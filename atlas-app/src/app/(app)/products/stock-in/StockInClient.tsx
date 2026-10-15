'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { PageHeader, SectionCard, Field } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ScanButton } from '@/components/scan/ScanButton';
import { QuickProductDialog } from '@/components/scan/QuickProductDialog';
import { WithFormOptions } from '@/components/document/WithFormOptions';
import { cleanScannedCode } from '@/lib/scan/codes';
import { readUnknownScan, scanShape } from '@/lib/scan/decode';
import { TRACKING_MODE_LABEL, type TrackingMode } from '@/lib/stock-tracking';
import { STOCK_IN_REASONS, type StockInReason } from '@/lib/stock-in';
import { lookupScanAction } from '../scan-actions';
import { stockInAction } from './actions';

interface P { id: string; code: string; name: string; trackingMode: string }
interface Line { product: P; qty: number; serials: string[]; noSerial: number; lotNo: string }

/**
 * Stock in by scan (G6, 12 Oct 2026). The receipt's scanning rules without a
 * supplier: barcode -> its product +1, serial -> the line waiting for serials,
 * a serial already on file refused, a box with an unreadable serial counted by
 * its barcode and given a house tag. A reason is required.
 */
export function StockInClient({ canEdit, initial }: {
  canEdit: boolean;
  initial: { product: P; serial: string | null } | null;
}) {
  const start: Line[] = initial
    ? [{ product: initial.product, qty: 1, serials: initial.serial && initial.product.trackingMode === 'serial' ? [initial.serial] : [], noSerial: initial.serial || initial.product.trackingMode !== 'serial' ? 0 : 1, lotNo: '' }]
    : [];
  const [lines, setLines] = useState<Line[]>(start);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const [reason, setReason] = useState<StockInReason>('found');
  const [note, setNote] = useState('');
  const [wedge, setWedge] = useState('');
  const [active, setActive] = useState<number | null>(start.length ? 0 : null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn' | 'info'; text: string } | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const [create, setCreate] = useState<{ barcode: string; serial: string | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ref: string; qty: number; units: number; houseTags: string[] } | null>(null);

  const commit = (next: Line[]) => { linesRef.current = next; setLines(next); };

  const apply = (p: P, serial: string | null): string => {
    const cur = [...linesRef.current];
    let i = cur.findIndex((l) => l.product.id === p.id);
    if (i < 0) { cur.push({ product: p, qty: 0, serials: [], noSerial: 0, lotNo: '' }); i = cur.length - 1; }
    const l = cur[i]!;
    if (p.trackingMode === 'serial') {
      if (serial) {
        if (l.serials.some((s) => s.toUpperCase() === serial.toUpperCase())) return `${serial} is already on this list. Ignored.`;
        const fills = l.noSerial > 0;
        cur[i] = { ...l, serials: [...l.serials, serial], noSerial: fills ? l.noSerial - 1 : l.noSerial, qty: fills ? l.qty : l.qty + 1 };
      } else cur[i] = { ...l, noSerial: l.noSerial + 1, qty: l.qty + 1 };
    } else {
      if (serial) return `${p.name} is not tracked by serial. Scan its barcode to count it.`;
      cur[i] = { ...l, qty: l.qty + 1 };
    }
    commit(cur); setActive(i);
    return '';
  };

  const waiting = (): number => {
    const ls = linesRef.current;
    if (active !== null && ls[active]?.product.trackingMode === 'serial') return active;
    for (let i = ls.length - 1; i >= 0; i--) if (ls[i]!.product.trackingMode === 'serial') return i;
    return -1;
  };

  const toWaiting = (code: string) => {
    const w = waiting();
    if (w < 0) return `${code} looks like a serial, but no product is waiting for serials. Scan the product's barcode first.`;
    const p = linesRef.current[w]!.product;
    return apply(p, code) || `ok:Serial ${code} added to ${p.name}.`;
  };

  const say = (t: string, tone: 'ok' | 'bad' | 'warn' | 'info' = 'bad') =>
    setMsg(t.startsWith('ok:') ? { tone: 'ok', text: t.slice(3) } : t ? { tone, text: t } : null);

  const handle = async (raw: string) => {
    const code = cleanScannedCode(raw);
    if (!code) return;
    setAsk(null);
    const shape = scanShape(code);
    if (shape.kind === 'gs1') {
      const p = (await lookupScanAction(shape.gtin).catch(() => null))?.products[0];
      if (!p) { setCreate({ barcode: shape.gtin, serial: shape.serial }); say(`${shape.why}. No product has barcode ${shape.gtin} yet - create it.`, 'info'); return; }
      say(apply(p, shape.serial) || `ok:${p.name}${shape.serial ? ` · serial ${shape.serial}` : ''}.`);
      return;
    }
    const look = await lookupScanAction(code).catch(() => null);
    if (!look) { say('Could not look that code up. Scan again.'); return; }
    if (look.units.length) { say(`${code} is already on file - one ${look.units[0]!.productName ?? 'unit'}. A serial can only come in once.`); return; }
    if (look.products.length) { const p = look.products[0]!; say(apply(p, null) || `ok:${p.name} +1.`); return; }
    const r = readUnknownScan(code, waiting() >= 0);
    if (r.as === 'barcode') { setCreate({ barcode: code, serial: null }); say(`${r.why}. Not on file - create the product.`, 'info'); return; }
    if (r.as === 'serial') { say(toWaiting(code)); return; }
    setAsk(code); say(`${code}: ${r.why}. Which is it?`, 'warn');
  };

  const total = lines.reduce((n, l) => n + l.qty, 0);
  const tags = lines.reduce((n, l) => n + (l.product.trackingMode === 'serial' ? l.noSerial : 0), 0);

  const post = async () => {
    setBusy(true); setMsg(null);
    const r = await stockInAction({
      reason, note: note.trim() || null,
      lines: lines.filter((l) => l.qty > 0).map((l) => ({
        productId: l.product.id, qty: l.qty, serials: l.serials, noSerial: l.noSerial, lotNo: l.lotNo.trim() || null,
      })),
    });
    setBusy(false);
    if ('error' in r && r.error) { say(r.error); return; }
    if ('ok' in r) { setDone({ ref: r.ref, qty: r.qty, units: r.units, houseTags: r.houseTags }); commit([]); }
  };

  const input = 'w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm';

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader badge="SI" title="Stock in by scan" subtitle="Opening stock, stock found in a count, or a transfer in - with the real serials, no supplier" />
      {!canEdit && <p className="mb-3 rounded-md bg-warning/10 px-3 py-2 text-sm">You can see this screen but not change stock. Ask someone with Products - add / edit.</p>}
      {done && (
        <div role="status" className="mb-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm">
          <b>{done.ref}</b>: {done.qty} item{done.qty === 1 ? '' : 's'} in stock{done.units ? `, ${done.units} named unit${done.units === 1 ? '' : 's'}` : ''}.
          {done.houseTags.length > 0 && <> House tags to print and stick: <span className="font-mono">{done.houseTags.join(', ')}</span> (<Link href="/stock-units" className="text-brand hover:underline">Serial &amp; Batch Stock</Link>).</>}
        </div>
      )}

      <div className="grid gap-4">
        <SectionCard title="Why is it coming in?" icon="info">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reason">
              <select className={input} value={reason} onChange={(e) => setReason(e.target.value as StockInReason)}>
                {(Object.keys(STOCK_IN_REASONS) as StockInReason[]).map((k) => <option key={k} value={k}>{STOCK_IN_REASONS[k]}</option>)}
              </select>
            </Field>
            <Field label={reason === 'other' ? 'Where from (required)' : 'Note'}>
              <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === 'transfer_in' ? 'From which branch' : 'Optional'} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Scan the items" icon="scan">
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Scan a barcode or serial" className={`${input} min-w-0 flex-1 font-mono`} value={wedge} disabled={!canEdit}
              onChange={(e) => setWedge(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = wedge; setWedge(''); void handle(v); } }}
              placeholder="Scan a barcode or serial - each Enter adds it" />
            <ScanButton label="Camera" disabled={!canEdit} title="Stock in by scan" hint="Barcodes add their product; serials go to the line waiting for them."
              onScanMany={(codes) => { void (async () => { for (const c of codes) await handle(c); })(); }} />
            <Button size="sm" icon="plus" disabled={!canEdit} onClick={() => setAdding(true)}>Add by name</Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Barcode = which product (+1 each scan). Serial = which box. A box with no readable serial: scan its barcode - it gets a house tag.</p>
          {msg && <p role="status" className={`mt-2 rounded-md px-2 py-1 text-xs ${msg.tone === 'ok' ? 'bg-success/10 text-success' : msg.tone === 'bad' ? 'bg-danger/10 text-danger' : msg.tone === 'warn' ? 'bg-warning/10 text-warning' : 'bg-brand/10 text-brand'}`}>{msg.text}</p>}
          {ask && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => { setCreate({ barcode: ask, serial: null }); setAsk(null); }}>It&apos;s the product barcode</Button>
              {waiting() >= 0 && <Button size="sm" onClick={() => { say(toWaiting(ask)); setAsk(null); }}>It&apos;s a serial for {lines[waiting()]?.product.name}</Button>}
            </div>
          )}
          {adding && (
            <WithFormOptions need={['stockProducts']} onClose={() => setAdding(false)}>
              {(o) => (
                <select aria-label="Add a product" className={`${input} mt-2`} defaultValue="" onChange={(e) => {
                  const p = o.stockProducts.find((x) => x.id === e.target.value);
                  if (p) { say(apply({ id: p.id, code: p.code, name: p.name, trackingMode: p.trackingMode }, null) || `ok:${p.name} +1.`); setAdding(false); }
                }}>
                  <option value="">Choose a product…</option>
                  {o.stockProducts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                </select>
              )}
            </WithFormOptions>
          )}

          <ul className="mt-3 divide-y divide-border rounded-md border border-border">
            {lines.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">Nothing yet. Scan the first barcode.</li>}
            {lines.map((l, i) => (
              <li key={l.product.id} className={`grid gap-1.5 px-3 py-2.5 ${active === i ? 'bg-brand/[0.04]' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{l.product.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{l.product.code}</span>
                  <span className="text-micro uppercase tracking-wide text-muted-foreground">{TRACKING_MODE_LABEL[l.product.trackingMode as TrackingMode] ?? l.product.trackingMode}</span>
                  <span className="ms-auto flex items-center gap-1.5 text-sm">
                    {l.product.trackingMode !== 'serial' && (
                      <input aria-label={`Quantity of ${l.product.name}`} className="w-20 rounded-md border border-border bg-card px-2 py-1 text-right tabular-nums" inputMode="numeric"
                        value={l.qty} onChange={(e) => commit(lines.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : x)))} />
                    )}
                    {l.product.trackingMode === 'serial' && <b className="tabular-nums">{l.qty}</b>}
                    <button type="button" aria-label={`Remove ${l.product.name}`} className="text-muted-foreground hover:text-danger" onClick={() => commit(lines.filter((_, j) => j !== i))}><Icon name="x" className="h-4 w-4" /></button>
                  </span>
                </div>
                {l.product.trackingMode === 'batch' && (
                  <input className={`${input} text-xs`} placeholder="Lot / batch number *" value={l.lotNo}
                    onChange={(e) => commit(lines.map((x, j) => (j === i ? { ...x, lotNo: e.target.value } : x)))} />
                )}
                {l.product.trackingMode === 'serial' && (
                  <p className="flex flex-wrap gap-1.5 text-xs">
                    {l.serials.map((s) => (
                      <button key={s} type="button" className="rounded-full bg-success/10 px-2 py-0.5 font-mono text-on-tint-success hover:bg-danger/10 hover:text-danger"
                        onClick={() => commit(lines.map((x, j) => (j === i ? { ...x, serials: x.serials.filter((y) => y !== s), qty: x.qty - 1 } : x)))} title="Remove">{s} ×</button>
                    ))}
                    {l.noSerial > 0 && (
                      <button type="button" className="rounded-full bg-accent/15 px-2 py-0.5 text-accent hover:bg-danger/10 hover:text-danger"
                        onClick={() => commit(lines.map((x, j) => (j === i ? { ...x, noSerial: x.noSerial - 1, qty: x.qty - 1 } : x)))}>{l.noSerial} without a serial - house tag{l.noSerial === 1 ? '' : 's'} ×</button>
                    )}
                    {l.qty === 0 && <span className="text-muted-foreground">Scan each box&apos;s serial.</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </SectionCard>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="me-auto text-xs text-muted-foreground">
            {total > 0 ? `${total} item${total === 1 ? '' : 's'} will come into stock as "${STOCK_IN_REASONS[reason]}"${tags ? `, ${tags} getting a house tag` : ''}. Checked like a receipt: no serial twice, none already on file.` : 'Scan to start.'}
          </p>
          <Button variant="primary" icon="check" disabled={!canEdit || total === 0 || busy} loading={busy} onClick={post}>Bring into stock</Button>
        </div>
      </div>

      {create && (
        <QuickProductDialog barcode={create.barcode} actionLabel="Save and add" onClose={() => setCreate(null)}
          onCreated={(p) => { say(apply({ id: p.id, code: p.code, name: p.name, trackingMode: p.trackingMode }, create.serial) || `ok:${p.name} created and added.`); setCreate(null); }} />
      )}
    </div>
  );
}
