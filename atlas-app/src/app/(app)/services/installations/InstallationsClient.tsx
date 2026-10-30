'use client';

import Link from 'next/link';
import { CustomerLink } from '@/components/document/CustomerLink';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, EmptyState, Badge, StatusBadge } from '@/components/ui/Layout';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { ListPager } from '@/components/ui/ListPager';
import { useListParams } from '@/components/ui/useListParams';
import type { ServerPaging } from '@/components/ui/DataGrid';
import { Icon } from '@/components/ui/Icon';
import { ScanButton } from '@/components/scan/ScanButton';
import { Modal } from '@/components/ui/Modal';
import { AdvanceDialog } from './AdvanceDialog';
import { QuickVisitDialog } from '@/components/services/QuickVisitDialog';
import { SearchSelect, type SearchOption } from '@/components/ui/SearchSelect';
import { searchGoodsAction, searchOpenOrdersAction, customerSurveysAction, type CustomerPick } from '@/app/actions/search-options';
import { CustomerPicker } from '@/components/services/CustomerPicker';
import { SitePicker, type SiteChoice } from '@/components/services/SitePicker';
import { istDate } from '@/lib/date-ranges';
import { OFFICE_LABEL, WORKING_STATUSES } from '@/lib/job-flow';
import {
  installWorkDoneAction, setChallanStatusAction, updatePaperworkAction,
  createInstallationChallanAction, loadInstallationChallanDetailAction, updateInstallationChallanAction,
} from './actions';

type Challan = {
  id: string; challanNo: string; legacyRef: string | null; status: string; stage: string; priority: string;
  physicalChallanNo: string | null; technicianRemark: string | null; note: string | null;
  siteLocation?: string | null; sitePin?: { lat: number; lng: number } | null;
  isInvoiced?: boolean; invoice?: { id: string; invoiceNo: string } | null;
  rejectionReason: string | null; salesOrderId: string | null; orderNo: string | null;
  partyId?: string | null; customerName: string | null; itemCount: number; totalQty: number;
  assignees: string[]; assigneeIds: string[]; dispatchedAt: string; completedAt: string | null;
};
type StaffOption = { id: string; fullName: string };
type Item = { id: string; srNo: number; productName: string; barcode: string | null; qty: number; unit: string | null };

/** A complaint's words and colours (30 Oct 2026). */
const STATUS_LABEL: Record<string, string> = OFFICE_LABEL;

const fieldClass = 'w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground';
const btn = 'inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-card px-3 text-xs font-semibold shadow-card transition hover:bg-muted disabled:opacity-50';

export function InstallationsClient({
  canEdit, challans, paging, counts, status, rangeLabel, totalAll, technicians, staff, canExport, views, initialOpenId = null, fromSurvey = null,
}: {
  /** ?survey= - "Raise a challan from this survey": the form opens on its customer (27 Oct 2026). */
  fromSurvey?: { visitId: string; customer: CustomerPick; site: string | null; siteId?: string | null } | null;
  /** From `?open=`, so a global-search hit opens the record itself. */
  initialOpenId?: string | null;
  canEdit: boolean;
  /** One page, filtered on the server (?q= from the global search included). */
  challans: Challan[];
  paging: ServerPaging;
  counts: Record<string, number>;
  status: string | null;
  rangeLabel: string;
  totalAll: number;
  technicians: StaffOption[];
  staff: StaffOption[];
  canExport: boolean;
  views: FilterBarViews;
}) {
  const list = useListParams();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, Item[]>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  // G-24: a visit booked from the challan itself - its number is not asked again.
  const [booking, setBooking] = useState<Challan | null>(null);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState<Challan | null>(null);
  const [fullEdit, setFullEdit] = useState<Challan | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // Opened after the first paint: the dialog is portalled, so opening it on the
  // server render would not match what the browser draws.
  useEffect(() => { if (fromSurvey) setShowCreate(true); }, [fromSurvey?.visitId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [advanceFor, setAdvanceFor] = useState<Challan | null>(null);
  const router = useRouter();

  const cards: KpiCard[] = [
    // The complaint list's cards (30 Oct 2026).
    { key: 'open', label: 'Open', count: counts.open ?? 0, icon: 'alert-circle', tone: 'brand' },
    { key: 'unassigned', label: 'No technician', count: counts.unassigned ?? 0, icon: 'user-plus', tone: counts.unassigned ? 'warning' : 'default' },
    { key: 'urgent', label: 'Urgent / high', count: counts.urgent ?? 0, icon: 'alert-triangle', tone: counts.urgent ? 'danger' : 'default' },
    { key: 'received', label: 'New', count: counts.received ?? 0, icon: 'clock' },
    { key: 'assigned', label: 'Waiting for technician', count: counts.assigned ?? 0, icon: 'user-plus', tone: counts.assigned ? 'warning' : 'default' },
    { key: 'in_progress', label: 'In the field', count: counts.in_progress ?? 0, icon: 'refresh' },
    { key: 'awaiting_customer', label: 'Waiting for customer', count: counts.awaiting_customer ?? 0, icon: 'user' },
    { key: 'resolved', label: 'Waiting to close', count: counts.resolved ?? 0, icon: 'check-circle', tone: 'success' },
    { key: 'closed', label: 'Closed', count: counts.closed ?? 0, icon: 'check-circle' },
    { key: 'cancelled', label: 'Cancelled', count: counts.cancelled ?? 0, icon: 'ban' },
  ];

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
    });
  }

  async function toggle(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!items[id]) {
      const detail = await loadInstallationChallanDetailAction(id);
      if (detail) setItems((m) => ({ ...m, [id]: detail.items }));
    }
  }

  // A search hit (`?open=`) opens that slip's items, loaded like a click.
  useEffect(() => { if (initialOpenId) void toggle(initialOpenId); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader
        badge="IC"
        title="Installation Challans"
        subtitle="The signed work slip for a new installation - what was fitted, who fitted it, and whether the office has accepted it"
        actions={canEdit ? (
          <button type="button" onClick={() => setShowCreate(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-white transition hover:opacity-90">
            <Icon name="plus" className="h-3.5 w-3.5" />
            Raise a challan
          </button>
        ) : undefined}
      />

      {error && (
        <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-on-tint-danger">{error}</div>
      )}

      <FilterBar
        searchPlaceholder="Challan no, old no, order, customer, paper slip, technician…"
        dates={{ defaultPreset: 'all', label: 'Challan date', activeLabel: rangeLabel }}
        people={{ label: 'Technician', options: technicians }}
        shown={paging.total}
        clearKeys={['status']}
        exportScreen={canExport ? 'installations' : null}
        views={views}
      />

      <KpiStrip cards={cards} activeKey={status} onSelect={(k) => list.set({ status: k })} columns={5} />

      {challans.length === 0 ? (
        <EmptyState icon="file-text" title="No installation challans here"
          hint={totalAll === 0
            ? 'Raise one when a technician finishes fitting equipment at a site.'
            : 'Nothing matches that filter or search.'} />
      ) : (
        <div className="flex flex-col gap-2">
          {challans.map((c) => (
            <div key={c.id} className="rounded border border-border bg-card p-4 shadow-card transition hover:shadow-raised">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/services/installations/${c.id}`} className="font-mono text-xs font-semibold text-brand hover:underline">{c.challanNo}</Link>
                    <Link href={`/services/installations/${c.id}`} className="rounded-full bg-brand/10 px-2 py-0.5 text-cap font-semibold text-on-tint-brand hover:bg-brand/15">Open page</Link>
                    <StatusBadge status={c.stage} label={STATUS_LABEL[c.stage] ?? c.stage} />
                    {c.priority !== 'normal' && c.priority !== 'low' && <Badge tone={c.priority === 'urgent' ? 'danger' : 'warning'}>{c.priority}</Badge>}
                    {c.physicalChallanNo && (
                      <Badge tone="neutral" icon="file-text" title="The number on the paper slip the customer signed">
                        Slip {c.physicalChallanNo}
                      </Badge>
                    )}
                  </div>

                  <p className="mt-1 text-sm font-medium">
                    {c.customerName ? <CustomerLink id={c.partyId}>{c.customerName}</CustomerLink> : 'No customer on file'}
                    {/* G-28: the order and the invoice open themselves. */}
                    {c.orderNo && c.salesOrderId && <span className="text-muted-foreground"> - order <Link href={`/sales/orders/${c.salesOrderId}`} className="font-mono text-brand hover:underline">{c.orderNo}</Link></span>}
                    {c.invoice && <span className="text-muted-foreground"> - billed on <Link href={`/invoices/${c.invoice.id}`} className="font-mono text-brand hover:underline">{c.invoice.invoiceNo}</Link></span>}
                  </p>

                  <p className="text-xs text-muted-foreground">
                    {c.itemCount} {c.itemCount === 1 ? 'line' : 'lines'}, {c.totalQty} {c.totalQty === 1 ? 'unit' : 'units'}
                    {c.assignees.length > 0 && ` - ${c.assignees.join(', ')}`}
                    {/* Only when it differs. For most migrated rows the two are the same string. */}
                    {c.legacyRef && c.legacyRef !== c.challanNo && ` - was ${c.legacyRef}`}
                  </p>

                  {(c.siteLocation || c.sitePin) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Site: {c.siteLocation ?? 'pin only'}
                      {c.sitePin && <> · <a href={`https://www.google.com/maps?q=${c.sitePin.lat},${c.sitePin.lng}`} target="_blank" rel="noreferrer noopener" className="text-brand hover:underline">Map</a></>}
                    </p>
                  )}
                  {c.technicianRemark && (
                    <p className="mt-1.5 text-sm">
                      <span className="text-muted-foreground">Technician: </span>{c.technicianRemark}
                    </p>
                  )}
                  {c.status === 'rejected' && c.rejectionReason && (
                    <p className="mt-1.5 text-sm text-danger">Sent back: {c.rejectionReason}</p>
                  )}
                </div>

                <p className="shrink-0 text-xs text-muted-foreground">
                  {new Date(c.dispatchedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <button type="button" className={btn} onClick={() => toggle(c.id)}>
                  <Icon name="columns" className="h-3.5 w-3.5" />
                  {expanded === c.id ? 'Hide items' : 'Items'}
                </button>

                {canEdit && (WORKING_STATUSES as readonly string[]).includes(c.stage) && (
                  <button type="button" className={btn} disabled={pending}
                    onClick={() => run(() => installWorkDoneAction(c.id, null))}>
                    Mark work done
                  </button>
                )}
                {/* Billing is the sign-off now (27 Oct 2026) - done on the installation's page. */}
                {(c.stage === 'awaiting_customer' || c.stage === 'resolved') && !c.isInvoiced && (
                  <Link href={`/services/installations/${c.id}`} className={btn}>
                    <Icon name="file-text" className="h-3.5 w-3.5" />
                    Bill
                  </Link>
                )}
                {canEdit && (c.stage === 'awaiting_customer' || c.stage === 'resolved') && !c.isInvoiced && (
                  <button type="button" className={btn} disabled={pending}
                    onClick={() => { setRejecting(c.id); setReason(''); }}>
                    Send back
                  </button>
                )}
                {canEdit && c.status !== 'approved' && (
                  <button type="button" className={btn} onClick={() => setBooking(c)}>
                    <Icon name="calendar" className="h-3.5 w-3.5" />
                    Schedule a visit
                  </button>
                )}
                {canEdit && c.status !== 'approved' && (
                  <button type="button" className={btn} onClick={() => setFullEdit(c)}>
                    <Icon name="pencil" className="h-3.5 w-3.5" />
                    Edit
                  </button>
                )}
                {canEdit && c.status === 'approved' && (
                  <button type="button" className={btn} onClick={() => setEditing(c)}
                    title="Approved, so only the paperwork can change. Send it back to change the lines.">
                    <Icon name="pencil" className="h-3.5 w-3.5" />
                    Paperwork
                  </button>
                )}
                {/*
                  Money handed over at the customer's premises. Offered on any
                  challan, whatever its status - the customer pays when they pay.
                  G-30 (10 Oct 2026): NOT once it is billed - money is then taken
                  against the invoice, which the server already insisted on after
                  the form was filled - and not to someone who cannot edit.
                */}
                {canEdit && c.invoice && (
                  <Link href={`/invoices/${c.invoice.id}`} className={`${btn} ms-auto`} title="Billed - record money against the invoice.">
                    <Icon name="credit-card" className="h-3.5 w-3.5" />
                    Take payment on {c.invoice.invoiceNo}
                  </Link>
                )}
                {canEdit && !c.isInvoiced && <button type="button" onClick={() => setAdvanceFor(c)}
                  className="btn-depth ms-auto inline-flex h-8 items-center gap-1.5 rounded-sm bg-brand px-3 text-xs font-semibold text-brand-fg transition hover:bg-brand-hover"
                  title="Record money the customer paid on site. Held until the final invoice.">
                  <Icon name="credit-card" className="h-3.5 w-3.5" />
                  Money received
                </button>}
              </div>

              {rejecting === c.id && (
                <div className="mt-3 rounded-lg border border-border bg-background p-3">
                  <label className="mb-1.5 block text-xs font-medium" htmlFor={`reason-${c.id}`}>
                    Why is it going back? The technician sees this.
                  </label>
                  <input id={`reason-${c.id}`} value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. customer signature missing on the paper slip" className={fieldClass} />
                  <div className="mt-2 flex gap-2">
                    <button type="button" className={btn} disabled={pending || !reason.trim()}
                      onClick={() => run(async () => {
                        const res = await setChallanStatusAction({ id: c.id, to: 'rejected', reason });
                        if (!res.error) setRejecting(null);
                        return res;
                      })}>
                      Send back
                    </button>
                    <button type="button" className={btn} onClick={() => setRejecting(null)}>Cancel</button>
                  </div>
                </div>
              )}

              {expanded === c.id && (
                <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-micro uppercase text-muted-foreground">
                        <th className="px-3 py-2 text-start">#</th>
                        <th className="px-3 py-2 text-start">Product</th>
                        <th className="px-3 py-2 text-start">Unit barcode</th>
                        <th className="px-3 py-2 text-end">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(items[c.id] ?? []).map((i) => (
                        <tr key={i.id} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 text-muted-foreground">{i.srNo}</td>
                          <td className="px-3 py-2">{i.productName}</td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{i.barcode ?? '-'}</td>
                          <td className="px-3 py-2 text-end tabular-nums">{i.qty}{i.unit ? ` ${i.unit}` : ''}</td>
                        </tr>
                      ))}
                      {(items[c.id] ?? []).length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-3 text-center text-muted-foreground">Loading</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {paging.total > 0 && <ListPager paging={paging} />}

      {editing && (
        <PaperworkForm challan={editing} pending={pending} onClose={() => setEditing(null)}
          onSave={(input) => run(async () => {
            const res = await updatePaperworkAction(input);
            if (!res.error) setEditing(null);
            return res;
          })} />
      )}

      {booking && (
        <QuickVisitDialog subject="installation" subjectId={booking.id}
          label={`${booking.challanNo}${booking.customerName ? ` · ${booking.customerName}` : ''}`}
          technicians={technicians} defaultTechnicianId={booking.assigneeIds[0] ?? ''}
          onClose={() => setBooking(null)} onDone={() => { setBooking(null); router.refresh(); }} />
      )}
      {showCreate && (
        <ChallanForm staff={staff} pending={pending} fromSurvey={fromSurvey}
          onClose={() => { setShowCreate(false); if (fromSurvey) router.replace('/services/installations'); }}
          onSave={(input) => run(async () => {
            const res = await createInstallationChallanAction(input);
            if (!res.error) {
              setShowCreate(false);
              if (res.id) router.push(`/services/installations/${res.id}`);
            }
            return res;
          })} />
      )}

      {advanceFor && (
        <AdvanceDialog
          challanId={advanceFor.id}
          challanNo={advanceFor.challanNo}
          onClose={() => setAdvanceFor(null)}
          onDone={() => router.refresh()}
        />
      )}

      {fullEdit && (
        <EditLoader challan={fullEdit} staff={staff} pending={pending}
          onClose={() => setFullEdit(null)}
          onSave={(input) => run(async () => {
            const res = await updateInstallationChallanAction({ ...input, id: fullEdit.id });
            if (!res.error) { setFullEdit(null); setItems((m) => { const n = { ...m }; delete n[fullEdit.id]; return n; }); }
            return res;
          })} />
      )}
    </div>
  );
}

function Shell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <Modal title={title} icon="file-text" size="sm" onClose={onClose}>{children}</Modal>;
}

function PaperworkForm({
  challan, pending, onClose, onSave,
}: {
  challan: Challan; pending: boolean; onClose: () => void;
  onSave: (input: { id: string; physicalChallanNo: string | null; technicianRemark: string | null; note: string | null }) => void;
}) {
  const [slip, setSlip] = useState(challan.physicalChallanNo ?? '');
  const [remark, setRemark] = useState(challan.technicianRemark ?? '');
  const [note, setNote] = useState(challan.note ?? '');

  return (
    <Shell title={`Paperwork - ${challan.challanNo}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="pw-slip">Paper slip number</label>
          <input id="pw-slip" value={slip} onChange={(e) => setSlip(e.target.value)} className={fieldClass}
            placeholder="the number on the signed sheet, e.g. 12893" />
          <p className="mt-1 text-xs text-muted-foreground">
            From the pre-printed book at the site. Free text, because it is somebody else&apos;s numbering.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="pw-remark">Technician&apos;s remark</label>
          <textarea id="pw-remark" value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} className={fieldClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="pw-note">Office note</label>
          <textarea id="pw-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={fieldClass} />
          <p className="mt-1 text-xs text-muted-foreground">
            Kept separate from the technician&apos;s remark, so who wrote what stays clear.
          </p>
        </div>
        <button type="button" disabled={pending}
          onClick={() => onSave({
            id: challan.id,
            physicalChallanNo: slip.trim() || null,
            technicianRemark: remark.trim() || null,
            note: note.trim() || null,
          })}
          className="h-9 rounded-lg bg-brand text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50">
          Save
        </button>
      </div>
    </Shell>
  );
}

type SaveInput = {
  salesOrderId: string | null; customerId?: string | null; siteId?: string | null; otherPlace?: boolean; siteLocation?: string | null; surveyVisitId?: string | null;
  physicalChallanNo: string | null; dispatchedAt: string;
  technicianRemark: string | null; note: string | null; assigneeIds: string[];
  items: { id?: string | null; productId: string | null; productName: string; barcode: string | null; qty: number; unit: string | null }[];
};
type Line = { id?: string | null; product: SearchOption | null; unit: string | null; barcode: string; qty: string };

/** Loads a saved challan's lines, then opens the form on them. */
function EditLoader({ challan, staff, pending, onClose, onSave }: {
  challan: Challan; staff: StaffOption[]; pending: boolean; onClose: () => void; onSave: (input: SaveInput) => void;
}) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof loadInstallationChallanDetailAction>> | undefined>(undefined);
  useEffect(() => { void loadInstallationChallanDetailAction(challan.id).then(setDetail); }, [challan.id]);
  if (detail === undefined) {
    return <Shell title={`Edit ${challan.challanNo}`} onClose={onClose}><p className="text-sm text-muted-foreground">Loading…</p></Shell>;
  }
  if (!detail) return <Shell title="Not found" onClose={onClose}><p className="text-sm">That challan could not be loaded.</p></Shell>;
  return (
    <ChallanForm
      staff={staff} pending={pending} onClose={onClose} onSave={onSave}
      initial={{
        challanNo: detail.challanNo,
        order: detail.salesOrderId ? { id: detail.salesOrderId, label: `${detail.orderNo ?? ''} - ${detail.customerName ?? ''}` } : null,
        assigneeIds: detail.assigneeIds,
        slip: detail.physicalChallanNo ?? '',
        remark: detail.technicianRemark ?? '',
        note: detail.note ?? '',
        dispatchedAt: istDate(new Date(detail.dispatchedAt)),
        lines: detail.items.map((it) => ({
          id: it.id, unit: it.unit, barcode: it.barcode ?? '', qty: String(it.qty),
          product: { id: it.productId ?? `name:${it.productName}`, label: it.productName },
        })),
      }}
    />
  );
}

/**
 * Raise a challan, or correct a saved one (health check SVC-3). Orders and
 * products are searched as you type instead of loading every one (PERF-2).
 */
function ChallanForm({ staff, pending, onClose, onSave, initial, fromSurvey = null }: {
  staff: StaffOption[]; pending: boolean; onClose: () => void; onSave: (input: SaveInput) => void;
  fromSurvey?: { visitId: string; customer: CustomerPick; site: string | null; siteId?: string | null } | null;
  initial?: {
    challanNo: string; order: SearchOption | null; assigneeIds: string[]; slip: string; remark: string; note: string;
    dispatchedAt: string; lines: Line[];
  };
}) {
  const [order, setOrder] = useState<SearchOption | null>(initial?.order ?? null);
  // Customer first (27 Oct 2026): a challan names its customer, with or without an order.
  const [customer, setCustomer] = useState<CustomerPick | null>(fromSurvey?.customer ?? null);
  // Where it is fitted (30 Oct 2026): a saved site of the customer, or another place - never their main address by default.
  const [site, setSite] = useState<SiteChoice>(fromSurvey?.siteId
    ? { siteId: fromSurvey.siteId, otherPlace: false, text: '' }
    : { siteId: null, otherPlace: !!fromSurvey?.site, text: fromSurvey?.site ?? '' });
  const [surveys, setSurveys] = useState<{ id: string; label: string }[]>([]);
  const [surveyId, setSurveyId] = useState(fromSurvey?.visitId ?? '');
  const customerId = customer?.id ?? null;
  const editing = !!initial;
  useEffect(() => {
    if (editing || !customerId) { setSurveys([]); return; }
    let live = true;
    void customerSurveysAction(customerId).then((r) => { if (live) setSurveys(r); });
    return () => { live = false; };
  }, [customerId, editing]);
  const [slip, setSlip] = useState(initial?.slip ?? '');
  const [remark, setRemark] = useState(initial?.remark ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [date, setDate] = useState(initial?.dispatchedAt ?? new Date().toISOString().slice(0, 10));
  const [assignees, setAssignees] = useState<string[]>(initial?.assigneeIds ?? []);
  const [lines, setLines] = useState<Line[]>(initial?.lines.length ? initial.lines : [{ product: null, unit: null, barcode: '', qty: '1' }]);

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  const ready = lines.some((l) => l.product && Number(l.qty) > 0) && (!!initial || (!!customer && (!!site.siteId || site.otherPlace)) || !!order);

  return (
    <Modal
      title={initial ? `Edit ${initial.challanNo}` : 'Raise an installation challan'}
      subtitle={initial ? 'Every change is kept in the activity log' : 'Who it is for, what goes up, and who goes'}
      icon="file-text"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btn}>Cancel</button>
          <button type="button" disabled={pending || !ready}
            onClick={() => onSave({
              salesOrderId: order?.id ?? null,
              ...(initial ? {} : { customerId: customer?.id ?? null, siteId: site.siteId, otherPlace: site.otherPlace, siteLocation: site.text.trim() || null, surveyVisitId: surveyId || null }),
              physicalChallanNo: slip.trim() || null,
              dispatchedAt: `${date}T12:00:00+05:30`,
              technicianRemark: remark.trim() || null,
              note: note.trim() || null,
              assigneeIds: assignees,
              items: lines
                .filter((l) => l.product && Number(l.qty) > 0)
                .map((l) => ({
                  id: l.id ?? null,
                  productId: l.product!.id.startsWith('name:') ? null : l.product!.id,
                  productName: l.product!.label,
                  barcode: l.barcode.trim() || null,
                  qty: Math.floor(Number(l.qty)),
                  unit: l.unit,
                })),
            })}
            className="h-9 rounded-lg bg-brand px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50">
            {initial ? 'Save changes' : 'Raise challan'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {!initial && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="cr-customer">Customer *</label>
              <CustomerPicker id="cr-customer" value={customer} onChange={(c) => { setCustomer(c); setSite({ siteId: null, otherPlace: false, text: '' }); }} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="cr-site">Site *</label>
              <SitePicker key={customer?.id ?? 'none'} id="cr-site" customerId={customer?.id ?? null} value={site} onChange={setSite} />
            </div>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="cr-order">Sales order <span className="font-normal text-muted-foreground">optional</span></label>
            <SearchSelect id="cr-order" value={order} onChange={setOrder} search={searchOpenOrdersAction} placeholder="Fills the prices - or leave empty" />
          </div>
          {!initial && (
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="cr-survey">From a survey <span className="font-normal text-muted-foreground">optional</span></label>
              <select id="cr-survey" value={surveyId} onChange={(e) => setSurveyId(e.target.value)} disabled={!surveys.length} className={fieldClass}>
                <option value="">{!customer ? 'Choose the customer first' : surveys.length ? 'None' : 'No survey for this customer'}</option>
                {surveys.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-xs font-medium">Technicians who went</span>
            <div className="thin-scroll flex max-h-32 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
              {staff.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={assignees.includes(s.id)}
                    onChange={(e) => setAssignees((a) => (e.target.checked ? [...a, s.id] : a.filter((x) => x !== s.id)))} />
                  {s.fullName}
                </label>
              ))}
            </div>
          </div>
          {initial && (
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="cr-date">Date</label>
              <input id="cr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
            </div>
          )}
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium">What goes up</span>
          <div className="flex flex-col gap-3">
            {lines.map((l, i) => (
              <div key={i} className="rounded-lg border border-border p-2">
                <div className="grid grid-cols-[1fr_4.5rem_auto] items-start gap-2">
                  <SearchSelect
                    id={`cr-product-${i}`} label="Product" value={l.product}
                    onChange={(o) => set(i, { product: o, unit: o?.sub?.split(' · ')[1] ?? l.unit })}
                    search={searchGoodsAction} placeholder="Product name or code…"
                  />
                  <input value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} inputMode="numeric"
                    className={`${fieldClass} text-center`} aria-label="Quantity" />
                  <button type="button" aria-label="Remove this line" disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))}
                    className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground hover:text-danger disabled:opacity-30">
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <input value={l.barcode} onChange={(e) => set(i, { barcode: e.target.value })}
                    placeholder="unit barcode - optional, scan or type" aria-label="Unit barcode" className={`${fieldClass} w-full`} />
                  <ScanButton className="h-9 w-9" title="Scan the unit barcode" onScan={(code) => set(i, { barcode: code })} />
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setLines((ls) => [...ls, { product: null, unit: null, barcode: '', qty: '1' }])}
            className="mt-2 text-xs font-medium text-brand">+ Add another line</button>
        </div>

        {/*
          Date fitted, paper slip and the technician's remark belong to the job
          as it happens (27 Oct 2026) - the phone fills them, and the paper slip
          is on the job page's menu. Still here when correcting a saved one.
        */}
        <div className={initial ? 'grid gap-3 sm:grid-cols-2' : ''}>
          {initial && (
            <div>
              <label className="mb-1 block text-xs font-medium" htmlFor="cr-slip">Paper slip number</label>
              <input id="cr-slip" value={slip} onChange={(e) => setSlip(e.target.value)} className={fieldClass} />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="cr-note">Office note</label>
            <input id="cr-note" value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass} />
          </div>
        </div>
        {initial && (
          <div>
            <label className="mb-1 block text-xs font-medium" htmlFor="cr-remark">Technician&apos;s remark</label>
            <textarea id="cr-remark" value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} className={fieldClass} />
          </div>
        )}
      </div>
    </Modal>
  );
}
