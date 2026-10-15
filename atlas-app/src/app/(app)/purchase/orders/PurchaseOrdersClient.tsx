'use client';

import { SupplierLink } from '@/components/document/SupplierLink';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Card, Field, SectionCard, SummaryRow, StatusBadge } from '@/components/ui/Layout';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { useListParams } from '@/components/ui/useListParams';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { computeBillTotals } from '@/lib/purchase';
import {
  PO_STATUS_LABEL, canEdit as canEditStatus, canCancel,
  type PurchaseOrderStatus,
} from '@/lib/purchase-order-status';
import {
  createOrderAction, updateOrderAction, sendOrderAction, approveOrderAction,
  cancelOrderAction, loadOrderAction,
} from './actions';

interface PoVM {
  id: string;
  orderNo: string;
  partyId: string;
  supplierName: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  status: string;
  grandTotalPaise: number;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

interface SupplierVM { id: string; name: string; gstin: string | null; isSupplier: boolean }
interface ProductVM { id: string; name: string; code: string; hsnCode: string | null }

interface LineDraft {
  productId: string | null;
  productName: string;
  productCode: string | null;
  qty: string;
  unitCost: string;
  discountPct: string;
  taxRatePct: string;
}

const rupees = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' });

function toPaise(v: string): number {
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}


const blankLine = (): LineDraft => ({
  productId: null, productName: '', productCode: null, qty: '1', unitCost: '', discountPct: '0', taxRatePct: '18',
});

export function PurchaseOrdersClient({
  orders, paging, counts, status, rangeLabel, onOrderPaise, olderOpen, totalAll, canExport, views,
  suppliers, products, canEdit, canApprove, isSingleStore,
}: {
  /** One page, filtered on the server (server/po-list). */
  orders: PoVM[];
  paging: ServerPaging;
  counts: Record<string, number>;
  status: string | null;
  rangeLabel: string;
  onOrderPaise: number;
  olderOpen: number;
  totalAll: number;
  canExport: boolean;
  views: FilterBarViews;
  suppliers: SupplierVM[];
  products: ProductVM[];
  canEdit: boolean;
  canApprove: boolean;
  isSingleStore: boolean;
}) {
  const router = useRouter();
  const list = useListParams();
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<PoVM | null>(null);
  const [cancelling, setCancelling] = useState<PoVM | null>(null);
  const [busy, setBusy] = useState<string | boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const cards: KpiCard[] = [
    { key: 'draft', label: 'Drafts', count: counts.draft ?? 0, icon: 'file-text' },
    { key: 'sent', label: 'Awaiting approval', count: counts.sent ?? 0, icon: 'alert-circle', tone: (counts.sent ?? 0) > 0 ? 'warning' : 'default' },
    { key: 'approved', label: 'Approved', count: counts.approved ?? 0, icon: 'check-circle', tone: 'info' },
    { key: 'partially_received', label: 'Partly received', count: counts.partially_received ?? 0, icon: 'truck', tone: 'warning' },
    { key: 'received', label: 'Received', count: counts.received ?? 0, icon: 'check-circle', tone: 'success' },
    { key: 'cancelled', label: 'Cancelled', count: counts.cancelled ?? 0, icon: 'ban' },
  ];

  async function act(key: string, fn: () => Promise<{ error?: string; ok?: boolean }>) {
    setBusy(key);
    setError(null);
    const res = await fn();
    if (res.error) setError(res.error);
    setBusy(false);
    router.refresh();
    return !res.error;
  }

  const columns: Column<PoVM>[] = [
    {
      key: 'orderNo', header: 'Order', sortValue: (o) => o.orderNo,
      render: (o) => <Link href={`/purchase/orders/${o.id}`} className="font-mono text-xs font-medium text-brand hover:underline">{o.orderNo}</Link>,
    },
    {
      key: 'supplier', header: 'Supplier', sortValue: (o) => o.supplierName,
      render: (o) => <SupplierLink id={o.partyId} className="font-medium">{o.supplierName}</SupplierLink>,
    },
    {
      key: 'date', header: 'Order date', sortValue: (o) => new Date(o.orderDate).getTime(),
      render: (o) => <span className="text-xs">{fmtDate(o.orderDate)}</span>,
    },
    {
      key: 'expected', header: 'Expected', sortValue: (o) => (o.expectedDeliveryDate ? new Date(o.expectedDeliveryDate).getTime() : 0),
      render: (o) => <span className="text-xs">{o.expectedDeliveryDate ? fmtDate(o.expectedDeliveryDate) : '-'}</span>,
    },
    {
      key: 'total', header: 'Total', align: 'end', sortValue: (o) => o.grandTotalPaise,
      render: (o) => <span className="tabular-nums">{rupees(o.grandTotalPaise)}</span>,
    },
    {
      key: 'status', header: 'Status', sortValue: (o) => o.status,
      render: (o) => <StatusBadge status={o.status === 'approved' ? 'confirmed' : o.status === 'partially_received' ? 'partial' : o.status === 'received' ? 'done' : o.status} label={PO_STATUS_LABEL[o.status as PurchaseOrderStatus] ?? o.status} />,
    },
    {
      key: 'actions', header: '', align: 'end',
      render: (o) => (
        <div className="flex justify-end gap-1.5">
          {canEdit && canEditStatus(o.status as PurchaseOrderStatus) && (
            <Button size="sm" variant="outline" onClick={() => setEditing(o)}>Edit</Button>
          )}
          {canEdit && o.status === 'draft' && (
            <Button size="sm" variant="outline" loading={busy === `send-${o.id}`}
              onClick={() => act(`send-${o.id}`, () => sendOrderAction(o.id))}>
              Mark sent
            </Button>
          )}
          {canApprove && o.status === 'sent' && (
            <Button size="sm" variant="primary" loading={busy === `approve-${o.id}`}
              onClick={() => act(`approve-${o.id}`, () => approveOrderAction(o.id))}>
              Approve
            </Button>
          )}
          {canEdit && canCancel(o.status as PurchaseOrderStatus) && (
            <Button size="sm" variant="outline" onClick={() => setCancelling(o)}>Cancel</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        badge="PU"
        title="Purchase Orders"
        subtitle={`${rupees(onOrderPaise)} on order · ${rangeLabel}`}
        actions={canEdit ? <Button variant="primary" icon="plus" onClick={() => setShowNew(true)}>New purchase order</Button> : undefined}
      />

      {error && (
        <Card className="mb-3 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}
      {!isSingleStore && (
        <Card className="mb-3 border-warning/40 bg-warning/10 p-3">
          <p className="text-sm"><strong>All Company</strong> is read-only. Select a single store to raise a purchase order.</p>
        </Card>
      )}

      <FilterBar
        searchPlaceholder="Order no, supplier, approved by…"
        dates={{ defaultPreset: 'all', label: 'Ordered', activeLabel: rangeLabel }}
        shown={paging.total}
        clearKeys={['status']}
        exportScreen={canExport ? 'purchase_orders' : null}
        views={views}
      />

      {olderOpen > 0 && (
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <Icon name="alert-triangle" className="h-4 w-4 shrink-0 text-warning" />
          <span><strong>{olderOpen.toLocaleString('en-IN')}</strong> order{olderOpen === 1 ? ' still waiting is' : 's still waiting are'} dated before this range.</span>
          <button type="button" onClick={() => list.set({ range: 'all' })} className="font-medium text-brand hover:underline">Show all dates</button>
        </p>
      )}

      <KpiStrip cards={cards} activeKey={status} onSelect={(k) => list.set({ status: k })} columns={6} />

      <DataGrid
        rows={orders}
        server={paging}
        columns={columns}
        rowKey={(o) => o.id}
        emptyIcon="shopping-cart"
        emptyMessage={totalAll === 0 ? 'No purchase orders yet' : 'No orders match'}
        emptyHint={totalAll === 0 ? 'Raise your first purchase order to order goods from a supplier.' : 'Try another card, a wider date range, or Clear all filters.'}
        mobileCard={(o) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <Link href={`/purchase/orders/${o.id}`} className="font-mono text-xs font-semibold text-brand hover:underline">{o.orderNo}</Link>
              <StatusBadge status={o.status === 'approved' ? 'confirmed' : o.status === 'partially_received' ? 'partial' : o.status === 'received' ? 'done' : o.status} label={PO_STATUS_LABEL[o.status as PurchaseOrderStatus] ?? o.status} />
            </div>
            <p className="mt-1 truncate text-sm font-medium">{o.supplierName}</p>
            <p className="flex justify-between text-xs text-muted-foreground">
              <span>{fmtDate(o.orderDate)}{o.expectedDeliveryDate ? ` · due ${fmtDate(o.expectedDeliveryDate)}` : ''}</span>
              <span className="font-mono tabular-nums">{rupees(o.grandTotalPaise)}</span>
            </p>
          </div>
        )}
      />

      {showNew && (
        <PoFormModal
          suppliers={suppliers}
          products={products}
          onClose={() => setShowNew(false)}
          onSubmit={async (input) => {
            const res = await createOrderAction(input);
            if (res.error) return res;
            setShowNew(false);
            router.refresh();
            return res;
          }}
        />
      )}

      {editing && (
        <EditOrderLoader
          order={editing}
          suppliers={suppliers}
          products={products}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}

      {cancelling && (
        <ConfirmDialog
          title="Cancel purchase order?"
          message={`"${cancelling.orderNo}" will be marked cancelled. This cannot be undone.`}
          confirmLabel="Cancel order"
          tone="danger"
          busy={busy === `cancel-${cancelling.id}`}
          onClose={() => setCancelling(null)}
          onConfirm={async () => {
            const ok = await act(`cancel-${cancelling.id}`, () => cancelOrderAction(cancelling.id, 'Cancelled by user'));
            if (ok) setCancelling(null);
          }}
        />
      )}
    </>
  );
}

// -------------------------------------------------------------- edit loader

function EditOrderLoader({
  order, suppliers, products, onClose, onSaved,
}: {
  order: PoVM;
  suppliers: SupplierVM[];
  products: ProductVM[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState<LineDraft[] | null>(null);
  const [notes, setNotes] = useState('');
  const [expected, setExpected] = useState<string | null>(null);

  useEffect(() => {
    loadOrderAction(order.id).then((res) => {
      if (!res.data) return;
      const d = res.data as unknown as {
        notes: string | null; expectedDeliveryDate: string | null;
        items: { productId: string | null; productName: string; productCode: string | null; qty: number; unitCostPaise: number; discountPct: number; taxRatePct: number }[];
      };
      setNotes(d.notes ?? '');
      setExpected(d.expectedDeliveryDate);
      setLines(d.items.map((i) => ({
        productId: i.productId, productName: i.productName, productCode: i.productCode,
        qty: String(i.qty), unitCost: String(i.unitCostPaise / 100),
        discountPct: String(i.discountPct), taxRatePct: String(i.taxRatePct),
      })));
    });
  }, [order.id]);

  if (!lines) return null;

  return (
    <PoFormModal
      title={`Edit ${order.orderNo}`}
      suppliers={suppliers}
      products={products}
      initial={{ partyId: order.partyId, orderDate: order.orderDate.slice(0, 10), expectedDeliveryDate: expected, notes, lines }}
      onClose={onClose}
      onSubmit={async (input) => {
        const res = await updateOrderAction(order.id, input);
        if (res.error) return res;
        onSaved();
        return res;
      }}
    />
  );
}

// ------------------------------------------------------------- form modal

function PoFormModal({
  title, suppliers, products, initial, onClose, onSubmit,
}: {
  title?: string;
  suppliers: SupplierVM[];
  products: ProductVM[];
  initial?: { partyId: string; orderDate: string; expectedDeliveryDate: string | null; notes: string; lines: LineDraft[] };
  onClose: () => void;
  onSubmit: (input: {
    partyId: string; orderDate: string; expectedDeliveryDate: string | null; notes: string | null;
    lines: { productId: string | null; productName: string; productCode: string | null; qty: number; unitCostPaise: number; discountPct: number; taxRatePct: number }[];
  }) => Promise<{ error?: string; ok?: boolean }>;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const [partyId, setPartyId] = useState(initial?.partyId ?? '');
  const [orderDate, setOrderDate] = useState(initial?.orderDate ?? today);
  const [expected, setExpected] = useState(initial?.expectedDeliveryDate?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [lines, setLines] = useState<LineDraft[]>(initial?.lines ?? [blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => computeBillTotals(
    lines.map((l) => ({
      qty: Number(l.qty) || 0,
      unitCostPaise: toPaise(l.unitCost),
      discountPct: Number(l.discountPct) || 0,
      taxRatePct: Number(l.taxRatePct) || 0,
    })),
    0,
    'IGST',
  ), [lines]);

  const setLine = (i: number, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };

  const pickProduct = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) { setLine(i, { productId: null }); return; }
    setLine(i, { productId: p.id, productName: p.name, productCode: p.code });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);

    const res = await onSubmit({
      partyId,
      orderDate,
      expectedDeliveryDate: expected || null,
      notes: notes.trim() || null,
      lines: lines
        .filter((l) => l.productName.trim() && Number(l.qty) > 0)
        .map((l) => ({
          productId: l.productId,
          productName: l.productName.trim(),
          productCode: l.productCode,
          qty: Number(l.qty),
          unitCostPaise: toPaise(l.unitCost),
          discountPct: Number(l.discountPct) || 0,
          taxRatePct: Number(l.taxRatePct) || 0,
        })),
    });

    setBusy(false);
    if (res.error) setError(res.error);
  };

  const ready = partyId && lines.some((l) => l.productName.trim() && Number(l.qty) > 0);

  return (
    <Modal
      title={title ?? 'New purchase order'}
      subtitle="What to order, from whom, and how much it should cost"
      icon="shopping-cart"
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">
            Total <strong className="tabular-nums">{rupees(preview.grandTotalPaise)}</strong>
            <span className="ms-2 text-xs text-muted-foreground">
              incl. {rupees(preview.igstPaise + preview.cgstPaise + preview.sgstPaise)} tax
            </span>
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={!ready || busy} loading={busy}>Save</Button>
          </div>
        </div>
      }
    >
      {error && (
        <Card className="mb-3 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <p className="text-xs leading-relaxed text-danger">{error}</p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier">
          <select
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
          >
            <option value="">Choose a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.isSupplier ? '' : ' (customer)'}</option>
            ))}
          </select>
        </Field>

        <Field label="Order date">
          <input type="date" className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </Field>

        <Field label="Expected delivery" hint="Optional">
          <input type="date" className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={expected} onChange={(e) => setExpected(e.target.value)} />
        </Field>

        <Field label="Notes">
          <input className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      <SectionCard title="Items" icon="package" className="mt-4" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 font-semibold">Item</th>
                <th className="px-2 py-2 text-right font-semibold">Qty</th>
                <th className="px-2 py-2 text-right font-semibold">Unit cost ₹</th>
                <th className="px-2 py-2 text-right font-semibold">Disc %</th>
                <th className="px-2 py-2 text-right font-semibold">GST %</th>
                <th className="px-2 py-2 text-right font-semibold">Taxable</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5">
                    <select
                      className="mb-1 w-full rounded-md border border-border bg-card px-2 py-1 text-xs"
                      value={l.productId ?? ''}
                      onChange={(e) => pickProduct(i, e.target.value)}
                    >
                      <option value="">Not in catalogue -</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input
                      className="w-full rounded-md border border-border bg-card px-2 py-1 text-xs"
                      value={l.productName}
                      onChange={(e) => setLine(i, { productName: e.target.value })}
                      placeholder="Description"
                    />
                  </td>
                  <NumCell value={l.qty} onChange={(v) => setLine(i, { qty: v })} />
                  <NumCell value={l.unitCost} onChange={(v) => setLine(i, { unitCost: v })} />
                  <NumCell value={l.discountPct} onChange={(v) => setLine(i, { discountPct: v })} />
                  <NumCell value={l.taxRatePct} onChange={(v) => setLine(i, { taxRatePct: v })} />
                  <td className="px-2 py-1.5 text-right tabular-nums">{rupees(preview.lines[i]?.taxablePaise ?? 0)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {lines.length > 1 && (
                      <button type="button" className="text-xs text-danger hover:underline"
                        onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border bg-muted/20 px-3 py-2">
          <Button size="sm" icon="plus" onClick={() => setLines((p) => [...p, blankLine()])}>Add line</Button>
        </div>
      </SectionCard>

      <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <SummaryRow label="Subtotal" value={rupees(preview.subtotalPaise)} />
        {preview.itemDiscountPaise > 0 && (
          <SummaryRow label="Less discount" value={`− ${rupees(preview.itemDiscountPaise)}`} />
        )}
        <SummaryRow label="Taxable value" value={rupees(preview.taxableBasePaise)} />
        <SummaryRow label="GST" value={rupees(preview.igstPaise + preview.cgstPaise + preview.sgstPaise)} />
        <SummaryRow label="Total" value={rupees(preview.grandTotalPaise)} strong />
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          The split between IGST and CGST+SGST is decided by the supplier&apos;s state when this is
          saved. This preview assumes IGST; the total does not change either way.
        </p>
      </div>
    </Modal>
  );
}

function NumCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <td className="px-2 py-1.5">
      <input
        className="w-20 rounded-md border border-border bg-card px-2 py-1 text-right text-xs tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
      />
    </td>
  );
}
