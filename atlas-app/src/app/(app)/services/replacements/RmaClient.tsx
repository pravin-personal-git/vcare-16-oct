'use client';

import { SupplierLink } from '@/components/document/SupplierLink';
import { CustomerLink } from '@/components/document/CustomerLink';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge, Card, StatusBadge } from '@/components/ui/Layout';
import { StuckPanel, type StuckCase } from './StuckPanel';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { useListParams } from '@/components/ui/useListParams';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { ScanButton } from '@/components/scan/ScanButton';
import { AiScanButton } from '@/components/scan/AiScanButton';
import {
  RMA_OUTCOMES, RMA_OUTCOME_LABEL, RMA_STATUS_LABEL, RMA_STATUS_TONE, RMA_TRANSITIONS,
  type RmaOutcome, type RmaStatus,
} from '@/lib/rma';
import type { RmaRow, RmaDetail } from '@/server/rma';
import { PartyPicker, ErrorNote, field, label, type PartyOption } from '../../stock-units/UnitDialogs';
import { createRmaAction, moveRmaAction, addRmaNoteAction, loadRmaAction, updateRmaAction, type RmaActionState } from './actions';
import { istDate } from '@/lib/date-ranges';

const fmt = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-';

const MOVE_LABEL: Record<RmaStatus, string> = {
  open: 'Reopen',
  sent: 'Mark as sent',
  received_back: 'Received back',
  returned_to_customer: 'Returned to customer',
  closed: 'Close case',
  cancelled: 'Cancel case',
};


export function RmaClient({
  rows, paging, totals, stuck, totalAll, filter, rangeLabel, canExport, views, products, parties, canEdit, initialOpenId = null,
}: {
  /** One page, filtered on the server (server/replacements-list). */
  paging: ServerPaging;
  totalAll: number;
  filter: string | null;
  rangeLabel: string;
  canExport: boolean;
  views: FilterBarViews;
  /** From `?open=`, so a global-search hit opens the record itself. */
  initialOpenId?: string | null;

  rows: RmaRow[];
  totals: Record<string, number>;
  /** Everything at a vendor right now, ignoring the date filter. */
  stuck: StuckCase[];
  products: { id: string; name: string; code: string }[];
  parties: PartyOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const list = useListParams();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [flash, setFlash] = useState<string | null>(null);

  const done = (res: RmaActionState) => { if (res.message) setFlash(res.message); router.refresh(); };

  const cards: KpiCard[] = [
    { key: 'open', label: 'Logged, not sent', count: totals.open ?? 0, icon: 'file-text' },
    { key: 'sent', label: 'Out for repair', count: totals.sent ?? 0, icon: 'truck', tone: 'warning' },
    { key: 'overdue', label: 'Overdue', count: totals.overdue ?? 0, icon: 'alert-triangle', tone: (totals.overdue ?? 0) > 0 ? 'danger' : 'default', subLabel: 'past the expected date' },
    { key: 'received_back', label: 'Back - customer waiting', count: totals.received_back ?? 0, icon: 'download', tone: 'info' },
    { key: 'done', label: 'Returned or closed', count: (totals.returned_to_customer ?? 0) + (totals.closed ?? 0) + (totals.cancelled ?? 0), icon: 'check-circle', tone: 'success' },
  ];

  const columns: Column<RmaRow>[] = [
    {
      key: 'case', header: 'Case', sortValue: (r) => r.caseNo,
      render: (r) => (
        <button type="button" className="text-start" onClick={() => setOpenId(r.id)}>
          <span className="font-mono text-xs font-medium hover:text-brand">{r.caseNo}</span>
          {r.legacyRef && r.legacyRef !== r.caseNo && <span className="block font-mono text-xs text-muted-foreground">was {r.legacyRef}</span>}
        </button>
      ),
    },
    { key: 'item', header: 'Item', sortValue: (r) => r.productName, render: (r) => <span className="text-xs">{r.productName}{r.serialNo ? <span className="block font-mono text-xs text-muted-foreground">{r.serialNo}</span> : null}</span> },
    { key: 'customer', header: 'Customer', sortValue: (r) => r.customerName ?? '', render: (r) => <CustomerLink id={r.customerId} className="text-xs">{r.customerName ?? ''}</CustomerLink> },
    { key: 'where', header: 'Sent to', sortValue: (r) => r.goingTo ?? '', render: (r) => <span className="text-xs">{r.supplierId ? <SupplierLink id={r.supplierId}>{r.goingTo ?? ''}</SupplierLink> : (r.goingTo ?? '')}{r.docketNo ? <span className="block font-mono text-xs text-muted-foreground">{r.courier ?? ''} {r.docketNo}</span> : null}</span> },
    {
      key: 'status', header: 'Status', sortValue: (r) => r.status,
      render: (r) => (
        <span className="flex flex-col gap-0.5">
          <StatusBadge status={r.status === 'received_back' ? 'pending' : r.status === 'returned_to_customer' ? 'done' : r.status === 'sent' ? 'in_progress' : r.status} label={RMA_STATUS_LABEL[r.status as RmaStatus] ?? r.status} />
          {r.overdue && <span className="text-xs text-danger">{r.daysLate} day{r.daysLate === 1 ? '' : 's'} late</span>}
        </span>
      ),
    },
    { key: 'expected', header: 'Expected back', sortValue: (r) => (r.expectedBackAt ? new Date(r.expectedBackAt).getTime() : 0), render: (r) => <span className="text-xs">{fmt(r.expectedBackAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        badge="rotate-ccw"
        title="Replacements"
        subtitle="Faulty items sent to a supplier or service centre - where each one is, and when it is due back"
        actions={canEdit ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Log a faulty item</Button> : undefined}
      />
      {flash && (
        <Card className="mb-3 border-success/30 bg-success/[0.06] px-3 py-2">
          <p className="flex items-center gap-2 text-xs"><Icon name="check-circle" className="h-4 w-4 text-success" />{flash}</p>
        </Card>
      )}
      {/*
        Above the filters on purpose. These cases are months old and the list
        opens on today, so a panel below the date filter would be a panel
        nobody ever saw.
      */}
      <StuckPanel cases={stuck} onOpen={setOpenId} />

      <FilterBar
        searchPlaceholder="Case no, old no, docket, serial, customer, item, complaint…"
        dates={{ defaultPreset: 'all', label: 'Logged', activeLabel: rangeLabel }}
        shown={paging.total}
        clearKeys={['filter']}
        exportScreen={canExport ? 'replacements' : null}
        views={views}
      />
      <KpiStrip cards={cards} activeKey={filter} onSelect={(k) => list.set({ filter: k })} columns={5} />
      <DataGrid
        rows={rows}
        server={paging}
        columns={columns}
        rowKey={(r) => r.id}
        emptyIcon="rotate-ccw"
        emptyMessage={totalAll === 0 ? 'No replacement cases yet' : 'No cases match'}
        emptyHint={totalAll === 0 ? 'Log a faulty item when it comes in. Send it when it leaves the office, and the case keeps track of where it is.' : 'Try another card, a wider date range, or Clear all filters.'}
        actions={[{ label: 'Open case', icon: 'external-link', onSelect: (r) => setOpenId(r.id) }]}
        mobileCard={(r) => (
          <button type="button" onClick={() => setOpenId(r.id)} className="block w-full text-start">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-brand">{r.caseNo}</span>
              <StatusBadge status={r.overdue ? 'overdue' : r.status === 'received_back' ? 'pending' : r.status === 'returned_to_customer' ? 'done' : r.status === 'sent' ? 'in_progress' : r.status}
                label={r.overdue ? `${r.daysLate}d late` : RMA_STATUS_LABEL[r.status as RmaStatus] ?? r.status} />
            </div>
            <p className="mt-1 truncate text-sm font-medium">{r.productName}</p>
            <p className="truncate text-xs text-muted-foreground">{r.customerName ?? 'No customer'}{r.goingTo ? ` · to ${r.goingTo}` : ''}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Expected back {fmt(r.expectedBackAt)}</p>
          </button>
        )}
      />

      {creating && (
        <CreateRmaDialog products={products} parties={parties} onClose={() => setCreating(false)}
          onDone={(r) => { setCreating(false); done(r); if (r.id) setOpenId(r.id); }} />
      )}
      {openId && (
        <RmaDetailDialog id={openId} parties={parties} canEdit={canEdit} onClose={() => setOpenId(null)} onChanged={done} />
      )}
    </>
  );
}

function CreateRmaDialog({
  products, parties, onClose, onDone,
}: {
  products: { id: string; name: string; code: string }[];
  parties: PartyOption[];
  onClose: () => void;
  onDone: (r: RmaActionState) => void;
}) {
  const [productId, setProductId] = useState('');
  const [productName, setProductName] = useState('');
  const [brandModel, setBrandModel] = useState('');
  const [qty, setQty] = useState('1');
  const [serialNo, setSerialNo] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [complaintNo, setComplaintNo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const res = await createRmaAction({
      productId: productId || null,
      productName: productName || products.find((p) => p.id === productId)?.name || '',
      brandModel: brandModel || null, qty: Number(qty) || 0, serialNo: serialNo || null,
      customerId: customerId || null, complaintNo: complaintNo || null, parentCaseId: null, note: note || null,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onDone(res);
  }

  return (
    <Modal title="Log a faulty item" subtitle="It stays 'logged' until it actually leaves the office" icon="rotate-ccw" size="lg" onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy} icon="check">Log it</Button></div>}>
      <ErrorNote text={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="rmaclien-f173" className={label}>Product</label>
          <select id="rmaclien-f173" className={field} value={productId} onChange={(e) => { setProductId(e.target.value); setProductName(products.find((p) => p.id === e.target.value)?.name ?? ''); }}>
            <option value="">Not in the catalogue - describe it below</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
          </select>
        </div>
        {!productId && (
          <div className="sm:col-span-2">
            <label htmlFor="rmaclien-f181" className={label}>What is it *</label>
            <input id="rmaclien-f181" className={field} value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. 8 port PoE switch" />
          </div>
        )}
        <div><label htmlFor="rmaclien-f185" className={label}>Brand / model</label><input id="rmaclien-f185" className={field} value={brandModel} onChange={(e) => setBrandModel(e.target.value)} /></div>
        <div><label htmlFor="rmaclien-f186" className={label}>Quantity</label><input id="rmaclien-f186" className={field} value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" /></div>
        <div className="sm:col-span-2">
          <label htmlFor="rmaclien-f188" className={label}>Serial / barcode</label>
          <div className="flex gap-1.5">
            <input id="rmaclien-f188" className={`${field} font-mono`} value={serialNo} onChange={(e) => setSerialNo(e.target.value)} placeholder="If it matches a unit on file, the unit is attached" />
            <ScanButton className="h-9 w-9" title="Scan the faulty unit's serial" onScan={setSerialNo} />
          </div>
          <div className="mt-1.5">
            <AiScanButton kind="product_label" label="Read the label" onResult={(r) => {
              const bm = [r.data.brand, r.data.model].filter(Boolean).join(' ');
              if (bm) setBrandModel(bm);
              if (r.data.serials[0]) setSerialNo(r.data.serials[0]);
            }} />
          </div>
        </div>
        <div><label htmlFor="rmaclien-f201" className={label}>Complaint number</label><input id="rmaclien-f201" className={`${field} font-mono`} value={complaintNo} onChange={(e) => setComplaintNo(e.target.value)} placeholder="COMP…" /></div>
        <div className="sm:col-span-2">
          <span className={label}>Customer (filled from the complaint if you give one)</span>
          <PartyPicker parties={parties} kind="customer" value={customerId} onChange={setCustomerId} />
        </div>
        <div className="sm:col-span-2"><label htmlFor="rmaclien-f206" className={label}>What is wrong</label><input id="rmaclien-f206" className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. PoE not working" /></div>
      </div>
    </Modal>
  );
}

function RmaDetailDialog({
  id, parties, canEdit, onClose, onChanged,
}: {
  id: string;
  parties: PartyOption[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: (r: RmaActionState) => void;
}) {
  const [d, setD] = useState<RmaDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<RmaStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ supplierId: '', supplierName: '', serviceCentre: '', courier: '', docketNo: '', expectedBackAt: '', outcome: '', replacementSerialNo: '', note: '', creditNoteNo: '', creditAmount: '' });
  const [edit, setEdit] = useState<null | Record<'productName' | 'brandModel' | 'qty' | 'serialNo' | 'customerId' | 'supplierId' | 'supplierName' | 'serviceCentre' | 'courier' | 'docketNo' | 'expectedBackAt' | 'replacementSerialNo', string>>(null);
  const startEdit = (x: RmaDetail) => setEdit({
    productName: x.productName, brandModel: x.brandModel ?? '', qty: String(x.qty), serialNo: x.serialNo ?? '',
    customerId: x.customerId ?? '', supplierId: x.supplierId ?? '', supplierName: x.supplierName ?? '',
    serviceCentre: x.serviceCentre ?? '',
    courier: x.courier ?? '', docketNo: x.docketNo ?? '',
    expectedBackAt: x.expectedBackAt ? istDate(new Date(x.expectedBackAt)) : '',
    replacementSerialNo: x.replacementSerialNo ?? '',
  });
  const saveEdit = (x: RmaDetail) => edit && run(updateRmaAction(x.id, {
    productName: edit.productName, brandModel: edit.brandModel || null, qty: Number(edit.qty) || 0,
    serialNo: edit.serialNo || null, customerId: edit.customerId || null,
    supplierId: edit.supplierId || null, supplierName: edit.supplierName || null,
    serviceCentre: edit.serviceCentre || null, courier: edit.courier || null, docketNo: edit.docketNo || null,
    expectedBackAt: edit.expectedBackAt || null, replacementSerialNo: edit.replacementSerialNo || null,
  }));

  async function load() {
    const r = await loadRmaAction(id);
    if (r.error || !r.detail) { setError(r.error ?? 'Not found.'); return; }
    setD(r.detail);
  }
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(p: Promise<RmaActionState>) {
    setBusy(true); setError(null);
    const r = await p;
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    onChanged(r); setMoving(null); setEdit(null); setNote(''); await load();
  }

  const next = d ? RMA_TRANSITIONS[d.status as RmaStatus] ?? [] : [];

  return (
    <Modal title={d ? d.caseNo : 'Loading…'} subtitle={d ? d.productName : undefined} icon="rotate-ccw" size="xl" onClose={onClose}
      footer={<div className="flex flex-wrap justify-end gap-2">
        {canEdit && d && !edit && <Button variant="ghost" icon="pencil" onClick={() => { setMoving(null); startEdit(d); }} disabled={busy}>Edit details</Button>}
        {canEdit && d && next.map((s) => (
          <Button key={s} variant={s === 'cancelled' ? 'ghost' : 'outline'} onClick={() => { setEdit(null); setMoving(s); if (s === 'sent' && d.supplierId && !form.supplierId) setForm({ ...form, supplierId: d.supplierId }); }} disabled={busy}>{s === 'closed' && d.status === 'open' ? 'Scrap now' : s === 'closed' && d.status === 'sent' ? 'Closed at supplier' : MOVE_LABEL[s]}</Button>
        ))}
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>}>
      <ErrorNote text={error} />
      {!d ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={RMA_STATUS_TONE[d.status as RmaStatus] ?? 'neutral'}>{RMA_STATUS_LABEL[d.status as RmaStatus] ?? d.status}</Badge>
            {d.overdue && <Badge tone="danger">{d.daysLate} days late</Badge>}
            {d.legacyRef && <span className="font-mono text-xs text-muted-foreground">old ref {d.legacyRef}</span>}
          </div>
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div><dt className={label}>Serial</dt><dd className="font-mono text-xs">{d.serialNo ?? '-'} {d.stockUnitId && <Link className="text-brand" href={`/stock-units?q=${encodeURIComponent(d.serialNo ?? '')}&open=${d.stockUnitId}`}>(unit)</Link>}</dd></div>
            <div><dt className={label}>Customer</dt><dd><CustomerLink id={d.customerId}>{d.customerName ?? '-'}</CustomerLink></dd></div>
            <div><dt className={label}>Complaint</dt><dd className="font-mono text-xs">{d.complaintNo ? <Link className="text-brand" href={d.complaintId ? `/services/complaints/${d.complaintId}` : `/services/complaints?q=${encodeURIComponent(d.complaintNo)}`}>{d.complaintNo}</Link> : '-'}</dd></div>
            <div><dt className={label}>Sent to</dt><dd>{d.supplierId ? <SupplierLink id={d.supplierId}>{d.goingTo ?? '-'}</SupplierLink> : (d.goingTo ?? '-')}</dd></div>
            <div><dt className={label}>Courier / docket</dt><dd className="font-mono text-xs">{[d.courier, d.docketNo].filter(Boolean).join(' ') || '-'}</dd></div>
            <div><dt className={label}>Sent / expected</dt><dd className="text-xs">{fmt(d.sentAt)} → {fmt(d.expectedBackAt)}</dd></div>
            <div><dt className={label}>Back in office</dt><dd className="text-xs">{fmt(d.receivedBackAt)}</dd></div>
            <div><dt className={label}>Customer received</dt><dd className="text-xs">{fmt(d.returnedToCustomerAt)}</dd></div>
            <div><dt className={label}>Outcome</dt><dd className="text-xs">{d.outcome ? RMA_OUTCOME_LABEL[d.outcome as RmaOutcome] ?? d.outcome : '-'}{d.replacementSerialNo ? ` · new serial ${d.replacementSerialNo}` : ''}</dd></div>
          </dl>
          {d.fromJob && (
            <p className="rounded border border-border bg-muted/40 px-3 py-2 text-xs">Old unit from a job{d.complaintNo ? ` (${d.complaintNo})` : ''} - the customer already has a new one. If the supplier <strong>replaces or repairs</strong> it, it goes into your stock and its cost is recovered; a <strong>credit note</strong> goes to the supplier&apos;s account; if it is useless, <strong>Scrap now</strong> (it shows in Inventory → Dead stock &amp; scrap).{d.stockBookedAt ? ' Already booked back.' : ''}</p>
          )}
          {d.origin && (
            <p className="text-xs"><span className={label}>{d.origin.exact ? 'Bought from (this unit)' : 'Last bought from (no serial - a suggestion)'}</span><br />
              {d.origin.supplierName}{d.origin.supplierBillNo ? ` · bill ${d.origin.supplierBillNo}` : ''} · {d.origin.grnNo} · {fmt(d.origin.receivedDate)}
              {d.origin.warrantyUntil && <> · <span className={d.origin.underWarranty ? 'text-success' : 'text-danger'}>supplier warranty {d.origin.underWarranty ? 'valid till' : 'ended'} {fmt(d.origin.warrantyUntil)}</span></>}
            </p>
          )}
          {d.creditAmountPaise ? <p className="text-xs">Supplier credit note {d.creditNoteNo ?? ''}: ₹{(d.creditAmountPaise / 100).toLocaleString('en-IN')}</p> : null}
          {(d.parentCaseNo || d.childCases.length > 0) && (
            <p className="text-xs text-muted-foreground">
              {d.parentCaseNo && <>Follows case {d.parentCaseNo}. </>}
              {d.childCases.length > 0 && <>Followed by {d.childCases.map((c) => c.caseNo).join(', ')}.</>}
            </p>
          )}

          {edit && (
            <section className="rounded border border-brand/30 bg-brand/[0.04] p-3" aria-label="Edit details">
              <p className="mb-2 text-sm font-medium">Edit details</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ['productName', 'Item *'], ['brandModel', 'Brand / model'], ['qty', 'Quantity'], ['serialNo', 'Serial'],
                  ['serviceCentre', 'Service centre'], ['courier', 'Courier'], ['docketNo', 'Docket number'],
                  ['replacementSerialNo', 'New serial (if replaced)'],
                ] as const).map(([k, l]) => (
                  <div key={k}>
                    <label htmlFor={`rma-edit-${k}`} className={label}>{l}</label>
                    <input id={`rma-edit-${k}`} className={field} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                  </div>
                ))}
                <div><label htmlFor="rma-edit-exp" className={label}>Expected back</label><input id="rma-edit-exp" type="date" className={field} value={edit.expectedBackAt} onChange={(e) => setEdit({ ...edit, expectedBackAt: e.target.value })} /></div>
                <div className="sm:col-span-2"><span className={label}>Customer</span><PartyPicker parties={parties} kind="customer" value={edit.customerId} onChange={(v) => setEdit({ ...edit, customerId: v })} /></div>

                {/*
                  THE VENDOR, ON A CASE THAT IS ALREADY OUT (7 Oct 2026).

                  Until now the only vendor field here was the typed name, so a
                  case sent to a supplier nobody recorded could never be
                  corrected into naming one. Forty of Vcare's forty-six items
                  at a vendor are in that state. Picking from the master clears
                  the typed name, because two answers to "who has it" is worse
                  than one.
                */}
                <div className="sm:col-span-2">
                  <span className={label}>Vendor who has it</span>
                  <PartyPicker
                    parties={parties}
                    kind="supplier"
                    value={edit.supplierId}
                    onChange={(v) => setEdit({ ...edit, supplierId: v, supplierName: v ? '' : edit.supplierName })}
                  />
                  <label htmlFor="rma-edit-supplierName" className="mt-1.5 block text-micro text-muted-foreground">
                    Not one of ours? Type the name &mdash; but a vendor on file can be rung, chased and invoiced.
                  </label>
                  <input
                    id="rma-edit-supplierName"
                    className={field}
                    value={edit.supplierName}
                    disabled={!!edit.supplierId}
                    placeholder={edit.supplierId ? 'Using the vendor chosen above' : 'Vendor name'}
                    onChange={(e) => setEdit({ ...edit, supplierName: e.target.value })}
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">The status moves with the buttons below; what you change here is written into the history.</p>
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEdit(null)}>Back</Button>
                <Button variant="primary" size="sm" loading={busy} onClick={() => saveEdit(d)}>Save</Button>
              </div>
            </section>
          )}

          {moving && (
            <section className="rounded border border-brand/30 bg-brand/[0.04] p-3">
              <p className="mb-2 text-sm font-medium">{moving === 'closed' && d.status === 'open' ? 'Scrap now - it is of no use' : moving === 'closed' && d.status === 'sent' ? 'Closed at the supplier - nothing comes back' : MOVE_LABEL[moving]}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {moving === 'sent' && (
                  <>
                    <div className="sm:col-span-2"><span className={label}>Supplier on file</span><PartyPicker parties={parties} kind="supplier" value={form.supplierId} onChange={(v) => setForm({ ...form, supplierId: v })} /></div>
                    <div><label htmlFor="rmaclien-f326" className={label}>Or supplier name</label><input id="rmaclien-f326" className={field} value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} /></div>
                    <div><label htmlFor="rmaclien-f327" className={label}>Service centre</label><input id="rmaclien-f327" className={field} value={form.serviceCentre} onChange={(e) => setForm({ ...form, serviceCentre: e.target.value })} /></div>
                    <div><label htmlFor="rmaclien-f328" className={label}>Courier</label><input id="rmaclien-f328" className={field} value={form.courier} onChange={(e) => setForm({ ...form, courier: e.target.value })} /></div>
                    <div><label htmlFor="rmaclien-f329" className={label}>Docket number</label><input id="rmaclien-f329" className={`${field} font-mono`} value={form.docketNo} onChange={(e) => setForm({ ...form, docketNo: e.target.value })} /></div>
                    <div><label htmlFor="rmaclien-f330" className={label}>Expected back</label><input id="rmaclien-f330" type="date" className={field} value={form.expectedBackAt} onChange={(e) => setForm({ ...form, expectedBackAt: e.target.value })} /></div>
                  </>
                )}
                {moving === 'closed' && d.status === 'sent' && (
                  <div className="sm:col-span-2"><label htmlFor="rma-close-kind" className={label}>What closed it *</label>
                    <select id="rma-close-kind" className={field} value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
                      <option value="">Choose…</option>
                      <option value="credit_note">Their credit note</option>
                      <option value="scrapped">Their written reply - they kept or scrapped it</option>
                    </select></div>
                )}
                {moving === 'received_back' && (
                  <>
                    <div><label htmlFor="rmaclien-f335" className={label}>What happened *</label>
                      <select id="rmaclien-f335" className={field} value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
                        <option value="">Choose…</option>
                        {RMA_OUTCOMES.map((o) => <option key={o} value={o}>{RMA_OUTCOME_LABEL[o]}</option>)}
                      </select></div>
                    <div><label htmlFor="rmaclien-f340" className={label}>New serial (if replaced)</label><input id="rmaclien-f340" className={`${field} font-mono`} value={form.replacementSerialNo} onChange={(e) => setForm({ ...form, replacementSerialNo: e.target.value })} /></div>
                  </>
                )}
                {(moving === 'received_back' || (moving === 'closed' && d.status === 'sent')) && form.outcome === 'credit_note' && (
                  <>
                    {!d.supplierId && <div className="sm:col-span-2"><span className={label}>Supplier who gave it *</span><PartyPicker parties={parties} kind="supplier" value={form.supplierId} onChange={(v) => setForm({ ...form, supplierId: v })} /></div>}
                    <div><label htmlFor="rma-cn-no" className={label}>Their credit note number</label><input id="rma-cn-no" className={`${field} font-mono`} value={form.creditNoteNo} onChange={(e) => setForm({ ...form, creditNoteNo: e.target.value })} /></div>
                    <div><label htmlFor="rma-cn-amt" className={label}>Amount (₹) *</label><input id="rma-cn-amt" inputMode="decimal" className={field} value={form.creditAmount} onChange={(e) => setForm({ ...form, creditAmount: e.target.value })} /></div>
                  </>
                )}
                <div className="sm:col-span-2"><label htmlFor="rmaclien-f343" className={label}>{moving === 'closed' && d.status === 'open' ? 'Why is it scrapped? *' : moving === 'closed' && d.status === 'sent' && form.outcome === 'scrapped' ? 'What the supplier wrote *' : 'Note'}</label><input id="rmaclien-f343" className={field} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setMoving(null)}>Back</Button>
                <Button variant="primary" size="sm" loading={busy} onClick={() => run(moveRmaAction(d.id, {
                  to: moving, supplierId: form.supplierId || null, supplierName: form.supplierName || null,
                  serviceCentre: form.serviceCentre || null, courier: form.courier || null, docketNo: form.docketNo || null,
                  expectedBackAt: form.expectedBackAt || null, outcome: moving === 'closed' && d.status === 'open' ? 'scrapped' : form.outcome || null,
                  creditNoteNo: form.creditNoteNo || null, creditAmount: form.creditAmount || null,
                  replacementSerialNo: form.replacementSerialNo || null, note: form.note || null,
                }))}>Confirm</Button>
              </div>
            </section>
          )}

          <section>
            <p className={label}>History</p>
            <ol className="space-y-1.5 text-xs">
              {d.events.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <Icon name={e.kind === 'note' ? 'file-text' : 'clock'} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="text-muted-foreground">{fmt(e.createdAt)}</span>{' '}
                    {e.toStatus && <>{e.fromStatus ? `${RMA_STATUS_LABEL[e.fromStatus as RmaStatus] ?? e.fromStatus} → ` : ''}{RMA_STATUS_LABEL[e.toStatus as RmaStatus] ?? e.toStatus}</>}
                    {e.kind === 'migrated' && ' Brought over from the old system'}
                    {e.note && <span className={e.toStatus ? 'text-muted-foreground' : ''}>{e.toStatus ? ' - ' : ''}{e.note}</span>}
                    {e.byName && <span className="text-muted-foreground"> · {e.byName}</span>}
                  </span>
                </li>
              ))}
            </ol>
            {canEdit && (
              <div className="mt-2 flex gap-2">
                <input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note - a call to the service centre, a promise date…" />
                <Button variant="outline" disabled={busy || !note.trim()} onClick={() => run(addRmaNoteAction(d.id, note))}>Add</Button>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
