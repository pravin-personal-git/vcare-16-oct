import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { ComplaintError, completeVisit, logActivity } from './complaints';
import { getJobSettings } from './job-settings';
import { raiseApproval, openApprovalRequest, decideApprovalStep, HierarchyError } from './hierarchy';
import { metresBetween } from '@/lib/shift';
import { customerLabel, findTransition, siteGate, transitionError, type JobActor } from '@/lib/job-flow';
import { assertActionAllowed } from './flow-gate';
import { jobEvent } from './job-notify';

/**
 * The technician's field steps (workflow slice 3, spec §4.1-4.3):
 * accept / decline, On my way, Working on site (location-checked, with a
 * manager override), Leaving site, Work done - and time on site.
 *
 * Every step goes through lib/job-flow's rulebook, and only the job's own
 * technician may take them from the phone.
 */

export interface SiteReading { lat: number; lng: number; accuracyM: number | null; mocked: boolean }

type Job = NonNullable<Awaited<ReturnType<typeof loadJob>>>;

async function loadJob(scope: StoreScope, complaintId: string) {
  return db.complaint.findFirst({
    where: { id: complaintId, ...scopeWhere(scope) },
    select: {
      id: true, storeId: true, status: true, assignedTechnicianId: true, siteLat: true, siteLng: true,
      onSiteSince: true, timeOnSiteSec: true,
    },
  });
}

function mustBeMine(job: Job, userId: string) {
  if (job.assignedTechnicianId !== userId) throw new ComplaintError('This job is assigned to someone else.');
}

/** Move the job one step, logging it (the customer sees it when their milestone changes). */
async function step(
  job: Job, to: string, actor: JobActor, userId: string | null,
  extra: { body?: string; data?: Record<string, unknown> } = {},
) {
  const rule = findTransition(job.status, to, actor);
  if (!rule) throw new ComplaintError(transitionError(job.status, to));
  // This business may have switched the step off, or handed it to the office
  // (F1a / D16). The rulebook allowing it is necessary, not sufficient.
  await assertActionAllowed(job.storeId, rule.action, actor);
  await db.$transaction(async (tx) => {
    await tx.complaint.update({ where: { id: job.id }, data: { status: to, ...(extra.data ?? {}) } });
    await logActivity(tx, job.id, 'status_change', userId, {
      statusFrom: job.status, statusTo: to, visibleToPortal: customerLabel(job.status) !== customerLabel(to),
      ...(extra.body ? { body: extra.body } : {}),
    });
  });
}

/** Seconds on site so far in the current on-site period. */
const sinceSec = (since: Date | null, now: Date) => (since ? Math.max(0, Math.round((now.getTime() - since.getTime()) / 1000)) : 0);

export async function acceptJob(scope: StoreScope, complaintId: string, userId: string) {
  scopeForWrite(scope);
  const job = await loadJob(scope, complaintId);
  if (!job) throw new ComplaintError('That job is not in your list.');
  mustBeMine(job, userId);
  await step(job, 'accepted', 'technician', userId, { data: { acceptedAt: new Date(), declinedReason: null } });
  const me = await db.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  await jobEvent(complaintId, 'accepted', me?.fullName ?? 'your technician');
}

export async function declineJob(scope: StoreScope, complaintId: string, reason: string, userId: string) {
  scopeForWrite(scope);
  const why = reason.trim();
  if (!why) throw new ComplaintError('Say why you cannot take this job.');
  const job = await loadJob(scope, complaintId);
  if (!job) throw new ComplaintError('That job is not in your list.');
  mustBeMine(job, userId);
  await step(job, 'received', 'technician', userId, {
    body: `Declined by the technician: ${why}`,
    data: { assignedTechnicianId: null, assignedAt: null, declinedReason: why },
  });
  await jobEvent(complaintId, 'declined', why);
}

export async function onTheWay(scope: StoreScope, complaintId: string, userId: string) {
  scopeForWrite(scope);
  const job = await loadJob(scope, complaintId);
  if (!job) throw new ComplaintError('That job is not in your list.');
  mustBeMine(job, userId);
  await step(job, 'on_the_way', 'technician', userId);
  await jobEvent(complaintId, 'on_the_way');
}

export type OnSiteResult =
  | { ok: true; distanceM: number | null }
  | { ok: false; reason: 'no_site' | 'poor_accuracy' | 'too_far' | 'mocked'; distanceM: number | null; message: string; radiusM: number };

/**
 * Working on site - only inside the branch's radius (Settings > Field jobs,
 * default 50 m). A refusal is returned, not thrown, so the phone can offer
 * "Ask for override" with the distance.
 */
export async function goOnSite(scope: StoreScope, complaintId: string, reading: SiteReading, userId: string, at?: Date): Promise<OnSiteResult> {
  const storeId = scopeForWrite(scope);
  const job = await loadJob(scope, complaintId);
  if (!job) throw new ComplaintError('That job is not in your list.');
  mustBeMine(job, userId);
  if (!findTransition(job.status, 'on_site', 'technician')) throw new ComplaintError(transitionError(job.status, 'on_site'));

  const settings = await getJobSettings(storeId);
  const distanceM = job.siteLat !== null && job.siteLng !== null
    ? Math.round(metresBetween({ lat: reading.lat, lng: reading.lng }, { lat: Number(job.siteLat), lng: Number(job.siteLng) }))
    : null;
  const gate = siteGate({ gateOn: settings.locationGate, radiusM: settings.radiusMeters, distanceM, accuracyM: reading.accuracyM, mocked: reading.mocked });
  if (!gate.ok) return { ...gate, radiusM: settings.radiusMeters };

  await arriveOnSite(job, userId, 'technician', reading, distanceM, settings.radiusMeters, false, at);
  return { ok: true, distanceM };
}

/** Shared by the gate and an approved override. */
async function arriveOnSite(job: Job, userId: string, actor: JobActor, reading: SiteReading | null, distanceM: number | null, radiusM: number, override = false, at?: Date) {
  // An offline step counts from when it was tapped (lib/job-flow tapTime).
  const now = at ?? new Date();
  const late = at ? ` (recorded offline at ${at.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}, sent later)` : '';
  await step(job, 'on_site', actor, userId, {
    data: { onSiteSince: now, ...(override ? { overrideUsed: true } : {}) },
  });
  // Location proof - internal, never shown to the customer.
  await logActivity(db, job.id, 'field_check_in', userId, {
    body: override
      ? `Started work on site with a manager's override${distanceM !== null ? ` (${distanceM} m from the site)` : ''}.`
      : `Arrived on site${distanceM !== null ? ` - ${distanceM} m from the recorded location` : ''}${reading?.accuracyM ? ` (GPS ±${Math.round(reading.accuracyM)} m)` : ''}${late}.`,
  });
  // The booked field visit counts as checked in (completeVisit needs that).
  const visit = await db.serviceVisit.findFirst({
    where: { complaintId: job.id, complaint: { storeId: job.storeId }, status: 'scheduled', purpose: 'field_visit', checkedInAt: null },
    orderBy: { scheduledAt: 'asc' },
  });
  if (visit) {
    await db.serviceVisit.update({
      where: { id: visit.id },
      data: { checkedInAt: now, checkInDistanceM: distanceM, checkInWithinRange: override ? false : distanceM === null ? null : distanceM <= radiusM },
    });
  }
}

/** Ask a manager to let him start although the check failed (Approval Rules: site_override). */
export async function requestSiteOverride(scope: StoreScope, complaintId: string, reason: string, reading: SiteReading | null, userId: string) {
  const storeId = scopeForWrite(scope);
  const why = reason.trim();
  if (!why) throw new ComplaintError('Say why the location check cannot work here (basement, no GPS…).');
  const job = await loadJob(scope, complaintId);
  if (!job) throw new ComplaintError('That job is not in your list.');
  mustBeMine(job, userId);
  if (!findTransition(job.status, 'on_site', 'technician')) throw new ComplaintError(transitionError(job.status, 'on_site'));
  const open = await db.siteOverride.findFirst({ where: { complaintId, status: 'pending' } });
  if (open) throw new ComplaintError('An override is already waiting for your manager.');

  const distanceM = reading && job.siteLat !== null && job.siteLng !== null
    ? Math.round(metresBetween({ lat: reading.lat, lng: reading.lng }, { lat: Number(job.siteLat), lng: Number(job.siteLng) }))
    : null;
  const row = await db.siteOverride.create({
    data: {
      storeId, complaintId, requestedBy: userId, reason: why,
      lat: reading?.lat ?? null, lng: reading?.lng ?? null, accuracyM: reading?.accuracyM ? Math.round(reading.accuracyM) : null, distanceM,
    },
  });
  await logActivity(db, complaintId, 'override', userId, { body: `Asked for a location override: ${why}${distanceM !== null ? ` (${distanceM} m away)` : ''}` });
  await raiseApproval(scope, 'site_override', row.id, userId);
  return { id: row.id };
}

/** Approve or reject an override - through the engine when a rule routes it, directly otherwise. */
export async function decideSiteOverride(
  scope: StoreScope, id: string, decision: 'approved' | 'rejected', userId: string, note?: string | null,
): Promise<void> {
  const row = await db.siteOverride.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!row) throw new ComplaintError('Override request not found in your scope.');
  if (row.status !== 'pending') throw new ComplaintError(`That override was already ${row.status}.`);

  const open = await openApprovalRequest(scope, 'site_override', row.id);
  let final: 'approved' | 'rejected' = decision;
  if (open) {
    let s;
    try { s = await decideApprovalStep(scope, open.id, decision, userId, note?.trim() || null); } catch (e) {
      if (e instanceof HierarchyError) throw new ComplaintError(e.message);
      throw e;
    }
    if (s.final === null) return;
    final = s.final === 'APPROVED' ? 'approved' : 'rejected';
  }
  await db.siteOverride.update({ where: { id: row.id }, data: { status: final, decidedBy: userId, decidedAt: new Date(), decisionNote: note?.trim() || null } });
  await jobEvent(row.complaintId, 'override_decided', final);

  const job = await loadJob(scope, row.complaintId);
  if (!job) return;
  if (final === 'approved' && findTransition(job.status, 'on_site', 'approver')) {
    const settings = await getJobSettings(row.storeId);
    await arriveOnSite(job, row.requestedBy, 'approver', null, row.distanceM, settings.radiusMeters, true);
  } else {
    await logActivity(db, row.complaintId, 'override', userId, { body: `Location override ${final}${note?.trim() ? `: ${note.trim()}` : ''}.` });
  }
}

/** Leaving site (to fetch parts, next day…): time on site is added up, the job goes back to In progress. */
export async function leaveSite(scope: StoreScope, complaintId: string, reason: string, userId: string, at?: Date) {
  scopeForWrite(scope);
  const why = reason.trim();
  if (!why) throw new ComplaintError('Say why you are leaving the site.');
  const job = await loadJob(scope, complaintId);
  if (!job) throw new ComplaintError('That job is not in your list.');
  mustBeMine(job, userId);
  const now = at ?? new Date();
  await step(job, 'in_progress', 'technician', userId, {
    body: `Left the site: ${why}${at ? ' (recorded offline, sent later)' : ''}`,
    data: { onSiteSince: null, timeOnSiteSec: job.timeOnSiteSec + sinceSec(job.onSiteSince, now) },
  });
}

/**
 * Work done. With customer sign-off on (Settings > Field jobs), the job waits
 * for the customer; with it off, it goes straight to Waiting to close.
 */
export async function workDone(scope: StoreScope, complaintId: string, note: string, userId: string, at?: Date) {
  const storeId = scopeForWrite(scope);
  const job = await loadJob(scope, complaintId);
  if (!job) throw new ComplaintError('That job is not in your list.');
  mustBeMine(job, userId);
  const settings = await getJobSettings(storeId);
  const now = at ?? new Date();
  /*
    STAGE 6 (10 Oct 2026): the pickup visit is "work done" for the visit, not
    for the job - the customer's item is now with us. While anything is still
    out the job goes back to In progress and waits for the hand-back; the
    customer is not asked to confirm a job that is not finished.
  */
  const { complaintCloseBlockers } = await import('./item-handback');
  const stillOut = await complaintCloseBlockers(complaintId, { ignoreVisits: true });
  const to = stillOut.length ? 'in_progress' : settings.customerOtp === 'off' ? 'resolved' : 'awaiting_customer';
  await step(job, to, 'technician', userId, {
    body: [note.trim() ? `Work done: ${note.trim()}` : 'Work done.', stillOut.length ? `The job stays open: ${stillOut.join(' ')}` : null].filter(Boolean).join(' '),
    data: {
      onSiteSince: null, timeOnSiteSec: job.timeOnSiteSec + sinceSec(job.onSiteSince, now),
      ...(to === 'resolved' ? { resolvedAt: now, signOff: 'technician' } : {}),
    },
  });
  // Work done completes the visit he checked in to (Working on site) - the old
  // separate "Visit completed" button is gone (live test 28 Sep 2026).
  const visits = await db.serviceVisit.findMany({
    where: { complaintId, complaint: { storeId }, status: 'scheduled', checkedInAt: { not: null } },
    select: { id: true },
  });
  for (const v of visits) await completeVisit(scope, v.id, note.trim(), userId);
  // Slice 6: the customer's sign-off code, or straight on to Waiting to close.
  const { issueOtp, afterResolved } = await import('./job-signoff');
  if (to === 'awaiting_customer') await issueOtp(storeId, complaintId);
  else if (to === 'resolved') await afterResolved(storeId, complaintId, userId, 'technician');
}

/** What the phone should offer this technician next - the "one big next step" (spec §10). */
export function technicianActions(status: string, isMine: boolean): string[] {
  if (!isMine) return [];
  const can = (to: string) => !!findTransition(status, to, 'technician');
  const out: string[] = [];
  if (status === 'assigned') return ['accept', 'decline'];
  // Slice 6: the customer's code, a new code, or the "customer approved" fallback.
  if (status === 'awaiting_customer') return ['enter_otp', 'resend_otp', 'customer_approved'];
  if (can('on_the_way')) out.push('on_the_way');
  if (can('on_site')) out.push('on_site');
  if (status === 'on_site') out.push('work_done', 'leave_site');
  else if (status === 'in_progress') out.push('work_done');
  if (['accepted', 'scheduled', 'in_progress', 'on_the_way'].includes(status)) out.push('book_visit');
  return out;
}
