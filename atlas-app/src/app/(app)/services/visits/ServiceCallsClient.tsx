'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { PageHeader, Badge, EmptyState, StatusBadge } from '@/components/ui/Layout';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { ListPager } from '@/components/ui/ListPager';
import { useListParams } from '@/components/ui/useListParams';
import type { ServerPaging } from '@/components/ui/DataGrid';
import { Icon } from '@/components/ui/Icon';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { CustomerPicker } from '@/components/services/CustomerPicker';
import type { CustomerPick } from '@/app/actions/search-options';
import { SearchSelect, type SearchOption } from '@/components/ui/SearchSelect';
import { searchOpenComplaintsAction, searchOpenInstallationsAction } from '@/app/actions/search-options';
import { scheduleSurveyVisitAction, scheduleVisitAction, completeVisitAction } from '../actions';
import { VISIT_REASONS, visitReason, visitReasonLabel, reasonsFor, type VisitReason } from '@/lib/visit-reasons';

type Visit = {
  id: string;
  /** What the visit is about - a complaint, or a new installation (7 Oct 2026). */
  subject: 'complaint' | 'installation';
  complaintId: string | null; installationChallanId: string | null;
  /** A survey booked against the customer alone - no challan yet (27 Oct 2026). */
  surveyOnly?: boolean;
  customerId: string | null;
  /** The complaint number or the challan number, whichever this is. */
  docNo: string;
  customerName: string;
  technicianId: string; technicianName: string; purpose: string; reason: string; scheduledAt: string;
  status: string; outcomeNote: string | null;
  siteLat: number | null; siteLng: number | null;
  checkedInAt: string | null; checkInDistanceM: number | null; checkInWithinRange: boolean | null;
};
type Technician = { id: string; fullName: string };

const PURPOSE_LABEL: Record<string, string> = { field_visit: 'Field visit', info_collection: 'Collect more details' };
const fieldClass = 'w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground';

export function ServiceCallsClient({
  visits, technicians, presetComplaint, paging, counts, kindCounts, status, kind, reason, rangeLabel, totalAll, canExport, views,
}: {
  /** One page, filtered on the server (server/visits-list). */
  visits: Visit[];
  paging: ServerPaging;
  counts: Record<string, number>;
  /** How many of the shown visits are installations, and how many complaints. */
  kindCounts: { installation: number; complaint: number };
  status: string | null;
  kind: string | null;
  reason: string | null;
  rangeLabel: string;
  totalAll: number;
  canExport: boolean;
  views: FilterBarViews;
  technicians: Technician[];
  /** From ?complaint= - opens the form with it chosen. */
  presetComplaint: SearchOption | null;
}) {
  const router = useRouter();
  const list = useListParams();
  const cards: KpiCard[] = [
    { key: 'scheduled', label: 'Scheduled', count: counts.scheduled ?? 0, icon: 'calendar', tone: 'info' },
    { key: 'completed', label: 'Completed', count: counts.completed ?? 0, icon: 'check-circle', tone: 'success' },
    { key: 'cancelled', label: 'Cancelled', count: counts.cancelled ?? 0, icon: 'ban' },
  ];
  const [showSchedule, setShowSchedule] = useState(presetComplaint !== null);
  const [completing, setCompleting] = useState<string | null>(null);
  const [outcomeNote, setOutcomeNote] = useState('');
  const [pending, startTransition] = useTransition();

  const complete = (visitId: string) => {
    startTransition(async () => {
      await completeVisitAction(visitId, outcomeNote);
      setCompleting(null);
      setOutcomeNote('');
    });
  };

  return (
    <div>
      <PageHeader
        badge="SV"
        title="Visit Scheduler"
        subtitle="Every trip to a customer's site - a new installation or an existing complaint"
        actions={
          <button type="button" onClick={() => setShowSchedule(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-white transition hover:opacity-90">
            <Icon name="calendar" className="h-3.5 w-3.5" />
            Schedule a visit
          </button>
        }
      />

      <FilterBar
        searchPlaceholder="Job or challan no, customer, technician, reason…"
        dates={{ defaultPreset: 'all', label: 'Scheduled', activeLabel: rangeLabel }}
        people={{ label: 'Technician', options: technicians }}
        shown={paging.total}
        clearKeys={['status', 'kind', 'reason']}
        exportScreen={canExport ? 'visits' : null}
        views={views}
      />
      {/*
        WHAT KIND OF TRIP, AND WHY (7 Oct 2026).

        Two chips rather than one dropdown, because "how much of today is new
        installations" is the question this screen exists to answer and it
        should be one press. The reason list underneath is the finer cut, and
        it only offers the reasons that belong to the chosen kind - offering
        "survey before installing" while the Complaints chip is held would be
        a filter that can only ever return nothing.
      */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([
          { key: 'installation', label: 'New installations', icon: 'package', n: kindCounts.installation },
          { key: 'complaint', label: 'Complaints', icon: 'wrench', n: kindCounts.complaint },
        ] as const).map((c) => (
          <Button
            key={c.key}
            size="sm"
            icon={c.icon}
            variant={kind === c.key ? 'primary' : 'outline'}
            onClick={() => list.set({ kind: kind === c.key ? null : c.key, reason: null })}
          >
            {c.label} ({c.n})
          </Button>
        ))}

        <select
          value={reason ?? ''}
          onChange={(e) => list.set({ reason: e.target.value || null })}
          aria-label="Reason"
          className="h-8 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-brand"
        >
          <option value="">Any reason</option>
          {(kind === 'installation' || kind === 'complaint'
            ? reasonsFor(kind)
            : VISIT_REASONS
          ).map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>

        {/* G-32: newest first by default; oldest first works through the backlog. */}
        <select
          value={list.get('sort') === 'scheduledAt' && list.get('dir') !== 'desc' ? 'asc' : 'desc'}
          onChange={(e) => list.set(e.target.value === 'asc' ? { sort: 'scheduledAt', dir: 'asc' } : { sort: null, dir: null })}
          aria-label="Sort by date"
          className="h-8 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-brand"
        >
          <option value="desc">Date: newest first</option>
          <option value="asc">Date: oldest first</option>
        </select>

        {(kind || reason) && (
          <button
            type="button"
            onClick={() => list.set({ kind: null, reason: null })}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            <Icon name="x" className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      <KpiStrip cards={cards} activeKey={status} onSelect={(k) => list.set({ status: k })} columns={4} />

      {visits.length === 0 ? (
        <EmptyState icon="calendar" title={totalAll === 0 ? 'No visits scheduled' : 'No visits match'}
          hint={totalAll === 0
            ? 'Schedule one above - against a new installation, or against a complaint somebody has reported.'
            : 'Try another card, a wider date range, or Clear all filters.'} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="divide-y divide-border">
            {visits.map((v) => (
              <div key={v.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/*
                      Each kind links to its own document. A complaint has a
                      page; a challan opens on the New Installations screen
                      with that row rung (OpenTarget), which is where the
                      items and the sign-off live.
                    */}
                    {v.surveyOnly ? (
                      <span className="font-mono text-xs font-semibold text-muted-foreground">Survey · no challan yet</span>
                    ) : (
                      <Link
                        href={v.subject === 'complaint'
                          ? `/services/complaints/${v.complaintId}`
                          : `/services/installations/${v.installationChallanId}`}
                        className="font-mono text-xs font-semibold text-brand hover:underline"
                      >
                        {v.docNo}
                      </Link>
                    )}
                    <StatusBadge status={v.status} />
                    {/* WHY the technician is going - the thing Pravin asked for. */}
                    <Badge
                      tone={v.subject === 'installation' ? 'info' : 'neutral'}
                      icon={visitReason(v.reason)?.icon ?? 'wrench'}
                    >
                      {visitReasonLabel(v.reason)}
                    </Badge>
                    {/* Purpose only when it is the unusual one - a looking trip. */}
                    {v.purpose === 'info_collection' && (
                      <Badge tone="neutral">{PURPOSE_LABEL[v.purpose]}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-medium"><CustomerLink id={v.customerId}>{v.customerName}</CustomerLink></p>
                  <p className="text-xs text-muted-foreground">
                    {v.technicianName} · {new Date(v.scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  {v.outcomeNote && <p className="mt-1.5 text-sm text-muted-foreground">{v.outcomeNote}</p>}
                  {v.surveyOnly && v.status !== 'cancelled' && (
                    <Link href={`/services/installations?survey=${v.id}`} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                      <Icon name="file-text" className="h-3.5 w-3.5" /> Raise a challan from this survey
                    </Link>
                  )}
                  {v.purpose === 'field_visit' && v.checkedInAt && (
                    <p className={`mt-1.5 text-xs font-medium ${v.checkInWithinRange ? 'text-success' : 'text-warning'}`}>
                      Checked in {v.checkInDistanceM != null ? `· ${v.checkInDistanceM}m from site` : ''}
                      {v.checkInWithinRange === false && ' (outside expected range)'}
                    </p>
                  )}
                </div>

                {v.status === 'scheduled' && (
                  completing === v.id ? (
                    <div className="flex w-full max-w-xs shrink-0 flex-col gap-2 sm:w-auto">
                      <textarea value={outcomeNote} onChange={(e) => setOutcomeNote(e.target.value)} rows={2} placeholder="What happened?" className={fieldClass} />
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setCompleting(null)} className="rounded border border-border px-2.5 py-1 text-xs hover:bg-muted">Cancel</button>
                        <button type="button" disabled={pending} onClick={() => complete(v.id)} className="rounded bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg disabled:opacity-50">Mark completed</button>
                      </div>
                    </div>
                  ) : v.purpose === 'field_visit' && !v.checkedInAt ? (
                    // The technician's phone does this: Working on site (location-checked)
                    // is the check-in, Work done completes the visit (live test 28 Sep 2026).
                    <p className="max-w-[16rem] shrink-0 text-xs text-muted-foreground">
                      The technician taps <strong>Working on site</strong> on the phone at the site; <strong>Work done</strong> completes this visit.
                    </p>
                  ) : (
                    <button type="button" onClick={() => { setCompleting(v.id); setOutcomeNote(''); }}
                      className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
                      Mark completed
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {paging.total > 0 && <ListPager paging={paging} />}

      {showSchedule && (
        <ScheduleDialog preset={presetComplaint} technicians={technicians} onClose={() => { setShowSchedule(false); router.refresh(); }} />
      )}
    </div>
  );
}

/**
 * Booking a visit, reason first (7 Oct 2026).
 *
 * The old form asked for a complaint before anything else, which is exactly
 * why Vcare booked two visits in a year: half their field work is a new
 * installation and there was no complaint to name. So the first question is
 * now WHY somebody is going, and that answer decides what the second question
 * searches - open complaints, or installation challans.
 *
 * The reason is not decoration. `lib/visit-reasons` says which record each one
 * attaches to, the form reads it to pick the picker, and the server reads the
 * same file to refuse a mismatch. One list, three readers.
 */
function ScheduleDialog({
  preset, technicians, onClose,
}: {
  preset: SearchOption | null;
  technicians: Technician[];
  onClose: () => void;
}) {
  /*
    A preset arrives from a complaint's own page (?complaint=), so it is a
    complaint by construction - start on the reason that fits it rather than
    making somebody re-answer a question they answered by clicking.
  */
  const [reason, setReason] = useState<VisitReason>(() => visitReason('existing_complaint')!);
  const [subject, setSubject] = useState<SearchOption | null>(preset);
  const [technicianId, setTechnicianId] = useState('');
  const [purpose, setPurpose] = useState('field_visit');
  const [scheduledAt, setScheduledAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const forInstallation = reason.subject === 'installation';
  // Survey before installing (27 Oct 2026): any customer, the site, a challan only if there is one.
  const forSurvey = reason.subject === 'customer';
  const [customer, setCustomer] = useState<CustomerPick | null>(null);
  const [site, setSite] = useState('');

  const pickReason = (key: string) => {
    const next = visitReason(key);
    if (!next) return;
    // Changing the KIND of thing clears what was chosen. A challan id in a
    // complaint field is the one mistake this form can make, and the server
    // would refuse it only after the rest had been filled in.
    if (next.subject !== reason.subject) setSubject(null);
    setReason(next);
    // A survey is a looking trip; a fitting is not. Set the purpose that fits
    // and leave it editable.
    setPurpose(next.key === 'installation_survey' ? 'info_collection' : 'field_visit');
  };

  const save = () => {
    setError(null);
    if (forSurvey) {
      if (!customer) { setError('Choose the customer.'); return; }
      if (!technicianId) { setError('Choose who is going.'); return; }
      if (!scheduledAt) { setError('Choose the date and time.'); return; }
      startTransition(async () => {
        const res = await scheduleSurveyVisitAction({ customerId: customer.id, siteAddress: site.trim() || null, challanId: subject?.id ?? null, technicianId, scheduledAt });
        if (res.error) { setError(res.error); return; }
        onClose();
      });
      return;
    }
    if (!subject) { setError(forInstallation ? 'Choose the installation challan.' : 'Choose the complaint.'); return; }
    if (!technicianId) { setError('Choose who is going.'); return; }
    if (!scheduledAt) { setError('Choose the date and time.'); return; }
    startTransition(async () => {
      const res = await scheduleVisitAction(subject.id, technicianId, purpose, scheduledAt, reason.key);
      if (res.error) { setError(res.error); return; }
      onClose();
    });
  };

  return (
    <Modal
      title="Schedule a visit"
      subtitle="Say why somebody is going, and the rest follows"
      icon="calendar"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={pending} loading={pending}>Schedule</Button>
        </div>
      }
    >
      <div className="grid gap-3">
        {error && <p className="rounded border border-danger/40 bg-danger/5 px-2.5 py-2 text-xs text-on-tint-danger">{error}</p>}

        {/* ---- 1. why ------------------------------------------------- */}
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Why is somebody going?</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {VISIT_REASONS.map((r) => (
              <label
                key={r.key}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition ${
                  r.key === reason.key ? 'border-brand bg-brand/[0.06]' : 'border-border hover:bg-muted/50'
                }`}
              >
                <input
                  type="radio"
                  name="visit-reason"
                  value={r.key}
                  checked={r.key === reason.key}
                  onChange={() => pickReason(r.key)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[hsl(var(--brand-primary))]"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <Icon name={r.icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {r.label}
                  </span>
                  <span className="mt-0.5 block text-micro text-muted-foreground">{r.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* ---- 2. what, which the reason decides ---------------------- */}
        {forSurvey && (
          <>
            <div className="grid gap-1 text-xs font-medium text-muted-foreground">
              <label htmlFor="visit-customer">Customer</label>
              <CustomerPicker id="visit-customer" value={customer} onChange={(c) => { setCustomer(c); if (c?.address && !site.trim()) setSite(c.address); }} />
            </div>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Site address
              <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="Where the technician goes" className={fieldClass} />
            </label>
          </>
        )}
        <div className="grid gap-1 text-xs font-medium text-muted-foreground">
          <label htmlFor="visit-subject">{forSurvey ? <>Installation challan <span className="font-normal">optional</span></> : forInstallation ? 'Installation challan' : 'Complaint'}</label>
          <SearchSelect
            /*
              Keyed on the subject so the box drops its own results when the
              kind changes, instead of showing challans under a complaint
              label for one render.
            */
            key={reason.subject}
            id="visit-subject"
            value={subject}
            onChange={setSubject}
            search={forInstallation || forSurvey ? searchOpenInstallationsAction : searchOpenComplaintsAction}
            placeholder={forSurvey ? 'Only if the customer already has one - leave empty' : forInstallation ? 'Challan no, order no, customer or phone...' : 'Complaint no, customer or phone...'}
          />
          {forInstallation && (
            <p className="text-micro font-normal text-muted-foreground">
              Challans already approved are left out &mdash; that paperwork is signed off.
            </p>
          )}
        </div>

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Who is going
          <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} className={fieldClass}>
            <option value="">Choose...</option>
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
          </select>
        </label>

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Kind of trip
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className={fieldClass}>
            <option value="field_visit">Field visit (do the work)</option>
            <option value="info_collection">Collect more details</option>
          </select>
        </label>

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          When
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={fieldClass} />
        </label>

        {forInstallation && purpose === 'field_visit' && (
          <p className="rounded border border-border bg-muted px-2.5 py-2 text-micro text-muted-foreground">
            The phone checks in against the site saved on the challan. A challan with no site
            saved cannot be checked in &mdash; the technician marks it done with a note.
          </p>
        )}

        {/*
          Said here because it is the first question somebody will ask of this
          screen: booking a date does not touch the challan's own sign-off.
        */}
        {forSurvey && (
          <p className="text-micro text-muted-foreground">
            A looking trip - the phone does not ask for a check-in. When it is done, raise the challan from the survey.
          </p>
        )}
        {forInstallation && (
          <p className="text-micro text-muted-foreground">
            This books the appointment only. The challan&rsquo;s own status stays where the store left it.
          </p>
        )}
      </div>
    </Modal>
  );
}
