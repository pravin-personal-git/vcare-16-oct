import 'server-only';
import { isInstallWorking } from '@/lib/installation-stages';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { publicBrandUrl } from './storage';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { ComplaintError, logActivity } from './complaints';
import { allocateDocumentNumber } from './allocate-document-number';
import { applyMovements, type MovementInput } from './stock';
import { sendUnit } from './serial-links';
import { raiseApproval, openApprovalRequest, decideApprovalStep, HierarchyError } from './hierarchy';
import { postJournalEntry } from './ledger';
import { costsFor } from './product-cost';
import { resolveCoverageFor } from './amc';
import { ACCOUNT, repairCostAccount } from '@/lib/service-revenue';
import { FEED_MAX_ROWS, LIST_MAX_ROWS } from '@/lib/list-limits';
import { installationEvent, jobEvent, type JobEvent } from './job-notify';
import { assertActionAllowed, stepBlockedReason } from './flow-gate';

/**
 * Job challans and GDNs (workflow slice 4, spec §4.4, Pravin round 2).
 *
 *   raise (technician on site, or office) -> Approval Rules (job_challan)
 *   -> approved -> the store issues it as a numbered GDN: stock and cost move
 *   -> unused parts come back; the faulty part taken out is logged and received.
 *
 * Job no. <-> challan no. <-> GDN no. are linked everywhere. Nothing here is
 * ever shown to the customer (activities are internal kinds).
 */

/**
 * One line as raised or changed. `unitIds` (22 Oct 2026, Vcare): the office
 * may name the exact serial-number units when raising - they are reserved for
 * this challan at once, and an approved challan whose every serial line is
 * named goes out on its GDN by itself. Optional: none named, the store picks
 * them when it issues, as before.
 */
export interface ChallanLineInput { productId: string; qty: number; unitIds?: string[] }

export const JOB_CHALLAN_TYPES = ['material', 'replacement', 'installation'] as const;
export type JobChallanType = (typeof JOB_CHALLAN_TYPES)[number];
export const JOB_CHALLAN_TYPE_LABEL: Record<JobChallanType, string> = {
  material: 'Material', replacement: 'Replacement', installation: 'Installation',
};

export interface JobChallanView {
  id: string; challanNo: string;
  /** Exactly one of these (22 Oct 2026, R3): a complaint's challan or an installation's. */
  complaintId: string | null; installationChallanId: string | null;
  /** The job's own number - the complaint no. or the installation challan no. */
  complaintNo: string;
  /** Where the job opens on the website. */
  jobHref: string;
  customerId: string; customerName: string;
  type: string; status: string; note: string | null; createdAt: Date; createdByName: string | null;
  /** Who raised it - the phone lets only that person change it (22 Oct 2026). */
  createdById: string | null;
  rejectionReason: string | null;
  lines: { id: string; productId: string; productName: string; productCode: string; qty: number; qtyIssued: number; qtyReturned: number; qtyReturnPending: number;
    /** Serial-number product, and the units of it still out on this job. */
    serial: boolean; units: { id: string; serialNo: string }[] }[];
  gdnNos: string[];
  /** GDNs the store cancelled (28 Sep 2026). */
  cancelledGdnNos: string[];
}

const include = {
  lines: { include: { product: { select: { productName: true, productCode: true, trackingMode: true } } } },
  issues: { select: { gdnNo: true, cancelledAt: true }, orderBy: { issuedAt: 'asc' as const } },
  complaint: { select: { complaintNo: true, customerId: true, customer: { select: { companyName: true, firstName: true, lastName: true } } } },
  installationChallan: { select: { challanNo: true, salesOrder: { select: { partyId: true, customerName: true, organizationName: true } } } },
};

/** Whose job a challan is on - the number, the customer and the page, for either kind. */
export function jobOf(r: {
  complaintId: string | null; installationChallanId: string | null;
  complaint: { complaintNo: string; customerId: string; customer: { companyName: string | null; firstName: string | null; lastName: string | null } } | null;
  installationChallan: { challanNo: string; salesOrder: { partyId: string | null; customerName: string; organizationName: string | null } | null } | null;
}) {
  if (r.complaint) {
    const cu = r.complaint.customer;
    return {
      complaintNo: r.complaint.complaintNo, customerId: r.complaint.customerId, jobHref: `/services/complaints/${r.complaintId}`,
      customerName: cu.companyName || [cu.firstName, cu.lastName].filter(Boolean).join(' '),
    };
  }
  const so = r.installationChallan?.salesOrder;
  return {
    complaintNo: r.installationChallan?.challanNo ?? '-', customerId: so?.partyId ?? '', jobHref: `/services/installations/${r.installationChallanId}`,
    customerName: so?.organizationName || so?.customerName || '',
  };
}

async function toView(rows: Awaited<ReturnType<typeof findMany>>): Promise<JobChallanView[]> {
  const ids = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))];
  const unitIds = rows.flatMap((r) => r.lines.flatMap((l) => l.stockUnitIds));
  const stores = [...new Set(rows.map((r) => r.storeId))];
  const serialNo = new Map((unitIds.length ? await db.stockUnit.findMany({ where: { id: { in: unitIds }, storeId: { in: stores } }, select: { id: true, serialNo: true } }) : []).map((u) => [u.id, u.serialNo ?? u.id]));
  const names = new Map((ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : []).map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({
    id: r.id, challanNo: r.challanNo, complaintId: r.complaintId, installationChallanId: r.installationChallanId, ...jobOf(r),
    type: r.type, status: r.status, note: r.note, createdAt: r.createdAt,
    createdByName: r.createdBy ? names.get(r.createdBy) ?? null : null, createdById: r.createdBy, rejectionReason: r.rejectionReason,
    lines: r.lines.map((l) => ({ id: l.id, productId: l.productId, productName: l.product.productName, productCode: l.product.productCode, qty: l.qty, qtyIssued: l.qtyIssued, qtyReturned: l.qtyReturned, qtyReturnPending: l.qtyReturnPending,
      serial: l.product.trackingMode === 'serial', units: l.stockUnitIds.map((id) => ({ id, serialNo: serialNo.get(id) ?? id })) })),
    gdnNos: r.issues.filter((i) => !i.cancelledAt).map((i) => i.gdnNo),
    cancelledGdnNos: r.issues.filter((i) => i.cancelledAt).map((i) => i.gdnNo),
  }));
}
function findMany(where: object) {
  return db.jobChallan.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: FEED_MAX_ROWS });
}

export async function jobChallansFor(scope: StoreScope, complaintId: string): Promise<JobChallanView[]> {
  // A hand-back GDN (stage 6) is not parts for the job - it shows with the items it handed back.
  return toView(await findMany({ complaintId, ...scopeWhere(scope), type: { not: 'handback' } }));
}

/** An installation's material challans (R3). */
export async function installationJobChallans(scope: StoreScope, installationChallanId: string): Promise<JobChallanView[]> {
  return toView(await findMany({ installationChallanId, ...scopeWhere(scope) }));
}

// ------------------------------------------------ whose job (22 Oct 2026, R3)

/** The job a challan belongs to - a complaint or an installation, never both. */
type JobRef = { storeId: string; complaintId: string | null; installationChallanId: string | null };

/** What happened, on the job's own history. */
async function say(tx: Tx | typeof db, j: JobRef, kind: 'challan_created' | 'challan_changed', userId: string | null, { body }: { body: string }) {
  if (j.complaintId) return logActivity(tx, j.complaintId, kind, userId, { body });
  if (j.installationChallanId) {
    await tx.activityLog.create({
      data: { storeId: j.storeId, userId, activityType: 'Material', entityType: 'installation_challan', entityId: j.installationChallanId, description: body },
    });
  }
}

/** Who hears about it - the complaint's people, or the installation's team and store. */
async function tell(j: JobRef, event: JobEvent, detail: string) {
  if (j.complaintId) return jobEvent(j.complaintId, event, detail);
  if (j.installationChallanId) return installationEvent(j.installationChallanId, event, detail);
}

/** What the parts' cost is booked against: who the customer is and which account. */
async function costTarget(scope: StoreScope, c: JobRef & { complaint: { id: string; customerId: string; productId: string | null } | null; installationChallan: { salesOrder: { partyId: string | null } | null } | null }) {
  if (c.complaint) {
    const cover = await resolveCoverageFor(scope, { customerId: c.complaint.customerId, productId: c.complaint.productId, onDate: new Date() });
    return { job: c.complaint, partyId: c.complaint.customerId as string | null, account: repairCostAccount(cover.kind) };
  }
  // An installation's material is the cost of doing the job (D7) - billed only
  // where the office marks it as an extra.
  const partyId = c.installationChallan?.salesOrder?.partyId ?? null;
  return { job: { id: c.installationChallanId ?? '', customerId: partyId ?? '', productId: null }, partyId, account: ACCOUNT.partsConsumed as string };
}

/** The job a cost posting names - the complaint, or the installation and its customer. */
function costJob(c: { installationChallanId: string | null; complaint: { id: string; customerId: string; productId: string | null } | null; installationChallan: { salesOrder: { partyId: string | null } | null } | null }) {
  return c.complaint ?? { id: c.installationChallanId ?? '', customerId: c.installationChallan?.salesOrder?.partyId ?? '', productId: null };
}

/** The job fields every challan action reads. */
const jobSelect = {
  storeId: true, complaintId: true, installationChallanId: true,
  complaint: { select: { id: true, customerId: true, productId: true } },
  installationChallan: { select: { salesOrder: { select: { partyId: true } } } },
} as const;

/**
 * The store's queue: approved and waiting to be issued (oldest first), still
 * waiting for approval, and issued in the last 7 days - with the automatic
 * GDN (28 Sep 2026) those are the parts to hand over, and to correct if wrong.
 */
export async function challansToIssue(scope: StoreScope): Promise<JobChallanView[]> {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = await findMany({ ...scopeWhere(scope), type: { not: 'handback' }, OR: [{ status: { in: ['approved', 'pending_approval'] } }, { status: 'issued', issues: { some: { cancelledAt: null, issuedAt: { gte: since } } } }] });
  return (await toView(rows)).sort((a, b) => (a.status === b.status ? a.createdAt.getTime() - b.createdAt.getTime() : a.status === 'approved' ? -1 : 1));
}

/**
 * Raise a challan. The technician only while Working on site (Pravin's rule);
 * the office any time the job is open.
 */
export async function raiseJobChallan(
  scope: StoreScope, complaintId: string,
  input: { type: string; lines: ChallanLineInput[]; note?: string | null },
  userId: string, actor: 'technician' | 'office',
): Promise<{ id: string; challanNo: string }> {
  const storeId = scopeForWrite(scope);
  const job = await db.complaint.findFirst({ where: { id: complaintId, ...scopeWhere(scope) }, select: { id: true, status: true, assignedTechnicianId: true } });
  if (!job) throw new ComplaintError('That job is not in your scope.');
  if (actor === 'technician') {
    if (job.assignedTechnicianId !== userId) throw new ComplaintError('This job is assigned to someone else.');
    if (job.status !== 'on_site') throw new ComplaintError('Tap "Working on site" first - challans are raised on site.');
    /**
     * This business may have taken the challan away from technicians (F1a,
     * Settings > Customisation). The fallback is `delegate`, never `skip` -
     * the parts are still issued and still costed, so somebody raises it;
     * only whose screen carries the button changes. The office branch below
     * is deliberately NOT gated, because it is where the work goes instead.
     *
     * Enforced here rather than at the route because the website reaches this
     * function too. This was the entire point of the switch, and it was
     * missing until the live check on 30 Sep 2026.
     */
    await assertActionAllowed(storeId, 'raise_challan', 'technician');
  } else if (['closed', 'cancelled'].includes(job.status)) {
    throw new ComplaintError('This job is finished - reopen it first.');
  }
  const type = (JOB_CHALLAN_TYPES as readonly string[]).includes(input.type) ? input.type : null;
  if (!type) throw new ComplaintError('Choose material, replacement or installation.');
  return createChallan(scope, { storeId, complaintId, installationChallanId: null }, type as JobChallanType, input, userId);
}

/**
 * Raise a material challan on an INSTALLATION (22 Oct 2026, R3): the cable,
 * clamps and connectors that are not lines on the sales order, so never left
 * on its GDN. The same engine as a complaint's - approval, store GDN, unused
 * back. A technician on the installation's team while the work is under way;
 * the office any time before it is approved.
 */
export async function raiseInstallationChallan(
  scope: StoreScope, installationChallanId: string,
  input: { type: string; lines: ChallanLineInput[]; note?: string | null },
  userId: string, actor: 'technician' | 'office',
): Promise<{ id: string; challanNo: string }> {
  const storeId = scopeForWrite(scope);
  const job = await db.installationChallan.findFirst({
    where: { id: installationChallanId, storeId },
    select: { id: true, stage: true, status: true, isInvoiced: true, notBilledReason: true, assignees: { select: { userId: true } } },
  });
  if (!job) throw new ComplaintError('That installation is not in your branch.');
  if (job.isInvoiced || job.notBilledReason || ['closed', 'cancelled', 'billed'].includes(job.stage)) throw new ComplaintError('This installation is billed and finished - nothing more goes out on it.');
  if (actor === 'technician') {
    if (!job.assignees.some((a) => a.userId === userId)) throw new ComplaintError('You are not on this installation\'s team.');
    if (!isInstallWorking(job.stage)) throw new ComplaintError('Material is asked for while the job is on - this one is at Work done or billed.');
    await assertActionAllowed(storeId, 'raise_challan', 'technician');
  }
  // A replacement takes a customer's old unit out - that is a complaint's job, not a new fitting.
  const type = input.type === 'installation' ? 'installation' : 'material';
  return createChallan(scope, { storeId, complaintId: null, installationChallanId }, type, input, userId);
}

/** Installation statuses in which the technician is working on the site. */
export { isInstallWorking };

/** The lines checked, the challan numbered and logged, and sent for approval. */
async function createChallan(
  scope: StoreScope, j: JobRef, type: JobChallanType,
  input: { lines: ChallanLineInput[]; note?: string | null }, userId: string,
): Promise<{ id: string; challanNo: string }> {
  const lines = await cleanLines(j.storeId, input.lines);

  const challanNo = await allocateDocumentNumber(j.storeId, 'JCH');
  const challan = await db.$transaction(async (tx) => {
    const c = await tx.jobChallan.create({
      data: { storeId: j.storeId, challanNo, complaintId: j.complaintId, installationChallanId: j.installationChallanId, type, note: input.note?.trim() || null, createdBy: userId, lines: { create: lines } },
    });
    await reserveUnits(tx, j.storeId, lines.flatMap((l) => l.stockUnitIds), { refType: 'JobChallan', refId: c.id, refNo: challanNo }, userId);
    await say(tx, j, 'challan_created', userId, {
      body: `${JOB_CHALLAN_TYPE_LABEL[type]} challan ${challanNo} raised (${lines.length} line${lines.length === 1 ? '' : 's'}) - waiting for approval.`,
    });
    return c;
  });
  await raiseApproval(scope, 'job_challan', challan.id, userId);
  return { id: challan.id, challanNo };
}

/**
 * The lines as typed, checked: whole quantities above 0, at most 50, every
 * product in this branch. Serial numbers named on a line: a serial-number
 * product, exactly as many as the quantity, each one this product's and on the
 * shelf - or already reserved by this same challan (`challanId`, when it is
 * being changed).
 */
async function cleanLines(storeId: string, raw: ChallanLineInput[], challanId?: string) {
  const lines = raw.filter((l) => l.productId && Number.isFinite(l.qty) && l.qty > 0)
    .map((l) => ({ productId: l.productId, qty: Math.trunc(l.qty), stockUnitIds: [...new Set((l.unitIds ?? []).filter(Boolean))] }));
  if (!lines.length) throw new ComplaintError('Add at least one part with a quantity.');
  if (lines.length > 50) throw new ComplaintError('That is more than 50 lines - split it into two challans.');
  const found = await db.product.count({ where: { id: { in: lines.map((l) => l.productId) }, storeId } });
  if (found !== new Set(lines.map((l) => l.productId)).size) throw new ComplaintError('A product is not in this branch.');

  const named = lines.filter((l) => l.stockUnitIds.length);
  if (named.length) {
    const all = named.flatMap((l) => l.stockUnitIds);
    if (new Set(all).size !== all.length) throw new ComplaintError('The same serial number is on two lines.');
    const products = new Map((await db.product.findMany({ where: { id: { in: named.map((l) => l.productId) } }, select: { id: true, productName: true, trackingMode: true } })).map((p) => [p.id, p]));
    const units = new Map((await db.stockUnit.findMany({ where: { id: { in: all }, storeId }, select: { id: true, productId: true, status: true, serialNo: true } })).map((u) => [u.id, u]));
    const mine = new Set(challanId
      ? (await db.jobChallanLine.findMany({ where: { challanId, qtyIssued: 0 }, select: { stockUnitIds: true } })).flatMap((x) => x.stockUnitIds)
      : []);
    for (const l of named) {
      const p = products.get(l.productId)!;
      if (p.trackingMode !== 'serial') throw new ComplaintError(`${p.productName} is not kept by serial number - leave its serial out.`);
      if (l.stockUnitIds.length !== l.qty) throw new ComplaintError(`Pick ${l.qty} serial number${l.qty === 1 ? '' : 's'} for ${p.productName} - or none, and the store picks them.`);
      for (const id of l.stockUnitIds) {
        const u = units.get(id);
        if (!u || u.productId !== l.productId) throw new ComplaintError(`A serial number picked is not a ${p.productName}.`);
        if (!(u.status === 'in_stock' || (u.status === 'reserved' && mine.has(u.id)))) {
          throw new ComplaintError(`${u.serialNo ?? 'A unit'} is not on the shelf - it is ${u.status.replace(/_/g, ' ')}.`);
        }
      }
    }
  }
  return lines;
}

/**
 * Hold named units for a challan: off the shelf for anyone else (a sale, another
 * challan), still counted in stock. Only from in_stock, all or nothing - two
 * people picking the same unit at once, the second is told.
 */
async function reserveUnits(tx: Tx, storeId: string, ids: string[], ref: { refType: string; refId: string; refNo: string }, userId: string) {
  if (!ids.length) return;
  const n = await tx.stockUnit.updateMany({ where: { id: { in: ids }, storeId, status: 'in_stock' }, data: { status: 'reserved' } });
  if (n.count !== ids.length) throw new ComplaintError('A serial number picked was taken just now - pick again.');
  for (const id of ids) {
    await tx.stockUnitEvent.create({ data: { storeId, unitId: id, eventType: 'status', fromStatus: 'in_stock', toStatus: 'reserved', partyId: null, ...ref, createdBy: userId } });
  }
}

/** Put a not-yet-issued challan's reserved units back on the shelf (rejected, withdrawn, changed). */
async function releaseUnits(tx: Tx, storeId: string, challanId: string, ref: { refType: string; refId: string; refNo: string }, userId: string) {
  const lines = await tx.jobChallanLine.findMany({ where: { challanId, qtyIssued: 0 }, select: { stockUnitIds: true } });
  const ids = lines.flatMap((l) => l.stockUnitIds);
  if (!ids.length) return;
  const held = (await tx.stockUnit.findMany({ where: { id: { in: ids }, storeId, status: 'reserved' }, select: { id: true } })).map((u) => u.id);
  if (held.length) {
    await tx.stockUnit.updateMany({ where: { id: { in: held } }, data: { status: 'in_stock' } });
    for (const id of held) {
      await tx.stockUnitEvent.create({ data: { storeId, unitId: id, eventType: 'status', fromStatus: 'reserved', toStatus: 'in_stock', partyId: null, ...ref, createdBy: userId } });
    }
  }
  await tx.jobChallanLine.updateMany({ where: { challanId, qtyIssued: 0 }, data: { stockUnitIds: [] } });
}

// ------------------------------------------ change or withdraw (22 Oct 2026)

/**
 * A challan the store has not issued yet can still be put right (Vcare, 22
 * Oct 2026): until then nothing has left the shelf, so changing it moves no
 * stock and no cost.
 *
 *   edit      while it waits for approval, or after it was rejected - the
 *             lines and note are replaced and it goes for approval again, so
 *             the approver always approves what will really go out.
 *   withdraw  while it waits, was rejected, or is approved but not issued -
 *             it leaves the store's queue and is kept, crossed out, on the job.
 *
 * Who: the person who raised it from the phone (a technician edits only their
 * own), or the office from the website (the same permission that raises one).
 * Once issued, the store's own Correct / Cancel GDN are the way - unchanged.
 */
const EDITABLE = ['pending_approval', 'rejected'];
const WITHDRAWABLE = ['pending_approval', 'rejected', 'approved'];

/** `on`: the job the screen has open - the challan must be on it. */
type OnJob = { complaintId?: string; installationChallanId?: string };

async function loadForChange(scope: StoreScope, id: string, on: OnJob, userId: string, actor: 'technician' | 'office', allowed: string[], what: string) {
  const c = await db.jobChallan.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      id: true, challanNo: true, status: true, type: true, note: true, createdBy: true, ...jobSelect,
      lines: { select: { qty: true, product: { select: { productName: true } } } },
      issues: { where: { cancelledAt: null }, select: { id: true }, take: 1 },
      complaint: { select: { id: true, status: true, customerId: true, productId: true } },
      installationChallan: { select: { status: true, stage: true, salesOrder: { select: { partyId: true } } } },
    },
  });
  if (!c) throw new ComplaintError('Challan not found in your scope.');
  if ((on.complaintId && c.complaintId !== on.complaintId) || (on.installationChallanId && c.installationChallanId !== on.installationChallanId)) {
    throw new ComplaintError('That challan is not on this job.');
  }
  if (c.type === 'handback') throw new ComplaintError('A hand-back GDN records what the customer took - it is not changed here.');
  if (c.issues.length || c.status === 'issued') throw new ComplaintError(`${c.challanNo} is already issued - the store corrects or cancels its GDN in Parts counter.`);
  if (!allowed.includes(c.status)) throw new ComplaintError(`${c.challanNo} is ${c.status.replace('_', ' ')} - it can no longer be ${what}.`);
  if (actor === 'technician' && c.createdBy !== userId) throw new ComplaintError('Only the person who raised this challan can change it from the phone - ask the office.');
  if (c.complaint && ['closed', 'cancelled'].includes(c.complaint.status)) throw new ComplaintError('This job is finished - reopen it first.');
  if (c.installationChallan && c.installationChallan.stage === 'billed') {
    throw new ComplaintError('This installation is billed and finished - its challans stay as they are.');
  }
  return c;
}

/**
 * Claim the challan inside the transaction: the change goes through only if
 * its status is still what was read, so an approval pressed at the same
 * moment wins or loses cleanly - never approves the old lines while they are
 * being replaced. The request an approver is looking at is closed with the
 * reason, so it leaves My Desk.
 */
async function claimForChange(tx: Tx, scope: StoreScope, c: { id: string; challanNo: string; status: string }, data: Prisma.JobChallanUpdateManyMutationInput, userId: string, why: string) {
  const n = await tx.jobChallan.updateMany({ where: { id: c.id, status: c.status }, data });
  if (n.count !== 1) throw new ComplaintError(`${c.challanNo} was changed by someone else just now - open it again.`);
  await tx.approvalRequest.updateMany({
    where: { ...scopeWhere(scope), entityType: 'job_challan', entityId: c.id, status: 'PENDING' },
    data: { status: 'REJECTED', decidedBy: userId, decidedAt: new Date(), note: why },
  });
}

const linesText = (lines: { qty: number; product: { productName: string } }[]) => lines.map((l) => `${l.product.productName} × ${l.qty}`).join(', ');

/** Change the lines, note or type of a challan not yet approved, and send it for approval again. */
export async function editJobChallan(
  scope: StoreScope, id: string, on: OnJob,
  input: { type?: string | null; lines: ChallanLineInput[]; note?: string | null },
  userId: string, actor: 'technician' | 'office',
): Promise<{ challanNo: string }> {
  const c = await loadForChange(scope, id, on, userId, actor, EDITABLE, 'changed');
  const lines = await cleanLines(c.storeId, input.lines, c.id);
  // Same choices as raising: an installation's challan is never a replacement.
  const kinds: readonly string[] = c.installationChallanId ? ['material', 'installation'] : JOB_CHALLAN_TYPES;
  const type = input.type && kinds.includes(input.type) ? input.type : c.type;
  const note = input.note?.trim() || null;

  await db.$transaction(async (tx) => {
    await claimForChange(tx, scope, c, { type, note, status: 'pending_approval', rejectionReason: null, approvedBy: null, approvedAt: null }, userId,
      'Withdrawn - the challan was changed and sent again.');
    // The units it held go back first, then the new picks are reserved (a unit kept is simply held again).
    const ref = { refType: 'JobChallan', refId: c.id, refNo: c.challanNo };
    await releaseUnits(tx, c.storeId, c.id, ref, userId);
    await tx.jobChallanLine.deleteMany({ where: { challanId: c.id } });
    await tx.jobChallanLine.createMany({ data: lines.map((l) => ({ ...l, challanId: c.id })) });
    await reserveUnits(tx, c.storeId, lines.flatMap((l) => l.stockUnitIds), ref, userId);
    const now = await tx.jobChallanLine.findMany({ where: { challanId: c.id }, select: { qty: true, product: { select: { productName: true } } } });
    await say(tx, c, 'challan_changed', userId, {
      body: `Challan ${c.challanNo} changed${c.status === 'rejected' ? ' after it was rejected' : ''}: ${linesText(c.lines)} → ${linesText(now)}${note && note !== c.note ? `. Note: ${note}` : ''} - waiting for approval again.`,
    });
  });
  await raiseApproval(scope, 'job_challan', c.id, userId);
  return { challanNo: c.challanNo };
}

/** Take back a challan nothing has been issued on - it leaves the approvers and the store. */
export async function withdrawJobChallan(
  scope: StoreScope, id: string, on: OnJob, reason: string | null, userId: string, actor: 'technician' | 'office',
): Promise<{ challanNo: string }> {
  const c = await loadForChange(scope, id, on, userId, actor, WITHDRAWABLE, 'withdrawn');
  const why = reason?.trim() || null;
  await db.$transaction(async (tx) => {
    await claimForChange(tx, scope, c, { status: 'withdrawn', rejectionReason: why }, userId, `Withdrawn${why ? `: ${why}` : ''}`);
    await releaseUnits(tx, c.storeId, c.id, { refType: 'JobChallan', refId: c.id, refNo: c.challanNo }, userId);
    await say(tx, c, 'challan_changed', userId, { body: `Challan ${c.challanNo} withdrawn${why ? `: ${why}` : ''} - nothing was issued on it.` });
  });
  return { challanNo: c.challanNo };
}

/** Approve or reject - through the engine when a rule routes it, directly otherwise. */
export async function decideJobChallan(
  scope: StoreScope, id: string, decision: 'approved' | 'rejected', userId: string, note?: string | null,
): Promise<void> {
  const c = await db.jobChallan.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!c) throw new ComplaintError('Challan not found in your scope.');
  if (c.status !== 'pending_approval') throw new ComplaintError(`That challan was already ${c.status.replace('_', ' ')}.`);
  if (decision === 'rejected' && !note?.trim()) throw new ComplaintError('Say why it is rejected - the technician sees it.');

  const open = await openApprovalRequest(scope, 'job_challan', c.id);
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
  await db.jobChallan.update({
    where: { id: c.id },
    data: final === 'approved'
      ? { status: 'approved', approvedBy: userId, approvedAt: new Date() }
      : { status: 'rejected', rejectionReason: note?.trim() || 'Rejected', approvedBy: userId, approvedAt: new Date() },
  });
  await say(db, c, 'challan_changed', userId, {
    body: final === 'approved' ? `Challan ${c.challanNo} approved - the store can issue it.` : `Challan ${c.challanNo} rejected: ${note?.trim() || '-'}`,
  });
  await tell(c, 'challan_decided', final === 'approved' ? `${c.challanNo} approved - collect from the store` : `${c.challanNo} rejected: ${note?.trim() || '-'}`);
  if (final !== 'approved') {
    // Rejected: the units it held go back on the shelf; changing it and sending it again picks them afresh.
    await db.$transaction((tx) => releaseUnits(tx, c.storeId, c.id, { refType: 'JobChallan', refId: c.id, refNo: c.challanNo }, userId));
    return;
  }
  // Settings > Field jobs > "Create the GDN automatically" (on by default,
  // Pravin 28 Sep 2026): the GDN is made now, unless stock is short - then it
  // waits for the store as before. The store can correct or cancel it.
  const { getJobSettings } = await import('./job-settings');
  if ((await getJobSettings(c.storeId)).autoIssueGdn) {
    const short = await stockShortfall(c.storeId, c.id);
    // Serial items go out by themselves when the office named them on raising
    // (22 Oct 2026); a serial line left unnamed waits for the store to pick (live test 2).
    const serialLines = await db.jobChallanLine.findMany({
      where: { challanId: c.id, product: { trackingMode: 'serial' } },
      select: { id: true, qty: true, stockUnitIds: true, product: { select: { productName: true } } },
    });
    const unnamed = serialLines.filter((l) => l.stockUnitIds.length !== l.qty);
    if (unnamed.length) {
      await say(db, c, 'challan_changed', null, { body: `Challan ${c.challanNo}: no serial numbers picked for ${unnamed.map((l) => l.product.productName).join(', ')} - the store picks them and issues it in Parts counter.` });
    } else if (!short.length) {
      try {
        const { gdnNo } = await issueJobChallan(scope, c.id, userId, Object.fromEntries(serialLines.map((l) => [l.id, l.stockUnitIds])));
        await say(db, c, 'challan_changed', userId, { body: `${gdnNo} created automatically on approval.` });
        await tell(c, 'gdn_auto', gdnNo);
        return;
      } catch (e) {
        console.error('[job challan] automatic GDN failed - left for the store', e);
      }
    } else {
      await say(db, c, 'challan_changed', null, {
        body: `Not enough stock for ${short.join(', ')} - challan ${c.challanNo} waits in Parts counter.`,
      });
    }
  }
  await tell(c, 'challan_to_issue', c.challanNo);
}

/** Products on a challan the branch does not have enough of (all warehouses). */
export async function stockShortfall(storeId: string, challanId: string): Promise<string[]> {
  const lines = await db.jobChallanLine.findMany({
    where: { challanId, challan: { storeId } },
    select: { productId: true, qty: true, product: { select: { productName: true, kind: true } } },
  });
  const need = new Map<string, { qty: number; name: string }>();
  for (const l of lines) {
    if (l.product.kind === 'service') continue;
    const n = need.get(l.productId);
    need.set(l.productId, { qty: (n?.qty ?? 0) + l.qty, name: l.product.productName });
  }
  if (!need.size) return [];
  const have = await db.productBalance.groupBy({
    by: ['productId'], where: { productId: { in: [...need.keys()] }, product: { storeId } }, _sum: { currentQty: true },
  });
  const onHand = new Map(have.map((h) => [h.productId, h._sum.currentQty ?? 0]));
  return [...need.entries()].filter(([id, n]) => (onHand.get(id) ?? 0) < n.qty).map(([, n]) => n.name);
}

/**
 * The store corrects a GDN - fewer parts actually handed over than issued.
 * Each line's new issued quantity may only go DOWN (more parts = a new
 * challan); the difference goes back into stock and its cost is reversed.
 */
export async function correctJobIssue(
  scope: StoreScope, challanId: string, lines: { lineId: string; qty: number; unitIds?: string[] }[], reason: string, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const why = reason.trim();
  if (!why) throw new ComplaintError('Say what was wrong - it is kept on the job.');
  const c = await db.jobChallan.findFirst({
    where: { id: challanId, ...scopeWhere(scope) },
    select: { id: true, status: true, type: true, challanNo: true, ...jobSelect, issues: { where: { cancelledAt: null }, select: { gdnNo: true }, take: 1 } },
  });
  if (!c) throw new ComplaintError('Challan not found in your scope.');
  if (c.status !== 'issued') throw new ComplaintError('Only an issued challan can be corrected.');
  if (c.type === 'handback') throw new ComplaintError('A hand-back GDN records what the customer took - it is not corrected here.');
  const gdnNo = c.issues[0]?.gdnNo ?? c.challanNo;
  const changes: { line: Line; back: number; unitIds?: string[] }[] = [];
  for (const want of lines) {
    const line = await loadLine(scope, want.lineId);
    if (line.challanId !== c.id) throw new ComplaintError('A line is not on this challan.');
    const q = Math.trunc(want.qty);
    const floor = line.qtyReturned + line.qtyReturnPending;
    if (!Number.isFinite(q) || q < floor) throw new ComplaintError(`${line.product.productName}: cannot go below ${floor} (already returned or on the way back).`);
    if (q > line.qtyIssued) throw new ComplaintError(`${line.product.productName}: a correction can only lower the quantity - raise a new challan for more.`);
    if (q < line.qtyIssued) changes.push({ line, back: line.qtyIssued - q, unitIds: want.unitIds });
  }
  if (!changes.length) throw new ComplaintError('Nothing changed.');
  const whs = await Promise.all(changes.map((ch) => backTo(ch.line)));
  await db.$transaction(async (tx) => {
    // Same warehouse; for serial items the units chosen (live test 2).
    for (const [i, ch] of changes.entries()) {
      await putBack(tx, storeId, userId, ch.line, ch.back, ch.unitIds, `GDN corrected: ${why}`, gdnNo, whs[i]);
      await tx.jobChallanLine.update({ where: { id: ch.line.id }, data: { qtyIssued: { decrement: ch.back } } });
    }
    await say(tx, c, 'challan_changed', userId, {
      body: `${gdnNo} corrected by the store: ${changes.map((ch) => `${ch.line.product.productName} ${ch.line.qtyIssued} → ${ch.line.qtyIssued - ch.back}`).join(', ')}. Reason: ${why}`,
    });
  });
  for (const ch of changes) {
    await postPartsCost(scope, costJob(c), [await lineCost(scope, ch.line, ch.back)], {
      sourceType: 'job_material_return', sourceId: ch.line.id, description: `${gdnNo} corrected (${why})`, sign: -1, account: ch.line.costAccount ?? undefined,
    }, userId).catch((e) => console.error('[job challan] correction cost failed', e));
  }
  await syncEstimateFor(c, userId).catch((e) => console.error('[job challan] estimate sync failed', e));
  await tell(c, 'gdn_changed', `${gdnNo} corrected: ${why}`);
}

/**
 * The store cancels a GDN made by mistake: every part goes back into stock,
 * the cost is reversed, and the challan returns to "approved" in the store's
 * queue. Only while nothing has been returned and no old unit received.
 */
export async function cancelJobIssue(scope: StoreScope, challanId: string, reason: string, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const why = reason.trim();
  if (!why) throw new ComplaintError('Say why the GDN is cancelled - it is kept on the job.');
  const c = await db.jobChallan.findFirst({
    where: { id: challanId, ...scopeWhere(scope) },
    include: {
      lines: { select: { id: true, qtyIssued: true, qtyReturned: true, qtyReturnPending: true, oldUnits: { select: { id: true, receivedAt: true } } } },
      issues: { where: { cancelledAt: null }, select: { id: true, gdnNo: true } },
      complaint: { select: { id: true, customerId: true, productId: true } },
      installationChallan: { select: { salesOrder: { select: { partyId: true } } } },
    },
  });
  if (!c) throw new ComplaintError('Challan not found in your scope.');
  if (c.type === 'handback') throw new ComplaintError('A hand-back GDN records what the customer took - it cannot be cancelled here.');
  if (c.status !== 'issued' || !c.issues.length) throw new ComplaintError('Only an issued challan has a GDN to cancel.');
  if (c.lines.some((l) => l.qtyReturned > 0 || l.qtyReturnPending > 0)) {
    throw new ComplaintError('Some parts were already returned - correct the quantities instead of cancelling.');
  }
  if (c.lines.some((l) => l.oldUnits.some((o) => o.receivedAt))) {
    throw new ComplaintError('The old unit was already received at the store - correct the quantities instead of cancelling.');
  }
  const issue = c.issues[0];
  const back = await Promise.all(c.lines.filter((l) => l.qtyIssued > 0).map((l) => loadLine(scope, l.id)));
  const whs = await Promise.all(back.map((l) => backTo(l)));
  await db.$transaction(async (tx) => {
    // Same warehouse, the same serial units (live test 2).
    for (const [i, l] of back.entries()) await putBack(tx, storeId, userId, l, l.qtyIssued, l.stockUnitIds, `GDN cancelled: ${why}`, issue.gdnNo, whs[i]);
    for (const l of c.lines) await tx.jobChallanLine.update({ where: { id: l.id }, data: { qtyIssued: 0, stockUnitIds: [] } });
    await tx.faultyPartReturn.deleteMany({ where: { challanLineId: { in: c.lines.map((l) => l.id) }, receivedAt: null } });
    await tx.materialIssue.update({ where: { id: issue.id }, data: { cancelledAt: new Date(), cancelledBy: userId, cancelReason: why } });
    await tx.jobChallan.update({ where: { id: c.id }, data: { status: 'approved' } });
    await say(tx, c, 'challan_changed', userId, { body: `${issue.gdnNo} cancelled by the store - parts back in stock. Reason: ${why}. Challan ${c.challanNo} is back in Parts counter.` });
  });
  for (const l of back) {
    await postPartsCost(scope, costJob(c), [await lineCost(scope, l, l.qtyIssued)], {
      sourceType: 'job_material_return', sourceId: issue.id, description: `${issue.gdnNo} cancelled (${why})`, sign: -1, account: l.costAccount ?? undefined,
    }, userId).catch((e) => console.error('[job challan] cancel cost failed', e));
  }
  await syncEstimateFor(c, userId).catch((e) => console.error('[job challan] estimate sync failed', e));
  await tell(c, 'gdn_changed', `${issue.gdnNo} cancelled: ${why}`);
}

/**
 * The store issues an approved challan as a GDN: stock goes out and the parts'
 * cost is posted (covered jobs to warranty cost, chargeable to parts
 * consumed - same rule as repair challans).
 */
export async function issueJobChallan(
  scope: StoreScope, id: string, userId: string,
  /** Serial-number lines: the exact stock units handed over, per line id. */
  serials: Record<string, string[]> = {},
): Promise<{ gdnNo: string }> {
  const storeId = scopeForWrite(scope);
  const c = await db.jobChallan.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: { lines: { include: { product: { select: { productName: true, trackingMode: true } } } }, complaint: { select: { id: true, customerId: true, productId: true } }, installationChallan: { select: { salesOrder: { select: { partyId: true } } } } },
  });
  if (!c) throw new ComplaintError('Challan not found in your scope.');
  if (c.status !== 'approved') throw new ComplaintError(c.status === 'issued' ? 'That challan is already issued.' : 'Only an approved challan can be issued.');

  // Serial items: the store picks exactly which units go (live test 2 - the
  // serial list used to keep showing them in stock).
  // A unit this line reserved when it was raised (22 Oct 2026) may go too; units it
  // reserved and the store did not pick go back on the shelf.
  const units = new Map<string, string[]>();
  const fromReserved: string[] = [];
  const unpick: string[] = [];
  for (const l of c.lines.filter((x) => x.product.trackingMode === 'serial')) {
    const ids = [...new Set(serials[l.id] ?? [])];
    if (ids.length !== l.qty) throw new ComplaintError(`Pick ${l.qty} serial number${l.qty === 1 ? '' : 's'} for ${l.product.productName}.`);
    const ok = await db.stockUnit.findMany({
      where: { id: { in: ids }, storeId, productId: l.productId, OR: [{ status: 'in_stock' }, { status: 'reserved', id: { in: l.stockUnitIds } }] },
      select: { id: true, status: true },
    });
    if (ok.length !== ids.length) throw new ComplaintError(`A serial picked for ${l.product.productName} is not in stock any more.`);
    fromReserved.push(...ok.filter((u) => u.status === 'reserved').map((u) => u.id));
    unpick.push(...l.stockUnitIds.filter((u) => !ids.includes(u)));
    units.set(l.id, ids);
  }
  // Quantity items come out of the warehouse that holds them.
  const homes = new Map<string, string | null>();
  for (const l of c.lines) if (!units.has(l.id)) homes.set(l.id, await stockHome(l.productId));
  // The cost and account are fixed now, so returns reverse exactly this.
  const costs = await costsFor(scope, [...new Set(c.lines.map((l) => l.productId))]);
  const { account, partyId } = await costTarget(scope, c);

  const gdnNo = await allocateDocumentNumber(storeId, 'GDN');
  const issue = await db.$transaction(async (tx) => {
    const mi = await tx.materialIssue.create({ data: { storeId, gdnNo, challanId: c.id, issuedBy: userId } });
    await applyMovements(tx, storeId, userId, c.lines.flatMap((l): MovementInput[] => units.has(l.id)
      ? units.get(l.id)!.map((u) => ({ productId: l.productId, qty: -1, reason: 'job_issue' as const, refType: 'MaterialIssue', refId: mi.id, refNo: gdnNo, stockUnitId: u }))
      // Rule 4: a line whose serials were NOT picked still binds identity -
      // `applyMovements` takes the oldest units and records what it could not
      // name. Without `partyId` it would bind nothing, because a unit that says
      // `with_customer` and names nobody is the hole this work closes.
      : [{ productId: l.productId, qty: -l.qty, reason: 'job_issue' as const, refType: 'MaterialIssue', refId: mi.id, refNo: gdnNo, warehouseId: homes.get(l.id) ?? null, partyId }]));
    const ref = { refType: 'MaterialIssue', refId: mi.id, refNo: gdnNo };
    for (const ids of units.values()) {
      await setUnits(tx, storeId, ids.filter((u) => !fromReserved.includes(u)), 'in_stock', 'with_customer', partyId, ref, userId);
      await setUnits(tx, storeId, ids.filter((u) => fromReserved.includes(u)), 'reserved', 'with_customer', partyId, ref, userId);
    }
    const stillHeld = unpick.length ? (await tx.stockUnit.findMany({ where: { id: { in: unpick }, status: 'reserved' }, select: { id: true } })).map((u) => u.id) : [];
    await setUnits(tx, storeId, stillHeld, 'reserved', 'in_stock', null, ref, userId);
    for (const l of c.lines) {
      await tx.jobChallanLine.update({
        where: { id: l.id },
        data: { qtyIssued: l.qty, stockUnitIds: units.get(l.id) ?? [], unitCostPaise: costs.get(l.productId)?.unitCostPaise ?? 0, costAccount: account },
      });
    }
    // Only if it is still approved: a challan withdrawn a moment ago is not
    // issued after all - the whole issue rolls back (22 Oct 2026).
    const still = await tx.jobChallan.updateMany({ where: { id: c.id, status: 'approved' }, data: { status: 'issued' } });
    if (still.count !== 1) throw new ComplaintError(`${c.challanNo} was withdrawn or changed just now - open it again.`);
    await say(tx, c, 'challan_changed', userId, { body: `Parts on challan ${c.challanNo} issued on ${gdnNo}.` });
    // A replacement takes the customer's old unit out: it must come back to
    // the store (Pravin, 28 Sep 2026) - never into sellable stock; receiving it
    // opens a Replacements case (supplier / service centre / scrap).
    // (An installation's challan is never a replacement - raiseInstallationChallan.)
    if (c.type === 'replacement' && c.complaintId) {
      for (const l of c.lines) {
        await tx.faultyPartReturn.create({
          data: {
            storeId, complaintId: c.complaintId, productId: l.productId, challanLineId: l.id, loggedBy: userId,
            description: `Old unit to come back - replaced on ${gdnNo}${l.qty > 1 ? ` (× ${l.qty})` : ''}`,
          },
        });
      }
    }
    return mi;
  });
  await postPartsCost(scope, costJob(c), c.lines.map((l) => ({ productId: l.productId, qty: l.qty, unitCostPaise: costs.get(l.productId)?.unitCostPaise ?? 0 })), {
    sourceType: 'job_material_issue', sourceId: issue.id, description: `Parts issued on ${gdnNo} (challan ${c.challanNo})`, sign: 1, account,
  }, userId).catch((e) => console.error('[job challan] cost posting failed', e));
  await tell(c, 'challan_issued', gdnNo);
  if (c.type === 'replacement') await tell(c, 'old_unit_due', `replaced on ${gdnNo}`);
  return { gdnNo };
}

async function loadLine(scope: StoreScope, lineId: string) {
  const line = await db.jobChallanLine.findFirst({
    where: { id: lineId, challan: scopeWhere(scope) },
    include: {
      product: { select: { productName: true, trackingMode: true } },
      challan: { select: { id: true, challanNo: true, status: true, ...jobSelect, issues: { where: { cancelledAt: null }, select: { id: true, gdnNo: true }, take: 1 } } },
    },
  });
  if (!line) throw new ComplaintError('That challan line is not in your scope.');
  return line;
}

/** The warehouse holding most of a product (null = the store's default holding). */
async function stockHome(productId: string): Promise<string | null> {
  const b = await db.productBalance.findFirst({ where: { productId }, orderBy: { currentQty: 'desc' }, select: { warehouseId: true, currentQty: true } });
  return b && b.currentQty > 0 ? b.warehouseId : null;
}

/** Where a line's parts left from - returns go back to the same place. */
async function issueWarehouse(issueId: string | undefined, productId: string): Promise<string | null> {
  if (!issueId) return null;
  const m = await db.stockMovement.findFirst({ where: { refType: 'MaterialIssue', refId: issueId, productId }, select: { warehouseId: true } });
  return m?.warehouseId ?? null;
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Move serial units between statuses with their history (issue: to the customer; back: to the shelf). */
async function setUnits(
  tx: Tx, storeId: string, unitIds: string[], from: string, to: string, partyId: string | null,
  ref: { refType: string; refId: string; refNo: string }, userId: string,
) {
  for (const id of unitIds) {
    await tx.stockUnit.update({ where: { id }, data: { status: to, partyId: to === 'with_customer' ? partyId : null } });
    await tx.stockUnitEvent.create({
      data: { storeId, unitId: id, eventType: 'status', fromStatus: from, toStatus: to, partyId: to === 'with_customer' ? partyId : null, ...ref, createdBy: userId },
    });
  }
}

/**
 * Put parts from a line back on the shelf - same warehouse, and for serial
 * items exactly the chosen units (they must be ones this line issued).
 */
async function putBack(
  tx: Tx, storeId: string, userId: string, line: Line, n: number, unitIds: string[] | undefined, note: string, refNo: string,
  /** From backTo(), read BEFORE the transaction (one connection - a lookup inside would wait on itself). */
  warehouseId: string | null,
): Promise<string[]> {
  if (line.product.trackingMode === 'serial') {
    const ids = [...new Set(unitIds ?? [])];
    // Parts that left with no serial (counted by quantity then) come back by
    // count - only the named ones have to be picked (29 Oct 2026).
    const byCount = n - ids.length;
    if (byCount < 0 || byCount > unnamedOut(line)) {
      throw new ComplaintError(`Pick the ${n - Math.min(n, unnamedOut(line))} serial number${n - Math.min(n, unnamedOut(line)) === 1 ? '' : 's'} of ${line.product.productName} that came back.`);
    }
    if (ids.some((u) => !line.stockUnitIds.includes(u))) throw new ComplaintError('A serial picked was not issued on this job.');
    await applyMovements(tx, storeId, userId, [
      ...ids.map((u) => ({
        productId: line.productId, qty: 1, reason: 'job_return' as const, refType: 'JobChallanLine', refId: line.id, refNo, stockUnitId: u, note,
      })),
      // No customer named, so no unit is guessed back - see returnUnitsToStock.
      ...(byCount > 0 ? [{ productId: line.productId, qty: byCount, reason: 'job_return' as const, refType: 'JobChallanLine', refId: line.id, refNo, warehouseId, note: `${note} (no serial on the GDN)` }] : []),
    ]);
    await setUnits(tx, storeId, ids, 'with_customer', 'in_stock', null, { refType: 'JobChallanLine', refId: line.id, refNo }, userId);
    await tx.jobChallanLine.update({ where: { id: line.id }, data: { stockUnitIds: line.stockUnitIds.filter((u) => !ids.includes(u)) } });
    return ids;
  }
  await applyMovements(tx, storeId, userId, [{
    productId: line.productId, qty: n, reason: 'job_return', refType: 'JobChallanLine', refId: line.id, refNo, warehouseId, note,
  }]);
  return [];
}

/** Where a line's parts go back to - read before the transaction. */
// Named serial units carry their own place; the warehouse is for quantity, and for serial parts that left with no serial (29 Oct 2026).
const backTo = (line: Line) => issueWarehouse(line.challan.issues[0]?.id, line.productId);

/** The cost of n parts of a line, at what they were issued at (older lines: today's cost). */
async function lineCost(scope: StoreScope, line: { productId: string; unitCostPaise: number | null; costAccount: string | null }, n: number) {
  const unit = line.unitCostPaise ?? (await costsFor(scope, [line.productId])).get(line.productId)?.unitCostPaise ?? 0;
  return { productId: line.productId, qty: n, unitCostPaise: unit, account: line.costAccount ?? undefined };
}
type Line = Awaited<ReturnType<typeof loadLine>>;
const stillOut = (l: Line) => l.qtyIssued - l.qtyReturned - l.qtyReturnPending;

/**
 * Unused parts: the technician (or office) says they are coming back - a
 * request only; stock moves when the store receives them. Before 28 Sep 2026
 * the phone put stock back on the technician's word alone.
 */
export async function requestPartsReturn(
  scope: StoreScope, lineId: string, qty: number, userId: string,
  /** The job the phone opened - the line must be on it (22 Oct 2026: any line in the branch was accepted). */
  onJob?: { complaintId?: string; installationChallanId?: string },
): Promise<void> {
  scopeForWrite(scope);
  const n = Math.trunc(qty);
  const line = await loadLine(scope, lineId);
  if (onJob && !(onJob.complaintId ? line.challan.complaintId === onJob.complaintId : line.challan.installationChallanId === onJob.installationChallanId)) {
    throw new ComplaintError('That part is not on this job.');
  }
  if (!(n > 0)) throw new ComplaintError('Enter how many are coming back.');
  if (n > stillOut(line)) throw new ComplaintError(`Only ${stillOut(line)} of these were issued and not yet returned.`);
  await db.jobChallanLine.update({ where: { id: line.id }, data: { qtyReturnPending: { increment: n } } });
  await say(db, line.challan, 'challan_changed', userId, {
    body: `${n} unused part(s) to hand back to the store (${line.challan.challanNo}) - waiting for the store to receive them.`,
  });
  await tell(line.challan, 'parts_returning', `${n} × ${line.product.productName}`);
}

/** The store receives the parts that were said to be coming back. Returns how many. */
export async function receiveReturnedParts(scope: StoreScope, lineId: string, userId: string, unitIds?: string[]): Promise<number> {
  const line = await loadLine(scope, lineId);
  if (line.qtyReturnPending <= 0) throw new ComplaintError('Nothing is waiting to be received on this line.');
  await moveBack(scope, line, line.qtyReturnPending, userId, true, unitIds);
  return line.qtyReturnPending;
}

/** The store itself takes unused parts back, with no request first (callers check Stock: Edit). */
export async function returnUnusedParts(scope: StoreScope, lineId: string, qty: number, userId: string, unitIds?: string[]): Promise<void> {
  const n = Math.trunc(qty);
  const line = await loadLine(scope, lineId);
  if (!(n > 0)) throw new ComplaintError('Enter how many came back.');
  if (n > stillOut(line)) throw new ComplaintError(`Only ${stillOut(line)} of these were issued and not yet returned.`);
  await moveBack(scope, line, n, userId, false, unitIds);
}

/** Stock returns (same warehouse / the exact serials) and the parts' cost is reversed at issue cost. */
async function moveBack(scope: StoreScope, line: Line, n: number, userId: string, fromPending: boolean, unitIds?: string[]) {
  const storeId = scopeForWrite(scope);
  const gdnNo = line.challan.issues[0]?.gdnNo ?? line.challan.challanNo;
  const wh = await backTo(line);
  await db.$transaction(async (tx) => {
    await putBack(tx, storeId, userId, line, n, unitIds, 'Unused, back from the job', gdnNo, wh);
    await tx.jobChallanLine.update({
      where: { id: line.id },
      data: { qtyReturned: { increment: n }, ...(fromPending ? { qtyReturnPending: { decrement: n } } : {}) },
    });
    await say(tx, line.challan, 'challan_changed', userId, { body: `${n} unused part(s) received back into stock by the store (${gdnNo}).` });
  });
  await postPartsCost(scope, costJob(line.challan), [await lineCost(scope, line, n)], {
    sourceType: 'job_material_return', sourceId: line.id, description: `Unused parts returned (${gdnNo})`, sign: -1, account: line.costAccount ?? undefined,
  }, userId).catch((e) => console.error('[job challan] return cost failed', e));
  // A waiting estimate follows what was really used (live test 2).
  await syncEstimateFor(line.challan, userId).catch((e) => console.error('[job challan] estimate sync failed', e));
}

/** The store's list: unused parts said to be coming back. */
export async function returnsToReceive(scope: StoreScope) {
  const rows = await db.jobChallanLine.findMany({
    where: { qtyReturnPending: { gt: 0 }, challan: scopeWhere(scope) },
    include: {
      product: { select: { productName: true, productCode: true, trackingMode: true } },
      challan: {
        select: {
          challanNo: true, complaintId: true, installationChallanId: true,
          complaint: { select: { complaintNo: true } }, installationChallan: { select: { challanNo: true } },
          issues: { where: { cancelledAt: null }, select: { gdnNo: true }, take: 1 },
        },
      },
    },
    take: FEED_MAX_ROWS,
  });
  const unitIds = rows.flatMap((l) => l.stockUnitIds);
  const serialNo = new Map((unitIds.length ? await db.stockUnit.findMany({ where: { id: { in: unitIds }, ...scopeWhere(scope) }, select: { id: true, serialNo: true } }) : []).map((u) => [u.id, u.serialNo ?? u.id]));
  return rows.map((l) => ({
    lineId: l.id, qty: l.qtyReturnPending, productName: l.product.productName, productCode: l.product.productCode,
    serial: l.product.trackingMode === 'serial', units: l.stockUnitIds.map((id) => ({ id, serialNo: serialNo.get(id) ?? id })),
    challanNo: l.challan.challanNo, gdnNo: l.challan.issues[0]?.gdnNo ?? null, complaintId: l.challan.complaintId,
    // The job's number and page - a complaint's or an installation's (R3).
    complaintNo: l.challan.complaint?.complaintNo ?? l.challan.installationChallan?.challanNo ?? '-',
    jobHref: l.challan.complaintId ? `/services/complaints/${l.challan.complaintId}` : `/services/installations/${l.challan.installationChallanId}`,
  }));
}

export async function postPartsCost(
  scope: StoreScope, job: { id: string; customerId: string; productId: string | null },
  lines: { productId: string; qty: number; unitCostPaise?: number }[],
  src: { sourceType: 'job_material_issue' | 'job_material_return'; sourceId: string; description: string; sign: 1 | -1; account?: string }, userId: string,
) {
  const missing = lines.filter((l) => l.unitCostPaise === undefined).map((l) => l.productId);
  const costs = missing.length ? await costsFor(scope, [...new Set(missing)]) : new Map();
  const total = lines.reduce((s, l) => s + (l.unitCostPaise ?? costs.get(l.productId)?.unitCostPaise ?? 0) * l.qty, 0);
  if (total <= 0) return;
  const cover = src.account ? null : await resolveCoverageFor(scope, { customerId: job.customerId, productId: job.productId, onDate: new Date() });
  const expense = src.account ?? repairCostAccount(cover!.kind);
  await postJournalEntry(scope, {
    entryDate: new Date(), description: `${src.description} (${expense === repairCostAccount('chargeable') ? 'chargeable' : 'covered'})`,
    sourceType: src.sourceType, sourceId: src.sourceId,
    lines: src.sign === 1
      ? [{ accountCode: expense, debitPaise: total }, { accountCode: '1200', creditPaise: total }]
      : [{ accountCode: '1200', debitPaise: total }, { accountCode: expense, creditPaise: total }],
  }, userId);
}

// ------------------------------------------------------------ faulty parts

export async function logFaultyPart(
  scope: StoreScope, complaintId: string,
  input: { productId?: string | null; description: string; serialNo?: string | null }, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const job = await db.complaint.findFirst({ where: { id: complaintId, ...scopeWhere(scope) }, select: { id: true } });
  if (!job) throw new ComplaintError('That job is not in your scope.');
  const what = input.description.trim();
  if (!what) throw new ComplaintError('Say what the faulty part is.');
  if (input.productId) {
    const p = await db.product.findFirst({ where: { id: input.productId, storeId }, select: { id: true } });
    if (!p) throw new ComplaintError('That product is not in this branch.');
  }
  await db.faultyPartReturn.create({
    data: { storeId, complaintId, productId: input.productId || null, description: what, serialNo: input.serialNo?.trim() || null, loggedBy: userId },
  });
  await logActivity(db, complaintId, 'challan_changed', userId, { body: `Faulty part taken out: ${what}${input.serialNo?.trim() ? ` (S/N ${input.serialNo.trim()})` : ''}.` });
}

/**
 * The store receives a faulty part or a replaced old unit. The serial (scanned
 * or typed) attaches the unit on file, which gives its original supplier and
 * bill - the Replacements case is filled from them (28 Sep 2026).
 */
export async function receiveFaultyPart(scope: StoreScope, id: string, userId: string, serialNo?: string | null): Promise<{ caseNo: string | null }> {
  scopeForWrite(scope);
  const f = await db.faultyPartReturn.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!f) throw new ComplaintError('Not found in your scope.');
  if (f.receivedAt) throw new ComplaintError('Already received.');
  const serial = serialNo?.trim() || f.serialNo || null;
  // A replaced old unit opens a Replacements case, so it goes to the supplier
  // or service centre, or is scrapped - it never re-enters sellable stock
  // (the same rule as damaged sales returns). Pravin, 28 Sep 2026.
  let rma: { id: string; caseNo: string } | null = null;
  if (f.challanLineId) {
    const [job, line] = await Promise.all([
      db.complaint.findUnique({ where: { id: f.complaintId }, select: { complaintNo: true, customerId: true } }),
      db.jobChallanLine.findUnique({ where: { id: f.challanLineId }, select: { qty: true, product: { select: { productName: true } } } }),
    ]);
    const { createRmaCase, RmaError } = await import('./rma');
    try {
      rma = await createRmaCase(scope, {
        productId: f.productId, productName: line?.product.productName ?? f.description, brandModel: null, qty: line?.qty ?? 1,
        serialNo: serial, customerId: job?.customerId ?? null, complaintNo: job?.complaintNo ?? null, parentCaseId: null,
        note: `Old unit from job ${job?.complaintNo ?? ''} (${f.description}).`,
      }, userId);
    } catch (e) {
      if (e instanceof RmaError) throw new ComplaintError(e.message);
      throw e;
    }
  }
  await db.faultyPartReturn.update({ where: { id }, data: { receivedAt: new Date(), receivedBy: userId, serialNo: serial, ...(rma ? { replacementCaseId: rma.id } : {}) } });
  await logActivity(db, f.complaintId, 'challan_changed', userId, {
    body: `Received at the store: ${f.description}.${rma ? ` Replacements case ${rma.caseNo} opened - send it to the supplier or service centre, or scrap it, from Replacements.` : ''}`,
  });
  return { caseNo: rma?.caseNo ?? null };
}

export async function faultyPartsFor(scope: StoreScope, where: { complaintId?: string; pendingOnly?: boolean }) {
  return db.faultyPartReturn.findMany({
    where: { ...scopeWhere(scope), ...(where.complaintId ? { complaintId: where.complaintId } : {}), ...(where.pendingOnly ? { receivedAt: null } : {}) },
    include: { product: { select: { productName: true } }, complaint: { select: { complaintNo: true } }, replacementCase: { select: { caseNo: true } } },
    orderBy: { loggedAt: 'desc' }, take: FEED_MAX_ROWS,
  });
}

/**
 * The job's parts as the phone shows them: challans (status, GDN) and faulty
 * parts - never sent to customers. One shape for the complaint screen and
 * the visit screen (22 Oct 2026, Vcare: a technician on a visit could not
 * send unused parts back without opening the complaint).
 */
export async function phoneJobParts(scope: StoreScope, complaintId: string, storeId: string, me?: string) {
  const [challans, faulty, blocked] = await Promise.all([
    jobChallansFor(scope, complaintId),
    faultyPartsFor(scope, { complaintId }),
    stepBlockedReason(storeId, 'job.challan', 'technician'),
  ]);
  return {
    challans: challans.map((c) => phoneChallan(c, me)),
    faulty: faulty.map((f) => ({ id: f.id, description: f.description, serialNo: f.serialNo, receivedAt: f.receivedAt })),
    /**
     * Whether THIS business still lets a technician raise the challan
     * (F1a). The server refuses it either way; this is so the phone can
     * hide the button instead of offering something that will be rejected.
     * Older builds ignore the field and get the refusal with its reason.
     */
    canRaiseChallan: blocked === null,
  };
}

/**
 * One challan as the phone shows it. `mine` (22 Oct 2026): this person raised
 * it, so the phone offers Change / Withdraw while the server would allow them -
 * older builds ignore it.
 */
function phoneChallan(c: JobChallanView, me?: string) {
  return {
    id: c.id, challanNo: c.challanNo, type: c.type, status: c.status, rejectionReason: c.rejectionReason, gdnNos: c.gdnNos, lines: c.lines,
    note: c.note, mine: !!me && c.createdById === me,
  };
}

/** An installation's material challans as the phone shows them (R3) - the same card as a complaint's, no faulty parts. */
export async function phoneInstallationParts(scope: StoreScope, installationChallanId: string, storeId: string, me?: string) {
  const [challans, blocked] = await Promise.all([
    installationJobChallans(scope, installationChallanId),
    stepBlockedReason(storeId, 'job.challan', 'technician'),
  ]);
  return {
    challans: challans.map((c) => phoneChallan(c, me)),
    faulty: [] as { id: string; description: string; serialNo: string | null; receivedAt: Date | null }[],
    canRaiseChallan: blocked === null,
  };
}

/** A waiting estimate follows what was really used (lazy import: job-customer is a sibling). A complaint's only - an installation has no estimate. */
const syncEstimateFor = async (j: { complaintId: string | null }, userId: string | null) => {
  if (j.complaintId) await (await import('./job-billing')).syncEstimateToUsed(j.complaintId, userId);
};

// ------------------------------------------------ GDN register (28 Sep 2026)

export interface JobGdnRow {
  id: string; gdnNo: string; issuedAt: Date; cancelledAt: Date | null; cancelReason: string | null;
  complaintId: string | null; installationChallanId: string | null; complaintNo: string; jobHref: string;
  customerId: string; customerName: string; challanNo: string; type: string; issuedByName: string | null;
  lines: { productName: string; issued: number; returned: number; pending: number; used: number;
    /** The serial units out on this line (22 Oct 2026) - shown wherever the product is. */
    units: { id: string; serialNo: string }[] }[];
}

/** Serial numbers for a set of unit ids, in one query. */
async function serialsOf(storeIds: string[], unitIds: string[]): Promise<Map<string, string>> {
  if (!unitIds.length) return new Map();
  const rows = await db.stockUnit.findMany({ where: { id: { in: unitIds }, storeId: { in: storeIds }, serialNo: { not: null } }, select: { id: true, serialNo: true } });
  return new Map(rows.map((u) => [u.id, u.serialNo!]));
}

/**
 * Job GDNs for Inventory > Goods Dispatch Note - that page listed sales
 * dispatches only, so a job's GDN was nowhere to be found (live test 2).
 */
export async function jobGdnList(scope: StoreScope): Promise<JobGdnRow[]> {
  const rows = await db.materialIssue.findMany({
    where: scopeWhere(scope),
    orderBy: { issuedAt: 'desc' }, take: FEED_MAX_ROWS,
    select: {
      id: true, storeId: true, gdnNo: true, issuedAt: true, cancelledAt: true, cancelReason: true, issuedBy: true,
      challan: {
        select: {
          challanNo: true, type: true, complaintId: true, installationChallanId: true,
          complaint: { select: { complaintNo: true, customerId: true, customer: { select: { companyName: true, firstName: true, lastName: true } } } },
          installationChallan: { select: { challanNo: true, salesOrder: { select: { partyId: true, customerName: true, organizationName: true } } } },
          lines: { select: { qty: true, qtyIssued: true, qtyReturned: true, qtyReturnPending: true, stockUnitIds: true, product: { select: { productName: true } } } },
        },
      },
    },
  });
  const ids = [...new Set(rows.map((r) => r.issuedBy).filter((x): x is string => !!x))];
  const serial = await serialsOf(scope.kind === 'single' ? [scope.storeId] : [...new Set(rows.map((r) => r.storeId))], rows.flatMap((r) => r.challan.lines.flatMap((l) => l.stockUnitIds)));
  const names = new Map((ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : []).map((u) => [u.id, u.fullName]));
  return rows.map((r) => {
    return {
      id: r.id, gdnNo: r.gdnNo, issuedAt: r.issuedAt, cancelledAt: r.cancelledAt, cancelReason: r.cancelReason,
      complaintId: r.challan.complaintId, installationChallanId: r.challan.installationChallanId, ...jobOf(r.challan),
      challanNo: r.challan.challanNo, type: r.challan.type, issuedByName: r.issuedBy ? names.get(r.issuedBy) ?? null : null,
      lines: r.challan.lines.map((l) => {
        // A cancelled GDN's lines were reset to 0 issued; show what it carried.
        const issued = r.cancelledAt ? l.qty : l.qtyIssued;
        return {
          productName: l.product.productName, issued, returned: l.qtyReturned, pending: l.qtyReturnPending, used: r.cancelledAt ? 0 : Math.max(0, l.qtyIssued - l.qtyReturned),
          units: l.stockUnitIds.flatMap((id) => (serial.has(id) ? [{ id, serialNo: serial.get(id)! }] : [])),
        };
      }),
    };
  });
}

/** The serial lines of a challan and the units in stock the store can pick from. */
export async function serialChoices(scope: StoreScope, challanId: string) {
  const c = await db.jobChallan.findFirst({
    where: { id: challanId, ...scopeWhere(scope) },
    select: { lines: { where: { product: { trackingMode: 'serial' } }, select: { id: true, productId: true, qty: true, stockUnitIds: true, product: { select: { productName: true } } } } },
  });
  if (!c) throw new ComplaintError('Challan not found in your scope.');
  return Promise.all(c.lines.map(async (l) => ({
    lineId: l.id, productName: l.product.productName, qty: l.qty,
    // The units the office reserved for this line come ticked (22 Oct 2026).
    picked: l.stockUnitIds,
    units: (await db.stockUnit.findMany({
      where: { ...scopeWhere(scope), productId: l.productId, serialNo: { not: null }, OR: [{ status: 'in_stock' }, { status: 'reserved', id: { in: l.stockUnitIds } }] },
      select: { id: true, serialNo: true }, orderBy: { receivedAt: 'asc' }, take: LIST_MAX_ROWS,
    })).map((u) => ({ id: u.id, serialNo: u.serialNo! })),
  })));
}

/** A serial-number product's units on the shelf, to pick when raising a challan (22 Oct 2026). */
export async function unitsOnShelf(scope: StoreScope, productId: string) {
  return (await db.stockUnit.findMany({
    where: { ...scopeWhere(scope), productId, status: 'in_stock', serialNo: { not: null } },
    select: { id: true, serialNo: true }, orderBy: { receivedAt: 'asc' }, take: LIST_MAX_ROWS,
  })).map((u) => ({ id: u.id, serialNo: u.serialNo! }));
}

/**
 * The store swaps a serial on an issued GDN (22 Oct 2026, Vcare): the unit
 * written down was not the one that went. The old unit comes back on the
 * shelf, the new one goes to the customer, both moves are on the GDN and the
 * job; the count, the cost and what is billed do not change - same product.
 */
export async function swapIssuedUnit(
  scope: StoreScope, lineId: string, fromUnitId: string, toUnitId: string, reason: string, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const why = reason.trim();
  if (!why) throw new ComplaintError('Say why the serial changes - it is kept on the job.');
  const line = await loadLine(scope, lineId);
  const c = line.challan;
  const issue = c.issues[0];
  if (!issue) throw new ComplaintError('This challan has no GDN yet - pick the serial when issuing.');
  if (line.product.trackingMode !== 'serial') throw new ComplaintError(`${line.product.productName} is not kept by serial number.`);
  if (!line.stockUnitIds.includes(fromUnitId)) throw new ComplaintError('That serial was not issued on this line.');
  if (fromUnitId === toUnitId) throw new ComplaintError('Pick a different serial number.');
  const [from, to] = await Promise.all([
    db.stockUnit.findFirst({ where: { id: fromUnitId, storeId }, select: { serialNo: true, status: true, invoiceId: true } }),
    db.stockUnit.findFirst({ where: { id: toUnitId, storeId, productId: line.productId }, select: { serialNo: true, status: true } }),
  ]);
  if (!from || from.status !== 'with_customer') throw new ComplaintError('The serial on the GDN is not out with the customer any more - it was returned or moved.');
  if (!to || to.status !== 'in_stock') throw new ComplaintError(`${to?.serialNo ?? 'That unit'} is not on the shelf.`);
  const { partyId } = await costTarget(scope, c);
  const ref = { refType: 'MaterialIssue', refId: issue.id, refNo: issue.gdnNo };
  await db.$transaction(async (tx) => {
    // The bill goes with the serial (29 Oct 2026) - it used to stay on the unit that came back.
    const moved = await tx.stockUnit.updateMany({ where: { id: toUnitId, status: 'in_stock' }, data: { status: 'with_customer', partyId, ...(from.invoiceId ? { invoiceId: from.invoiceId } : {}) } });
    if (moved.count !== 1) throw new ComplaintError('That unit was taken just now - pick another.');
    await tx.stockUnitEvent.create({ data: { storeId, unitId: toUnitId, eventType: 'status', fromStatus: 'in_stock', toStatus: 'with_customer', partyId, ...ref, createdBy: userId } });
    await setUnits(tx, storeId, [fromUnitId], 'with_customer', 'in_stock', null, ref, userId);
    if (from.invoiceId) await tx.stockUnit.update({ where: { id: fromUnitId }, data: { invoiceId: null } });
    await applyMovements(tx, storeId, userId, [
      { productId: line.productId, qty: 1, reason: 'job_return', refType: 'JobChallanLine', refId: line.id, refNo: issue.gdnNo, stockUnitId: fromUnitId, note: `Serial changed on ${issue.gdnNo}: ${why}` },
      { productId: line.productId, qty: -1, reason: 'job_issue', ...ref, stockUnitId: toUnitId, partyId, note: `Serial changed on ${issue.gdnNo}: ${why}` },
    ]);
    await tx.jobChallanLine.update({ where: { id: line.id }, data: { stockUnitIds: line.stockUnitIds.map((u) => (u === fromUnitId ? toUnitId : u)) } });
    await say(tx, c, 'challan_changed', userId, { body: `${issue.gdnNo}: ${line.product.productName} serial changed ${from.serialNo} → ${to.serialNo}. Reason: ${why}` });
  });
}

/** How many of a line's parts are out with no serial on record (29 Oct 2026). */
export const unnamedOut = (l: { qtyIssued: number; qtyReturned: number; stockUnitIds: string[] }) => Math.max(0, l.qtyIssued - l.qtyReturned - l.stockUnitIds.length);

/**
 * Name the serial of a part that left on a GDN without one (29 Oct 2026, Vcare):
 * the product was counted by quantity then, or nobody picked. The unit goes to
 * the job's customer and the job's bill, its history gets the GDN, and the line
 * names it - so the complaint, the GDN, the bill and Product History agree.
 * Stock does not move: the GDN already took it off the shelf.
 */
export async function nameIssuedUnit(scope: StoreScope, lineId: string, unitId: string, reason: string, userId: string): Promise<string> {
  const storeId = scopeForWrite(scope);
  const why = reason.trim();
  if (!why) throw new ComplaintError('Say why the serial was not on the GDN - it is kept on the job.');
  const line = await loadLine(scope, lineId);
  const c = line.challan;
  const issue = c.issues[0];
  if (!issue || c.status !== 'issued') throw new ComplaintError('This challan has no GDN yet - pick the serial when issuing.');
  if (line.product.trackingMode !== 'serial') throw new ComplaintError(`${line.product.productName} is counted by quantity - set it to serial numbers (Products → Tracking) first.`);
  if (unnamedOut(line) <= 0) throw new ComplaintError(`Every ${line.product.productName} on ${issue.gdnNo} already has its serial - change one instead.`);
  if (line.stockUnitIds.includes(unitId)) throw new ComplaintError('That serial is already on this line.');
  const elsewhere = await db.jobChallanLine.findFirst({ where: { stockUnitIds: { has: unitId }, challan: scopeWhere(scope) }, select: { challan: { select: { challanNo: true } } } });
  if (elsewhere) throw new ComplaintError(`That serial is already on ${elsewhere.challan.challanNo}.`);
  const { partyId } = await costTarget(scope, c);
  const bill = c.complaint ? (await db.complaint.findFirst({ where: { id: c.complaint.id }, select: { invoiceId: true } }))?.invoiceId ?? null : null;
  const ref = { refType: 'MaterialIssue', refId: issue.id, refNo: issue.gdnNo };
  return db.$transaction(async (tx) => {
    const serial = await sendUnit(tx, storeId, userId, { unitId, productId: line.productId, to: 'with_customer', partyId, invoiceId: bill, ref, note: `Serial named after ${issue.gdnNo}: ${why}` });
    const fresh = await tx.jobChallanLine.updateMany({ where: { id: line.id, version: line.version }, data: { stockUnitIds: [...line.stockUnitIds, unitId], version: { increment: 1 } } });
    if (fresh.count !== 1) throw new ComplaintError('This line changed just now - open the job again.');
    await say(tx, c, 'challan_changed', userId, { body: `${issue.gdnNo}: serial ${serial} added for ${line.product.productName}. Reason: ${why}` });
    return serial;
  });
}

/**
 * One job GDN, as a document.
 *
 * Pravin's point 6: a regular GDN opens as a proper note that can be printed
 * and handed over, and a job GDN - the parts a technician took to a customer's
 * site - opened as a row in a table and nothing else. Same goods leaving the
 * same warehouse, same signature wanted at the other end, two different
 * standards of paperwork.
 *
 * Deliberately read-only, exactly like `loadDispatch` next door. Issuing,
 * returning and cancelling belong on the job, where the context is; a print
 * view that can also change stock is a print view somebody will change stock
 * from by accident.
 */
export async function jobGdnDocument(scope: StoreScope, id: string) {
  const g = await db.materialIssue.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      id: true, storeId: true, gdnNo: true, issuedAt: true, cancelledAt: true,
      cancelReason: true, issuedBy: true,

      challan: {
        select: {
          id: true, challanNo: true, type: true, complaintId: true, installationChallanId: true,
          // An installation's material GDN (R3): the order's buyer and where the goods went.
          installationChallan: { select: { challanNo: true, siteLocation: true, salesOrder: { select: { customerName: true, organizationName: true, phone: true, shippingAddress: true, billingAddress: true } } } },
          complaint: {
            select: {
              complaintNo: true, description: true,
              siteLocation: true,
              site: { select: { name: true, address: true } },
              customer: {
                select: {
                  companyName: true, firstName: true, lastName: true, title: true,
                  phone: true, phoneCc: true, addressLine1: true, city: true, state: true,
                },
              },
            },
          },
          lines: {
            select: {
              qty: true, qtyIssued: true, qtyReturned: true, stockUnitIds: true,
              product: { select: { productName: true, productCode: true } },
            },
          },
        },
      },
    },
  });
  if (!g) return null;

  const c = g.challan.complaint;
  const cu = c?.customer ?? null;
  const ic = g.challan.installationChallan;
  const so = ic?.salesOrder ?? null;
  const issuer = g.issuedBy
    ? await db.user.findUnique({ where: { id: g.issuedBy }, select: { fullName: true } })
    : null;

  // `MaterialIssue` carries a storeId and no relation to the store, so the
  // letterhead is fetched rather than joined.
  const docSerials = await serialsOf([g.storeId], g.challan.lines.flatMap((l) => l.stockUnitIds));
  const store = await db.store.findUnique({
    where: { id: g.storeId },
    select: { name: true, address: true, organization: { select: { name: true, logoPath: true } } },
  });

  return {
    id: g.id,
    gdnNo: g.gdnNo,
    issuedAt: g.issuedAt.toISOString(),
    cancelledAt: g.cancelledAt ? g.cancelledAt.toISOString() : null,
    cancelReason: g.cancelReason,
    issuedByName: issuer?.fullName ?? null,
    complaintId: g.challan.complaintId,
    installationChallanId: g.challan.installationChallanId,
    complaintNo: c?.complaintNo ?? ic?.challanNo ?? '-',
    complaintNote: c?.description ?? null,
    challanId: g.challan.id,
    challanNo: g.challan.challanNo,
    challanType: g.challan.type,
    customerName: cu ? [cu.title, cu.firstName, cu.lastName].filter(Boolean).join(' ').trim() : so?.customerName ?? '',
    organizationName: cu ? cu.companyName : so?.organizationName ?? null,
    phone: cu ? [cu.phoneCc, cu.phone].filter(Boolean).join(' ') : so?.phone ?? '',
    // The site the parts went to, which is not necessarily the billing address -
    // that distinction is the whole reason a field job has a site at all.
    // The site the parts went to, which is NOT necessarily the billing address.
    // That distinction is the whole reason a field job carries a site at all.
    siteAddress: c
      ? c.site?.address ?? c.siteLocation ?? [cu?.addressLine1, cu?.city, cu?.state].filter(Boolean).join(', ')
      : ic?.siteLocation ?? so?.shippingAddress ?? so?.billingAddress ?? null,
    siteLabel: c?.site?.name ?? null,
    storeName: store?.name ?? '',
    storeAddress: store?.address ?? null,
    org: {
      name: store?.organization.name ?? '',
      logoUrl: publicBrandUrl(store?.organization.logoPath ?? null),
    },
    items: g.challan.lines.map((l, n) => ({
      srNo: n + 1,
      productName: l.product.productName,
      productCode: l.product.productCode,
      // A cancelled GDN had its issued quantities reset to zero; print what it
      // actually carried, or the document says a technician took nothing.
      qty: g.cancelledAt ? l.qty : l.qtyIssued,
      returned: l.qtyReturned,
      // The serial numbers that went (22 Oct 2026) - printed under the product.
      units: l.stockUnitIds.flatMap((id) => (docSerials.has(id) ? [{ id, serialNo: docSerials.get(id)! }] : [])),
    })).filter((l) => l.qty > 0),
  };
}
