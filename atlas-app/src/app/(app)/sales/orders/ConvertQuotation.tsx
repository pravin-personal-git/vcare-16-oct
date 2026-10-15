'use client';

import { useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge, Field, EmptyState } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { convertQuotation } from './actions';
import { ask } from '@/components/ui/ask';

export interface ConvertibleQuotation {
  id: string;
  quotationNo: string;
  customerName: string;
  organizationName: string | null;
  grandTotalPaise: number;
  status: string;
  quotationDate: Date;
}

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Convert a quotation into an order.
 *
 * Accepted quotations are the intended path and are listed first. Sent and
 * draft ones are still offered, because customers confirm on the phone and
 * nobody remembers to press Accept first - but they are labelled, so converting
 * one is a visible choice rather than an accident.
 */
export function ConvertQuotation({
  quotations, onClose,
}: {
  quotations: ConvertibleQuotation[];
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [expected, setExpected] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [search, setSearch] = useState('');

  const ranked = [...quotations].sort((a, b) => {
    const rank = (s: string) => (s === 'accepted' ? 0 : s === 'sent' ? 1 : 2);
    return rank(a.status) - rank(b.status);
  });

  const q = search.trim().toLowerCase();
  const list = q
    ? ranked.filter((x) =>
        `${x.quotationNo} ${x.customerName} ${x.organizationName ?? ''}`.toLowerCase().includes(q))
    : ranked;

  const submit = () => {
    if (!selected) return;
    setError(null);
    start(async () => {
      const r = await convertQuotation(selected, {
        expectedDeliveryDate: expected || null,
        requiresApproval,
      });
      if (r.error) setError(r.error);
      else { if (r.message) await ask.tell(r.message); onClose(); window.location.reload(); }
    });
  };

  return (
    <Modal
      title="Convert Quotation to Order"
      subtitle="Line items and prices are copied. The quotation is then locked."
      icon="rotate-ccw"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          {selected && (
            <span className="me-auto text-xs text-muted-foreground">
              {quotations.find((x) => x.id === selected)?.quotationNo} selected
            </span>
          )}
          <Button variant="outline" icon="x" onClick={onClose} className="ms-auto">Cancel</Button>
          <Button
            variant="primary" icon="shopping-cart"
            onClick={submit} loading={pending} disabled={!selected}
          >
            Create order
          </Button>
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
            placeholder="Search quotation no or customer…"
            className="field-input ps-9"
          />
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {list.map((x) => (
            <label
              key={x.id}
              className={`flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 transition last:border-b-0 hover:bg-muted/60 ${
                selected === x.id ? 'bg-brand/[0.07]' : ''
              }`}
            >
              <input
                type="radio" name="quotation" checked={selected === x.id}
                onChange={() => setSelected(x.id)}
                className="h-3.5 w-3.5 accent-[hsl(var(--brand-primary))]"
              />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs font-semibold text-brand">{x.quotationNo}</p>
                <p className="truncate text-sm">{x.organizationName ?? x.customerName}</p>
              </div>
              <Badge
                tone={x.status === 'accepted' ? 'success' : x.status === 'sent' ? 'info' : 'neutral'}
              >
                {x.status === 'accepted' ? 'Accepted' : x.status === 'sent' ? 'Sent' : 'Draft'}
              </Badge>
              <div className="shrink-0 text-end">
                <p className="font-mono text-xs font-semibold tabular-nums">
                  {formatCurrency(x.grandTotalPaise)}
                </p>
                <p className="text-xs text-muted-foreground">{fmt(x.quotationDate)}</p>
              </div>
            </label>
          ))}
          {list.length === 0 && (
            <EmptyState
              icon="file-text"
              title="No quotations available to convert"
              hint="Already-converted and rejected quotations are not listed."
            />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Expected delivery"
            hint="Leave blank if the date is not agreed yet."
          >
            <input
              type="date" value={expected}
              onChange={(e) => setExpected(e.target.value)}
              className="field-input"
            />
          </Field>

          <label
            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition ${
              requiresApproval ? 'border-brand bg-brand/[0.06]' : 'border-border bg-card hover:bg-muted/50'
            }`}
          >
            <input
              type="checkbox" checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[hsl(var(--brand-primary))]"
            />
            <span>
              <span className="block text-sm font-medium">Needs approval first</span>
              <span className="block text-xs text-muted-foreground">
                Starts at Pending Approval instead of Order Booked. Nothing can
                be packed until someone with approval rights confirms it.
              </span>
            </span>
          </label>
        </div>

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
