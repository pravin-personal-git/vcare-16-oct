'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Layout';
import { TRACKING_MODES, TRACKING_MODE_HINT, TRACKING_MODE_LABEL, type TrackingMode } from '@/lib/stock-tracking';
import { scanShape } from '@/lib/scan/decode';
import {
  createProductFromScanAction, quickProductOptionsAction, type CreatedProduct,
} from '@/app/(app)/products/scan-actions';
import { ScanButton } from './ScanButton';

/**
 * NEW PRODUCT FROM A SCAN (Scan-to-Stock G2/G5, 12 Oct 2026).
 *
 * The short form the approved demo showed: name, barcode (filled from the
 * scan and locked), category, tracking (suggested from what that category's
 * products mostly use), unit, buying and selling price (both may wait - the
 * product then shows "price missing"), GST. Opened from the header scanner,
 * a receipt line and the product list; `onCreated` hands the new product
 * back so the caller can drop it straight into its line.
 */
const toPaise = (v: string): number | null => {
  const t = v.replace(/,/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export function QuickProductDialog({ barcode, name = '', onCreated, onClose, actionLabel = 'Save product' }: {
  /** The scanned barcode - locked when given. */
  barcode?: string | null;
  name?: string;
  onCreated: (p: CreatedProduct) => void;
  onClose: () => void;
  actionLabel?: string;
}) {
  const [opts, setOpts] = useState<{ canCreate: boolean; categories: { id: string; name: string; suggestedTracking: TrackingMode }[] } | null>(null);
  const [f, setF] = useState({
    productName: name, barcode: barcode ?? '', categoryId: '', trackingMode: 'quantity' as TrackingMode,
    trackingTouched: false, unit: 'pcs', cost: '', sell: '', taxRatePct: '18', hsnCode: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = !!barcode;
  const shape = f.barcode.trim() ? scanShape(f.barcode) : null;

  useEffect(() => { quickProductOptionsAction().then(setOpts).catch(() => setOpts({ canCreate: false, categories: [] })); }, []);

  const pickCategory = (id: string) => {
    const c = opts?.categories.find((x) => x.id === id);
    setF((p) => ({ ...p, categoryId: id, trackingMode: p.trackingTouched || !c ? p.trackingMode : c.suggestedTracking }));
  };

  const save = async () => {
    setBusy(true); setError(null);
    const r = await createProductFromScanAction({
      productName: f.productName, barcode: f.barcode.trim() || null, categoryId: f.categoryId || null,
      trackingMode: f.trackingMode, unit: f.unit, costPaise: toPaise(f.cost), sellPaise: toPaise(f.sell),
      taxRatePct: Number(f.taxRatePct), hsnCode: f.hsnCode.trim() || null,
    });
    setBusy(false);
    if (r.error || !r.product) { setError(r.error ?? 'Could not create the product.'); return; }
    onCreated(r.product);
  };

  const input = 'w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm';
  const suggested = opts?.categories.find((c) => c.id === f.categoryId)?.suggestedTracking;

  return (
    <Modal
      title="New product"
      subtitle={locked ? `From the scan ${barcode}` : 'Quick form - the rest can be filled in later from Products'}
      icon="package"
      size="md"
      onClose={onClose}
      footer={opts?.canCreate ? (
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!f.productName.trim()}>{actionLabel}</Button>
        </div>
      ) : undefined}
    >
      {!opts && <p className="text-sm text-muted-foreground">Loading…</p>}
      {opts && !opts.canCreate && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
          You can&apos;t add products with your role. Ask someone who can (Products - add / edit), and give them the
          barcode <span className="font-mono font-semibold">{barcode ?? f.barcode}</span>.
        </p>
      )}
      {opts?.canCreate && (
        <div className="grid gap-3">
          {error && <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-on-tint-danger">{error}</p>}
          <Field label="Name">
            <input className={input} value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} placeholder="Hikvision 2MP Dome DS-2CE56D0T" />
          </Field>
          <Field label="Barcode" hint={locked ? 'From the scan - locked' : shape ? shape.why : 'The maker\'s barcode on the box, if there is one'}>
            <div className="flex gap-1.5">
              <input className={`${input} font-mono ${locked ? 'bg-muted/50' : ''}`} value={f.barcode} readOnly={locked}
                onChange={(e) => setF({ ...f, barcode: e.target.value })} placeholder="8904130896422" />
              {!locked && <ScanButton onScan={(c) => setF((p) => ({ ...p, barcode: c }))} title="Scan the barcode" />}
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category">
              <select className={input} value={f.categoryId} onChange={(e) => pickCategory(e.target.value)}>
                <option value="">No category (code GEN-…)</option>
                {opts.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Tracking" hint={suggested && !f.trackingTouched ? `Suggested: most ${opts.categories.find((c) => c.id === f.categoryId)?.name} products use this` : TRACKING_MODE_HINT[f.trackingMode]}>
              <select className={input} value={f.trackingMode} onChange={(e) => setF({ ...f, trackingMode: e.target.value as TrackingMode, trackingTouched: true })}>
                {TRACKING_MODES.map((m) => <option key={m} value={m}>{TRACKING_MODE_LABEL[m]}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Unit">
              <select className={input} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
                {['pcs', 'nos', 'box', 'set', 'mtr', 'roll', 'kg', 'ltr'].map((u) => <option key={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Buying ₹">
              <input className={`${input} text-right tabular-nums`} inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="Later" />
            </Field>
            <Field label="Selling ₹">
              <input className={`${input} text-right tabular-nums`} inputMode="decimal" value={f.sell} onChange={(e) => setF({ ...f, sell: e.target.value })} placeholder="Later" />
            </Field>
            <Field label="GST">
              <select className={input} value={f.taxRatePct} onChange={(e) => setF({ ...f, taxRatePct: e.target.value })}>
                {['0', '5', '12', '18', '28'].map((g) => <option key={g} value={g}>{g}%</option>)}
              </select>
            </Field>
          </div>
          <Field label="HSN code" hint="Optional">
            <input className={`${input} font-mono`} value={f.hsnCode} onChange={(e) => setF({ ...f, hsnCode: e.target.value })} />
          </Field>
          {!f.sell.trim() && (
            <p className="text-xs text-muted-foreground">No selling price yet: the product shows <b>price missing</b> on the products list until one is set.</p>
          )}
          <p className="text-xs text-muted-foreground">Atlas makes the product code from the category. A barcode another product already has is refused.</p>
        </div>
      )}
    </Modal>
  );
}
