import 'server-only';
import { randomBytes } from 'node:crypto';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { ComplaintError, logActivity } from './complaints';
import { getJobSettings } from './job-settings';
import { CUSTOMER_VISIBLE_KINDS, customerLabel, findTransition, transitionError } from '@/lib/job-flow';
import { FEED_MAX_ROWS } from '@/lib/list-limits';
import { jobEvent } from './job-notify';

/**
 * The customer's side of a field job (workflow slice 5, spec §4.5-4.8):
 * what they see and what they can do - in the customer app, the portal, or
 * the no-login link (/j/<token>) for customers who have neither.
 *
 *   confirm it is resolved / say it is not (with a reason)
 *   approve or decline an estimate
 *   ask for another visit time
 *   rate the job after it is resolved
 *   reopen within the business's window
 *
 * Every entry point first proves the job is this customer's (party + store,
 * or the job's own link token), then goes through lib/job-flow.
 */

export type CustomerVia = 'app' | 'portal' | 'link';

/** A job the caller has proven belongs to this customer. */
interface OwnedJob { id: string; storeId: string; status: string; closedAt: Date | null; ratedAt: Date | null; customerId: string }

async function owned(where: { id: string; customerId?: string; storeId?: string; customerToken?: string }): Promise<OwnedJob> {
  const c = await db.complaint.findFirst({
    where,
    select: { id: true, storeId: true, status: true, closedAt: true, ratedAt: true, customerId: true },
  });
  if (!c) throw new ComplaintError('Job not found.');
  return c;
}

/** For the app and portal: the signed-in customer's own job. */
export const ownedByParty = (partyId: string, storeId: string, complaintId: string) =>
  owned({ id: complaintId, customerId: partyId, storeId });

/** For the no-login link: the token IS the credential; it stops 30 days after closing. */
export async function ownedByToken(token: string): Promise<OwnedJob> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new ComplaintError('This link is not valid.');
  const c = await db.complaint.findFirst({
    where: { customerToken: token },
    select: { id: true, storeId: true, status: true, closedAt: true, ratedAt: true, customerId: true },
  });
  if (!c) throw new ComplaintError('This link is not valid.');
  if (c.closedAt && Date.now() - c.closedAt.getTime() > 30 * 86_400_000) throw new ComplaintError('This link has expired. Contact the business for help.');
  return c;
}

async function move(j: OwnedJob, to: string, body: string | null, data: Record<string, unknown> = {}) {
  if (!findTransition(j.status, to, 'customer')) throw new ComplaintError(transitionError(j.status, to));
  // Stage 6: the customer cannot confirm a job while their item is still out.
  if (to === 'resolved') await (await import('./item-handback')).assertCanClose(j.id);
  await db.$transaction(async (tx) => {
    await tx.complaint.update({ where: { id: j.id }, data: { status: to, ...data } });
    await logActivity(tx, j.id, 'status_change', null, {
      statusFrom: j.status, statusTo: to, visibleToPortal: customerLabel(j.status) !== customerLabel(to),
      ...(body ? { body } : {}),
    });
  });
}

/** The customer says the job is done. (A code sign-off arrives in slice 6.) */
export async function customerConfirm(j: OwnedJob, via: CustomerVia) {
  await move(j, 'resolved', `Confirmed resolved by the customer (${via}).`, { resolvedAt: new Date(), signOff: 'customer' });
  await jobEvent(j.id, 'customer_confirmed');
  const { afterResolved } = await import('./job-signoff');
  await afterResolved(j.storeId, j.id, null, 'customer');
}

export async function customerNotResolved(j: OwnedJob, reason: string, via: CustomerVia) {
  const why = reason.trim();
  if (!why) throw new ComplaintError('Tell us what is still wrong.');
  await move(j, 'in_progress', `Customer says it is not resolved (${via}): ${why}`);
  await jobEvent(j.id, 'not_resolved', why);
}

/** Within the business's reopen window (Settings > Field jobs). */
export async function customerReopen(j: OwnedJob, reason: string, via: CustomerVia) {
  const why = reason.trim();
  if (!why) throw new ComplaintError('Tell us what went wrong again.');
  const settings = await getJobSettings(j.storeId);
  if (j.status !== 'closed') throw new ComplaintError('Only a closed job can be reopened.');
  if (!j.closedAt || Date.now() - j.closedAt.getTime() > settings.reopenDays * 86_400_000) {
    throw new ComplaintError(settings.reopenDays ? `Jobs can be reopened within ${settings.reopenDays} days of closing. Please raise a new complaint.` : 'Please raise a new complaint.');
  }
  await move(j, 'in_progress', `Reopened by the customer (${via}): ${why}`, { closedAt: null, closedBy: null, reopenCount: { increment: 1 } });
  await jobEvent(j.id, 'reopened', why);
}

/** Two ratings: the work, and the technician (Pravin, live test 28 Sep 2026). */
export async function customerRate(j: OwnedJob, stars: number, comment: string | null, techStars?: number | null) {
  const n = Math.round(stars);
  if (!(n >= 1 && n <= 5)) throw new ComplaintError('Choose 1 to 5 stars for the work.');
  const t = techStars == null || techStars === 0 ? null : Math.round(Number(techStars));
  if (t !== null && !(t >= 1 && t <= 5)) throw new ComplaintError('Choose 1 to 5 stars for the technician.');
  if (!['resolved', 'closed'].includes(j.status)) throw new ComplaintError('You can rate the job once it is resolved.');
  if (j.ratedAt) throw new ComplaintError('Thank you - this job is already rated.');
  await db.complaint.update({ where: { id: j.id }, data: { ratingStars: n, techRatingStars: t, ratingComment: comment?.trim() || null, ratedAt: new Date() } });
}

/** Ask for another visit time - a request the office and technician act on, not a change. */
export async function customerAskSlot(j: OwnedJob, preferred: string, via: CustomerVia) {
  const when = preferred.trim();
  if (!when) throw new ComplaintError('Say which day and time suit you.');
  if (['resolved', 'closed', 'cancelled'].includes(j.status)) throw new ComplaintError('This job is finished.');
  await logActivity(db, j.id, 'customer_request', null, { body: `Customer asked for another visit time (${via}): ${when}`, visibleToPortal: true });
  await jobEvent(j.id, 'slot_asked', when);
}

// ------------------------------------------------------------ estimates

/**
 * One estimate line. `productId` (parts) lets the estimate follow what was
 * really used after returns; `taxRatePct` makes the customer see the GST they
 * will be billed (live test 2, 28 Sep 2026). Older estimates have neither.
 */
export interface EstimateLine { description: string; qty: number; unitPaise: number; productId?: string | null; taxRatePct?: number }

/** Line total incl. GST, in paise. */
export const estimateLineTotal = (l: EstimateLine) => Math.round(l.qty * l.unitPaise * (1 + (l.taxRatePct ?? 0) / 100));
export const estimateTotal = (lines: EstimateLine[]) => lines.reduce((s, l) => s + estimateLineTotal(l), 0);

export async function sendEstimate(scope: StoreScope, complaintId: string, lines: EstimateLine[], note: string | null, userId: string) {
  const storeId = scopeForWrite(scope);
  const job = await db.complaint.findFirst({ where: { id: complaintId, ...scopeWhere(scope) }, select: { id: true, status: true } });
  if (!job) throw new ComplaintError('That job is not in your scope.');
  if (!findTransition(job.status, 'awaiting_estimate', 'office')) throw new ComplaintError(transitionError(job.status, 'awaiting_estimate'));
  const ids = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))];
  const ours = new Set((ids.length ? await db.product.findMany({ where: { id: { in: ids }, storeId }, select: { id: true } }) : []).map((p) => p.id));
  const clean: EstimateLine[] = lines
    .map((l) => ({
      description: String(l.description ?? '').trim().slice(0, 200), qty: Math.max(1, Math.trunc(Number(l.qty) || 1)),
      unitPaise: Math.max(0, Math.round(Number(l.unitPaise) || 0)),
      productId: l.productId && ours.has(l.productId) ? l.productId : null,
      taxRatePct: Math.min(28, Math.max(0, Number(l.taxRatePct ?? 18) || 0)),
    }))
    .filter((l) => l.description);
  if (!clean.length) throw new ComplaintError('Add at least one line to the estimate.');
  // Incl. GST, so what the customer approves is what they are billed.
  const total = estimateTotal(clean);
  await db.$transaction(async (tx) => {
    await tx.jobEstimate.updateMany({ where: { complaintId, status: 'waiting' }, data: { status: 'withdrawn' } });
    await tx.jobEstimate.create({ data: { storeId, complaintId, lines: clean as unknown as object[], totalPaise: total, note: note?.trim() || null, createdBy: userId } });
    await tx.complaint.update({ where: { id: complaintId }, data: { status: 'awaiting_estimate' } });
    await logActivity(tx, complaintId, 'estimate', userId, {
      body: `Estimate sent for approval: ₹${(total / 100).toLocaleString('en-IN')}.`, visibleToPortal: true,
      statusFrom: job.status, statusTo: 'awaiting_estimate',
    });
  });
  await jobEvent(complaintId, 'estimate_sent', `₹${(total / 100).toLocaleString('en-IN')}`);
}

export async function customerDecideEstimate(j: OwnedJob, approve: boolean, note: string | null, via: CustomerVia) {
  const est = await db.jobEstimate.findFirst({ where: { complaintId: j.id, status: 'waiting' }, orderBy: { createdAt: 'desc' } });
  if (!est) throw new ComplaintError('There is no estimate waiting for you.');
  if (!approve && !note?.trim()) throw new ComplaintError('Tell us why - it helps us offer something better.');
  const to = approve ? 'in_progress' : 'awaiting_customer';
  if (!findTransition(j.status, to, 'customer')) throw new ComplaintError(transitionError(j.status, to));
  await db.$transaction(async (tx) => {
    await tx.jobEstimate.update({ where: { id: est.id }, data: { status: approve ? 'approved' : 'declined', decidedVia: via, decidedAt: new Date(), declineNote: approve ? null : note?.trim() } });
    // Approved chargeable work is ready to bill (Bill this job, 28 Sep 2026).
    await tx.complaint.update({ where: { id: j.id }, data: { status: to, ...(approve ? { billingStatus: 'to_invoice' } : {}) } });
    await logActivity(tx, j.id, 'estimate', null, {
      body: approve ? `Estimate approved by the customer (${via}).` : `Estimate declined by the customer (${via}): ${note?.trim()}`,
      visibleToPortal: true, statusFrom: j.status, statusTo: to,
    });
  });
  await jobEvent(j.id, 'estimate_decided', approve ? 'approved' : `declined (${note?.trim()})`);
  // Declined: the job waits for the customer's confirmation - send the code for it.
  if (!approve) await (await import('./job-signoff')).askCustomerToConfirm(j.id);
}

// ------------------------------------------------------------ what the customer sees

export interface CustomerJobView {
  id: string; complaintNo: string; productName: string | null; description: string; status: string;
  statusLabel: string; siteLocation: string | null; createdAt: string;
  technician: { name: string; phone: string | null } | null;
  /** When the technician checked in on site (11 Oct 2026) - the portal's "working on it since". */
  onSiteSince?: string | null;
  /** The serialised unit's warranty end, when Atlas knows it (11 Oct 2026). */
  warrantyUntil?: string | null;
  visits: { id: string; scheduledAt: string; status: string }[];
  timeline: { id: string; body: string | null; statusTo: string | null; createdAt: string }[];
  estimate: { lines: EstimateLine[]; totalPaise: number; note: string | null } | null;
  /** The sign-off code to give the technician, while the job waits for them (slice 6). */
  otp: string | null;
  rating: { stars: number; techStars: number | null; comment: string | null } | null;
  reopenUntil: string | null;
  /** Each item on the job and where it is, in the customer's words (repair flow stage 8). */
  items: import('@/lib/customer-items').CustomerItem[];
  /** What the customer can do right now. */
  actions: ('confirm' | 'not_resolved' | 'approve_estimate' | 'decline_estimate' | 'ask_slot' | 'rate' | 'reopen')[];
}

export async function customerJobView(complaintId: string): Promise<CustomerJobView | null> {
  const c = await db.complaint.findUnique({
    where: { id: complaintId },
    include: {
      product: { select: { productName: true } },
      assignedTechnician: { select: { fullName: true, phone: true } },
      activities: { where: { visibleToPortal: true, kind: { in: [...CUSTOMER_VISIBLE_KINDS] } }, orderBy: { createdAt: 'desc' }, take: FEED_MAX_ROWS },
      visits: { where: { status: { not: 'cancelled' } }, orderBy: { scheduledAt: 'desc' }, take: 20 },
      estimates: { where: { status: 'waiting' }, orderBy: { createdAt: 'desc' }, take: 1 },
      // The items and their repair loop - never a quote, courier or cost.
      items: {
        where: { deletedAt: null }, orderBy: { srNo: 'asc' },
        select: {
          equipmentName: true, serialNo: true, status: true,
          // The unit's warranty, for the customer's product card (11 Oct 2026).
          stockUnit: {
            select: {
              warrantyMonths: true, warrantyFrom: true,
              invoice: { select: { invoiceDate: true } },
              product: { select: { warrantyMonths: true } },
              challanItems: { select: { challan: { select: { dispatchedAt: true, completedAt: true } } }, orderBy: { createdAt: 'desc' }, take: 1 },
            },
          },
          pickup: { select: { pickupNo: true } }, handbackIssue: { select: { gdnNo: true } },
          replacementCases: { where: { deletedAt: null, status: { not: 'cancelled' } }, orderBy: { createdAt: 'desc' }, take: 1, select: { outcome: true, closedOn: true, replacementSerialNo: true } },
        },
      },
    },
  });
  if (!c) return null;
  const { customerItem } = await import('@/lib/customer-items');
  const settings = await getJobSettings(c.storeId);
  const labels = settings.labels;
  const reopenUntil = c.status === 'closed' && c.closedAt && settings.reopenDays > 0
    ? new Date(c.closedAt.getTime() + settings.reopenDays * 86_400_000) : null;
  const est = c.estimates[0];
  const actions: CustomerJobView['actions'] = [];
  if (c.status === 'awaiting_customer') actions.push('confirm', 'not_resolved');
  if (c.status === 'awaiting_estimate' && est) actions.push('approve_estimate', 'decline_estimate');
  if (['accepted', 'scheduled', 'in_progress', 'assigned', 'received'].includes(c.status)) actions.push('ask_slot');
  if (['resolved', 'closed'].includes(c.status) && !c.ratedAt) actions.push('rate');
  if (reopenUntil && reopenUntil.getTime() > Date.now()) actions.push('reopen');
  // The technician is shown once they have accepted (spec §4.1).
  const showTech = c.assignedTechnician && !['received', 'assigned'].includes(c.status);
  // Warranty of the first serialised unit on the job - the same sum the
  // customer page and the unit page use (basis, invoice / install date, months).
  const unit = c.items.find((i) => i.stockUnit)?.stockUnit ?? null;
  let warrantyEnd: Date | null = null;
  if (unit) {
    const { getWarrantyBasis } = await import('./stock-units');
    const { warrantyStart, unitWarrantyMonths } = await import('@/lib/stock-units');
    const { warrantyUntil } = await import('@/lib/amc-coverage');
    const install = unit.challanItems[0]?.challan ?? null;
    const starts = warrantyStart({
      basis: await getWarrantyBasis({ kind: 'single', storeId: c.storeId, writable: false }),
      invoiceDate: unit.invoice?.invoiceDate ?? null,
      installDate: install ? (install.completedAt ?? install.dispatchedAt) : null,
      restartedOn: unit.warrantyFrom,
    });
    warrantyEnd = warrantyUntil({ productId: null, soldOn: starts, warrantyMonths: unitWarrantyMonths(unit.warrantyMonths, unit.product.warrantyMonths) });
  }
  return {
    id: c.id, complaintNo: c.complaintNo, productName: c.product?.productName ?? null, description: c.description,
    status: c.status, statusLabel: customerLabel(c.status, labels), siteLocation: c.siteLocation, createdAt: c.createdAt.toISOString(),
    technician: showTech ? { name: c.assignedTechnician!.fullName, phone: c.assignedTechnician!.phone } : null,
    onSiteSince: ['on_site', 'in_progress'].includes(c.status) && c.onSiteSince ? c.onSiteSince.toISOString() : null,
    warrantyUntil: warrantyEnd ? warrantyEnd.toISOString() : null,
    visits: c.visits.map((v) => ({ id: v.id, scheduledAt: v.scheduledAt.toISOString(), status: v.status })),
    // A status change's body is the office's reason ("lightning not covered -
    // send an estimate"), which reached the customer's link in the 9 Oct test.
    timeline: c.activities.map((a) => ({ id: a.id, body: a.kind === 'status_change' ? null : a.body, statusTo: a.statusTo, createdAt: a.createdAt.toISOString() })),
    estimate: est ? { lines: est.lines as unknown as EstimateLine[], totalPaise: est.totalPaise, note: est.note } : null,
    otp: c.status === 'awaiting_customer' ? await (await import('./job-signoff')).activeOtp(c.id) : null,
    rating: c.ratedAt && c.ratingStars ? { stars: c.ratingStars, techStars: c.techRatingStars, comment: c.ratingComment } : null,
    reopenUntil: reopenUntil ? reopenUntil.toISOString() : null,
    items: c.items.flatMap((i) => {
      const r = i.replacementCases[0];
      const v = customerItem({
        equipmentName: i.equipmentName, serialNo: i.serialNo, status: i.status, outcome: r?.outcome ?? null, closedOn: r?.closedOn ?? null,
        newSerialNo: r?.replacementSerialNo ?? null, pickupNo: i.pickup?.pickupNo ?? null, handbackGdnNo: i.handbackIssue?.gdnNo ?? null,
      });
      return v ? [v] : [];
    }),
    actions,
  };
}

/** The office's copy of the customer's no-login link (created on first use). */
export async function customerLinkToken(scope: StoreScope, complaintId: string): Promise<string> {
  scopeForWrite(scope);
  const c = await db.complaint.findFirst({ where: { id: complaintId, ...scopeWhere(scope) }, select: { id: true, customerToken: true } });
  if (!c) throw new ComplaintError('That job is not in your scope.');
  if (c.customerToken) return c.customerToken;
  const token = randomBytes(24).toString('base64url');
  await db.complaint.update({ where: { id: c.id }, data: { customerToken: token } });
  return token;
}

/** One entry point for every customer action, whichever door it came through. */
export async function customerAct(j: OwnedJob, op: string, b: { reason?: string | null; note?: string | null; stars?: number; techStars?: number | null; comment?: string | null; preferred?: string | null }, via: CustomerVia) {
  switch (op) {
    case 'confirm': return customerConfirm(j, via);
    case 'not_resolved': return customerNotResolved(j, b.reason ?? '', via);
    case 'approve_estimate': return customerDecideEstimate(j, true, null, via);
    case 'decline_estimate': return customerDecideEstimate(j, false, b.note ?? b.reason ?? null, via);
    case 'ask_slot': return customerAskSlot(j, b.preferred ?? '', via);
    case 'rate': return customerRate(j, Number(b.stars ?? 0), b.comment ?? null, b.techStars == null ? null : Number(b.techStars));
    case 'reopen': return customerReopen(j, b.reason ?? '', via);
    default: throw new ComplaintError('Unknown action.');
  }
}
