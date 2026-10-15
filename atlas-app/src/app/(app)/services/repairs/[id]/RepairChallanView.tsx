'use client';

import Link from 'next/link';
import { CustomerLink } from '@/components/document/CustomerLink';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { type BadgeTone } from '@/components/ui/Layout';
import { DetailHeader } from '@/components/document/DetailHeader';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { SearchSelect, type SearchOption } from '@/components/ui/SearchSelect';
import { searchGoodsAction } from '@/app/actions/search-options';
import type { RepairChallanDetail } from '@/server/complaints';
import { updateRepairChallanAction } from '../../actions';

type Challan = Omit<RepairChallanDetail, 'dispatchedAt' | 'createdAt'> & { dispatchedAt: string; createdAt: string };

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  work_done: { label: 'Work done', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  legacy_unknown: { label: 'Not recorded', tone: 'neutral' },
};
const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const field = 'h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function RepairChallanView({ challan: c, canEdit }: { challan: Challan; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const status = STATUS[c.status] ?? { label: c.status, tone: 'neutral' as BadgeTone };

  return (
    <div className="flex flex-col gap-4">
      <DetailHeader
        icon="truck"
        kind="Repair challan"
        number={c.challanNo}
        status={status}
        facts={[
          { label: 'Part', value: `${c.productName} × ${c.qty}` },
          { label: 'Complaint', value: <Link href={`/services/complaints/${c.complaintId}`} className="font-mono text-brand hover:underline">{c.complaintNo}</Link> },
          { label: 'Customer', value: <><CustomerLink id={c.customerId} via={`complaint:${c.complaintId}`}>{c.customerName}</CustomerLink> · {c.customerPhone}</> },
          { label: 'Was', value: c.legacyRef && c.legacyRef !== c.challanNo ? c.legacyRef : null },
        ]}
        backHref="/services/repairs"
        backLabel="Repair challans"
        actions={canEdit ? <Button icon="pencil" onClick={() => setEditing(true)}>Edit challan</Button> : undefined}
      />

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <dl className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
          {[
            ['Cost', rupees(c.costPaise)],
            ['Dispatched', fmt(c.dispatchedAt)],
            ['Paper slip', c.physicalChallanNo ?? '-'],
            ['Assigned to', c.assigneeNames.join(', ') || '-'],
            ['Raised by', c.createdByName ?? (c.legacyRef ? 'Old system' : '-')],
          ].map(([k, v]) => (
            <div key={k} className="px-5 py-3">
              <dt className="text-micro font-medium uppercase tracking-wide text-muted-foreground">{k}</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Notes</h2>
          <dl className="mt-3 flex flex-col gap-3">
            <div><dt className="text-xs text-muted-foreground">Technician&apos;s remark</dt><dd className="whitespace-pre-wrap text-sm">{c.technicianRemark ?? '-'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Note</dt><dd className="whitespace-pre-wrap text-sm">{c.note ?? '-'}</dd></div>
            {c.amcContractNo && (
              <div><dt className="text-xs text-muted-foreground">Cover</dt><dd className="text-sm">Customer holds {c.amcContractNo}{c.amcItemised ? ' (specific equipment only - check the complaint)' : ''}</dd></div>
            )}
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Stock</h2>
          {c.stockMoved.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              This challan has not taken anything out of stock{c.legacyRef ? ' - it came from the previous system, where stock was kept separately' : ''}.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5">
              {c.stockMoved.map((m) => (
                <li key={m.productId} className="flex justify-between text-sm"><span>{m.productName}</span><span className="tabular-nums">{m.qty} out</span></li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Every change to this challan is in the <Link href={`/reports/activity-log?row=${c.id}&table=RepairChallan`} className="text-brand hover:underline">activity log</Link>.
          </p>
        </section>
      </div>

      {editing && <EditChallan challan={c} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditChallan({ challan: c, onClose }: { challan: Challan; onClose: () => void }) {
  const router = useRouter();
  const [product, setProduct] = useState<SearchOption | null>({ id: c.productId, label: c.productName });
  const [qty, setQty] = useState(String(c.qty));
  const [cost, setCost] = useState(String(c.costPaise / 100));
  const [date, setDate] = useState(c.dispatchedAt.slice(0, 10));
  const [status, setStatus] = useState(c.status);
  const [slip, setSlip] = useState(c.physicalChallanNo ?? '');
  const [remark, setRemark] = useState(c.technicianRemark ?? '');
  const [note, setNote] = useState(c.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const movesStock = c.stockMoved.length > 0 && product && (product.id !== c.productId || Number(qty) !== c.qty);

  const save = () => start(async () => {
    setError(null);
    if (!product) { setError('Choose the product.'); return; }
    const res = await updateRepairChallanAction({
      id: c.id, productId: product.id, qty: Math.floor(Number(qty) || 0), costPaise: Math.round((Number(cost) || 0) * 100),
      dispatchedAt: `${date}T12:00:00+05:30`, status, physicalChallanNo: slip || null, technicianRemark: remark || null, note: note || null,
    });
    if (res.error) { setError(res.error); return; }
    onClose();
    router.refresh();
  });

  return (
    <Modal
      title={`Edit ${c.challanNo}`}
      subtitle="Every change is kept in the activity log"
      icon="pencil"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="me-auto text-sm text-danger">{error}</p>}
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={pending}>Save changes</Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
          <label htmlFor="rc-product">Product</label>
          <SearchSelect id="rc-product" value={product} onChange={setProduct} search={searchGoodsAction} placeholder="Product name or code…" />
        </div>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Quantity
          <input id="rc-qty" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className={field} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Cost (₹)
          <input id="rc-cost" type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className={field} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Dispatched on
          <input id="rc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Status
          <select id="rc-status" value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
            {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">Paper slip number
          <input id="rc-slip" value={slip} onChange={(e) => setSlip(e.target.value)} className={field} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">Technician&apos;s remark
          <textarea id="rc-remark" rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} className={`${field} h-auto py-2`} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">Note
          <textarea id="rc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={`${field} h-auto py-2`} />
        </label>
      </div>
      {movesStock && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-sm">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          Stock will be corrected: the difference is posted as a correcting movement, so the stock report stays right.
        </p>
      )}
    </Modal>
  );
}
