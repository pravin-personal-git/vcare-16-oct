'use client';

import { useUrlState } from '@/components/ui/useListParams';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Toolbar, ToolbarIcon } from '@/components/ui/Toolbar';
import { createBomAction, updateBomAction, setBomActiveAction, loadProducts } from './actions';

interface ProductRef { id: string; productName: string; productCode: string }

export interface BomRowVM {
  id: string;
  outputQty: number;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  finishedProduct: ProductRef;
  components: { id: string; qty: number; product: ProductRef }[];
  orderCount: number;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function BomClient({ rows, canEdit }: { rows: BomRowVM[]; canEdit: boolean }) {
  const [filter, setFilter] = useState<string | null>(null);
  // Kept in the address (F1b): survives refresh and Back.
  const [search, setSearch] = useUrlState('q');
  const [createOpen, setCreateOpen] = useState(false);
  const [viewing, setViewing] = useState<BomRowVM | null>(null);
  const [editing, setEditing] = useState<BomRowVM | null>(null);

  const cards = useMemo(() => ({
    total: rows.length,
    active: rows.filter((r) => r.isActive).length,
    inactive: rows.filter((r) => !r.isActive).length,
    products: new Set(rows.map((r) => r.finishedProduct.id)).size,
  }), [rows]);

  const kpis: KpiCard[] = [
    { key: 'all', label: 'Total BOMs', count: cards.total, icon: 'package' },
    { key: 'active', label: 'Active', count: cards.active, icon: 'check-circle', tone: 'success' },
    { key: 'inactive', label: 'Inactive', count: cards.inactive, icon: 'x-circle' },
    { key: 'products', label: 'Finished Products Covered', count: cards.products, icon: 'box', tone: 'info' },
  ];

  const visible = useMemo(() => {
    if (filter === 'active') return rows.filter((r) => r.isActive);
    if (filter === 'inactive') return rows.filter((r) => !r.isActive);
    return rows;
  }, [rows, filter]);

  const columns: Column<BomRowVM>[] = [
    {
      key: 'product', header: 'Finished Product',
      render: (r) => (
        <div>
          <div className="font-medium">{r.finishedProduct.productName}</div>
          <div className="text-xs text-muted-foreground">{r.finishedProduct.productCode}</div>
        </div>
      ),
      sortValue: (r) => r.finishedProduct.productName,
    },
    { key: 'output', header: 'Output Qty', align: 'end', render: (r) => <span className="font-mono text-xs">{r.outputQty}</span>, sortValue: (r) => r.outputQty },
    {
      key: 'components', header: 'Components',
      render: (r) => <span className="text-xs">{r.components.map((c) => `${c.product.productName} × ${c.qty}`).join(', ')}</span>,
      optional: true,
    },
    { key: 'orders', header: 'Production Orders', align: 'end', render: (r) => <span className="font-mono text-xs">{r.orderCount}</span>, sortValue: (r) => r.orderCount, optional: true },
    { key: 'created', header: 'Created', render: (r) => <span className="text-xs">{fmtDate(r.createdAt)}</span>, sortValue: (r) => r.createdAt, optional: true },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'active' : 'inactive'}</Badge>, sortValue: (r) => (r.isActive ? 1 : 0) },
  ];

  return (
    <div>
      <PageHeader
        badge="BM"
        title="Product BOM"
        subtitle={`${rows.length} bills of materials`}
        actions={
          canEdit ? (
            <Button variant="primary" icon="package" onClick={() => setCreateOpen(true)}>
              Add BOM
            </Button>
          ) : undefined
        }
      />

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Finished product, component…"
        count={`Total (${visible.length})`}
        end={
          <>
            <ToolbarIcon icon="refresh" label="Refresh" onClick={() => window.location.reload()} />
            <ToolbarIcon
              icon="x-circle" label="Clear filters"
              active={filter !== null || search !== ''}
              onClick={() => { setFilter(null); setSearch(''); }}
            />
          </>
        }
      />

      <KpiStrip cards={kpis} activeKey={filter} onSelect={setFilter} columns={4} />

      <DataGrid
        exportAs={{ title: 'Bills of materials' }}
        rows={visible}
        columns={columns}
        rowKey={(r) => r.id}
        search={search}
        emptyIcon="package"
        emptyMessage={filter ? 'No BOMs match this card.' : 'No bills of materials found.'}
        emptyHint="Add one to tell Atlas what a finished product is made of."
        pageSizes={[10, 25, 50, 100]}
        pageSummary={(pageRows) => (
          <span className="text-muted-foreground">
            Count: <strong className="text-foreground">{pageRows.length}</strong>
          </span>
        )}
        actions={[
          { label: 'View', icon: 'eye', onSelect: (r) => setViewing(r) },
          ...(canEdit ? [
            { label: 'Edit', icon: 'pencil' as const, onSelect: (r: BomRowVM) => setEditing(r) },
            { label: 'Deactivate', icon: 'x-circle' as const, enabled: (r: BomRowVM) => r.isActive,
              onSelect: (r: BomRowVM) => void setBomActiveAction(r.id, false).then(() => window.location.reload()) },
            { label: 'Reactivate', icon: 'check-circle' as const, enabled: (r: BomRowVM) => !r.isActive,
              onSelect: (r: BomRowVM) => void setBomActiveAction(r.id, true).then(() => window.location.reload()) },
          ] : []),
        ]}
      />

      {createOpen && (
        <CreateBomDialog onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); window.location.reload(); }} />
      )}

      {editing && (
        <CreateBomDialog bom={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); window.location.reload(); }} />
      )}

      {viewing && (
        <Modal open title={viewing.finishedProduct.productName} subtitle="Bill of materials" icon="package" size="sm" onClose={() => setViewing(null)}>
          <div className="grid gap-3">
            <dl className="grid gap-1 text-xs text-muted-foreground">
              <div className="flex justify-between"><dt>Output qty</dt><dd className="font-medium text-foreground">{viewing.outputQty}</dd></div>
              <div className="flex justify-between"><dt>Status</dt><dd className="font-medium text-foreground">{viewing.isActive ? 'Active' : 'Inactive'}</dd></div>
              {viewing.notes && <div className="flex justify-between"><dt>Notes</dt><dd className="font-medium text-foreground">{viewing.notes}</dd></div>}
            </dl>
            <div className="rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="p-2 text-start">Component</th>
                    <th className="p-2 text-end">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {viewing.components.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="p-2">{c.product.productName}</td>
                      <td className="p-2 text-end font-mono text-xs">{c.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CreateBomDialog({ bom, onClose, onDone }: { bom?: BomRowVM; onClose: () => void; onDone: () => void }) {
  const [products, setProducts] = useState<ProductRef[]>([]);
  const [finishedProductId, setFinishedProductId] = useState(bom?.finishedProduct.id ?? '');
  const [outputQty, setOutputQty] = useState(String(bom?.outputQty ?? 1));
  const [notes, setNotes] = useState(bom?.notes ?? '');
  const [rows, setRows] = useState<{ productId: string; qty: string }[]>(
    bom ? bom.components.map((c) => ({ productId: c.product.id, qty: String(c.qty) })) : [{ productId: '', qty: '' }],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void loadProducts().then((p) => {
      // An edited BOM's own products stay choosable even past the list cap.
      const own = bom ? [bom.finishedProduct, ...bom.components.map((c) => c.product)] : [];
      setProducts([...own.filter((o) => !p.some((x) => x.id === o.id)), ...p]);
      if (!bom && p.length > 0) setFinishedProductId(p[0].id);
    });
  }, [bom]);

  const addRow = () => setRows((r) => [...r, { productId: '', qty: '' }]);
  const removeRow = (idx: number) => setRows((r) => r.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<{ productId: string; qty: string }>) =>
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  const components = rows
    .filter((r) => r.productId && Number(r.qty) > 0)
    .map((r) => ({ productId: r.productId, qty: Number(r.qty) }));

  const ready = finishedProductId !== '' && Number(outputQty) > 0 && components.length > 0;

  const save = () => {
    startTransition(async () => {
      const res = bom
        ? await updateBomAction(bom.id, { outputQty: Number(outputQty), notes: notes.trim() || null, components })
        : await createBomAction({
          finishedProductId, outputQty: Number(outputQty), notes: notes.trim() || null, components,
        });
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <Modal
      open
      title={bom ? 'Edit BOM' : 'Add BOM'}
      subtitle={bom ? 'Completed production orders keep what they used; drafts use the new recipe' : 'What a finished product is made of'}
      icon="package"
      size="lg"
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

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Finished product
            <select value={finishedProductId} onChange={(e) => setFinishedProductId(e.target.value)} disabled={!!bom}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.productName} ({p.productCode})</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Output qty per run
            <input type="number" min={1} value={outputQty} onChange={(e) => setOutputQty(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </label>
        </div>

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Notes
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Components</span>
            <Button icon="plus" onClick={addRow}>Add component</Button>
          </div>
          <div className="grid gap-2">
            {rows.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <select aria-label={`Component ${idx + 1}`} value={row.productId} onChange={(e) => updateRow(idx, { productId: e.target.value })}
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                  <option value="">Select a component…</option>
                  {products.filter((p) => p.id !== finishedProductId).map((p) => (
                    <option key={p.id} value={p.id}>{p.productName} ({p.productCode})</option>
                  ))}
                </select>
                <input type="number" min={1} placeholder="Qty" aria-label={`Quantity ${idx + 1}`} value={row.qty}
                  onChange={(e) => updateRow(idx, { qty: e.target.value })}
                  className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
                <button type="button" onClick={() => removeRow(idx)} disabled={rows.length === 1} aria-label={`Remove component ${idx + 1}`}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-30">
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
