'use client';

import { useListParams, useUrlState } from '@/components/ui/useListParams';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { DateRangeSelect, useUrlDateRange } from '@/components/ui/DateRangeSelect';
import { inRange } from '@/lib/date-ranges';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Toolbar, ToolbarIcon } from '@/components/ui/Toolbar';
import { loadActiveBoms, createProductionOrderAction, completeOrderAction, cancelOrderAction } from './actions';

interface BomRef { id: string; outputQty: number; finishedProduct: { productName: string; productCode: string } }

export interface OrderRowVM {
  id: string;
  orderNo: string;
  qtyToProduce: number;
  status: string;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  bom: BomRef;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

const STATUS_TONE: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  draft: 'warning', completed: 'success', cancelled: 'neutral',
};

export function ProductionOrderClient({ rows, canEdit }: { rows: OrderRowVM[]; canEdit: boolean }) {
  const [filter, setFilter] = useState<string | null>(null);
  // Kept in the address (F1b): survives refresh and Back.
  const [search, setSearch] = useUrlState('q');
  const [createOpen, setCreateOpen] = useState(false);
  const [managing, setManaging] = useState<OrderRowVM | null>(null);

  // The date filter (9 Oct 2026): ?range= &from= &to=, default all time.
  // Everything below - tiles, chips, the grid - works on these rows.
  const range = useUrlDateRange();
  const list = useListParams();
  const rangeOn = range.from !== null || range.to !== null;
  const dated = useMemo(() => rows.filter((r) => inRange(r.createdAt, range)), [rows, range]);

  const cards = useMemo(() => ({
    total: dated.length,
    draft: dated.filter((r) => r.status === 'draft').length,
    completed: dated.filter((r) => r.status === 'completed').length,
    cancelled: dated.filter((r) => r.status === 'cancelled').length,
  }), [dated]);

  const kpis: KpiCard[] = [
    { key: 'all', label: 'Total Orders', count: cards.total, icon: 'sliders' },
    { key: 'draft', label: 'Draft', count: cards.draft, icon: 'file-text', tone: 'warning' },
    { key: 'completed', label: 'Completed', count: cards.completed, icon: 'check-circle', tone: 'success' },
    { key: 'cancelled', label: 'Cancelled', count: cards.cancelled, icon: 'x-circle' },
  ];

  const visible = useMemo(() => {
    if (filter === 'draft') return dated.filter((r) => r.status === 'draft');
    if (filter === 'completed') return dated.filter((r) => r.status === 'completed');
    if (filter === 'cancelled') return dated.filter((r) => r.status === 'cancelled');
    return dated;
  }, [dated, filter]);

  const columns: Column<OrderRowVM>[] = [
    { key: 'orderNo', header: 'Order No.', width: '10rem',
      render: (r) => <span className="font-mono text-xs font-medium text-brand">{r.orderNo}</span>,
      sortValue: (r) => r.orderNo },
    {
      key: 'product', header: 'Finished Product',
      render: (r) => (
        <div>
          <div className="font-medium">{r.bom.finishedProduct.productName}</div>
          <div className="text-xs text-muted-foreground">{r.bom.finishedProduct.productCode}</div>
        </div>
      ),
      sortValue: (r) => r.bom.finishedProduct.productName,
    },
    { key: 'qty', header: 'Qty to Produce', align: 'end', render: (r) => <span className="font-mono text-xs">{r.qtyToProduce}</span>, sortValue: (r) => r.qtyToProduce },
    { key: 'date', header: 'Created', render: (r) => <span className="text-xs">{fmtDate(r.createdAt)}</span>, sortValue: (r) => r.createdAt, optional: true },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>, sortValue: (r) => r.status },
  ];

  return (
    <div>
      <PageHeader
        badge="PO"
        title="Production Order"
        subtitle={`${rows.length} orders`}
        actions={
          canEdit ? (
            <Button variant="primary" icon="sliders" onClick={() => setCreateOpen(true)}>
              New Order
            </Button>
          ) : undefined
        }
      />

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Order no., finished product…"
        count={`Total (${visible.length})`}
        filters={<DateRangeSelect label="Created" />}
        end={
          <>
            <ToolbarIcon icon="refresh" label="Refresh" onClick={() => window.location.reload()} />
            <ToolbarIcon
              icon="x-circle" label="Clear filters"
              active={filter !== null || search !== '' || rangeOn}
              onClick={() => { setFilter(null); setSearch(''); list.set({ range: null, from: null, to: null }); }}
            />
          </>
        }
      />

      <KpiStrip cards={kpis} activeKey={filter} onSelect={setFilter} columns={4} />

      <DataGrid
        exportAs={{ title: 'Production orders' }}
        rows={visible}
        columns={columns}
        rowKey={(r) => r.id}
        search={search}
        emptyIcon="sliders"
        emptyMessage={filter ? 'No orders match this card.' : 'No production orders found.'}
        emptyHint="Create one against a BOM to consume components and produce a finished good."
        pageSizes={[10, 25, 50, 100]}
        pageSummary={(pageRows) => (
          <span className="text-muted-foreground">
            Count: <strong className="text-foreground">{pageRows.length}</strong>
          </span>
        )}
        actions={[
          { label: 'View / manage', icon: 'file-text', iconTone: 'brand', onSelect: (r) => setManaging(r) },
        ]}
      />

      {createOpen && (
        <CreateOrderDialog onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); window.location.reload(); }} />
      )}

      {managing && (
        <ManageDialog
          row={managing}
          canEdit={canEdit}
          onClose={() => setManaging(null)}
          onChanged={() => window.location.reload()}
        />
      )}
    </div>
  );
}

function CreateOrderDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [boms, setBoms] = useState<BomRef[]>([]);
  const [bomId, setBomId] = useState('');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void loadActiveBoms().then((b) => {
      setBoms(b);
      if (b.length > 0) { setBomId(b[0].id); setQty(String(b[0].outputQty)); }
    });
  }, []);

  const selected = boms.find((b) => b.id === bomId);
  const ready = bomId !== '' && Number(qty) > 0;

  const save = () => {
    startTransition(async () => {
      const res = await createProductionOrderAction({ bomId, qtyToProduce: Number(qty), notes: notes.trim() || null });
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <Modal
      open
      title="New Production Order"
      subtitle="Consume components against a BOM and produce a finished good"
      icon="sliders"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={!ready || pending} loading={pending} onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="whitespace-pre-line">{error}</span>
          </p>
        )}

        {boms.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active BOMs. Add one under Product BOM first.</p>
        ) : (
          <>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Bill of materials
              <select value={bomId} onChange={(e) => {
                const b = boms.find((x) => x.id === e.target.value);
                setBomId(e.target.value);
                if (b) setQty(String(b.outputQty));
              }} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                {boms.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.finishedProduct.productName} ({b.finishedProduct.productCode}) - {b.outputQty}/run
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Qty to produce {selected ? `(multiple of ${selected.outputQty})` : ''}
              <input type="number" min={selected?.outputQty ?? 1} step={selected?.outputQty ?? 1}
                value={qty} onChange={(e) => setQty(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
            </label>

            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Notes
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}

function ManageDialog({
  row, canEdit, onClose, onChanged,
}: {
  row: OrderRowVM;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const complete = () => {
    startTransition(async () => {
      const res = await completeOrderAction(row.id);
      if (res.error) { setError(res.error); return; }
      onChanged();
    });
  };
  const cancel = () => {
    startTransition(async () => {
      const res = await cancelOrderAction(row.id, reason);
      if (res.error) { setError(res.error); return; }
      onChanged();
    });
  };

  return (
    <Modal
      open
      title={row.orderNo}
      subtitle={`${row.bom.finishedProduct.productName} × ${row.qtyToProduce}`}
      icon="sliders"
      size="sm"
      onClose={onClose}
    >
      <div className="grid gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <dl className="grid gap-1 text-xs text-muted-foreground">
          <div className="flex justify-between"><dt>Status</dt><dd className="font-medium text-foreground">{row.status}</dd></div>
          {row.notes && <div className="flex justify-between"><dt>Notes</dt><dd className="font-medium text-foreground">{row.notes}</dd></div>}
          {row.cancelReason && <div className="flex justify-between"><dt>Cancel reason</dt><dd className="font-medium text-foreground">{row.cancelReason}</dd></div>}
        </dl>

        {canEdit && row.status === 'draft' && (
          <>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Reason (for cancel)
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon="check" disabled={pending} loading={pending} onClick={complete}>
                Complete - consume &amp; produce
              </Button>
              <Button icon="x-circle" disabled={!reason.trim() || pending} loading={pending} onClick={cancel}>
                Cancel order
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
