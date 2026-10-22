import { field, jsonBody, requireAction, str, V1Error } from '@/server/auth/v1-staff';
import { db } from '@/server/db';
import { teamIds } from '@/server/team-reach';
import { callsWithParty } from '@/server/call-logs';
import { inScope, type ResolvedAccess } from '@/lib/app-access';
import type { AppContext } from '@/server/context';
import {
  addComplaintNote, completeVisit, fieldCheckIn, getComplaintDetail, updateComplaintStatus, scheduleVisit, rescheduleVisit,
} from '@/server/complaints';
import {
  acceptJob, declineJob, goOnSite, leaveSite, onTheWay, requestSiteOverride, technicianActions, workDone, type SiteReading,
} from '@/server/job-onsite';
import { getJobSettings } from '@/server/job-settings';
import { customerApprovedFallback, resendOtp, verifyOtp } from '@/server/job-signoff';
import { tapTime } from '@/lib/job-flow';
import { editJobChallan, logFaultyPart, phoneJobParts, raiseJobChallan, requestPartsReturn, withdrawJobChallan } from '@/server/job-challans';
import { complaintItems, pickUpItems } from '@/server/complaint-items';

/** A GPS reading from the phone, or null when it sent none. */
function reading(b: Record<string, unknown>): SiteReading | null {
  const lat = Number(b.lat), lng = Number(b.lng), acc = Number(b.accuracyM);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, accuracyM: Number.isFinite(acc) ? acc : null, mocked: b.mocked === true };
}

type Params = { params: Promise<{ id: string }> };

/** Inside the person's "Complaints they see" setting - theirs, their visit's, or wider. */
async function mayOpen(ctx: AppContext, access: ResolvedAccess, assignee: string | null, complaintId: string) {
  // "Mine + my team" (B4, 11 Oct 2026) - the same reach as the list and the website.
  const team = access.scope.complaints === 'team' ? await teamIds(ctx.scope, ctx.user.id) : undefined;
  if (inScope(access.scope.complaints, [assignee], ctx.user.id, team)) return true;
  return (await db.serviceVisit.count({ where: { complaintId, technicianId: { in: [ctx.user.id, ...(team ?? [])] } } })) > 0;
}

/** Statuses a phone may set. Assigning and closing stay on the website. */
const PHONE_STATUSES = ['in_progress', 'resolved'];

/** The 1.0.5 job steps - Settings > Roles > Phone app > Job steps. */
const JOB_STEP_OPS = new Set([
  'accept', 'decline', 'on_the_way', 'on_site', 'request_override', 'leave_site', 'work_done', 'book_visit', 'change_visit',
  'enter_otp', 'resend_otp', 'customer_approved', 'raise_challan', 'unused_parts', 'faulty_part',
  'edit_challan', 'withdraw_challan',
]);

/** Why a technician sees no next step - so the phone never just shows nothing. */
function noStepReason(d: { status: string; assignedTechnicianId: string | null; assignedTechnicianName: string | null }, me: string, canEdit: boolean, stepsOn: boolean): string | null {
  if (['closed', 'cancelled'].includes(d.status)) return null;
  if (!canEdit) return 'You can view this job but not work on it (website permission Complaints: edit).';
  if (!stepsOn) return 'Job steps are switched off for your role - ask the office (Settings > Roles > Phone app > Job steps).';
  if (!d.assignedTechnicianId) return 'This job is not assigned to anyone yet - the office assigns it.';
  if (d.assignedTechnicianId !== me) return `This job is assigned to ${d.assignedTechnicianName ?? 'another technician'} - only they can take its steps.`;
  return null;
}

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['complaints.view', 'complaints.edit'], 'complaints', async (ctx, access) => {
    const d = await getComplaintDetail(ctx.scope, id);
    if (!d || !await mayOpen(ctx, access, d.assignedTechnicianId, id)) throw new V1Error('That complaint is not in your list.', 404);
    // Calls with the customer since the complaint (call log, 27 Sep 2026).
    const calls = await callsWithParty(ctx.scope, d.customerId, new Date(d.createdAt.getTime() - 86_400_000)).catch(() => []);
    const job = await db.complaint.findUnique({ where: { id }, select: { storeId: true, onSiteSince: true, timeOnSiteSec: true, overrideUsed: true } });
    const [settings, override, parts, items] = await Promise.all([
      getJobSettings(job!.storeId),
      db.siteOverride.findFirst({ where: { complaintId: id, status: 'pending' }, select: { id: true } }),
      phoneJobParts(ctx.scope, id, job!.storeId, ctx.user.id),
      complaintItems(ctx.scope, { id, customerId: d.customerId, createdAt: d.createdAt }),
    ]);
    return {
      complaint: d, calls, canEdit: ctx.permissions.has('complaints.edit'), me: ctx.user.id,
      // Workflow slice 3: what this technician can do next, and what the phone shows for it.
      actions: ctx.permissions.has('complaints.edit') && access.actions['complaints.jobSteps'] !== false ? technicianActions(d.status, d.assignedTechnicianId === ctx.user.id) : [],
      noStepReason: noStepReason(d, ctx.user.id, ctx.permissions.has('complaints.edit'), access.actions['complaints.jobSteps'] !== false),
      site: { gate: settings.locationGate, radiusM: settings.radiusMeters, hasLocation: d.siteLat !== null && d.siteLng !== null },
      /**
       * THE ITEMS (10 Oct 2026, repair flow stage 8): each serial on the job,
       * who pays for the technician and for the part, and where it is in the
       * repair loop. No supplier quotes or courier money - the phone never
       * carries costs. Older builds ignore the field.
       */
      items: items.map((i) => ({
        id: i.id, srNo: i.srNo, ours: i.ours, equipmentName: i.equipmentName, serialNo: i.serialNo, problem: i.problem, status: i.status,
        labour: { free: i.cover.labour.free, reason: i.cover.labour.reason },
        parts: { free: i.cover.parts.free, reason: i.cover.parts.reason },
        pickupNo: i.pickup?.pickupNo ?? null, handbackGdnNo: i.handback?.gdnNo ?? null,
        repair: i.rma ? { status: i.rma.status, outcome: i.rma.outcome, newSerialNo: i.rma.replacementSerialNo } : null,
      })),
      // Settings > Roles > Phone app > Take items for repair - its own switch.
      canPickUp: ctx.permissions.has('complaints.edit') && access.actions['complaints.pickup'] !== false && d.assignedTechnicianId === ctx.user.id,
      overridePending: !!override,
      onSiteSince: job?.onSiteSince ?? null,
      timeOnSiteSec: job?.timeOnSiteSec ?? 0,
      overrideUsed: job?.overrideUsed ?? false,
      // Workflow slice 4: the job's challans (status, GDN) and faulty parts - never sent to customers.
      parts,
    };
  });
}

/**
 * One action on a complaint - `op` is status | note | checkin | complete.
 * Check-in is GPS from the phone only; completing a field visit needs it
 * (enforced in completeVisit, as on the website).
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, 'complaints.edit', 'complaints', async (ctx, access) => {
    const b = await jsonBody(req);
    // Offline queue (workflow slice 8): the phone's id for this step - one
    // sent twice is applied once - and when it was actually tapped.
    const opId = str(b.opId, 80);
    if (opId && await db.jobOfflineReceipt.findUnique({ where: { opId }, select: { id: true } })) {
      return { ok: true, duplicate: true, complaint: await getComplaintDetail(ctx.scope, id) };
    }
    const tap = tapTime(b.at);
    const at = tap.offline ? tap.at : undefined;
    const done = async () => {
      if (opId) await db.jobOfflineReceipt.create({ data: { opId, complaintId: id, op: String(b.op ?? ''), userId: ctx.user.id } }).catch(() => undefined);
    };
    const detail = await getComplaintDetail(ctx.scope, id);
    if (!detail || !await mayOpen(ctx, access, detail.assignedTechnicianId, id)) throw new V1Error('That complaint is not in your list.', 404);
    if (b.op === 'status') requireAction(access, 'complaints.work', 'Changing the job status');
    if (b.op === 'note') requireAction(access, 'complaints.note', 'Adding notes');
    if (b.op === 'checkin' || b.op === 'complete') requireAction(access, 'complaints.siteCheckin', 'Site check-in');
    if (JOB_STEP_OPS.has(String(b.op ?? ''))) requireAction(access, 'complaints.jobSteps', 'Job steps');
    if (b.op === 'pickup') requireAction(access, 'complaints.pickup', 'Taking items for repair');

    switch (b.op) {
      case 'status': {
        const status = str(b.status, 40);
        if (!status || !PHONE_STATUSES.includes(status)) throw new V1Error('Choose In progress or Resolved.');
        // As the technician - lib/job-flow decides which steps a phone may take.
        await updateComplaintStatus(ctx.scope, id, status, ctx.user.id, 'technician');
        break;
      }
      case 'note': {
        const body = str(b.body, 2000);
        if (!body) throw new V1Error('Write something first.');
        await addComplaintNote(ctx.scope, id, body, ctx.user.id, b.shareWithCustomer === true);
        break;
      }
      case 'checkin': {
        const visitId = str(b.visitId, 60);
        const lat = Number(b.lat), lng = Number(b.lng), acc = Number(b.accuracyM);
        if (!visitId || !detail.visits.some((v) => v.id === visitId)) throw new V1Error('Choose the visit to check in to.');
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new V1Error('Your location could not be read. Turn on location and try again.');
        if (b.mocked === true) throw new V1Error('A fake location app is running on this phone. Turn it off to check in.');
        const r = await fieldCheckIn(ctx.scope, { visitId, lat, lng, accuracyM: Number.isFinite(acc) ? Math.round(acc) : null }, ctx.user.id);
        return { ok: true, checkIn: r, complaint: await getComplaintDetail(ctx.scope, id) };
      }
      case 'complete': {
        const visitId = str(b.visitId, 60);
        if (!visitId || !detail.visits.some((v) => v.id === visitId)) throw new V1Error('Choose the visit to complete.');
        await completeVisit(ctx.scope, visitId, str(b.outcome, 2000) ?? '', ctx.user.id);
        break;
      }
      // ---- workflow slice 3 (the job's own technician; lib/job-flow checks each step)
      case 'accept':
        await acceptJob(ctx.scope, id, ctx.user.id);
        break;
      case 'decline':
        await declineJob(ctx.scope, id, str(b.reason, 500) ?? '', ctx.user.id);
        break;
      case 'on_the_way':
        await onTheWay(ctx.scope, id, ctx.user.id);
        break;
      case 'on_site': {
        const r = reading(b);
        if (!r) throw new V1Error('Your location could not be read. Turn on location and try again.');
        const res = await goOnSite(ctx.scope, id, r, ctx.user.id, at);
        if (res.ok) await done();
        return { ok: res.ok, onSite: res, complaint: await getComplaintDetail(ctx.scope, id) };
      }
      case 'request_override':
        await requestSiteOverride(ctx.scope, id, str(b.reason, 500) ?? '', reading(b), ctx.user.id);
        break;
      case 'leave_site':
        await leaveSite(ctx.scope, id, str(b.reason, 500) ?? '', ctx.user.id, at);
        break;
      case 'work_done':
        await workDone(ctx.scope, id, str(b.note, 2000) ?? '', ctx.user.id, at);
        break;
      case 'book_visit': {
        const at = new Date(String(b.at ?? ''));
        if (Number.isNaN(at.getTime())) throw new V1Error('Choose the visit date and time.');
        if (detail.assignedTechnicianId !== ctx.user.id) throw new V1Error('This job is assigned to someone else.');
        await scheduleVisit(ctx.scope, id, ctx.user.id, 'field_visit', at, ctx.user.id, 'technician');
        break;
      }
      case 'change_visit': {
        const visitId = str(b.visitId, 60);
        const at = new Date(String(b.at ?? ''));
        if (!visitId || !detail.visits.some((v) => v.id === visitId)) throw new V1Error('Choose the visit to change.');
        if (Number.isNaN(at.getTime())) throw new V1Error('Choose the new date and time.');
        await rescheduleVisit(ctx.scope, visitId, at, str(b.reason, 500) ?? '', ctx.user.id);
        break;
      }
      // ---- workflow slice 6: sign-off
      case 'enter_otp':
        await verifyOtp(ctx.scope, id, str(b.code, 12) ?? '', ctx.user.id);
        break;
      case 'resend_otp':
        await resendOtp(ctx.scope, id, ctx.user.id);
        break;
      case 'customer_approved':
        await customerApprovedFallback(ctx.scope, id, str(b.note, 1000) ?? '', ctx.user.id);
        break;
      // ---- workflow slice 4: parts
      case 'raise_challan': {
        const lines = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]).map((l) => ({ productId: String(l?.productId ?? ''), qty: Number(l?.qty ?? 0) })) : [];
        const r = await raiseJobChallan(ctx.scope, id, { type: String(b.type ?? ''), lines, note: str(b.note, 1000) }, ctx.user.id, 'technician');
        return { ok: true, challanNo: r.challanNo, complaint: await getComplaintDetail(ctx.scope, id) };
      }
      // A challan not yet issued, put right by whoever raised it (22 Oct 2026).
      case 'edit_challan': {
        const lines = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]).map((l) => ({ productId: String(l?.productId ?? ''), qty: Number(l?.qty ?? 0) })) : [];
        await editJobChallan(ctx.scope, str(b.challanId, 60) ?? '', { complaintId: id }, { type: str(b.type, 20), lines, note: str(b.note, 1000) }, ctx.user.id, 'technician');
        break;
      }
      case 'withdraw_challan':
        await withdrawJobChallan(ctx.scope, str(b.challanId, 60) ?? '', { complaintId: id }, str(b.reason, 500), ctx.user.id, 'technician');
        break;
      case 'unused_parts':
        // A request: the store receives them before stock moves (28 Sep 2026).
        await requestPartsReturn(ctx.scope, str(b.lineId, 60) ?? '', Number(b.qty ?? 0), ctx.user.id, { complaintId: id });
        break;
      case 'faulty_part':
        await logFaultyPart(ctx.scope, id, { productId: str(b.productId, 60), description: str(b.description, 300) ?? '', serialNo: str(b.serialNo, 100) }, ctx.user.id);
        break;
      // ---- repair flow stage 8: take the customer's items for repair (queueable offline)
      case 'pickup': {
        if (detail.assignedTechnicianId !== ctx.user.id) throw new V1Error('This job is assigned to someone else.');
        const itemIds = Array.isArray(b.itemIds) ? (b.itemIds as unknown[]).map((x) => String(x)).slice(0, 50) : [];
        const r = await pickUpItems(ctx.scope, id, { itemIds, handedOverBy: str(b.handedOverBy, 120), note: str(b.note, 500) }, ctx.user.id);
        await done();
        return { ok: true, pickupNo: r.pickupNo, warnings: r.warnings, complaint: await getComplaintDetail(ctx.scope, id) };
      }
      default:
        throw new V1Error('Unknown action.');
    }
    await done();
    return { ok: true, complaint: await getComplaintDetail(ctx.scope, id) };
  });
}
