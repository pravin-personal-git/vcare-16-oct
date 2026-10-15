'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { PageHeader, Badge, Card, type BadgeTone } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { COURIER_PAID_BY, COURIER_PAID_BY_LABEL, DISPATCH_STATUS_LABEL, type DispatchStatus } from '@/lib/supplier-dispatch';
import { createDispatchAction } from './actions';

/**
 * The Supplier Dispatch board (10 Oct 2026, repair flow stage 4).
 *
 *   To send          - supplier cases waiting, grouped by where they are going;
 *                      tick any of them (from any complaints) and make one box.
 *   With suppliers   - one card per box: courier, docket, tracking link, days
 *                      out, late when past the expected date.
 *   Back             - came back on a complaint item, still to reach the customer.
 */
type Ready = { id: string; caseNo: string; productName: string; serialNo: string | null; customerName: string | null; complaintId: string | null; complaintNo: string | null; supplierId: string | null; supplierName: string | null; createdAt: string; valuePaise: number | null };
type Out = { id: string; dispatchNo: string; status: string; supplierName: string | null; serviceCentre: string | null; courier: string | null; docketNo: string | null; trackingUrl: string | null; courierChargePaise: number; sentAt: string; expectedBackAt: string | null; cases: number; back: number };
type Back = { id: string; caseNo: string; productName: string; serialNo: string | null; outcome: string | null; receivedBackAt: string | null; customerName: string | null; complaintId: string | null; complaintNo: string | null };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '-');
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const TONE: Record<string, BadgeTone> = { sent: 'info', part_back: 'warning', back: 'success', cancelled: 'neutral' };

export function DispatchClient({ ready, dispatches, back, suppliers, canEdit }: {
  ready: Ready[]; dispatches: Out[]; back: Back[]; suppliers: { id: string; name: string }[]; canEdit: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [making, setMaking] = useState<{ supplierId: string | null; supplierName: string | null } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // To send, grouped by where it is going - the supplier on file, else the typed name.
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; supplierId: string | null; label: string; cases: Ready[] }>();
    for (const r of ready) {
      const key = r.supplierId ?? `name:${r.supplierName ?? ''}`;
      if (!m.has(key)) m.set(key, { key, supplierId: r.supplierId, label: r.supplierName ?? 'Supplier not known yet', cases: [] });
      m.get(key)!.cases.push(r);
    }
    return [...m.values()].sort((a, b) => b.cases.length - a.cases.length);
  }, [ready]);
  const out = dispatches.filter((d) => d.status === 'sent' || d.status === 'part_back');
  const done = dispatches.filter((d) => d.status === 'back' || d.status === 'cancelled');
  const late = out.filter((d) => d.expectedBackAt && new Date(d.expectedBackAt).getTime() < Date.now()).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader badge="truck" title="Supplier Dispatch"
        subtitle="Faulty items going to suppliers in one box - courier, docket, tracking link and charge - and what has come back" />
      {flash && (
        <Card className="border-success/30 bg-success/[0.06] px-3 py-2">
          <p className="flex items-center gap-2 text-sm"><Icon name="check-circle" className="h-4 w-4 text-success" />{flash}</p>
        </Card>
      )}
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="warning">To send {ready.length}</Badge>
        <Badge tone="info">Boxes out {out.length}</Badge>
        {late > 0 && <Badge tone="danger">Late {late}</Badge>}
        <Badge tone="success">Back - to hand over {back.length}</Badge>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Lane title="To send" count={ready.length} hint="Tick items for one supplier, then make a box. Items come here when they are picked up from a customer or logged in Repairs & Replacements.">
          {groups.length === 0 && <Empty>Nothing waiting to go.</Empty>}
          {groups.map((g) => {
            const ids = g.cases.map((c) => c.id);
            const sel = ids.filter((id) => picked.includes(id));
            return (
              <Card key={g.key} className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{g.label}</p>
                  <span className="text-xs text-muted-foreground">{g.cases.length} item{g.cases.length === 1 ? '' : 's'}</span>
                </div>
                <ul className="flex flex-col divide-y divide-border">
                  {g.cases.map((c) => (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-start gap-2 py-1.5 text-sm">
                        {canEdit && <input type="checkbox" className="mt-1" checked={picked.includes(c.id)} onChange={() => setPicked(picked.includes(c.id) ? picked.filter((x) => x !== c.id) : [...picked, c.id])} />}
                        <span className="min-w-0">
                          <span className="block">{c.productName}{c.serialNo ? <span className="ms-1.5 font-mono text-xs text-muted-foreground">{c.serialNo}</span> : null}</span>
                          <span className="block text-xs text-muted-foreground">
                            {c.caseNo}{c.complaintNo ? <> · <Link href={`/services/complaints/${c.complaintId}`} className="text-brand hover:underline">{c.complaintNo}</Link></> : null}{c.customerName ? ` · ${c.customerName}` : ''} · waiting {daysSince(c.createdAt)} d
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setPicked([...new Set([...picked, ...ids])])}>Tick all</Button>
                    <Button size="sm" variant="primary" icon="truck" disabled={!sel.length}
                      onClick={() => setMaking({ supplierId: g.supplierId, supplierName: g.supplierId ? null : (g.label === 'Supplier not known yet' ? null : g.label) })}>
                      Make dispatch {sel.length ? `(${sel.length})` : ''}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </Lane>

        <Lane title="With suppliers" count={out.length} hint="One card per box. Open it for the delivery challan and each item's result.">
          {out.length === 0 && <Empty>No box is out.</Empty>}
          {out.map((d) => <DispatchCard key={d.id} d={d} />)}
          {done.length > 0 && <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Back in the last 30 days</p>}
          {done.map((d) => <DispatchCard key={d.id} d={d} />)}
        </Lane>

        <Lane title="Back - hand to customer" count={back.length} hint="Came back from the supplier on a complaint. Hand it over from the complaint.">
          {back.length === 0 && <Empty>Nothing waiting for the customer.</Empty>}
          {back.map((b) => (
            <Card key={b.id} className="flex flex-col gap-1 p-3 text-sm">
              <p className="font-medium">{b.productName}{b.serialNo ? <span className="ms-1.5 font-mono text-xs text-muted-foreground">{b.serialNo}</span> : null}</p>
              <p className="text-xs text-muted-foreground">{b.caseNo} · {b.outcome?.replace(/_/g, ' ') ?? 'back'} · {day(b.receivedBackAt)}{b.customerName ? ` · ${b.customerName}` : ''}</p>
              {b.complaintId && <Link href={`/services/complaints/${b.complaintId}`} className="text-xs font-medium text-brand hover:underline">Open {b.complaintNo}</Link>}
            </Card>
          ))}
        </Lane>
      </div>

      {making && (
        <MakeDispatch
          cases={ready.filter((r) => picked.includes(r.id) && (making.supplierId ? r.supplierId === making.supplierId : !r.supplierId))}
          suppliers={suppliers} supplierId={making.supplierId} supplierName={making.supplierName}
          onClose={() => setMaking(null)}
          onDone={(msg) => { setMaking(null); setPicked([]); setFlash(msg); router.refresh(); }} />
      )}
    </div>
  );
}

function DispatchCard({ d }: { d: Out }) {
  const isLate = (d.status === 'sent' || d.status === 'part_back') && d.expectedBackAt && new Date(d.expectedBackAt).getTime() < Date.now();
  return (
    <Card className="flex flex-col gap-1 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/services/dispatch/${d.id}`} className="font-mono text-sm font-semibold text-brand hover:underline">{d.dispatchNo}</Link>
        <Badge tone={isLate ? 'danger' : TONE[d.status] ?? 'neutral'}>{isLate ? `Late since ${day(d.expectedBackAt)}` : DISPATCH_STATUS_LABEL[d.status as DispatchStatus] ?? d.status}</Badge>
      </div>
      <p>{[d.supplierName, d.serviceCentre].filter(Boolean).join(' / ') || '-'}</p>
      <p className="text-xs text-muted-foreground">
        {d.back} of {d.cases} back · sent {day(d.sentAt)} ({daysSince(d.sentAt)} d){d.expectedBackAt ? ` · due ${day(d.expectedBackAt)}` : ''}
      </p>
      <p className="text-xs text-muted-foreground">
        {[d.courier, d.docketNo].filter(Boolean).join(' ') || 'No courier recorded'}{d.courierChargePaise ? ` · ${rupees(d.courierChargePaise)}` : ''}
        {d.trackingUrl && <> · <a href={d.trackingUrl} target="_blank" rel="noreferrer noopener" className="font-medium text-brand hover:underline">Track</a></>}
      </p>
    </Card>
  );
}

function MakeDispatch({ cases, suppliers, supplierId, supplierName, onClose, onDone }: {
  cases: Ready[]; suppliers: { id: string; name: string }[]; supplierId: string | null; supplierName: string | null;
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    supplierId: supplierId ?? '', supplierName: supplierName ?? '', serviceCentre: '', supplierRmaNo: '',
    courier: '', docketNo: '', trackingUrl: '', courierCharge: '', courierPaidBy: 'cash', chargeSplit: 'equal' as 'equal' | 'value',
    boxes: '1', weightKg: '', expectedBack: '', note: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const share = cases.length && Number(f.courierCharge) > 0 ? Number(f.courierCharge) / cases.length : 0;
  const save = () => start(async () => {
    setError(null);
    const r = await createDispatchAction({
      caseIds: cases.map((c) => c.id), supplierId: f.supplierId || null, supplierName: f.supplierName.trim() || null,
      serviceCentre: f.serviceCentre.trim() || null, supplierRmaNo: f.supplierRmaNo.trim() || null, courier: f.courier.trim() || null,
      docketNo: f.docketNo.trim() || null, trackingUrl: f.trackingUrl.trim() || null, courierCharge: f.courierCharge,
      courierPaidBy: f.courierPaidBy, chargeSplit: f.chargeSplit, boxes: f.boxes, weightKg: f.weightKg, expectedBack: f.expectedBack, note: f.note.trim() || null,
    });
    if (r.error) { setError(r.error); return; }
    onDone(`${r.dispatchNo} made - ${cases.length} item${cases.length === 1 ? '' : 's'} sent.${r.warnings?.length ? ` ${r.warnings.join(' ')}` : ''}`);
  });
  const input = 'field-input';
  return (
    <Modal title={`Make a dispatch - ${cases.length} item${cases.length === 1 ? '' : 's'}`} icon="truck" size="lg" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={pending} onClick={save}>Make dispatch and send</Button></>}>
      <div className="grid gap-3 text-sm">
        {error && <p role="alert" className="rounded border border-danger/40 bg-danger/5 px-2.5 py-2 text-xs text-on-tint-danger">{error}</p>}
        <ul className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
          {cases.map((c) => <li key={c.id}>{c.caseNo} · {c.productName}{c.serialNo ? ` · ${c.serialNo}` : ''}{c.complaintNo ? ` · ${c.complaintNo}` : ''}</li>)}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier on file"><select id="dsp-supplier" value={f.supplierId} onChange={set('supplierId')} className={input}><option value="">- not on file -</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Or supplier name"><input id="dsp-supplier-name" value={f.supplierName} onChange={set('supplierName')} disabled={!!f.supplierId} className={input} /></Field>
          <Field label="Service centre (optional)"><input id="dsp-centre" value={f.serviceCentre} onChange={set('serviceCentre')} placeholder="Hikvision service centre, Raipur" className={input} /></Field>
          <Field label="Supplier's RMA / authorisation no."><input id="dsp-rma" value={f.supplierRmaNo} onChange={set('supplierRmaNo')} className={input} /></Field>
          <Field label="Courier company"><input id="dsp-courier" value={f.courier} onChange={set('courier')} placeholder="DTDC" className={input} /></Field>
          <Field label="Docket / AWB no."><input id="dsp-docket" value={f.docketNo} onChange={set('docketNo')} className={input} /></Field>
          <Field label="Tracking link" wide><input id="dsp-tracking" value={f.trackingUrl} onChange={set('trackingUrl')} placeholder="https://www.dtdc.in/tracking?awb=…" className={input} /></Field>
          <Field label="Courier charge ₹ (we paid)"><input id="dsp-charge" type="number" min={0} value={f.courierCharge} onChange={set('courierCharge')} className={input} /></Field>
          <Field label="Paid how"><select id="dsp-paid" value={f.courierPaidBy} onChange={set('courierPaidBy')} className={input}>{COURIER_PAID_BY.map((k) => <option key={k} value={k}>{COURIER_PAID_BY_LABEL[k]}</option>)}</select></Field>
          <Field label="Share the charge"><select id="dsp-split" value={f.chargeSplit} onChange={set('chargeSplit')} className={input}><option value="equal">Equally{share ? ` (₹${share.toFixed(2)} each)` : ''}</option><option value="value">By each item&apos;s value</option></select></Field>
          <Field label="Expected back by"><input id="dsp-back" type="date" value={f.expectedBack} onChange={set('expectedBack')} className={input} /></Field>
          <Field label="Boxes"><input id="dsp-boxes" type="number" min={1} value={f.boxes} onChange={set('boxes')} className={input} /></Field>
          <Field label="Weight kg"><input id="dsp-weight" type="number" min={0} step="0.1" value={f.weightKg} onChange={set('weightKg')} className={input} /></Field>
          <Field label="Note" wide><input id="dsp-note" value={f.note} onChange={set('note')} placeholder="Bill copy with each item" className={input} /></Field>
        </div>
        <p className="text-xs text-muted-foreground">Making it sends every item above, prints as a delivery challan (for repair - not a sale, no tax), and posts the courier charge to Freight &amp; Delivery when we paid it.</p>
      </div>
    </Modal>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`grid gap-1 text-xs font-medium text-muted-foreground ${wide ? 'sm:col-span-2' : ''}`}>{label}{children}</label>;
}

function Lane({ title, count, hint, children }: { title: string; count: number; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3" aria-label={title}>
      <h2 className="flex items-center justify-between text-sm font-semibold">{title}<span className="text-muted-foreground">{count}</span></h2>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-xs text-muted-foreground">{children}</p>;
}
