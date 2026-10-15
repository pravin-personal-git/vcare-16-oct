'use client';
import { ListFilter } from '@/components/ui/ListFilter';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard, Segmented } from '@/components/ui/Layout';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import {
  saveAsset, assign, unassign, changeStatus, fetchHistory, fetchAssignableUsers,
  requestAssetAction, decideAssetRequestAction, fulfillWithExistingAction, fulfillWithNewAction, createBatchAction,
} from './actions';
import type { AssetBatchInput } from '@/server/assets';
import { newestFirst, oldestFirst, type CardListPage } from '@/lib/card-list';
import { useListParams } from '@/components/ui/useListParams';

interface AssetRow {
  id: string;
  name: string;
  assetType: string;
  serialNumber: string | null;
  purchaseDate: string | null;
  costPaise: number | null;
  status: 'unassigned' | 'assigned' | 'maintenance' | 'retired';
  assignedToId: string | null;
  assignedToName: string | null;
  notes: string | null;
  isActive: boolean;
}

interface AssetRequestRow {
  id: string;
  requestedById: string;
  requestedByName: string;
  assetType: string;
  reason: string | null;
  status: string;
  decidedAt: string | null;
  decisionNote: string | null;
  fulfilledAssetName: string | null;
  createdAt: string;
}

interface AssetBatchRow {
  id: string;
  name: string;
  assetType: string;
  totalQty: number;
  unitCostPaise: number | null;
  purchaseDate: string | null;
  assetCount: number;
  assignedCount: number;
}

interface AssetDashboard {
  total: number;
  assigned: number;
  unassigned: number;
  maintenance: number;
  retired: number;
  totalCostPaise: number;
  pendingRequests: number;
  batchCount: number;
}

const STATUS_TONE = {
  unassigned: 'neutral', assigned: 'success', maintenance: 'warning', retired: 'danger',
} as const;
const STATUS_LABEL = {
  unassigned: 'Unassigned', assigned: 'Assigned', maintenance: 'Maintenance', retired: 'Retired',
} as const;

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function AssetsClient({
  assets, requests, batches, dashboard, currentUserId, canEdit, isSingleStore, listPage, statusFilter, statusCounts, spare,
}: {
  /** One server-side page of assets (F1b): status, search and page run on the server. */
  listPage: CardListPage;
  statusFilter: string;
  /** Per status, over every asset. */
  statusCounts: Record<string, number>;
  /** Every unassigned asset, for fulfilling a request. */
  spare: AssetRow[];
  assets: AssetRow[];
  requests: AssetRequestRow[];
  batches: AssetBatchRow[];
  dashboard: AssetDashboard;
  currentUserId: string;
  canEdit: boolean;
  isSingleStore: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'assets' | 'requests' | 'batches'>('assets');
  const list = useListParams();
  const filter = statusFilter as 'all' | AssetRow['status'];
  const setFilter = (v: 'all' | AssetRow['status']) => list.set({ status: v === 'all' ? null : v });
  const [editing, setEditing] = useState<AssetRow | 'new' | null>(null);
  const [assigning, setAssigning] = useState<AssetRow | null>(null);
  const [historyFor, setHistoryFor] = useState<AssetRow | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [fulfilling, setFulfilling] = useState<AssetRequestRow | null>(null);
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [busy, setBusy] = useState<string | boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const counts = {
    unassigned: statusCounts.unassigned ?? 0,
    assigned: statusCounts.assigned ?? 0,
    maintenance: statusCounts.maintenance ?? 0,
    retired: statusCounts.retired ?? 0,
  };
  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const decidedRequests = requests.filter((r) => r.status !== 'pending');

  async function act(key: string, fn: () => Promise<{ error?: string; ok?: boolean }>) {
    setBusy(key);
    setError(null);
    const res = await fn();
    if (res.error) setError(res.error);
    setBusy(false);
    router.refresh();
    return !res.error;
  }

  const kpis: KpiCard[] = [
    { key: 'total', label: 'Total Assets', count: dashboard.total, icon: 'box' },
    { key: 'assigned', label: 'Assigned', count: dashboard.assigned, icon: 'user-plus', tone: 'success' },
    { key: 'value', label: 'Total Value', count: formatCurrencyCompact(dashboard.totalCostPaise), icon: 'receipt', tone: 'info' },
    { key: 'requests', label: 'Pending Requests', count: dashboard.pendingRequests, icon: 'clock', tone: dashboard.pendingRequests > 0 ? 'warning' : 'default' },
  ];

  return (
    <div>
      <PageHeader
        badge="AM"
        title="Asset Management"
        subtitle="Company assets, who holds them, and who's asked for one"
        actions={
          <div className="flex gap-2">
            <Button iconEnd="plus" onClick={() => setRequesting(true)}>Request an asset</Button>
            {canEdit && isSingleStore && tab === 'assets' && (
              <Button variant="primary" iconEnd="user-plus" onClick={() => setEditing('new')}>Add Asset</Button>
            )}
            {canEdit && isSingleStore && tab === 'batches' && (
              <Button variant="primary" iconEnd="plus" onClick={() => setCreatingBatch(true)}>New Batch</Button>
            )}
          </div>
        }
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}
      {!isSingleStore && (
        <Card className="mb-3 border-warning/40 bg-warning/10 p-3">
          <p className="text-sm"><strong>All Company</strong> is read-only. Select a single store to add or change an asset.</p>
        </Card>
      )}

      <KpiStrip cards={kpis} activeKey={null} onSelect={() => {}} columns={4} />

      <div className="mb-3">
        <Segmented
          options={[
            { value: 'assets', label: `Assets (${listPage.total})` },
            { value: 'requests', label: `Requests (${pendingRequests.length})` },
            { value: 'batches', label: `Batches (${batches.length})` },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'assets' && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['unassigned', 'assigned', 'maintenance', 'retired'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(filter === s ? 'all' : s)}
                className={`rounded-lg border p-3 text-start transition ${filter === s ? 'border-brand bg-brand/5' : 'border-border bg-card hover:bg-muted/40'}`}
              >
                <p className="text-micro uppercase tracking-wide text-muted-foreground">{STATUS_LABEL[s]}</p>
                <p className="text-lg font-bold">{counts[s]}</p>
              </button>
            ))}
          </div>

          <SectionCard title={`${listPage.server.total} asset${listPage.server.total === 1 ? '' : 's'}`} icon="box" bodyClassName="p-0">
        {listPage.server.total === 0 ? (
          <EmptyState icon="box" title="No assets here" hint="Add one to start tracking who holds what." />
        ) : (
          /* F1b / D17. The status strip above already narrows; what was missing
             is search. An asset register is looked up by serial number or by
             whose name is on it - "where is that laptop", "what does Ramesh
             hold" - and neither was answerable without reading the list. */
          <ListFilter
            server={listPage.server}
            exportScreen="assets"
            rows={assets}
            // Date filter and sort (9 Oct 2026) - same keys as server/card-lists.
            dates={[{ key: 'bought', label: 'Purchased', of: (r) => r.purchaseDate }]}
            sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.purchaseDate) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.purchaseDate) }]}
            noun="assets"
            placeholder="Name, type, serial number, who holds it…"
            searchOn={(a) => [a.name, a.assetType, a.serialNumber, a.assignedToName, a.notes]}
          >
            {(found) => (found.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every asset with this status." />
            ) : (
          <div className="divide-y divide-border">
            {found.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{a.name}</p>
                    <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {a.assetType}{a.serialNumber && ` · S/N ${a.serialNumber}`}
                    {a.assignedToName && ` · Held by ${a.assignedToName}`}
                    {a.costPaise != null && ` · ${formatCurrency(a.costPaise)}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setHistoryFor(a)}>History</Button>
                  {canEdit && isSingleStore && a.status !== 'retired' && (
                    <>
                      {a.status === 'assigned' ? (
                        <Button size="sm" variant="outline" loading={busy === `ret-${a.id}`} onClick={() => act(`ret-${a.id}`, () => unassign(a.id))}>
                          Return
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setAssigning(a)}>Assign</Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busy === `mnt-${a.id}`}
                        onClick={() => act(`mnt-${a.id}`, () => changeStatus(
                          a.id, a.status === 'maintenance' ? 'unassigned' : 'maintenance', null,
                        ))}
                      >
                        {a.status === 'maintenance' ? 'Back in service' : 'Send for maintenance'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(a)}>Edit</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busy === `ret2-${a.id}`}
                        onClick={() => act(`ret2-${a.id}`, () => changeStatus(a.id, 'retired', null))}
                      >
                        Retire
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
            ))}
          </ListFilter>
        )}
          </SectionCard>
        </>
      )}

      {tab === 'requests' && (
        <div className="grid gap-4">
          <SectionCard title={`${pendingRequests.length} pending`} icon="clock" bodyClassName="p-0">
            {pendingRequests.length === 0 ? (
              <EmptyState icon="clock" title="No pending requests" hint="Requests employees raise for an asset show up here." />
            ) : (
              <div className="divide-y divide-border">
                {pendingRequests.map((r) => (
                  <div key={r.id} data-row-id={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold">{r.assetType}</p>
                        {r.requestedById === currentUserId && <Badge tone="info">Mine</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {r.requestedByName} · {new Date(r.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
                        {r.reason && ` · ${r.reason}`}
                      </p>
                    </div>
                    {canEdit && isSingleStore && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm" variant="outline" loading={busy === `dec-${r.id}`}
                          onClick={() => act(`dec-${r.id}`, () => decideAssetRequestAction(r.id, 'rejected', null))}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm" variant="primary" loading={busy === `apr-${r.id}`}
                          onClick={() => act(`apr-${r.id}`, () => decideAssetRequestAction(r.id, 'approved', null))}
                        >
                          Approve
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {decidedRequests.length > 0 && (
            <SectionCard title="Decided" icon="file-text" bodyClassName="p-0">
              <div className="divide-y divide-border">
                {decidedRequests.map((r) => (
                  <div key={r.id} data-row-id={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{r.assetType}</p>
                        <Badge tone={r.status === 'approved' ? 'success' : r.status === 'fulfilled' ? 'success' : r.status === 'rejected' ? 'danger' : 'neutral'}>
                          {r.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {r.requestedByName}
                        {r.fulfilledAssetName && ` · Fulfilled with ${r.fulfilledAssetName}`}
                      </p>
                    </div>
                    {canEdit && isSingleStore && r.status === 'approved' && (
                      <Button size="sm" variant="primary" onClick={() => setFulfilling(r)}>Fulfil</Button>
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {tab === 'batches' && (
        <SectionCard title={`${batches.length} batch${batches.length === 1 ? '' : 'es'}`} icon="box" bodyClassName="p-0">
          {batches.length === 0 ? (
            <EmptyState icon="box" title="No batches yet" hint="Add a bulk procurement to create many identical assets at once." />
          ) : (
            <div className="divide-y divide-border">
              {batches.map((b) => (
                <div key={b.id} className="px-4 py-3">
                  <p className="text-sm font-semibold">{b.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.assetType} · {b.assignedCount}/{b.assetCount} assigned
                    {b.unitCostPaise != null && ` · ${formatCurrency(b.unitCostPaise)}/unit`}
                    {b.purchaseDate && ` · ${new Date(b.purchaseDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {requesting && (
        <RequestDialog
          busy={busy === 'request'}
          onClose={() => setRequesting(false)}
          onRequest={async (input) => {
            const ok = await act('request', () => requestAssetAction(input));
            if (ok) setRequesting(false);
          }}
        />
      )}

      {fulfilling && (
        <FulfilDialog
          request={fulfilling}
          spareAssets={spare.filter((a) => a.assetType === fulfilling.assetType)}
          busy={busy === `ful-${fulfilling.id}`}
          onClose={() => setFulfilling(null)}
          onFulfilExisting={async (assetId) => {
            const ok = await act(`ful-${fulfilling.id}`, () => fulfillWithExistingAction(fulfilling.id, assetId));
            if (ok) setFulfilling(null);
          }}
          onFulfilNew={async (input) => {
            const ok = await act(`ful-${fulfilling.id}`, () => fulfillWithNewAction(fulfilling.id, input));
            if (ok) setFulfilling(null);
          }}
        />
      )}

      {creatingBatch && (
        <BatchDialog
          busy={busy === 'batch'}
          onClose={() => setCreatingBatch(false)}
          onSave={async (input) => {
            const ok = await act('batch', () => createBatchAction(input));
            if (ok) setCreatingBatch(false);
          }}
        />
      )}

      {editing && (
        <AssetForm
          asset={editing === 'new' ? null : editing}
          busy={busy === 'save'}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const ok = await act('save', () => saveAsset(editing === 'new' ? null : editing.id, input));
            if (ok) setEditing(null);
          }}
        />
      )}

      {assigning && (
        <AssignDialog
          asset={assigning}
          busy={busy === `assign-${assigning.id}`}
          onClose={() => setAssigning(null)}
          onAssign={async (userId) => {
            const ok = await act(`assign-${assigning.id}`, () => assign(assigning.id, userId));
            if (ok) setAssigning(null);
          }}
        />
      )}

      {historyFor && (
        <HistoryDialog asset={historyFor} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  );
}

function AssetForm({
  asset, busy, onClose, onSave,
}: {
  asset: AssetRow | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: {
    name: string; assetType: string; serialNumber: string | null;
    purchaseDate: Date | null; costPaise: number | null; notes: string | null;
  }) => void;
}) {
  const [name, setName] = useState(asset?.name ?? '');
  const [assetType, setAssetType] = useState(asset?.assetType ?? '');
  const [serialNumber, setSerialNumber] = useState(asset?.serialNumber ?? '');
  const [purchaseDate, setPurchaseDate] = useState(asset?.purchaseDate?.slice(0, 10) ?? '');
  const [cost, setCost] = useState(asset?.costPaise != null ? (asset.costPaise / 100).toString() : '');
  const [notes, setNotes] = useState(asset?.notes ?? '');

  return (
    <Modal
      title={asset ? 'Edit asset' : 'Add asset'}
      icon="box"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim() || !assetType.trim()}
            onClick={() => onSave({
              name: name.trim(),
              assetType: assetType.trim(),
              serialNumber: serialNumber.trim() || null,
              purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
              costPaise: cost.trim() ? Math.round(Number(cost) * 100) : null,
              notes: notes.trim() || null,
            })}>
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required htmlFor="as-name" className="sm:col-span-2">
          <input id="as-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Type" required hint="Laptop, Vehicle, Tool…" htmlFor="as-type">
          <input id="as-type" value={assetType} onChange={(e) => setAssetType(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Serial number" htmlFor="as-serial">
          <input id="as-serial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Purchase date" htmlFor="as-date">
          <input id="as-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Cost (₹)" htmlFor="as-cost">
          <input id="as-cost" value={cost} onChange={(e) => setCost(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Notes" htmlFor="as-notes" className="sm:col-span-2">
          <textarea id="as-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand" />
        </Field>
      </div>
    </Modal>
  );
}

function AssignDialog({
  asset, busy, onClose, onAssign,
}: { asset: AssetRow; busy: boolean; onClose: () => void; onAssign: (userId: string) => void }) {
  const [users, setUsers] = useState<{ id: string; fullName: string }[] | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAssignableUsers().then((res) => {
      if (res.error) setError(res.error);
      else setUsers(res.data ?? []);
    });
  }, []);

  return (
    <Modal
      title={`Assign "${asset.name}"`}
      icon="user-plus"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!selected} onClick={() => onAssign(selected)}>Assign</Button>
        </div>
      }
    >
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      {!users ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody holds a role in this store yet.</p>
      ) : (
        <select value={selected} onChange={(e) => setSelected(e.target.value)} className={inputClass}>
          <option value="">Choose a person…</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </select>
      )}
    </Modal>
  );
}

function HistoryDialog({ asset, onClose }: { asset: AssetRow; onClose: () => void }) {
  const [rows, setRows] = useState<{ id: string; action: string; note: string | null; at: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory(asset.id).then((res) => {
      if (res.error) setError(res.error);
      else setRows(res.data ?? []);
    });
  }, [asset.id]);

  return (
    <Modal title={`History - ${asset.name}`} icon="file-text" size="md" onClose={onClose}>
      {error && <p className="text-sm text-danger">{error}</p>}
      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="border-b border-border pb-2 text-sm last:border-0">
              <span className="font-medium capitalize">{r.action.replace(/_/g, ' ')}</span>
              {r.note && <span className="text-muted-foreground"> - {r.note}</span>}
              <span className="block text-xs text-muted-foreground">
                {new Date(r.at).toLocaleString('en-IN')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function RequestDialog({
  busy, onClose, onRequest,
}: { busy: boolean; onClose: () => void; onRequest: (input: { assetType: string; reason: string | null }) => void }) {
  const [assetType, setAssetType] = useState('');
  const [reason, setReason] = useState('');

  return (
    <Modal
      title="Request an asset"
      subtitle="Goes to your own manager for approval, same as a leave request"
      icon="box"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!assetType.trim()}
            onClick={() => onRequest({ assetType: assetType.trim(), reason: reason.trim() || null })}>
            Send request
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Field label="What do you need?" required hint="Laptop, Company Phone, Desk Chair…" htmlFor="req-type">
          <input id="req-type" value={assetType} onChange={(e) => setAssetType(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Reason" htmlFor="req-reason">
          <textarea id="req-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand" />
        </Field>
      </div>
    </Modal>
  );
}

function FulfilDialog({
  request, spareAssets, busy, onClose, onFulfilExisting, onFulfilNew,
}: {
  request: AssetRequestRow;
  spareAssets: AssetRow[];
  busy: boolean;
  onClose: () => void;
  onFulfilExisting: (assetId: string) => void;
  onFulfilNew: (input: { name: string; assetType: string; serialNumber: string | null; purchaseDate: Date | null; costPaise: number | null; notes: string | null }) => void;
}) {
  const [mode, setMode] = useState<'existing' | 'new'>(spareAssets.length > 0 ? 'existing' : 'new');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [name, setName] = useState(request.assetType);
  const [serialNumber, setSerialNumber] = useState('');
  const [cost, setCost] = useState('');

  return (
    <Modal
      title={`Fulfil "${request.assetType}"`}
      subtitle={`For ${request.requestedByName}`}
      icon="user-plus"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {mode === 'existing' ? (
            <Button variant="primary" loading={busy} disabled={!selectedAssetId} onClick={() => onFulfilExisting(selectedAssetId)}>
              Assign this one
            </Button>
          ) : (
            <Button variant="primary" loading={busy} disabled={!name.trim()}
              onClick={() => onFulfilNew({
                name: name.trim(), assetType: request.assetType, serialNumber: serialNumber.trim() || null,
                purchaseDate: new Date(), costPaise: cost.trim() ? Math.round(Number(cost) * 100) : null, notes: null,
              })}>
              Add new &amp; assign
            </Button>
          )}
        </div>
      }
    >
      <div className="grid gap-3">
        <Segmented
          options={[
            { value: 'existing', label: `Use a spare (${spareAssets.length})` },
            { value: 'new', label: 'Add new' },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'existing' ? (
          spareAssets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No unassigned &ldquo;{request.assetType}&rdquo; asset to hand over - add a new one instead.</p>
          ) : (
            <select value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)} className={inputClass}>
              <option value="">Choose an asset…</option>
              {spareAssets.map((a) => <option key={a.id} value={a.id}>{a.name}{a.serialNumber ? ` (S/N ${a.serialNumber})` : ''}</option>)}
            </select>
          )
        ) : (
          <>
            <Field label="Name" required htmlFor="ful-name">
              <input id="ful-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Serial number" htmlFor="ful-serial">
              <input id="ful-serial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Cost (₹)" htmlFor="ful-cost">
              <input id="ful-cost" value={cost} onChange={(e) => setCost(e.target.value)} className={inputClass} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}

function BatchDialog({
  busy, onClose, onSave,
}: { busy: boolean; onClose: () => void; onSave: (input: AssetBatchInput) => void }) {
  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState('');
  const [totalQty, setTotalQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [notes, setNotes] = useState('');

  const ready = name.trim() && assetType.trim() && Number(totalQty) > 0;

  return (
    <Modal
      title="New asset batch"
      subtitle="Adds this many identical assets in one go"
      icon="box"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ready}
            onClick={() => onSave({
              name: name.trim(), assetType: assetType.trim(), totalQty: Number(totalQty),
              unitCostPaise: unitCost.trim() ? Math.round(Number(unitCost) * 100) : null,
              purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
              notes: notes.trim() || null,
            })}>
            Create {totalQty || ''} assets
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Batch name" required hint="50 Dell Laptops - Sept 2026" htmlFor="batch-name" className="sm:col-span-2">
          <input id="batch-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Asset type" required hint="Laptop, Chair, Phone…" htmlFor="batch-type">
          <input id="batch-type" value={assetType} onChange={(e) => setAssetType(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Quantity" required htmlFor="batch-qty">
          <input id="batch-qty" type="number" min={1} max={1000} value={totalQty} onChange={(e) => setTotalQty(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Unit cost (₹)" htmlFor="batch-cost">
          <input id="batch-cost" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Purchase date" htmlFor="batch-date">
          <input id="batch-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Notes" htmlFor="batch-notes" className="sm:col-span-2">
          <textarea id="batch-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand" />
        </Field>
      </div>
    </Modal>
  );
}
