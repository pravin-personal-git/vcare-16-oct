'use client';

import { useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge, Field, EmptyState } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { FULFILMENT_LABEL, canInvoice, type FulfilmentStatus } from '@/lib/sales-order-status';
import { convertOrder } from './actions';

export interface InvoiceableOrder {
  id: string;
  orderNo: string;
  customerName: string;
  organizationName: string | null;
  grandTotalPaise: number;
  amountPaidPaise: number;
  fulfilmentStatus: FulfilmentStatus;
  /** The business's own stage name (G3). */
  stageLabel?: string;
  orderDate: Date;
}

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

const TERMS = [
  { days: 0, label: 'Due on issue' },
  { days: 7, label: 'Net 7 days' },
  { days: 15, label: 'Net 15 days' },
  { days: 30, label: 'Net 30 days' },
  { days: 45, label: 'Net 45 days' },
  { days: 60, label: 'Net 60 days' },
];

/**
 * Convert a sales order into an invoice.
 *
 * Dispatched orders are listed first because those are the ones that should be
 * invoiced - the goods have left. Undispatched ones are still offered, and
 * labelled, because advance billing is a real and legitimate practice. What we
 * do not do is silently allow it without saying which is which.
 */
export function ConvertOrder({
  orders, onClose,
}: {
  orders: InvoiceableOrder[];
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [termsDays, setTermsDays] = useState(0);
  const [search, setSearch] = useState('');

  const ranked = [...orders].sort(
    (a, b) => Number(canInvoice(b.fulfilmentStatus)) - Number(canInvoice(a.fulfilmentStatus)),
  );

  const q = search.trim().toLowerCase();
  const list = q
    ? ranked.filter((x) =>
        `${x.orderNo} ${x.customerName} ${x.organizationName ?? ''}`.toLowerCase().includes(q))
    : ranked;

  const chosen = orders.find((o) => o.id === selected);

  const submit = () => {
    if (!selected) return;
    setError(null);
    start(async () => {
      const r = await convertOrder(selected, { termsDays });
      if (r.error) { setError(r.error); return; }
      if (r.id) { window.location.href = `/invoices/${r.id}`; return; }
      window.location.reload();
    });
  };

  return (
    <Modal
      title="Convert Order to Invoice"
      subtitle="Line items and figures are copied. The order is then marked invoiced."
      icon="receipt"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {chosen && (
            <span className="text-xs text-muted-foreground">
              {chosen.orderNo} ·{' '}
              <strong className="font-mono text-foreground">
                {formatCurrency(chosen.grandTotalPaise)}
              </strong>
            </span>
          )}
          <div className="ms-auto flex gap-2">
            <Button variant="outline" icon="x" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary" icon="receipt"
              onClick={submit} loading={pending} disabled={!selected}
            >
              Create invoice
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="relative">
          <Icon
            name="search"
            className="pointer-events-none absolute start-0 top-1/2 ms-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order no or customer…"
            className="field-input ps-9"
          />
        </div>

        <div className="thin-scroll max-h-80 overflow-y-auto rounded-lg border border-border bg-card">
          {list.map((o) => {
            const ready = canInvoice(o.fulfilmentStatus);
            return (
              <label
                key={o.id}
                className={`flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 transition last:border-b-0 hover:bg-muted/60 ${
                  selected === o.id ? 'bg-brand/[0.07]' : ''
                }`}
              >
                <input
                  type="radio" name="order" checked={selected === o.id}
                  onChange={() => setSelected(o.id)}
                  className="h-3.5 w-3.5 accent-[hsl(var(--brand-primary))]"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-semibold text-brand">{o.orderNo}</p>
                  <p className="truncate text-sm">{o.organizationName ?? o.customerName}</p>
                </div>
                <Badge tone={ready ? 'success' : 'neutral'}>
                  {ready ? (o.stageLabel ?? FULFILMENT_LABEL[o.fulfilmentStatus]) : 'Not dispatched'}
                </Badge>
                <div className="shrink-0 text-end">
                  <p className="font-mono text-xs font-semibold tabular-nums">
                    {formatCurrency(o.grandTotalPaise)}
                  </p>
                  <p className="text-xs text-muted-foreground">{fmt(o.orderDate)}</p>
                </div>
              </label>
            );
          })}
          {list.length === 0 && (
            <EmptyState
              icon="shopping-cart"
              title="Nothing waiting to be invoiced"
              hint="Orders appear here until they have an invoice. Cancelled and failed orders are not listed."
            />
          )}
        </div>

        <Field
          label="Payment terms"
          hint="Sets the due date, which is what makes an invoice go overdue."
        >
          <select
            value={termsDays}
            onChange={(e) => setTermsDays(Number(e.target.value))}
            className="field-input"
          >
            {TERMS.map((t) => (
              <option key={t.days} value={t.days}>{t.label}</option>
            ))}
          </select>
        </Field>

        {chosen && chosen.amountPaidPaise > 0 && (
          <p className="flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-xs text-on-tint-success">
            <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>{formatCurrency(chosen.amountPaidPaise)}</strong> already
              received against this order comes across to the invoice. The money
              did not move - only the document it hangs off.
            </span>
          </p>
        )}

        {chosen && !canInvoice(chosen.fulfilmentStatus) && (
          <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-xs text-on-tint-warning">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              These goods have not been dispatched yet. Billing in advance is
              legitimate, but the invoice date will precede the delivery - make
              sure that is what you intend.
            </span>
          </p>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          The invoice is created as a <strong>draft</strong> so you can check it
          before it goes out. Nothing is sent until you issue it.
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
