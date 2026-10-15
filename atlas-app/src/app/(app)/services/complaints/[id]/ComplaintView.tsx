'use client';

import { docMessage } from '@/lib/wa-message';
import { whatsappLink } from '@/lib/revenue';

import { CustomerLink } from '@/components/document/CustomerLink';
import { DocumentTrail } from '@/components/document/DocumentTrail';
import { AttachmentPanel } from '@/components/ui/AttachmentPanel';
import type { AttachmentView } from '@/components/ui/Attachments';
import type { TrailStep } from '@/lib/document-trail';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { SplitCover } from '@/lib/amc-coverage';
import type { ComplaintDetail } from '@/server/complaints';
import {
  addComplaintNoteAction, assignTechnicianAction, setResolutionTypeAction, updateComplaintStatusAction, rescheduleVisitAction, cancelVisitAction,
  logFaultyPartAction, raiseJobChallanAction, addComplaintItemAction, cancelComplaintItemAction, requestWarrantyVoidAction, pickUpItemsAction, handBackItemsAction,
} from '../../actions';
import type { ComplaintItemView } from '@/server/complaint-items';
import type { HandBackOption } from '@/server/item-handback';
import { EquipmentPicker, type PickedItem } from '../EquipmentPicker';
import { Modal } from '@/components/ui/Modal';
import { TechnicianOptions } from '@/components/services/TechnicianOptions';
import { JOB_STATUSES, OFFICE_LABEL, officeStatusOptions, statusTone } from '@/lib/job-flow';
import { classifyActivity, type ActivityAuthor } from '@/lib/complaint-activity';
import { ReasonDialog, VisitChangeDialog, VisitTrail, needsReason } from './JobControls';
import { JobParts, LogFaulty, RaiseChallan, type ChallanVM, type FaultyVM } from './JobParts';
import type { FindableProduct } from '@/components/document/ProductFinder';
import { CustomerSide, type EstimateSeedLine } from './CustomerSide';
import { AutoRefresh } from '@/components/ui/AutoRefresh';
import { DetailHeader } from '@/components/document/DetailHeader';
import { ActionBar } from '@/components/document/ActionBar';
import { customerLinkAction } from '../../actions';
import { QuickVisitDialog } from '@/components/services/QuickVisitDialog';
import { RMA_OUTCOME_LABEL, SUPPLIER_ANSWER_LABEL, type RmaOutcome, type SupplierAnswer } from '@/lib/rma';

/**
 * ONE COMPLAINT - LAYOUT A, "WORKBENCH" (9 Oct 2026).
 *
 * Pravin, after the live service test: the page was "bahut messed up and
 * scattered, aadhi cheezein left mein aadhi right mein", and remarks could not
 * be told from the log. He chose layout A from the style book
 * (09-documentation/complaint-rma-layouts.html):
 *
 *   left   - every action, and the one thing to do next
 *   middle - the work: cover, the problem, parts, visits, then Remarks /
 *            Activity log / Calls as separate tabs, then photos
 *   right  - every linked document, grouped: sale & cover, visits, parts,
 *            supplier, money
 *
 * Nothing here changes what a button does - the same actions, the same
 * dialogs. Only where things sit, and which entries count as a remark
 * (lib/complaint-activity).
 */

type Iso<T, K extends keyof T> = Omit<T, K> & { [P in K]: string };
/** An item with its cover's dates as strings, for the client. */
export type ItemVM = Omit<ComplaintItemView, 'cover'> & {
  cover: {
    labour: { free: boolean; reason: string; until: string | null; contractId: string | null; contractNo: string | null };
    parts: { free: boolean; reason: string; until: string | null; voided: boolean };
    uncertain: boolean;
  };
};
type VisitChangeRow = ComplaintDetail['visits'][number]['changes'][number];
type Detail = Omit<ComplaintDetail, 'createdAt' | 'activities' | 'visits' | 'challans' | 'acceptedAt' | 'closedAt'> & {
  createdAt: string;
  acceptedAt: string | null;
  closedAt: string | null;
  activities: Iso<ComplaintDetail['activities'][number], 'createdAt'>[];
  visits: (Omit<ComplaintDetail['visits'][number], 'scheduledAt' | 'completedAt' | 'checkedInAt' | 'changes'> & {
    scheduledAt: string; completedAt: string | null; checkedInAt: string | null;
    changes: (Omit<VisitChangeRow, 'fromAt' | 'toAt' | 'createdAt'> & { fromAt: string; toAt: string | null; createdAt: string })[];
  })[];
  challans: Iso<ComplaintDetail['challans'][number], 'dispatchedAt'>[];
};

// Office words and colours for every job status (lib/job-flow).
const STATUS: Record<string, { label: string; tone: BadgeTone }> = Object.fromEntries(
  JOB_STATUSES.map((s) => [s, { label: OFFICE_LABEL[s], tone: statusTone(s) as BadgeTone }]),
);
const AUTHOR: Record<ActivityAuthor, { label: string; tone: BadgeTone; initials: string }> = {
  technician: { label: 'Technician', tone: 'info', initials: 'T' },
  office: { label: 'Office', tone: 'brand', initials: 'O' },
  customer: { label: 'Customer', tone: 'warning', initials: 'C' },
  system: { label: 'Atlas', tone: 'neutral', initials: 'A' },
};
const LEGACY_LABEL: Record<string, string> = {
  legacyStatus: 'Status in old system', previousStatus: 'Previous status', legacyComplaintType: 'Complaint type',
  legacyProductLines: 'Product lines', legacyAssignedTechnicianId: 'Technician', nonInvoiceStatus: 'Non-invoice status',
  closeReason: 'Close reason', referredBy: 'Referred by', isDirectInvoice: 'Direct invoice',
};

/** The stages across the top. A status sits in one of them; cancelled sits in none. */
const STAGES: { label: string; statuses: string[] }[] = [
  { label: 'Raised', statuses: ['received'] },
  { label: 'Technician', statuses: ['assigned', 'accepted'] },
  { label: 'Visit', statuses: ['scheduled', 'on_the_way', 'on_site'] },
  { label: 'Work', statuses: ['in_progress', 'awaiting_estimate'] },
  { label: 'Confirm', statuses: ['awaiting_customer', 'resolved'] },
  { label: 'Closed', statuses: ['closed'] },
];

const human = (k: string) => LEGACY_LABEL[k] ?? k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function ComplaintView({ detail: d, coverage, technicians, legacyTechnicianName, canEdit, calls = [], parts, estimateSeed = [], closeNeedsApproval = false, canBill = false, trail = [], photos = [], sale = null, items = [], handBack = [], bill = null }: {
  /** What Bill this job would bill (stage 7). */
  bill?: { lines: import('@/lib/job-bill').BillLine[]; basePaise: number; withGstPaise: number; fromEstimate: boolean } | null;
  /** The items on the job (10 Oct 2026, stage 2), each with its own cover. */
  items?: ItemVM[];
  /** Items ready to go back to the customer, with stock that could stand in for a kept one (stage 6). */
  handBack?: HandBackOption[];
  /** The job's whole paper trail - visits, challans, GDNs, invoice (F1b / D18). */
  trail?: TrailStep[];
  /** The sale this equipment came from - the warranty is counted from it. */
  sale?: { id: string; invoiceNo: string; date: string } | null;
  /** Job photos (3 Oct 2026), stored as `DocumentAttachment` rows on the complaint. */
  photos?: AttachmentView[];
  /** Invoices & receipts: Edit - may use Bill this job. */
  canBill?: boolean;
  detail: Detail;
  /** Job challans, GDNs and faulty parts (workflow slice 4). */
  parts?: { challans: ChallanVM[]; faulty: FaultyVM[]; catalogue: FindableProduct[]; canIssue: boolean };
  /** Estimate prefill: visit charge + challan parts at list price (workflow slice 5). */
  estimateSeed?: EstimateSeedLine[];
  /** Settings > Field jobs: closing goes through My Desk (workflow slice 6). */
  closeNeedsApproval?: boolean;
  /** Calls with the customer since the complaint was raised (from the call log). */
  calls?: { id: string; userName: string; direction: string; startedAt: string; durationSec: number }[];
  /** Two switches (10 Oct 2026): technician by AMC, part by warranty. */
  coverage: SplitCover;
  technicians: { id: string; fullName: string; serviceTeam: boolean }[];
  legacyTechnicianName: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const [share, setShare] = useState(false);
  const [tab, setTab] = useState<'remarks' | 'log' | 'calls'>('remarks');
  const [error, setError] = useState<string | null>(null);
  const [askReason, setAskReason] = useState<{ to: string; title: string } | null>(null);
  const [visitEdit, setVisitEdit] = useState<{ id: string; mode: 'move' | 'cancel'; scheduledAt: string } | null>(null);
  const [raising, setRaising] = useState(false);
  const [logging, setLogging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [takingOff, setTakingOff] = useState<ItemVM | null>(null);
  const [pickingUp, setPickingUp] = useState(false);
  const [handingBack, setHandingBack] = useState(false);
  const [booking, setBooking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const liveItems = items.filter((i) => i.status !== 'cancelled');
  // Only an item of ours whose warranty is running can have it voided.
  const voidable = liveItems.filter((i) => i.ours && i.cover.parts.free && i.voidStatus !== 'requested' && i.voidStatus !== 'approved');

  const run = (fn: () => Promise<{ error?: string } | void>) => start(async () => {
    setError(null);
    const r = await fn();
    if (r && 'error' in r && r.error) setError(r.error);
    router.refresh();
  });
  const setStatus = (to: string) => {
    const title = needsReason(d.status, to, d.needsCallback);
    if (title) { setAskReason({ to, title }); return; }
    run(() => updateComplaintStatusAction(d.id, to));
  };

  // Send the customer their no-login job link on WhatsApp (G6). The tab is
  // opened first, inside the click, so a pop-up blocker lets it through.
  const sendLink = (copyOnly = false) => {
    const tab = copyOnly ? null : window.open('', '_blank');
    start(async () => {
      setError(null);
      const r = await customerLinkAction(d.id);
      if (r.error || !r.url) { tab?.close(); setError(r.error ?? 'Could not make the link.'); return; }
      if (copyOnly) {
        navigator.clipboard?.writeText(r.url).then(() => setNotice('Customer link copied.')).catch(() => setNotice(r.url!));
        return;
      }
      // One wording and the +91 rule for every document (A1, 11 Oct 2026).
      const text = docMessage({ kind: 'complaint', number: d.complaintNo, customerName: d.customerName, note: 'See progress, confirm when it is fixed, and rate us here:', url: r.url });
      if (tab) tab.location.href = whatsappLink(r.phone ?? d.customerPhone, text);
    });
  };
  const canCancel = canEdit && officeStatusOptions(d.status).includes('cancelled');

  const status = STATUS[d.status] ?? { label: d.status, tone: 'neutral' as BadgeTone };
  const ageDays = Math.max(0, Math.floor((Date.now() - new Date(d.createdAt).getTime()) / 86_400_000));
  const visitsDone = d.visits.filter((v) => v.status === 'completed').length;
  const legacy = Object.entries(d.customFields).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
  const mapsHref = d.siteLat !== null && d.siteLng !== null ? `https://www.google.com/maps/search/?api=1&query=${d.siteLat},${d.siteLng}` : null;
  const stageAt = STAGES.findIndex((s) => s.statuses.includes(d.status));

  // Remarks (what people wrote) and the log (what Atlas did) - lib/complaint-activity.
  const sorted = d.activities.map((a) => ({ a, c: classifyActivity({ kind: a.kind, body: a.body, createdById: a.createdById }, { technicianId: d.assignedTechnicianId }) }));
  const remarks = sorted.filter((x) => x.c.lane === 'remark');
  const log = sorted.filter((x) => x.c.lane === 'log');

  const challans = parts?.challans ?? [];
  const toIssue = challans.filter((c) => c.status === 'approved').length;
  const toApprove = challans.filter((c) => c.status === 'pending_approval').length;
  const oldUnitsDue = (parts?.faulty ?? []).filter((f) => !f.receivedAt).length;
  const next = nextStep({
    status: d.status, hasTech: !!d.assignedTechnicianId, techName: d.assignedTechnicianName,
    openVisits: d.visits.filter((v) => v.status === 'scheduled').length, toApprove, toIssue, oldUnitsDue,
    waitingEstimate: d.waitingEstimatePaise !== null, billed: !!d.invoice, billingStatus: d.billingStatus, closeNeedsApproval,
    itemsOut: liveItems.filter((i) => ['picked_up', 'with_supplier'].includes(i.status)).length,
    toHandBack: handBack.length,
    refitDue: liveItems.some((i) => i.status === 'handed_back') && !d.visits.some((v) => v.purpose === 'refit'),
    unbilledPaise: !d.invoice && d.billingStatus !== 'waived' && bill ? bill.withGstPaise : 0,
  });

  const byKind = (...kinds: TrailStep['kind'][]) => trail.filter((s) => kinds.includes(s.kind) && !s.current);

  return (
    <div className="flex flex-col gap-4">
      <AutoRefresh />
      <DetailHeader
        icon="alert-circle"
        kind="Complaint"
        number={d.complaintNo}
        status={status}
        facts={[
          { label: 'Customer', value: <CustomerLink id={d.customerId} via={`complaint:${d.id}`}>{d.customerName}</CustomerLink> },
          { label: 'Technician', value: d.assignedTechnicianName ?? 'Not assigned' },
          { label: 'Priority', value: d.priority !== 'normal' ? d.priority : null },
        ]}
        backHref="/services/complaints"
        backLabel="Customer Complaints"
        // The shared action bar (Option A, G6 - 11 Oct 2026): the same order of
        // buttons as the invoice, order and installation pages.
        actions={(
          <ActionBar
            whatsapp={canEdit ? { label: 'Send link', icon: 'whatsapp', onClick: () => sendLink(), disabled: pending } : undefined}
            sendMenu={canEdit ? [{ label: 'Copy customer link', icon: 'copy', onClick: () => sendLink(true) }] : []}
            actions={[
              ...(canEdit ? [{ label: 'Schedule a visit', icon: 'calendar' as const, iconTone: 'brand' as const, onClick: () => setBooking(true) }] : []),
              { label: 'Call', icon: 'phone', iconTone: 'success', onClick: () => { window.location.href = `tel:${d.customerPhone}`; } },
              { label: 'Print', icon: 'printer', onClick: () => window.print() },
            ]}
            more={canEdit && parts ? [
              { label: 'Raise challan', icon: 'truck', onClick: () => setRaising(true) },
              { label: 'Log faulty part', icon: 'alert-circle', onClick: () => setLogging(true) },
              { label: 'Add item', icon: 'plus', onClick: () => setAdding(true) },
            ] : canEdit ? [{ label: 'Add item', icon: 'plus', onClick: () => setAdding(true) }] : []}
            destructive={canCancel ? { label: 'Cancel complaint…', icon: 'ban', onClick: () => setStatus('cancelled') } : undefined}
          />
        )}
      />

      {askReason && (
        <ReasonDialog title={askReason.title} busy={pending} onClose={() => setAskReason(null)}
          onConfirm={(reason) => { const to = askReason.to; setAskReason(null); run(() => updateComplaintStatusAction(d.id, to, reason)); }} />
      )}
      {visitEdit && (
        <VisitChangeDialog mode={visitEdit.mode} scheduledAt={visitEdit.scheduledAt} busy={pending} onClose={() => setVisitEdit(null)}
          onConfirm={({ newAt, reason }) => {
            const v = visitEdit; setVisitEdit(null);
            run(() => (v.mode === 'move' && newAt ? rescheduleVisitAction(v.id, newAt, reason) : cancelVisitAction(v.id, reason)));
          }} />
      )}
      {raising && parts && <RaiseChallan catalogue={parts.catalogue} busy={pending} onClose={() => setRaising(false)}
        onSave={(input) => { setRaising(false); run(() => raiseJobChallanAction(d.id, input)); }} />}
      {adding && <AddItems customerId={d.customerId} busy={pending} onClose={() => setAdding(false)}
        onSave={(picked) => { setAdding(false); run(async () => {
          for (const it of picked) {
            const r = await addComplaintItemAction(d.id, { ours: it.ours, stockUnitId: it.stockUnitId, productId: it.productId, equipmentName: it.equipmentName, serialNo: it.serialNo });
            if (r.error) return r;
          }
        }); }} />}
      {voiding && <VoidWarranty items={voidable} photos={photos} busy={pending} onClose={() => setVoiding(false)}
        onSave={(itemId, reason, photoId) => { setVoiding(false); run(() => requestWarrantyVoidAction(itemId, reason, photoId)); }} />}
      {pickingUp && <PickUp items={liveItems.filter((i) => i.status === 'open')} busy={pending} onClose={() => setPickingUp(false)}
        onSave={(ids, who, note) => { setPickingUp(false); run(async () => {
          const r = await pickUpItemsAction(d.id, ids, who, note);
          if (r.pickupNo) setNotice(`Pickup receipt ${r.pickupNo} made.${r.warnings?.length ? ` ${r.warnings.join(' ')}` : ''}`);
          return r;
        }); }} />}
      {booking && (
        <QuickVisitDialog subject="complaint" subjectId={d.id} label={`${d.complaintNo} · ${d.customerName}`}
          technicians={technicians} defaultTechnicianId={d.assignedTechnicianId ?? ''}
          defaultReason={liveItems.some((i) => i.status === 'handed_back') ? 'refit' : d.visits.some((v) => v.status !== 'cancelled') ? 'follow_up' : 'existing_complaint'}
          onClose={() => setBooking(false)} onDone={() => { setBooking(false); setNotice('Visit booked.'); router.refresh(); }} />
      )}
      {handingBack && <HandBack options={handBack} busy={pending} onClose={() => setHandingBack(false)}
        onSave={(ids, fromStock, who, note) => { setHandingBack(false); run(async () => {
          const r = await handBackItemsAction(d.id, ids, fromStock, who, note);
          if (r.gdnNo) setNotice(`Handed back on ${r.gdnNo}.${r.warnings?.length ? ` ${r.warnings.join(' ')}` : ''} Book the refit visit if the technician has to fit it.`);
          return r;
        }); }} />}
      {takingOff && <ReasonDialog title={`Take ${takingOff.equipmentName} off this complaint?`} busy={pending} onClose={() => setTakingOff(null)}
        onConfirm={(reason) => { const it = takingOff; setTakingOff(null); run(() => cancelComplaintItemAction(it.id, reason)); }} />}
      {logging && parts && <LogFaulty catalogue={parts.catalogue} busy={pending} onClose={() => setLogging(false)}
        onSave={(input) => { setLogging(false); run(() => logFaultyPartAction(d.id, input)); }} />}

      {/* Who, what, where - and the stage it is at. */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <p className="text-lg font-semibold"><CustomerLink id={d.customerId} via={`complaint:${d.id}`}>{d.customerName}</CustomerLink></p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <a href={`tel:${d.customerPhone}`} className="inline-flex items-center gap-1 hover:text-brand"><Icon name="phone" className="h-3.5 w-3.5" />{d.customerPhone}</a>
              {d.productName && <span className="inline-flex items-center gap-1"><Icon name="package" className="h-3.5 w-3.5" />{d.productName}</span>}
              {(d.siteLocation || mapsHref) && (
                <span className="inline-flex items-center gap-1">
                  <Icon name="map-pin" className="h-3.5 w-3.5" />
                  {d.siteLocation ?? 'Site'}
                  {mapsHref && <a href={mapsHref} target="_blank" rel="noreferrer noopener" className="ms-1 font-medium text-brand hover:underline">Map</a>}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {d.priority !== 'normal' && <Badge tone={d.priority === 'urgent' ? 'danger' : 'warning'}>{d.priority}</Badge>}
            {d.raisedByPortal && <Badge tone="info" icon="user">Raised by customer</Badge>}
            {d.jobType !== 'complaint' && <Badge tone="neutral">{d.jobType === 'installation' ? 'Installation' : 'Repair'}</Badge>}
            {d.reopenCount > 0 && <Badge tone="warning">Reopened {d.reopenCount > 1 ? `${d.reopenCount} times` : 'once'}</Badge>}
            {d.overrideUsed && <Badge tone="warning" icon="map-pin">Location override used</Badge>}
            {d.timeOnSiteSec > 0 && <Badge tone="neutral" icon="clock">{d.timeOnSiteSec >= 3600 ? `${Math.floor(d.timeOnSiteSec / 3600)}h ${Math.floor((d.timeOnSiteSec % 3600) / 60)}m` : `${Math.max(1, Math.round(d.timeOnSiteSec / 60))} min`} on site</Badge>}
            <Badge tone="neutral" icon="calendar">Raised {fmt(d.createdAt)} · {ageDays} day{ageDays === 1 ? '' : 's'}</Badge>
            <Badge tone="neutral">Visits {visitsDone} of {d.visits.length}</Badge>
            {d.legacyRef && d.legacyRef !== d.complaintNo && <span className="text-xs text-muted-foreground">was {d.legacyRef}</span>}
          </div>
        </div>
        <ol className="flex flex-wrap gap-1 border-t border-border bg-muted/30 px-5 py-2.5" aria-label="Stage">
          {d.status === 'cancelled'
            ? <li><Badge tone="neutral">Cancelled</Badge></li>
            : STAGES.map((s, i) => (
              <li key={s.label} aria-current={i === stageAt ? 'step' : undefined}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${i === stageAt ? 'bg-brand text-white' : i < stageAt ? 'text-success' : 'text-muted-foreground'}`}>
                {i < stageAt && <Icon name="check" className="me-1 inline h-3 w-3" />}{s.label}
              </li>
            ))}
        </ol>
      </section>

      {/* The whole chain in one line (D18); the right column groups the same links by kind. */}
      <DocumentTrail steps={trail} />

      {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-on-tint-danger">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-success/40 bg-success/[0.07] px-3 py-2 text-sm">{notice}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_18rem]">
        {/* ---------------- LEFT: actions ---------------- */}
        <aside className="flex flex-col gap-3 lg:sticky lg:top-4" aria-label="Actions">
          <Rail title="Next">
            <p className="text-sm leading-snug">{next}</p>
          </Rail>

          {canEdit && (
            <Rail title="Job">
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Status
                <select
                  id="complaint-status" disabled={pending} value={d.status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground outline-none focus:border-brand"
                >
                  {/* Only the steps the rulebook allows the office from here - each once
                      (lib/job-flow officeStatusOptions). */}
                  {officeStatusOptions(d.status).map((k) => <option key={k} value={k}>{STATUS[k]?.label ?? k}</option>)}
                </select>
                <span className="font-normal">Visit booked comes from scheduling a visit; waiting for estimate from sending one.</span>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Technician
                <select
                  id="complaint-technician" disabled={pending} value={d.assignedTechnicianId ?? ''}
                  onChange={(e) => e.target.value && run(() => assignTechnicianAction(d.id, e.target.value))}
                  className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground outline-none focus:border-brand"
                >
                  <option value="">Not assigned</option>
                  <TechnicianOptions technicians={technicians} />
                </select>
              </label>
              {d.assignedTechnicianId && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">How it gets fixed</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(['field_visit', 'direct_replacement'] as const).map((t) => (
                      <button
                        key={t} type="button" disabled={pending} aria-pressed={d.resolutionType === t}
                        onClick={() => run(() => setResolutionTypeAction(d.id, t))}
                        className={`h-8 rounded-lg border px-2.5 text-xs font-medium transition disabled:opacity-60 ${d.resolutionType === t ? 'border-brand bg-brand/10 text-brand' : 'border-border hover:bg-muted'}`}
                      >
                        {t === 'field_visit' ? 'Field visit' : 'Direct replacement'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Rail>
          )}

          {canEdit && (
            <Rail title="Items">
              <Button size="sm" icon="truck" variant={liveItems.some((i) => i.status === 'open') ? 'primary' : undefined} disabled={!liveItems.some((i) => i.status === 'open')} onClick={() => setPickingUp(true)}>Pick up for repair</Button>
              <Button size="sm" icon="check-circle" variant={handBack.length ? 'primary' : undefined} disabled={!handBack.length} onClick={() => setHandingBack(true)}>Hand back{handBack.length ? ` (${handBack.length})` : ''}</Button>
              <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add item</Button>
              <Button size="sm" icon="ban" disabled={!voidable.length} onClick={() => setVoiding(true)}>Warranty void…</Button>
              {!voidable.length && liveItems.length > 0 && <p className="text-xs text-muted-foreground">No item has a running warranty to void.</p>}
            </Rail>
          )}

          {canEdit && (
            <Rail title="Visits & parts">
              {/* G-24: booked here, for this complaint - not a second search in the Visit Scheduler. */}
              <Button size="sm" icon="calendar" onClick={() => setBooking(true)}>Schedule a visit</Button>
              {parts && (
                <>
                  <Button size="sm" icon="truck" onClick={() => setRaising(true)}>Raise challan</Button>
                  <Button size="sm" icon="alert-circle" onClick={() => setLogging(true)}>Log faulty part</Button>
                </>
              )}
              {(toIssue > 0 || oldUnitsDue > 0) && (
                <p className="text-xs text-muted-foreground">
                  Store: {[toIssue ? `${toIssue} challan${toIssue === 1 ? '' : 's'} to issue` : '', oldUnitsDue ? `${oldUnitsDue} old unit${oldUnitsDue === 1 ? '' : 's'} to receive` : ''].filter(Boolean).join(' · ')} - in Parts, or <Link href="/goods-dispatch/job-parts" className="text-brand hover:underline">the store&apos;s queue</Link>.
                </p>
              )}
            </Rail>
          )}

          <CustomerSide complaintId={d.id} complaintNo={d.complaintNo} canEdit={canEdit}
            canEstimate={['on_site', 'in_progress'].includes(d.status)} seed={estimateSeed}
            waitingEstimatePaise={d.waitingEstimatePaise} rating={d.rating} catalogue={parts?.catalogue ?? []}
            invoice={d.invoice} billingStatus={d.billingStatus} canBill={canBill} finished={['resolved', 'closed'].includes(d.status)} bill={bill} />

          {(d.status === 'resolved' || d.status === 'closed') && (
            <Link href={`/services/complaints/${d.id}/report`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
              <Icon name="printer" className="h-3.5 w-3.5" />Service report
            </Link>
          )}
        </aside>

        {/* ---------------- MIDDLE: the work ---------------- */}
        <div className="flex min-w-0 flex-col gap-4">
          {d.status === 'received' && d.declinedReason && (
            <p role="status" className="rounded-lg border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm">
              <strong>Declined by the technician:</strong> {d.declinedReason} - assign someone else.
            </p>
          )}
          {d.status === 'resolved' && (
            <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${d.needsCallback ? 'border-warning/40 bg-warning/[0.07]' : 'border-border bg-muted/40'}`}>
              <strong>Waiting to close.</strong>{' '}
              {d.needsCallback
                ? 'The technician says the customer approved but there is no code - call the customer before closing.'
                : d.signOff === 'otp' ? 'The customer confirmed with their code.' : d.signOff === 'customer' ? 'The customer confirmed in the app / link.' : ''}
              {closeNeedsApproval ? ' Close it from Status (this approves the close request), or in My Desk → Waiting on me.' : ' Close it from Status.'}
            </p>
          )}
          {d.status === 'assigned' && (
            <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Waiting for {d.assignedTechnicianName ?? 'the technician'} to accept on the phone. You can accept on their behalf from Status.
            </p>
          )}

          {items.length > 0 && <ItemsCard items={items} complaintId={d.id} canEdit={canEdit} onTakeOff={setTakingOff} />}

          {/* Who pays - two switches: the AMC pays the technician, the warranty pays the part.
              A job with items shows it per item above; an old one-product job shows it here. */}
          {items.length === 0 && <section className="grid gap-3 sm:grid-cols-2" aria-label="Who pays">
            <CoverHalf title="Technician" free={coverage.labour.free} reason={coverage.labour.reason} />
            <CoverHalf title="Part / repair" free={coverage.parts.free} reason={coverage.parts.reason} />
            {coverage.uncertain && <p className="text-xs text-muted-foreground sm:col-span-2">Needs checking - the equipment is not matched to a product, so the warranty cannot be read.</p>}
          </section>}

          <section className="rounded-xl border border-border bg-card p-5 shadow-card">
            <h2 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">The problem</h2>
            <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed">{d.description}</p>
          </section>

          {parts && (
            <JobParts complaintId={d.id} challans={parts.challans} faulty={parts.faulty} catalogue={parts.catalogue}
              canEdit={canEdit} canIssue={parts.canIssue} fmt={fmt} actionsElsewhere />
          )}

          <section className="rounded-xl border border-border bg-card p-5 shadow-card">
            <h2 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Visits</h2>
            <ul className="mt-3 flex flex-col divide-y divide-border">
              {d.visits.length === 0 && <li className="py-1 text-sm text-muted-foreground">No visits yet.</li>}
              {d.visits.map((v) => (
                // G-33: the trail's visit chip lands here (#visit-id), scrolled to and highlighted.
                <li key={v.id} id={`visit-${v.id}`} className="scroll-mt-24 rounded-lg py-2 target:bg-brand/10 target:ring-2 target:ring-brand/40">
                  <p className="flex items-center justify-between gap-2 text-sm font-medium">
                    {v.technicianName}
                    <Badge tone={v.status === 'completed' ? 'success' : v.status === 'cancelled' ? 'neutral' : 'warning'}>{v.status}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {v.purpose === 'field_visit' ? 'Field visit' : 'Visit'} · {fmt(v.scheduledAt)}
                    {v.checkedInAt ? ` · checked in${v.checkInDistanceM !== null ? ` ${Math.round(v.checkInDistanceM)} m from site` : ''}` : ''}
                  </p>
                  <VisitTrail changes={v.changes} fmt={fmt} />
                  {canEdit && v.status === 'scheduled' && (
                    <span className="mt-1.5 flex gap-3 text-xs">
                      <button type="button" className="font-medium text-brand hover:underline" onClick={() => setVisitEdit({ id: v.id, mode: 'move', scheduledAt: v.scheduledAt })}>Change time</button>
                      <button type="button" className="font-medium text-danger hover:underline" onClick={() => setVisitEdit({ id: v.id, mode: 'cancel', scheduledAt: v.scheduledAt })}>Cancel visit</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* Remarks, the log and calls - three different things, three tabs. */}
          <section className="rounded-xl border border-border bg-card shadow-card">
            <div role="tablist" aria-label="Remarks and history" className="flex gap-1 border-b border-border px-3">
              {([['remarks', `Remarks (${remarks.length})`], ['log', `Activity log (${log.length})`], ['calls', `Calls (${calls.length})`]] as const).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold transition ${tab === k ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="p-5">
              {tab === 'remarks' && (
                <div className="flex flex-col gap-4">
                  {canEdit && (
                    <form
                      className="flex flex-col gap-2"
                      onSubmit={(e) => { e.preventDefault(); const body = note.trim(); if (!body) return; const s = share; setNote(''); setShare(false); run(() => addComplaintNoteAction(d.id, body, s)); }}
                    >
                      <label htmlFor="complaint-note" className="sr-only">Write a remark</label>
                      <textarea id="complaint-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a remark - what you saw, what the customer said, what is next…"
                        className="min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                          <input id="complaint-note-share" type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
                          The customer can see this
                        </label>
                        <Button type="submit" size="sm" variant="primary" disabled={pending || !note.trim()}>Add remark</Button>
                      </div>
                    </form>
                  )}
                  <ol className="flex flex-col gap-3">
                    {remarks.length === 0 && <li className="text-sm text-muted-foreground">No remarks yet. Remarks are what people write; what Atlas did is in the activity log.</li>}
                    {remarks.map(({ a, c }) => {
                      const who = AUTHOR[c.author];
                      return (
                        <li key={a.id} className="flex gap-3">
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${who.tone === 'info' ? 'bg-info/10 text-info' : who.tone === 'warning' ? 'bg-warning/15 text-warning' : who.tone === 'brand' ? 'bg-brand/10 text-brand' : 'bg-muted text-muted-foreground'}`}>
                            {(a.createdByName ?? who.label).slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <strong className="text-foreground">{c.author === 'customer' ? 'Customer' : a.createdByName ?? who.label}</strong>
                              <Badge tone={who.tone}>{a.kind === 'visit_completed' ? 'Visit outcome' : who.label}</Badge>
                              <span>{fmtTime(a.createdAt)}</span>
                              {a.visibleToPortal ? <Badge tone="warning" icon="eye">Customer sees this</Badge> : <Badge tone="neutral" icon="lock">Staff only</Badge>}
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap text-sm">{a.body}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
              {tab === 'log' && (
                <ol className="flex flex-col divide-y divide-border">
                  {log.length === 0 && <li className="py-1 text-sm text-muted-foreground">Nothing yet.</li>}
                  {log.map(({ a }) => (
                    <li key={a.id} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 py-1.5 text-sm">
                      <time className="text-xs tabular-nums text-muted-foreground">{fmtTime(a.createdAt)}</time>
                      <span className="min-w-0 text-muted-foreground">
                        <span className="text-foreground">
                          {a.statusFrom && a.statusTo ? `${STATUS[a.statusFrom]?.label ?? a.statusFrom} → ${STATUS[a.statusTo]?.label ?? a.statusTo}` : a.body ?? a.kind.replace(/_/g, ' ')}
                        </span>
                        {a.statusFrom && a.statusTo && a.body ? <span> - {a.body}</span> : null}
                        <span className="text-xs"> · {a.kind === 'legacy_update' ? `old system${a.createdByName ? `, ${a.createdByName}` : ''}` : a.createdByName ?? 'Atlas'}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {tab === 'calls' && (
                <div className="flex flex-col gap-2">
                  <ul className="flex flex-col divide-y divide-border">
                    {calls.length === 0 && <li className="py-1 text-sm text-muted-foreground">None yet. A call from a staff phone shows here after the phone&apos;s next sync.</li>}
                    {calls.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                        <span>
                          <span className="font-medium">{c.userName}</span>
                          <span className="text-muted-foreground"> · {c.direction === 'incoming' ? 'customer called' : c.direction === 'outgoing' ? 'called the customer' : c.direction}</span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {new Date(c.startedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          {' · '}{c.durationSec > 0 ? `${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s` : 'not connected'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Link href={`/call-logs?q=${encodeURIComponent(d.customerPhone ?? '')}`} className="text-xs font-medium text-brand hover:underline">All calls with this number</Link>
                </div>
              )}
            </div>
          </section>

          {/* Job photos (3 Oct 2026). The customer sees these unless switched off in Settings → Customisation. */}
          <section className="rounded-xl border border-border bg-card p-5 shadow-card">
            <AttachmentPanel
              docType="complaint"
              docId={d.id}
              initial={photos}
              readOnly={!canEdit}
              phone={d.customerPhone}
              docLabel={`Complaint ${d.complaintNo}`}
            />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Photos and files on this job. Photos marked &ldquo;Customer sees it&rdquo; show in the customer&apos;s
              portal (new photos start that way), unless job photos are switched off in Settings &rarr; Customisation.
            </p>
          </section>

          {legacy.length > 0 && (
            <details className="rounded-xl border border-dashed border-border bg-muted/30 p-5">
              <summary className="flex cursor-pointer items-center gap-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                <Icon name="clock" className="h-3.5 w-3.5" /> From the previous system
              </summary>
              <dl className="mt-3 flex flex-col gap-2.5">
                {legacy.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{human(k)}</dt>
                    <dd className="text-sm font-medium">
                      {k === 'legacyAssignedTechnicianId' ? (legacyTechnicianName ?? 'Someone no longer on the staff list') : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>

        {/* ---------------- RIGHT: every linked document ---------------- */}
        <aside className="flex flex-col gap-3 lg:sticky lg:top-4" aria-label="Linked documents">
          <Rail title="Linked documents">
            <Group title="Sale & cover">
              {items.length > 0
                ? [...new Map(items.filter((i) => i.invoice).map((i) => [i.invoice!.id, i])).values()].map((i) => <DocLink key={i.invoice!.id} href={`/invoices/${i.invoice!.id}`} label={i.invoice!.invoiceNo} what="Sale" />)
                : sale && <DocLink href={`/invoices/${sale.id}`} label={sale.invoiceNo} what={`Sale · ${fmt(sale.date)}`} />}
              {coverage.labour.contractId && coverage.labour.contractNo && <DocLink href={`/services/amc?open=${coverage.labour.contractId}`} label={coverage.labour.contractNo} what={coverage.labour.until ? `AMC · till ${fmt(new Date(coverage.labour.until).toISOString())}` : 'AMC'} />}
              {d.salesOrder && <DocLink href={`/sales/orders/${d.salesOrder.id}`} label={d.salesOrder.orderNo} what="Sales order" />}
              {!sale && !coverage.labour.contractId && !d.salesOrder && <Empty>No sale or contract found for this equipment.</Empty>}
            </Group>
            <Group title="Visits">
              {d.visits.length === 0 && <Empty>None yet.</Empty>}
              {d.visits.map((v) => (
                <a key={v.id} href={`#visit-${v.id}`} className="flex items-baseline justify-between gap-2 text-sm hover:text-brand">
                  <span className="min-w-0 truncate">{fmt(v.scheduledAt)} · {v.technicianName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{v.status}</span>
                </a>
              ))}
            </Group>
            <Group title="Parts">
              {byKind('challan', 'gdn').length === 0 && <Empty>No challans.</Empty>}
              {byKind('challan', 'gdn').map((s) => (
                s.kind === 'challan'
                  ? <div key={s.id} className="flex items-baseline justify-between gap-2 text-sm"><span className="font-mono text-xs font-semibold">{s.label}</span><span className="text-xs text-muted-foreground">{s.detail}</span></div>
                  : <DocLink key={s.id} href={s.route} label={s.label} what={`GDN · ${s.detail}`} />
              ))}
              {d.challans.map((c) => <DocLink key={c.id} href={`/services/repairs/${c.id}`} label={c.challanNo} what={`Repair challan · ${rupees(c.costPaise)}`} />)}
            </Group>
            <Group title="Pickups">
              {[...new Map(items.filter((i) => i.pickup).map((i) => [i.pickup!.id, i.pickup!])).values()].map((pk) => (
                <DocLink key={pk.id} href={`/services/complaints/${d.id}/pickup/${pk.id}`} label={pk.pickupNo} what="Pickup receipt" />
              ))}
              {!items.some((i) => i.pickup) && <Empty>Nothing taken from the site.</Empty>}
            </Group>
            <Group title="Supplier (RMA)">
              {byKind('replacement').length === 0 && <Empty>Nothing sent to a supplier.</Empty>}
              {byKind('replacement').map((s) => <DocLink key={s.id} href={s.route} label={s.label} what={s.detail} />)}
              {byKind('supplier_dispatch').map((s) => <DocLink key={s.id} href={s.route} label={s.label} what={`Dispatch · ${s.detail}`} />)}
              {byKind('rma_receipt').map((s) => <DocLink key={s.id} href={s.route} label={s.label} what="RMA receipt" />)}
            </Group>
            <Group title="Money">
              {d.waitingEstimatePaise !== null && <div className="text-sm">Estimate {rupees(d.waitingEstimatePaise)} · <span className="text-warning">waiting for the customer</span></div>}
              {d.invoice && <DocLink href={`/invoices/${d.invoice.id}`} label={d.invoice.invoiceNo} what={`Job invoice · ${d.invoice.lifecycle}`} />}
              {byKind('receipt', 'credit_note', 'return').map((s) => <DocLink key={s.id} href={s.route} label={s.label} what={s.detail} />)}
              {!d.invoice && d.waitingEstimatePaise === null && <Empty>{d.billingStatus === 'not_billable' ? 'Nothing to bill.' : 'Not billed yet.'}</Empty>}
            </Group>
          </Rail>
        </aside>
      </div>
    </div>
  );
}

/** The one thing to do next, in words. */
function nextStep(s: {
  status: string; hasTech: boolean; techName: string | null; openVisits: number; toApprove: number; toIssue: number; oldUnitsDue: number;
  waitingEstimate: boolean; billed: boolean; billingStatus: string; closeNeedsApproval: boolean;
  itemsOut: number; toHandBack: number; refitDue: boolean; unbilledPaise: number;
}): string {
  if (s.status === 'cancelled') return 'Cancelled - nothing to do.';
  if (s.status === 'closed') return !s.billed && s.billingStatus === 'to_invoice' ? 'Closed, but not billed - use Bill this job.' : 'Closed - nothing to do.';
  // Stage 7: the money before the close - the office's job, technician or not.
  if (s.status === 'resolved' && s.unbilledPaise > 0) return `Bill this job (₹${(s.unbilledPaise / 100).toLocaleString('en-IN')} with GST) - or Don't bill with a reason - before it can close.`;
  // Back with us (stage 6): the office hands it over, whoever the technician is.
  if (s.toHandBack) return `${s.toHandBack} item${s.toHandBack === 1 ? ' is' : 's are'} back - use Hand back to give ${s.toHandBack === 1 ? 'it' : 'them'} to the customer on a GDN.`;
  if (!s.hasTech) return 'Assign a technician.';
  if (s.status === 'assigned') return `Waiting for ${s.techName ?? 'the technician'} to accept on the phone - or accept for them from Status.`;
  if (s.toApprove) return `${s.toApprove} challan${s.toApprove === 1 ? '' : 's'} waiting for approval in My Desk.`;
  if (s.toIssue) return `The store has ${s.toIssue} challan${s.toIssue === 1 ? '' : 's'} to issue.`;
  if (s.oldUnitsDue) return `The store has ${s.oldUnitsDue} old unit${s.oldUnitsDue === 1 ? '' : 's'} to receive back.`;
  if (s.waitingEstimate) return 'Waiting for the customer to approve the estimate.';
  // The repair loop (stage 6): handed over - fit it.
  if (s.itemsOut) return `${s.itemsOut} item${s.itemsOut === 1 ? ' is' : 's are'} away for repair - follow ${s.itemsOut === 1 ? 'it' : 'them'} in Supplier Dispatch. The job cannot close until ${s.itemsOut === 1 ? 'it is' : 'they are'} handed back.`;
  if (s.refitDue && !s.openVisits && !['resolved', 'awaiting_customer'].includes(s.status)) return 'Handed back - book the refit visit (Fitting a repaired item back) if the technician has to fit it.';
  if (s.status === 'resolved') return s.closeNeedsApproval ? 'Approve the close - from Status or My Desk.' : 'Close the job from Status.';
  if (s.status === 'awaiting_customer') return 'Waiting for the customer to confirm it is fixed.';
  if (s.openVisits) return 'A visit is booked - the technician updates it on the phone.';
  if (['accepted', 'in_progress'].includes(s.status)) return 'Schedule a visit, or raise a challan if parts are needed.';
  return 'Keep the job moving from Status.';
}

const ITEM_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  open: { label: 'Open', tone: 'neutral' }, picked_up: { label: 'Picked up', tone: 'info' }, with_supplier: { label: 'At supplier', tone: 'info' },
  back: { label: 'Back - to hand over', tone: 'brand' }, handed_back: { label: 'Handed back', tone: 'success' },
  supplier_closed: { label: 'Closed by supplier', tone: 'warning' },
  declined: { label: 'Declined - returned', tone: 'neutral' }, cancelled: { label: 'Taken off', tone: 'neutral' },
};

/** Every item on the job, with who pays for it - the heart of a multi-item complaint. */
function ItemsCard({ items, complaintId, canEdit, onTakeOff }: { items: ItemVM[]; complaintId: string; canEdit: boolean; onTakeOff: (i: ItemVM) => void }) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-card" aria-label="Items">
      <h2 className="px-5 pt-4 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Items ({items.filter((i) => i.status !== 'cancelled').length})</h2>
      <div className="overflow-x-auto px-2 pb-3 pt-2">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="text-micro uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-1.5 text-start font-medium">Item</th>
              <th className="px-3 py-1.5 text-start font-medium">Technician</th>
              <th className="px-3 py-1.5 text-start font-medium">Part / repair</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((i) => {
              const st = ITEM_STATUS[i.status] ?? { label: i.status, tone: 'neutral' as BadgeTone };
              const off = i.status === 'cancelled';
              return (
                <tr key={i.id} className={off ? 'opacity-55' : ''}>
                  <td className="px-3 py-2 align-top">
                    <p className="font-medium">{i.equipmentName}{!i.ours && <Badge tone="warning" className="ms-1.5">not ours</Badge>}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {i.pickup && <span className="font-mono text-xs text-muted-foreground">{i.pickup.pickupNo}</span>}
                      {i.handback && <Link href={`/services/complaints/${complaintId}/handback/${i.handback.id}`} className="font-mono text-xs text-brand hover:underline">{i.handback.gdnNo}</Link>}
                      {canEdit && i.status === 'open' && (
                        <button type="button" className="text-xs font-medium text-danger hover:underline" onClick={() => onTakeOff(i)}>Take off</button>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{i.serialNo ? (i.stockUnitId
                      ? <Link href={`/stock-units?q=${encodeURIComponent(i.serialNo)}&open=${i.stockUnitId}`} className="font-mono hover:text-brand hover:underline">S/N {i.serialNo}</Link>
                      : <span className="font-mono">S/N {i.serialNo}</span>) : 'no serial'}{i.problem ? ` · ${i.problem}` : ''}</p>
                    {i.rma && <ItemRma rma={i.rma} />}
                    {i.voidStatus === 'requested' && <p className="mt-1 text-xs text-warning">Warranty void asked: {i.voidReason} - waiting for a manager (My Desk)</p>}
                    {i.voidStatus === 'rejected' && <p className="mt-1 text-xs text-muted-foreground">Void refused: {i.voidDecisionNote}</p>}
                    {off && i.cancelReason && <p className="mt-1 text-xs text-muted-foreground">Taken off: {i.cancelReason}</p>}
                  </td>
                  <td className="px-3 py-2 align-top"><Pays free={i.cover.labour.free} reason={i.cover.labour.reason} /></td>
                  <td className="px-3 py-2 align-top"><Pays free={i.cover.parts.free} reason={i.cover.parts.reason} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Where the item's supplier case stands (stage 5): box, answer, what came back, on which receipt. */
function ItemRma({ rma: r }: { rma: NonNullable<ItemVM['rma']> }) {
  const said = r.supplierAnswer ? SUPPLIER_ANSWER_LABEL[r.supplierAnswer as SupplierAnswer] ?? r.supplierAnswer : null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      <Link href={`/services/replacements?q=${encodeURIComponent(r.caseNo)}&open=${r.id}`} className="font-mono text-brand hover:underline">{r.caseNo}</Link>
      {r.dispatch && <>· <Link href={`/services/dispatch/${r.dispatch.id}`} className="font-mono text-brand hover:underline">{r.dispatch.dispatchNo}</Link></>}
      {said && <span>· supplier: {said}{r.supplierQuotePaise ? ` ${rupees(r.supplierQuotePaise)}` : ''}</span>}
      {r.outcome && <span>· {r.closedOn === 'written_reply' ? 'Kept / scrapped by the supplier (written reply)' : RMA_OUTCOME_LABEL[r.outcome as RmaOutcome] ?? r.outcome}{r.replacementSerialNo ? ` - new S/N ${r.replacementSerialNo}` : ''}{r.creditNoteNo ? ` - CN ${r.creditNoteNo}` : ''}</span>}
      {r.receipt && <>· <Link href={`/services/dispatch/receipts/${r.receipt.id}`} className="font-mono text-brand hover:underline">{r.receipt.receiptNo}</Link></>}
    </p>
  );
}

function Pays({ free, reason }: { free: boolean; reason: string }) {
  return (
    <div className="min-w-0">
      <Badge tone={free ? 'success' : 'warning'}>{free ? 'Free' : 'Customer pays'}</Badge>
      <p className="mt-0.5 text-xs text-muted-foreground">{reason}</p>
    </div>
  );
}

function AddItems({ customerId, busy, onClose, onSave }: { customerId: string; busy: boolean; onClose: () => void; onSave: (picked: PickedItem[]) => void }) {
  const [picked, setPicked] = useState<PickedItem[]>([]);
  return (
    <Modal title="Add items to this complaint" icon="plus" size="lg" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!picked.length} onClick={() => onSave(picked)}>Add {picked.length > 0 ? picked.length : ''}</Button></>}>
      <EquipmentPicker customerId={customerId} value={picked} onChange={setPicked} />
    </Modal>
  );
}

const VOID_REASONS = ['Lightning / power surge', 'Water got in', 'Physical damage', 'Seal or sticker broken', 'Opened by someone else'];

function VoidWarranty({ items, photos, busy, onClose, onSave }: {
  items: ItemVM[]; photos: AttachmentView[]; busy: boolean; onClose: () => void; onSave: (itemId: string, reason: string, photoId: string) => void;
}) {
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [kind, setKind] = useState(VOID_REASONS[0]);
  const [detail, setDetail] = useState('');
  const [photoId, setPhotoId] = useState(photos[0]?.id ?? '');
  const reason = detail.trim() ? `${kind} - ${detail.trim()}` : kind;
  return (
    <Modal title="Void the warranty on an item" icon="ban" size="md" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!itemId || !photoId} onClick={() => onSave(itemId, reason, photoId)}>Send to a manager</Button></>}>
      <div className="grid gap-3 text-sm">
        <p className="text-xs text-muted-foreground">A manager decides in My Desk. Until then nothing changes; once approved, the part or repair on this item is charged to the customer. The AMC still pays for the technician.</p>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Item
          <select id="void-item" value={itemId} onChange={(e) => setItemId(e.target.value)} className="field-input">
            {items.map((i) => <option key={i.id} value={i.id}>{i.equipmentName}{i.serialNo ? ` · ${i.serialNo}` : ''}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Why
          <select id="void-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="field-input">
            {VOID_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">What you saw (optional)
          <input id="void-detail" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Housing melted, burnt smell at the PoE port" className="field-input" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Photo (from this job)
          {photos.length === 0
            ? <span className="font-normal text-warning">No photo on this job yet - add one in Photos and files, then come back.</span>
            : (
              <select id="void-photo" value={photoId} onChange={(e) => setPhotoId(e.target.value)} className="field-input">
                {photos.map((ph) => <option key={ph.id} value={ph.id}>{ph.label || ph.fileName}</option>)}
              </select>
            )}
        </label>
      </div>
    </Modal>
  );
}

function PickUp({ items, busy, onClose, onSave }: {
  items: ItemVM[]; busy: boolean; onClose: () => void; onSave: (ids: string[], handedOverBy: string | null, note: string | null) => void;
}) {
  const [ids, setIds] = useState<string[]>(items.map((i) => i.id));
  const [who, setWho] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal title="Take items for repair" icon="truck" size="md" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!ids.length} onClick={() => onSave(ids, who.trim() || null, note.trim() || null)}>Make pickup receipt</Button></>}>
      <div className="grid gap-3 text-sm">
        <p className="text-xs text-muted-foreground">Nothing is swapped from stock. The customer&apos;s own items go on one pickup receipt, each serial is marked in for repair (still theirs, still on their invoice), and a supplier case opens for each - send it from Replacements.</p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((i) => (
            <li key={i.id}>
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2">
                <input type="checkbox" checked={ids.includes(i.id)} onChange={() => setIds(ids.includes(i.id) ? ids.filter((x) => x !== i.id) : [...ids, i.id])} />
                <span>{i.equipmentName}{i.serialNo ? <span className="ms-1.5 font-mono text-xs text-muted-foreground">{i.serialNo}</span> : null}</span>
              </label>
            </li>
          ))}
        </ul>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Handed over by (at the customer)
          <input id="pickup-who" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Name of the person who gave it" className="field-input" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Note (optional)
          <input id="pickup-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="With adaptor, no box" className="field-input" />
        </label>
      </div>
    </Modal>
  );
}

function HandBack({ options, busy, onClose, onSave }: {
  options: HandBackOption[]; busy: boolean; onClose: () => void;
  onSave: (ids: string[], fromStock: Record<string, string>, receivedBy: string | null, note: string | null) => void;
}) {
  const [ids, setIds] = useState<string[]>(options.map((o) => o.itemId));
  const [fromStock, setFromStock] = useState<Record<string, string>>(() => Object.fromEntries(options.filter((o) => o.stockUnits.length).map((o) => [o.itemId, o.stockUnits[0].id])));
  const [who, setWho] = useState('');
  const [note, setNote] = useState('');
  const what = (o: HandBackOption) => (o.status === 'supplier_closed'
    ? 'The supplier kept it - give one from our stock'
    : o.outcome === 'replaced' ? `New serial from the supplier: ${o.newSerialNo ?? '-'} - full warranty from today`
    : o.outcome === 'returned_unrepaired' ? 'Came back not repaired' : 'Repaired - same unit');
  return (
    <Modal title="Hand items back to the customer" icon="check-circle" size="md" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!ids.length} onClick={() => onSave(ids, fromStock, who.trim() || null, note.trim() || null)}>Make the GDN</Button></>}>
      <div className="grid gap-3 text-sm">
        <p className="text-xs text-muted-foreground">One GDN on this complaint, signed by the customer. Their own items do not touch stock; a unit given from stock goes out of stock and its cost is booked to warranty when the warranty pays.</p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {options.map((o) => (
            <li key={o.itemId} className="grid gap-1.5 px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input type="checkbox" checked={ids.includes(o.itemId)} onChange={() => setIds(ids.includes(o.itemId) ? ids.filter((x) => x !== o.itemId) : [...ids, o.itemId])} />
                <span>{o.equipmentName}{o.serialNo ? <span className="ms-1.5 font-mono text-xs text-muted-foreground">{o.serialNo}</span> : null}</span>
              </label>
              <p className="ps-7 text-xs text-muted-foreground">{what(o)}{o.status === 'supplier_closed' ? (o.partsFree ? ' - free under warranty.' : ' - the customer pays for it.') : ''}</p>
              {o.status === 'supplier_closed' && o.serial && (
                o.stockUnits.length
                  ? <select aria-label={`Serial from stock for ${o.equipmentName}`} value={fromStock[o.itemId] ?? ''} onChange={(e) => setFromStock({ ...fromStock, [o.itemId]: e.target.value })} className="field-input ms-7 font-mono">
                    {o.stockUnits.map((u) => <option key={u.id} value={u.id}>{u.serialNo}</option>)}
                  </select>
                  : <p className="ps-7 text-xs text-danger">None in stock - receive one first, or untick it.</p>
              )}
            </li>
          ))}
        </ul>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Received by (at the customer)
          <input id="handback-who" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Name of the person who took it" className="field-input" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Note (optional)
          <input id="handback-note" value={note} onChange={(e) => setNote(e.target.value)} className="field-input" />
        </label>
      </div>
    </Modal>
  );
}

function CoverHalf({ title, free, reason }: { title: string; free: boolean; reason: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${free ? 'border-success/30 bg-success/[0.07]' : 'border-warning/30 bg-warning/[0.08]'}`}>
      <Icon name={free ? 'check-circle' : 'credit-card'} className={`mt-0.5 h-5 w-5 shrink-0 ${free ? 'text-success' : 'text-warning'}`} />
      <div className="min-w-0">
        <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className={`text-sm font-semibold ${free ? 'text-success' : 'text-warning'}`}>{free ? 'Free' : 'Customer pays'}</p>
        <p className="mt-0.5 text-sm text-foreground/80">{reason}</p>
      </div>
    </div>
  );
}

function Rail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4 shadow-card">
      <h2 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-2.5 first-of-type:border-0 first-of-type:pt-0">
      <h3 className="text-xs font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function DocLink({ href, label, what }: { href: string; label: string; what: string }) {
  return (
    <Link href={href} className="group flex items-baseline justify-between gap-2 rounded px-0.5 text-sm hover:bg-muted/60">
      <span className="font-mono text-xs font-semibold text-brand group-hover:underline">{label}</span>
      <span className="min-w-0 truncate text-end text-xs text-muted-foreground">{what}</span>
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}
