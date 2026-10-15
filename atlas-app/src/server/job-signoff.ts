import 'server-only';
import { randomInt } from 'node:crypto';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { ComplaintError, logActivity } from './complaints';
import { getJobSettings } from './job-settings';
import { raiseApproval, openApprovalRequest, decideApprovalStep, HierarchyError } from './hierarchy';
import { sendCustomerMessage } from './notify';
import { customerLabel, findTransition, transitionError, type JobActor } from '@/lib/job-flow';
import { jobEvent } from './job-notify';

/**
 * Sign-off and closing (workflow slice 6, spec §4.6-4.7, Pravin rounds 1 & 4).
 *
 *   Work done -> the customer gets a 6-digit code (app / portal / link, and
 *   email when there is an address) -> the technician types it in -> resolved
 *   (signOff = otp). Fallback: "Customer approved, please close" (signOff =
 *   technician, needsCallback) - closing then needs a note of the call.
 *
 *   Resolved -> "Waiting to close": an approval (job_close) for whoever the
 *   Approval Rules name, shown in My Desk - or closed at once when the
 *   customer's code confirmed it and the business allows auto-close. With
 *   "Closing needs approval" off, the office closes it from the job page.
 */

const OTP_MINUTES = 30;
const OTP_TRIES = 5;
export type SignOff = 'otp' | 'customer' | 'technician' | 'office';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://atlas.nairsolutions.org';

/** A new sign-off code for the customer (replaces any earlier one) and try to send it. */
export async function issueOtp(storeId: string, complaintId: string): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.jobOtp.updateMany({ where: { complaintId, usedAt: null }, data: { expiresAt: new Date() } });
  await db.jobOtp.create({ data: { storeId, complaintId, code, expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000) } });
  const c = await db.complaint.findUnique({
    where: { id: complaintId },
    select: { complaintNo: true, customerToken: true, customer: { select: { email: true, phone: true, firstName: true, companyName: true } } },
  });
  if (!c) return;
  // storeId so this goes through the branch's own provider - WhatsApp where
  // the client set it up, which for a one-time code is the channel people
  // actually read (workstream D).
  await sendCustomerMessage(
    { email: c.customer.email, phone: c.customer.phone, name: c.customer.companyName || c.customer.firstName || '' },
    `Your code for ${c.complaintNo}`,
    `The technician has finished. If it is working, give them this code: ${code}. It works for ${OTP_MINUTES} minutes.`,
    c.customerToken ? `${APP_URL}/j/${c.customerToken}` : undefined,
    storeId,
  ).catch(() => null);
}

/** The code the customer should see right now (their own views only). */
/**
 * The job now waits for the customer (work done / estimate declined / the
 * office marked it done): send the sign-off code unless it is switched off.
 */
export async function askCustomerToConfirm(complaintId: string): Promise<void> {
  const c = await db.complaint.findUnique({ where: { id: complaintId }, select: { storeId: true, status: true } });
  if (!c || c.status !== 'awaiting_customer') return;
  if ((await getJobSettings(c.storeId)).customerOtp === 'off') return;
  await issueOtp(c.storeId, complaintId);
}

export async function activeOtp(complaintId: string): Promise<string | null> {
  const o = await db.jobOtp.findFirst({
    where: { complaintId, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: OTP_TRIES } },
    orderBy: { createdAt: 'desc' }, select: { code: true },
  });
  return o?.code ?? null;
}

async function mine(scope: StoreScope, complaintId: string, userId: string) {
  const job = await db.complaint.findFirst({ where: { id: complaintId, ...scopeWhere(scope) }, select: { id: true, storeId: true, status: true, assignedTechnicianId: true } });
  if (!job) throw new ComplaintError('That job is not in your list.');
  if (job.assignedTechnicianId !== userId) throw new ComplaintError('This job is assigned to someone else.');
  return job;
}

async function toResolved(job: { id: string; status: string }, actor: JobActor, userId: string | null, signOff: SignOff, body: string, extra: Record<string, unknown> = {}) {
  if (!findTransition(job.status, 'resolved', actor)) throw new ComplaintError(transitionError(job.status, 'resolved'));
  // Stage 6: nothing still out, no visit still booked.
  await (await import('./item-handback')).assertCanClose(job.id);
  await db.$transaction(async (tx) => {
    await tx.complaint.update({ where: { id: job.id }, data: { status: 'resolved', resolvedAt: new Date(), signOff, ...extra } });
    await logActivity(tx, job.id, 'status_change', userId, {
      statusFrom: job.status, statusTo: 'resolved', body, visibleToPortal: customerLabel(job.status) !== customerLabel('resolved'),
    });
  });
}

/** The technician types the customer's code. */
export async function verifyOtp(scope: StoreScope, complaintId: string, code: string, userId: string): Promise<void> {
  scopeForWrite(scope);
  const job = await mine(scope, complaintId, userId);
  if (job.status !== 'awaiting_customer') throw new ComplaintError('This job is not waiting for the customer.');
  const otp = await db.jobOtp.findFirst({ where: { complaintId, usedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!otp || otp.expiresAt < new Date()) throw new ComplaintError('The code has expired - send the customer a new one.');
  if (otp.attempts >= OTP_TRIES) throw new ComplaintError('Too many wrong tries - send the customer a new code.');
  if (otp.code !== code.replace(/\D/g, '')) {
    await db.jobOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new ComplaintError(`That code is not right. ${OTP_TRIES - otp.attempts - 1} tries left.`);
  }
  await db.jobOtp.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
  await toResolved(job, 'technician', userId, 'otp', 'Customer confirmed with their code.');
  await afterResolved(job.storeId, complaintId, userId, 'otp');
}

export async function resendOtp(scope: StoreScope, complaintId: string, userId: string): Promise<void> {
  scopeForWrite(scope);
  const job = await mine(scope, complaintId, userId);
  if (job.status !== 'awaiting_customer') throw new ComplaintError('This job is not waiting for the customer.');
  await issueOtp(job.storeId, complaintId);
}

/** Fallback: the customer said yes but has no code. Closing then needs a call-back. */
export async function customerApprovedFallback(scope: StoreScope, complaintId: string, note: string, userId: string): Promise<void> {
  scopeForWrite(scope);
  const why = note.trim();
  if (!why) throw new ComplaintError('Say what the customer said (and why there is no code).');
  const job = await mine(scope, complaintId, userId);
  if (job.status !== 'awaiting_customer') throw new ComplaintError('This job is not waiting for the customer.');
  const settings = await getJobSettings(job.storeId);
  // With the code required, a close without it needs a call-back; optional or off, it does not.
  await toResolved(job, 'technician', userId, 'technician', `Technician: customer approved, please close - ${why}`, { needsCallback: settings.customerOtp === 'required' });
  await afterResolved(job.storeId, complaintId, userId, 'technician');
}

/**
 * Waiting to close: auto-close, raise the close approval, or leave it for the
 * office - per Settings > Field jobs.
 */
export async function afterResolved(storeId: string, complaintId: string, requesterId: string | null, signOff: SignOff): Promise<void> {
  const settings = await getJobSettings(storeId);
  const scope: StoreScope = { kind: 'single', storeId, writable: true };
  // The customer confirmed themselves - with the code, or Yes in their app,
  // portal or link (Pravin, live test 28 Sep 2026).
  if ((signOff === 'otp' || signOff === 'customer') && settings.autoCloseOnOtp) {
    // Stage 7: a job with charges not yet billed stays at Waiting to close for the office.
    const { unbilledPaise } = await import('./job-billing');
    const due = await unbilledPaise(scope, complaintId);
    if (due > 0) {
      await logActivity(db, complaintId, 'note', null, { body: `Not closed automatically: ₹${(due / 100).toLocaleString('en-IN')} + GST to bill first.` });
      return;
    }
    await closeJob(scope, complaintId, requesterId, 'system', signOff === 'otp' ? 'Closed automatically - the customer confirmed with their code.' : 'Closed automatically - the customer confirmed it is resolved.');
    return;
  }
  if (!settings.approvalToClose) return;
  const requester = requesterId
    ?? (await db.complaint.findUnique({ where: { id: complaintId }, select: { assignedTechnicianId: true, createdBy: true } }))?.assignedTechnicianId
    ?? null;
  if (requester) await raiseApproval(scope, 'job_close', complaintId, requester);
}

/**
 * Close a resolved job. A job the technician marked "customer approved"
 * needs a note of the call-back first (Pravin round 4).
 */
export async function closeJob(scope: StoreScope, complaintId: string, userId: string | null, actor: JobActor, note?: string | null): Promise<void> {
  scopeForWrite(scope);
  const job = await db.complaint.findFirst({
    where: { id: complaintId, ...scopeWhere(scope) },
    select: { id: true, status: true, needsCallback: true, complaintNo: true, customerToken: true, customer: { select: { email: true, firstName: true, companyName: true } } },
  });
  if (!job) throw new ComplaintError('That job is not in your scope.');
  if (!findTransition(job.status, 'closed', actor)) throw new ComplaintError(transitionError(job.status, 'closed'));
  await (await import('./item-handback')).assertCanClose(job.id);
  await (await import('./item-handback')).assertBilledToClose(scope, job.id);
  if (job.needsCallback && actor !== 'system' && !note?.trim()) {
    throw new ComplaintError('The technician marked this "customer approved" without a code - call the customer and note what they said.');
  }
  await db.$transaction(async (tx) => {
    await tx.complaint.update({ where: { id: job.id }, data: { status: 'closed', closedAt: new Date(), closedBy: userId, closeNote: note?.trim() || null } });
    await logActivity(tx, job.id, 'status_change', userId, { statusFrom: job.status, statusTo: 'closed', visibleToPortal: true, ...(note?.trim() ? { body: note.trim() } : {}) });
  });
  await jobEvent(complaintId, 'closed');
  // The customer's report and rating link.
  if (job.customerToken) {
    await sendCustomerMessage(
      { email: job.customer.email, name: job.customer.companyName || job.customer.firstName || '' },
      `${job.complaintNo} is closed - your service report`,
      'Thank you. Your job is closed. You can see the service report and rate us here.',
      `${APP_URL}/j/${job.customerToken}/report`,
    ).catch(() => null);
  }
}

/** Back to the technician from Waiting to close. */
export async function sendBackJob(scope: StoreScope, complaintId: string, userId: string, actor: JobActor, note: string): Promise<void> {
  scopeForWrite(scope);
  const why = note.trim();
  if (!why) throw new ComplaintError('Say why it goes back to the technician.');
  const job = await db.complaint.findFirst({ where: { id: complaintId, ...scopeWhere(scope) }, select: { id: true, status: true } });
  if (!job) throw new ComplaintError('That job is not in your scope.');
  if (!findTransition(job.status, 'in_progress', actor)) throw new ComplaintError(transitionError(job.status, 'in_progress'));
  await db.$transaction(async (tx) => {
    await tx.complaint.update({ where: { id: job.id }, data: { status: 'in_progress', needsCallback: false, signOff: null } });
    await logActivity(tx, job.id, 'status_change', userId, { statusFrom: job.status, statusTo: 'in_progress', body: `Sent back to the technician: ${why}`, visibleToPortal: true });
  });
  await jobEvent(complaintId, 'sent_back', why);
}

/** The job_close approval, decided in My Desk (approval-handlers). */
export async function decideJobClose(scope: StoreScope, complaintId: string, decision: 'approved' | 'rejected', userId: string, note: string | null, auto: boolean): Promise<void> {
  const job = await db.complaint.findFirst({ where: { id: complaintId, ...scopeWhere(scope) }, select: { id: true, status: true, needsCallback: true } });
  if (!job) throw new ComplaintError('That job is not in your scope.');
  if (job.status !== 'resolved') throw new ComplaintError('This job is not waiting to close any more.');
  if (decision === 'approved' && job.needsCallback && !auto && !note?.trim()) {
    throw new ComplaintError('Call the customer first and write what they said - the technician closed this without their code.');
  }
  if (decision === 'rejected' && !note?.trim()) throw new ComplaintError('Say why it goes back to the technician.');
  const open = await openApprovalRequest(scope, 'job_close', complaintId);
  if (open && !auto) {
    let s;
    try { s = await decideApprovalStep(scope, open.id, decision, userId, note?.trim() || null); } catch (e) {
      if (e instanceof HierarchyError) throw new ComplaintError(e.message);
      throw e;
    }
    if (s.final === null) return;
    decision = s.final === 'APPROVED' ? 'approved' : 'rejected';
  }
  if (decision === 'approved') await closeJob(scope, complaintId, userId, auto ? 'system' : 'approver', note);
  else await sendBackJob(scope, complaintId, userId, 'approver', note ?? '');
}
