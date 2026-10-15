'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Badge, Field } from '@/components/ui/Layout';
import { formatCurrency } from '@/lib/format';
import type { PurchaseHistoryRow } from '@/server/product-cost';
import { addPurchasePrice, getPurchaseHistory } from './cost-actions';

/**
 * Record what a product was bought for, and show what it has been bought for.
 *
 * The history is the point, not decoration. The cost figure on the grid is
 * derived from these rows, so the honest way to present it is to let someone
 * open it and see the three purchases the average came from. A margin nobody
 * can interrogate is a margin nobody should act on.
 *
 * There is no edit or delete. A wrong entry is corrected by recording the right
 * one - the same rule as the stock ledger, and for the same reason: the history
 * IS the valuation basis, so changing it retrospectively moves profit figures
 * that have already been reported.
 */

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function PurchasePriceDialog({
  product, onClose,
}: {
  product: { id: string; productName: string; productCode: string; dlpPaise: number };
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<PurchaseHistoryRow[] | null>(null);

  const [cost, setCost] = useState('');
  const [qty, setQty] = useState('1');
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');

  const load = () => {
    getPurchaseHistory(product.id).then((r) => {
      setHistory(r.rows);
      if (r.error) setError(r.error);
    });
  };

  useEffect(load, [product.id]);

  const costPaise = Math.round((Number(cost.replace(/,/g, '')) || 0) * 100);
  const qtyNum = Math.trunc(Number(qty) || 0);
  const valid = costPaise > 0 && qtyNum > 0;

  // Margin this purchase would imply against the current selling price. Shown
  // live, because "am I still making money at this buying price" is the actual
  // question someone is asking while they type.
  //
  // Three states, not two. An earlier version collapsed "you have not typed a
  // cost yet" into "this product has no selling price", so a product with a
  // perfectly good DLP was reported as having none the moment the field was
  // empty - which is a message that sends someone off to fix a problem that
  // does not exist.
  const noSellingPrice = product.dlpPaise <= 0;
  const impliedMargin = costPaise > 0 && !noSellingPrice
    ? ((product.dlpPaise - costPaise) / product.dlpPaise) * 100
    : null;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await addPurchasePrice({
        productId: product.id,
        unitCostPaise: costPaise,
        qty: qtyNum,
        purchasedAt: when || null,
        reference: reference.trim() || null,
        note: null,
      });
      if (res.error) { setError(res.error); return; }
      setCost('');
      setReference('');
      load();
    });
  };

  return (
    <Modal
      title="Purchase price"
      subtitle={`${product.productName} · ${product.productCode}`}
      icon="truck"
      size="lg"
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="grid gap-4">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            Record a purchase
          </p>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Unit cost ₹" required hint="Excluding tax" htmlFor="pp-cost">
              <input
                id="pp-cost" value={cost} autoFocus inputMode="decimal"
                onChange={(e) => setCost(e.target.value)} className={inputClass}
              />
            </Field>
            <Field label="Quantity" required htmlFor="pp-qty">
              <input
                id="pp-qty" value={qty} inputMode="numeric"
                onChange={(e) => setQty(e.target.value)} className={inputClass}
              />
            </Field>
            <Field label="Purchased on" htmlFor="pp-when">
              <input
                id="pp-when" type="date" value={when}
                onChange={(e) => setWhen(e.target.value)} className={inputClass}
              />
            </Field>
            <Field label="Bill / reference" htmlFor="pp-ref">
              <input
                id="pp-ref" value={reference}
                onChange={(e) => setReference(e.target.value)} className={inputClass}
              />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {noSellingPrice ? (
                'This product has no selling price, so no margin can be shown.'
              ) : impliedMargin === null ? (
                <>Enter a unit cost to see the margin it would leave on {formatCurrency(product.dlpPaise)}.</>
              ) : (
                <>
                  At this cost the margin on {formatCurrency(product.dlpPaise)} would be{' '}
                  <strong className={impliedMargin < 0 ? 'text-danger' : 'text-success'}>
                    {impliedMargin.toFixed(1)}%
                  </strong>
                </>
              )}
            </p>
            <Button variant="primary" icon="plus" loading={pending} disabled={!valid} onClick={submit}>
              Record
            </Button>
          </div>
        </div>

        <div>
          <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            History
          </p>

          {history === null ? (
            <p className="px-1 py-4 text-sm text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing recorded yet. Until there is, this product has no cost - so no margin and no
              stock value.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 text-right font-semibold">Unit cost</th>
                    <th className="px-3 py-2 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2 font-semibold">Reference</th>
                    <th className="px-3 py-2 font-semibold">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={h.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5">
                        {new Date(h.purchasedAt).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
                          day: '2-digit', month: 'short', year: 'numeric',
                        })}
                        {i < 3 && (
                          <Badge tone="info" className="ms-1.5">in average</Badge>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {formatCurrency(h.unitCostPaise)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{h.qty}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{h.reference ?? '-'}</td>
                      <td className="px-3 py-1.5">
                        <Badge tone={h.source === 'grn' ? 'success' : 'neutral'}>
                          {h.source === 'grn' ? 'Goods receipt' : 'Entered by hand'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-2 text-xs text-muted-foreground">
            Append-only - a wrong entry is corrected by recording the right one, never by editing
            history. These rows <em>are</em> the valuation basis, so changing one retrospectively
            moves a profit figure that has already been reported.
          </p>
        </div>
      </div>
    </Modal>
  );
}
