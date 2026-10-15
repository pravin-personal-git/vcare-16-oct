/**
 * The field-job lifecycle - #MOBILE-APP CLIENT & CUSTOMER WORKFLOW, slice 1
 * (spec: 09-documentation/04-roadmap/MOBILE-APP-CLIENT-CUSTOMER-WORKFLOW-SPEC.md §3).
 *
 * One table decides which step may follow which, and WHO may take it. The
 * server refuses anything not listed here; before this, a complaint's status
 * was free text any screen could set to anything.
 *
 * Status CODES are stable and stored; LABELS are what people see, and each
 * business may rename them (JobSettings.labels). Two old codes keep their
 * spelling so years of data and reports stay valid:
 *   received = New,   resolved = Waiting to close (work done, customer confirmed).
 *
 * Pure - shared by the server, the website, the phone app's API and tests.
 */

export const JOB_STATUSES = [
  'received', 'assigned', 'accepted', 'scheduled', 'on_the_way', 'on_site', 'in_progress',
  'awaiting_estimate', 'awaiting_customer', 'resolved', 'closed', 'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = ['complaint', 'repair', 'installation'] as const;
export type JobType = (typeof JOB_TYPES)[number];

// `waived` (10 Oct 2026): something was chargeable and the office chose not to bill it, with a reason.
export const BILLING_STATUSES = ['not_billable', 'to_invoice', 'invoiced', 'part_paid', 'paid', 'waived'] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

/** Who is acting. `approver` is whoever the Approval Rules name; `system` is automatic. */
export type JobActor = 'office' | 'technician' | 'customer' | 'approver' | 'system';

/** What the office sees by default. */
export const OFFICE_LABEL: Record<JobStatus, string> = {
  received: 'New',
  assigned: 'Waiting for technician',
  accepted: 'Accepted',
  scheduled: 'Visit booked',
  on_the_way: 'On the way',
  on_site: 'Working on site',
  in_progress: 'In progress',
  awaiting_estimate: 'Waiting for estimate approval',
  awaiting_customer: 'Waiting for customer confirmation',
  resolved: 'Waiting to close',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/** What the customer sees - milestones only (spec §3.1, Pravin round 3). */
export const CUSTOMER_LABEL: Record<JobStatus, string> = {
  received: 'Received',
  assigned: 'Received',
  accepted: 'Technician assigned',
  scheduled: 'Visit booked',
  on_the_way: 'Technician on the way',
  on_site: 'Technician working on site',
  in_progress: 'Work in progress',
  awaiting_estimate: 'Please approve the estimate',
  awaiting_customer: 'Please confirm it is resolved',
  resolved: 'Resolved - thank you',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const TERMINAL: readonly JobStatus[] = ['closed', 'cancelled'];
/** Work is finished from our side - no longer "open" on lists and counts. */
export const DONE: readonly JobStatus[] = ['resolved', 'closed', 'cancelled'];

export const isJobStatus = (s: string): s is JobStatus => (JOB_STATUSES as readonly string[]).includes(s);
export const isOpenStatus = (s: string) => !(DONE as readonly string[]).includes(s);

interface Transition { from: readonly JobStatus[]; to: JobStatus; by: readonly JobActor[]; action: string }

const OPEN: JobStatus[] = JOB_STATUSES.filter((s) => !(DONE as readonly string[]).includes(s));
const WORKING: JobStatus[] = ['accepted', 'scheduled', 'on_the_way', 'on_site', 'in_progress'];

/**
 * THE rulebook. Read top to bottom as the job's life.
 *
 * The office keeps two broad powers so a business can run without the phone
 * app (and while the later slices are being built): put any open job "In
 * progress", and mark any open job "Waiting to close" on the technician's or
 * customer's behalf. Both are logged with who did it.
 */
export const TRANSITIONS: readonly Transition[] = [
  { from: ['received'], to: 'assigned', by: ['office'], action: 'assign' },
  { from: ['assigned'], to: 'accepted', by: ['technician', 'office'], action: 'accept' },
  { from: ['assigned'], to: 'received', by: ['technician'], action: 'decline' },
  { from: ['accepted', 'in_progress', 'scheduled'], to: 'scheduled', by: ['office', 'technician'], action: 'book_visit' },
  { from: ['accepted', 'scheduled'], to: 'on_the_way', by: ['technician'], action: 'on_the_way' },
  // approver = a manager approving a location-check override (SiteOverride).
  { from: ['accepted', 'scheduled', 'on_the_way', 'in_progress'], to: 'on_site', by: ['technician', 'approver'], action: 'on_site' },
  { from: ['on_site'], to: 'in_progress', by: ['technician'], action: 'leave_site' },
  // Older phone app (before the on-site step): "Start" from any working step.
  { from: ['assigned', 'accepted', 'scheduled', 'on_the_way'], to: 'in_progress', by: ['technician'], action: 'start' },
  { from: ['on_site', 'in_progress'], to: 'awaiting_estimate', by: ['system', 'office'], action: 'estimate_sent' },
  { from: ['awaiting_estimate'], to: 'in_progress', by: ['customer', 'office'], action: 'estimate_decided' },
  // Customer said no to the price: the technician wraps up without that work (spec §4.5).
  { from: ['awaiting_estimate'], to: 'awaiting_customer', by: ['customer', 'office'], action: 'estimate_declined' },
  { from: ['on_site', 'in_progress'], to: 'awaiting_customer', by: ['technician'], action: 'work_done' },
  { from: ['awaiting_customer'], to: 'resolved', by: ['customer', 'technician', 'office'], action: 'confirm' },
  { from: ['awaiting_customer'], to: 'in_progress', by: ['customer', 'office'], action: 'not_resolved' },
  // Older phone app: "Resolved" straight from work (OTP off, or before slice 6).
  { from: WORKING, to: 'resolved', by: ['technician'], action: 'work_done_confirmed' },
  { from: ['resolved'], to: 'closed', by: ['approver', 'office', 'system'], action: 'close' },
  { from: ['resolved'], to: 'in_progress', by: ['approver', 'office'], action: 'send_back' },
  { from: ['closed'], to: 'in_progress', by: ['customer', 'office'], action: 'reopen' },
  { from: OPEN, to: 'cancelled', by: ['office'], action: 'cancel' },
  // Office fallback powers (see above).
  { from: OPEN.filter((s) => s !== 'in_progress'), to: 'in_progress', by: ['office'], action: 'office_progress' },
  { from: OPEN, to: 'resolved', by: ['office'], action: 'office_done' },
  // The office marks the work done for a technician without the app: the
  // customer still confirms (code / Yes) - live test 28 Sep 2026.
  { from: WORKING, to: 'awaiting_customer', by: ['office'], action: 'office_work_done' },
];

/** The rule that allows `from → to` for this actor, or null. */
export function findTransition(from: string, to: string, actor: JobActor): Transition | null {
  if (!isJobStatus(from) || !isJobStatus(to) || from === to) return null;
  return TRANSITIONS.find((t) => t.to === to && t.from.includes(from) && t.by.includes(actor)) ?? null;
}

/** Where this actor may take a job next - for status pickers and buttons. */
export function nextStatuses(from: string, actor: JobActor): JobStatus[] {
  if (!isJobStatus(from)) return [];
  return [...new Set(TRANSITIONS.filter((t) => t.from.includes(from) && t.by.includes(actor)).map((t) => t.to))];
}

/**
 * The office's Status picker (10 Oct 2026).
 *
 * Pravin found "Visit booked" listed twice, then three times: the picker was
 * built as [current, ...nextStatuses], and from "Visit booked" the next steps
 * include "Visit booked" again (booking another visit) - the same value twice,
 * and React kept a stale copy on every refresh. It also offered two steps that
 * are only true when something else happened: "Visit booked" (schedule a
 * visit) and "Waiting for estimate approval" (send an estimate). Picking them
 * by hand made the job claim a visit or an estimate that did not exist.
 *
 * So: the current status once, then each other step once, without those two.
 */
export const SET_BY_THEIR_OWN_ACTION: readonly JobStatus[] = ['scheduled', 'awaiting_estimate'];

export function officeStatusOptions(current: string): string[] {
  const next = nextStatuses(current, 'office').filter((s) => s !== current && !SET_BY_THEIR_OWN_ACTION.includes(s));
  return [current, ...next];
}

/** A plain refusal for a step that is not allowed. */
export function transitionError(from: string, to: string): string {
  const a = isJobStatus(from) ? OFFICE_LABEL[from] : from;
  const b = isJobStatus(to) ? OFFICE_LABEL[to] : to;
  return `A job that is "${a}" cannot go to "${b}" from here.`;
}

export { WORKING as WORKING_STATUSES };

/**
 * Timeline entries a customer may ever see. The portal and the customer app
 * read ONLY these kinds, and only when also marked visibleToPortal - so a
 * challan, a cost or an internal note can never leak, whatever a caller
 * passes (the 27 Sep 2026 bug: challans showed on customers' timelines).
 */
export const CUSTOMER_VISIBLE_KINDS = ['note', 'remark', 'pickup', 'status_change', 'visit_scheduled', 'visit_changed', 'visit_completed', 'estimate', 'customer_request'] as const;
/** Never shown to a customer. Guard-tested. */
export const INTERNAL_KINDS = ['assignment', 'challan_created', 'challan_changed', 'field_check_in', 'override', 'cost', 'internal_note', 'item_changed'] as const;

/** Old Vcare-style words each business may want instead (spec §3.2); applied as label overrides. */
export type StatusLabels = Partial<Record<JobStatus, { office?: string; customer?: string }>>;

export function officeLabel(s: string, labels?: StatusLabels | null): string {
  if (!isJobStatus(s)) return s;
  return labels?.[s]?.office?.trim() || OFFICE_LABEL[s];
}
export function customerLabel(s: string, labels?: StatusLabels | null): string {
  if (!isJobStatus(s)) return s;
  return labels?.[s]?.customer?.trim() || CUSTOMER_LABEL[s];
}

/** The customer's progress bar (portal + customer app): step labels, and which step a status is on. */
export const CUSTOMER_STEPS = ['Received', 'Technician assigned', 'Visit booked', 'Work in progress', 'Please confirm', 'Resolved'] as const;
const STEP_OF: Record<JobStatus, number> = {
  received: 0, assigned: 0, accepted: 1, scheduled: 2, on_the_way: 3, on_site: 3, in_progress: 3,
  awaiting_estimate: 3, awaiting_customer: 4, resolved: 5, closed: 5, cancelled: 0,
};
export const customerStep = (s: string): number => (isJobStatus(s) ? STEP_OF[s] : 0);

/** Badge colour family for a status, the same everywhere. */
export type StatusTone = 'warning' | 'info' | 'brand' | 'success' | 'neutral' | 'danger';
export function statusTone(s: string): StatusTone {
  if (s === 'received' || s === 'assigned') return 'warning';
  if (s === 'awaiting_estimate' || s === 'awaiting_customer') return 'info';
  if (s === 'resolved') return 'success';
  if (s === 'closed') return 'neutral';
  if (s === 'cancelled') return 'danger';
  return 'brand';
}

/**
 * The "Working on site" location check (spec §4.3, Pravin round 1): allowed
 * inside the radius; a reading vaguer than the radius is refused (step out,
 * or wait for a better fix) rather than trusted; too far -> ask for an
 * override. With the check switched off, always allowed (and recorded).
 */
export type SiteGateResult =
  | { ok: true }
  | { ok: false; reason: 'no_site' | 'poor_accuracy' | 'too_far' | 'mocked'; distanceM: number | null; message: string };

export function siteGate(input: {
  gateOn: boolean; radiusM: number; distanceM: number | null; accuracyM: number | null; mocked: boolean;
}): SiteGateResult {
  if (input.mocked) {
    return { ok: false, reason: 'mocked', distanceM: input.distanceM, message: 'A fake location app is running on this phone. Turn it off to start work.' };
  }
  if (!input.gateOn) return { ok: true };
  if (input.distanceM === null) {
    return { ok: false, reason: 'no_site', distanceM: null, message: 'This job has no site location to check against. Ask your manager for an override.' };
  }
  if (input.accuracyM !== null && input.accuracyM > input.radiusM) {
    return { ok: false, reason: 'poor_accuracy', distanceM: input.distanceM, message: `Your location is only accurate to ${Math.round(input.accuracyM)} m. Step outside or wait a moment and try again - or ask for an override.` };
  }
  if (input.distanceM > input.radiusM) {
    return { ok: false, reason: 'too_far', distanceM: input.distanceM, message: `You are ${Math.round(input.distanceM)} m from the site (allowed ${input.radiusM} m). Go to the site, or ask for an override.` };
  }
  return { ok: true };
}

/**
 * When a step queued offline actually happened (spec §4.10). The phone's tap
 * time is used for time on site - but only if it is believable: not in the
 * future (5 minutes of clock slack) and not older than 48 hours. Otherwise
 * the time it reached the server.
 */
export function tapTime(sent: unknown, now: Date = new Date()): { at: Date; offline: boolean } {
  const t = typeof sent === 'string' || typeof sent === 'number' ? new Date(sent) : null;
  if (!t || Number.isNaN(t.getTime())) return { at: now, offline: false };
  const ms = now.getTime() - t.getTime();
  if (ms < -5 * 60_000 || ms > 48 * 3_600_000) return { at: now, offline: false };
  return { at: ms > 60_000 ? t : now, offline: ms > 60_000 };
}
