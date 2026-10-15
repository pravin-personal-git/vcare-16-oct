'use client';

import { useMemo, useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge, Field, EmptyState } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import type { BillableCustomer, ConsolidatedDraft } from '@/server/consolidated-invoice';
import { billSite, previewSiteBill } from './actions';

/**
 * One bill for a whole site.
 *
 * `ConvertOrder` next door takes one order and makes one invoice. That is right
 * for a shop that sells by the order. It is wrong for Vcare, who sell by the
 * site: a job runs for weeks, three technicians raise three challans, the
 * customer adds two cameras halfway through on a second order, and at the end
 * they expect ONE document.
 *
 * Three steps, deliberately, rather than one button:
 *
 *   1. WHO. Customers with unbilled work, not a flat list of challans - the
 *      decision being made is "what do I bill Shree Ram Textiles for?", and a
 *      list of 200 challans makes somebody sort that out themselves.
 *   2. WHAT. Their challans, all ticked, because billing everything outstanding
 *      is the normal case and un-ticking is the exception.
 *   3. CHECK. What the bill will actually say, before it exists. Once it does,
 *      the challans are marked billed and undoing it is a cancellation - so the
 *      preview is the moment somebody can still change their mind cheaply.
 */

const TERMS = [
  { days: 0, label: 'Due on issue' },
  { days: 7, label: 'Net 7 days' },
  { days: 15, label: 'Net 15 days' },
  { days: 30, label: 'Net 30 days' },
  { days: 45, label: 'Net 45 days' },
  { days: 60, label: 'Net 60 days' },
];

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  });

export function BillSite({ customers, onClose }: {
  customers: BillableCustomer[];
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<ConsolidatedDraft | null>(null);
  const [termsDays, setTermsDays] = useState(0);
  const [search, setSearch] = useState('');

  const customer = customers.find((c) => c.partyId === partyId) ?? null;

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      `${c.customerName} ${c.organizationName ?? ''}`.toLowerCase().includes(q));
  }, [customers, search]);

  const choose = (c: BillableCustomer) => {
    setPartyId(c.partyId);
    // Everything ticked. Billing all the outstanding work is the normal case;
    // holding one challan back is the exception, so make that the extra click.
    setPicked(new Set(c.challans.map((ch) => ch.id)));
    setDraft(null);
    setError(null);
  };

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setDraft(null);
  };

  const preview = () => {
    if (!customer) return;
    setError(null);
    start(async () => {
      const r = await previewSiteBill([...picked], customer.orders.map((o) => o.id));
      if (r.error) { setError(r.error); setDraft(null); return; }
      setDraft(r.draft ?? null);
    });
  };

  const raise = () => {
    if (!customer || !draft) return;
    setError(null);
    start(async () => {
      const r = await billSite([...picked], customer.orders.map((o) => o.id), { termsDays });
      if (r.error) { setError(r.error); return; }
      if (r.id) { window.location.href = `/invoices/${r.id}`; return; }
      window.location.reload();
    });
  };

  const net = draft
    ? draft.lines.reduce(
        (t, l) => t + Math.round(l.qty * l.unitPricePaise * (1 - l.discountPct / 100)), 0)
    : 0;

  return (
    <Modal
      title="Bill a site"
      subtitle="One invoice covering every challan and order for one customer."
      icon="receipt"
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {draft && (
            <span className="text-xs text-muted-foreground">
              {draft.lines.length} line{draft.lines.length === 1 ? '' : 's'} ·{' '}
              <strong className="font-mono text-foreground">{formatCurrency(net)}</strong>
              {' '}before tax
            </span>
          )}
          <div className="ms-auto flex gap-2">
            <Button variant="outline" icon="x" onClick={onClose}>Cancel</Button>
            {!draft ? (
              <Button
                variant="primary" icon="search"
                onClick={preview} loading={pending} disabled={picked.size === 0}
              >
                Work out the bill
              </Button>
            ) : (
              <Button variant="primary" icon="receipt" onClick={raise} loading={pending}>
                Raise this invoice
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-on-tint-danger">
            {error}
          </p>
        )}

        {/* ---- 1. who ---------------------------------------------------- */}
        {!customer && (
          <>
            <div className="relative">
              <Icon
                name="search"
                className="pointer-events-none absolute start-0 top-1/2 ms-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer…"
                className="field-input ps-9"
              />
            </div>

            <div className="thin-scroll max-h-80 overflow-y-auto rounded-lg border border-border bg-card">
              {list.map((c) => (
                <button
                  key={c.partyId}
                  type="button"
                  onClick={() => choose(c)}
                  className="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-start transition last:border-b-0 hover:bg-muted/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {c.organizationName ?? c.customerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.challans.length} challan{c.challans.length === 1 ? '' : 's'} ·{' '}
                      {c.orders.length} order{c.orders.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <Icon name="chevron-right" className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
              {list.length === 0 && (
                <EmptyState
                  icon="receipt"
                  title="No unbilled work"
                  hint="Challans appear here once they have been dispatched and until they are on an invoice. Rejected work is never listed."
                />
              )}
            </div>
          </>
        )}

        {/* ---- 2. what --------------------------------------------------- */}
        {customer && (
          <>
            <div className="flex items-center gap-2">
              <Button variant="outline" icon="chevron-left" onClick={() => { setPartyId(null); setDraft(null); }}>
                Another customer
              </Button>
              <p className="truncate text-sm font-medium">
                {customer.organizationName ?? customer.customerName}
              </p>
            </div>

            <div className="thin-scroll max-h-56 overflow-y-auto rounded-lg border border-border bg-card">
              {customer.challans.map((ch) => (
                <label
                  key={ch.id}
                  className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 transition last:border-b-0 hover:bg-muted/60"
                >
                  <input
                    type="checkbox"
                    checked={picked.has(ch.id)}
                    onChange={() => toggle(ch.id)}
                    className="h-3.5 w-3.5 accent-[hsl(var(--brand-primary))]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-semibold text-brand">{ch.challanNo}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmt(ch.dispatchedAt)} · {ch.itemCount} line{ch.itemCount === 1 ? '' : 's'} ·{' '}
                      {ch.totalQty} item{ch.totalQty === 1 ? '' : 's'}
                      {ch.orderNo ? ` · ${ch.orderNo}` : ''}
                    </p>
                  </div>
                  {ch.status !== 'approved' && <Badge tone="neutral">{ch.status.replace('_', ' ')}</Badge>}
                </label>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Goods are billed from the challans — what actually left the building. Labour and
              charges come from the {customer.orders.length === 1 ? 'order' : 'orders'}{' '}
              ({customer.orders.map((o) => o.orderNo).join(', ')}), because no challan can carry them.
            </p>
          </>
        )}

        {/* ---- 3. check -------------------------------------------------- */}
        {draft && (
          <div className="space-y-3 rounded-lg border border-brand/40 bg-brand/[0.04] p-3">
            {draft.warnings.map((w) => (
              <p key={w} className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning-foreground">
                <Icon name="alert-triangle" className="me-1 inline h-3.5 w-3.5" />
                {w}
              </p>
            ))}

            <div className="thin-scroll max-h-72 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-start text-micro uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 text-start font-semibold">Charge</th>
                    <th className="py-1.5 text-end font-semibold">Qty</th>
                    <th className="py-1.5 text-end font-semibold">Rate</th>
                    <th className="py-1.5 text-start font-semibold ps-3">From</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.lines.map((l, i) => (
                    <tr key={`${l.productId ?? l.productName}-${i}`} className="border-b border-border/60 last:border-b-0">
                      <td className="py-1.5 pe-2">
                        {l.productName}
                        {l.pricedFromCatalogue && (
                          <Badge tone="warning" className="ms-1.5">catalogue price</Badge>
                        )}
                      </td>
                      <td className="py-1.5 text-end font-mono tabular-nums">{l.qty}</td>
                      <td className="py-1.5 text-end font-mono tabular-nums">
                        {formatCurrency(l.unitPricePaise)}
                      </td>
                      <td className="py-1.5 ps-3 font-mono text-xs text-muted-foreground">
                        {/*
                          One entry per document. A challan that fitted three
                          cameras has three lines, one per barcode, and
                          "ECHN-0515 (1) · ECHN-0515 (1) · ECHN-0515 (1)" reads
                          as a glitch rather than as information.
                        */}
                        {Object.entries(
                          l.sources.reduce<Record<string, number>>(
                            (acc, s) => ({ ...acc, [s.docNo]: (acc[s.docNo] ?? 0) + s.qty }), {}),
                        ).map(([doc, qty]) => `${doc} (${qty})`).join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {draft.advances.length > 0 && (
              <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs">
                <p className="mb-1 font-medium">
                  Advances already received — applied to this invoice when it is raised
                </p>
                {draft.advances.map((a) => (
                  <p key={a.id} className="text-muted-foreground">
                    <span className="font-mono">{a.receiptNo}</span> ·{' '}
                    {formatCurrency(a.heldPaise)} · collected on{' '}
                    <span className="font-mono">{a.against}</span> · {fmt(a.receivedAt)}
                  </p>
                ))}
                <p className="mt-1 font-medium">
                  {formatCurrency(draft.advancePaise)} comes off the bill.
                </p>
              </div>
            )}

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
          </div>
        )}
      </div>
    </Modal>
  );
}
