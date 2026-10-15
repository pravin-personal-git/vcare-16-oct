'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { adjustStock } from './actions';
import { ask } from '@/components/ui/ask';

/**
 * Correcting a stock figure by counting.
 *
 * You type what you counted, not the difference. Asking for a difference means
 * doing arithmetic in your head while standing at a shelf, and getting the sign
 * wrong there writes the error in at twice the size.
 *
 * Both numbers go into the ledger - what was counted and what the system
 * believed - because six months later the gap is the only thing that explains
 * why the figure moved, and a bare delta has thrown that away.
 */

const REASONS = [
  'Physical stock count',
  'Opening stock was never entered',
  'Goods received but not recorded',
  'Damaged or written off',
  'Returned to supplier',
  'Correcting an earlier mistake',
];

export function StockAdjustDialog({
  product,
  onClose,
}: {
  product: { id: string; productName: string; productCode: string; currentQty: number; unit: string };
  onClose: () => void;
}) {
  const [counted, setCounted] = useState<string>('');
  const [reason, setReason] = useState(
    product.currentQty < 0 ? 'Opening stock was never entered' : 'Physical stock count',
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const countedNum = counted === '' ? null : Number(counted);
  const delta = countedNum === null ? null : countedNum - product.currentQty;

  const save = async () => {
    setError(null);
    if (countedNum === null) return setError('Enter what you counted.');
    setBusy(true);
    const res = await adjustStock({
      productId: product.id,
      countedQty: countedNum,
      note: [reason, note.trim()].filter(Boolean).join(' - '),
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    if (res.message) await ask.tell(res.message);
    onClose();
    window.location.reload();
  };

  return (
    <Modal
      title="Adjust Stock"
      subtitle={`${product.productName} · ${product.productCode}`}
      icon="package"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="outline" icon="x" onClick={onClose} className="ms-auto">Cancel</Button>
          <Button variant="primary" icon="check" loading={busy} onClick={save}>
            Record adjustment
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {product.currentQty < 0 && (
          <p className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-xs leading-relaxed text-on-tint-danger">
            <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              This product is at <strong>{product.currentQty} {product.unit}</strong>.
              More has gone out than ever came in, which usually means the
              opening stock was never entered. Count what is actually on the
              shelf and put that number below.
            </span>
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <p className="text-micro font-semibold uppercase text-muted-foreground">
              System says
            </p>
            <p className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${
              product.currentQty < 0 ? 'text-danger' : ''
            }`}>
              {product.currentQty}
              <span className="ms-1 text-xs font-normal text-muted-foreground">{product.unit}</span>
            </p>
          </div>
          <div className="rounded-lg border border-brand/30 bg-brand/[0.06] px-3 py-2.5">
            <p className="text-micro font-semibold uppercase text-brand">Change</p>
            <p className="mt-0.5 font-mono text-lg font-bold tabular-nums">
              {delta === null ? '-' : delta === 0 ? 'no change' : delta > 0 ? `+${delta}` : delta}
            </p>
          </div>
        </div>

        <Field
          label="Counted quantity"
          required
          hint="What is actually on the shelf. Not the difference - the system works that out."
        >
          <input
            type="number"
            min={0}
            step={1}
            value={counted}
            autoFocus
            onChange={(e) => setCounted(e.target.value)}
            placeholder="0"
            className="field-input font-mono text-lg"
          />
        </Field>

        <Field label="Reason" required>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="field-input"
          >
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>

        <Field label="Note" hint="Anything worth remembering - who counted, which shelf.">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="field-input"
          />
        </Field>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Both figures go into the stock ledger - what you counted and what the
          system believed. The difference on its own would not explain anything
          six months from now.
        </p>
        {/* G6 (12 Oct 2026): more stock with serials on the boxes belongs in Stock in by scan, which records them. */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Found more boxes that carry serial numbers? Use{' '}
          <Link href={`/products/stock-in?product=${product.id}`} className="font-semibold text-brand hover:underline">Stock in by scan</Link>{' '}
          instead, so their real serials are recorded.
        </p>

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
