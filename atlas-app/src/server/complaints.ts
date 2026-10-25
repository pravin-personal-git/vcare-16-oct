import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeWhere, scopeForWrite, userInScope, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { applyMovements } from './stock';
import { metresBetween } from '@/lib/shift';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { isServiceTeamMember, orderAssignable, type AssignablePerson } from '@/lib/technicians';
// One direction only: complaints -> amc -> invoices. Nothing in amc.ts or
// invoices.ts imports this file back, so there is no cycle.
import { resolveCoverageFor, customersWithCover } from './amc';
import { serviceDepartments } from './service-team';
import { postJournalEntry, reverseJournalEntry } from './ledger';
import { costsFor } from './product-cost';
import { repairCostAccount } from '@/lib/service-revenue';
import { fieldSetup } from './custom-fields';
import { stdRequired, stdShown } from '@/lib/custom-fields';
import { customerLabel, findTransition, transitionError, SET_BY_THEIR_OWN_ACTION, type JobActor } from '@/lib/job-flow';
import { visitSubject } from '@/lib/visit-reasons';
import { assertActionAllowed } from './flow-gate';
import { jobEvent } from './job-notify';

/** Statuses before any work - reassigning here means the new technician must accept. */
const PRE_WORK: string[] = ['received', 'assigned', 'accepted', 'scheduled'];

/**
 * Services & Complaints.
 *
 * Three real tables, not four independent ones: a Complaint (what the
 * customer reported), a ServiceVisit (a technician's scheduled or completed
 * call against it), and a RepairChallan (stock that physically left the
 * building to fix it). "Complaint Tracker" and "Repair Tracker" - two of the
 * four screens this module exposes - are filtered views over these three,
 * not separate storage, so a complaint's tracker can never disagree with its
 * own history.
 */

export class ComplaintError extends Error {}

// ------------------------------------------------------------- field config

export interface ComplaintFieldConfigRow {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  options: string[];
  required: boolean;
  sortOrder: number;
  isActive: boolean;
}

export async function listFieldConfigs(scope: StoreScope): Promise<ComplaintFieldConfigRow[]> {
  const rows = await db.complaintFieldConfig.findMany({
    where: { ...scopeWhere(scope), isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id, fieldKey: r.fieldKey, label: r.label, fieldType: r.fieldType,
    options: r.options ? r.options.split(',').map((o) => o.trim()).filter(Boolean) : [],
    required: r.required, sortOrder: r.sortOrder, isActive: r.isActive,
  }));
}

export interface FieldConfigInput {
  fieldKey: string;
  label: string;
  fieldType: string;
  options: string;
  required: boolean;
}

export async function saveFieldConfig(scope: StoreScope, id: string | null, input: FieldConfigInput) {
  const storeId = scopeForWrite(scope);
  if (!input.label.trim()) throw new ComplaintError('Field label is required.');
  const fieldKey = input.fieldKey.trim() || input.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

  if (id) {
    const found = await db.complaintFieldConfig.findFirst({ where: { id, storeId } });
    if (!found) throw new ComplaintError('That field is not in your scope.');
    return db.complaintFieldConfig.update({
      where: { id },
      data: { label: input.label.trim(), fieldType: input.fieldType, options: input.options.trim() || null, required: input.required },
    });
  }

  const maxSort = await db.complaintFieldConfig.aggregate({ where: { storeId }, _max: { sortOrder: true } });
  return db.complaintFieldConfig.create({
    data: {
      storeId, fieldKey, label: input.label.trim(), fieldType: input.fieldType,
      options: input.options.trim() || null, required: input.required,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  });
}

export async function removeFieldConfig(scope: StoreScope, id: string) {
  const storeId = scopeForWrite(scope);
  const found = await db.complaintFieldConfig.findFirst({ where: { id, storeId } });
  if (!found) throw new ComplaintError('That field is not in your scope.');
  await db.complaintFieldConfig.update({ where: { id }, data: { isActive: false } });
}

// -------------------------------------------------------------------- lists

export interface ComplaintRow {
  id: string;
  complaintNo: string;
  /** The customer record, so the name opens their page (G-35). */
  customerId: string;
  customerName: string;
  customerPhone: string;
  siteLocation: string | null;
  siteLat: number | null;
  siteLng: number | null;
  siteSource: string | null;
  productName: string | null;
  /**
   * The equipment's category, so the list can be filtered by what broke rather
   * than only by what state the job is in. "Show me every camera complaint" was
   * unanswerable before - the only filters were the status cards.
   */
  productCategoryId: string | null;
  productCategoryName: string | null;
  description: string;
  status: string;
  resolutionType: string | null;
  priority: string;
  assignedTechnicianId: string | null;
  assignedTechnicianName: string | null;
  /**
   * Who OWNS the job, as opposed to who attends site. Populated for migrated
   * complaints, where the source system tracked the two separately; null on a
   * complaint raised in Atlas until somebody sets it.
   */
  ownerId: string | null;
  ownerName: string | null;
  /** The complaint's number in the system it was migrated from, if any. */
  legacyRef: string | null;
  raisedByPortal: boolean;
  createdAt: Date;
  /** complaint | repair | installation - the phone filters by it (28 Sep 2026). */
  jobType: string;
  closedAt: Date | null;

  /**
   * Whether this customer holds a live maintenance contract.
   *
   * The LIST answer, not the precise one - see `customersWithCover`. It says
   * the customer has cover, never that this particular fault is covered, and
   * the badge is worded to match. The exact "who pays" answer needs the
   * product matched and lives on the tracker, where one query per complaint is
   * affordable.
   */
  amcContractNo: string | null;
  amcDaysToExpiry: number | null;
  /** True when the contract lists specific equipment, so cover may not extend. */
  amcItemised: boolean;
}

async function technicianNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter((x): x is string => !!x))];
  if (clean.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: clean } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

export async function listComplaints(scope: StoreScope, opts: { status?: string } = {}): Promise<ComplaintRow[]> {
  const rows = await db.complaint.findMany({
    where: { ...scopeWhere(scope), ...(opts.status ? { status: opts.status } : {}) },
    include: {
      customer: { select: { firstName: true, lastName: true, companyName: true, phone: true } },
      product: {
        select: {
          productName: true, categoryId: true,
          category: { select: { name: true } },
        },
      },
      owner: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  const names = await technicianNames(rows.map((r) => r.assignedTechnicianId));
  // ONE query for the whole list, not one per row - see `customersWithCover`.
  const cover = await customersWithCover(scope);

  return rows.map((r) => ({
    id: r.id, complaintNo: r.complaintNo, customerId: r.customerId,
    customerName: r.customer.companyName || [r.customer.firstName, r.customer.lastName].filter(Boolean).join(' '),
    customerPhone: r.customer.phone,
    siteLocation: r.siteLocation,
    siteLat: r.siteLat ? Number(r.siteLat) : null, siteLng: r.siteLng ? Number(r.siteLng) : null,
    siteSource: r.siteSource,
    productName: r.product?.productName ?? null,
    productCategoryId: r.product?.categoryId ?? null,
    productCategoryName: r.product?.category?.name ?? null,
    description: r.description, status: r.status, resolutionType: r.resolutionType, priority: r.priority,
    assignedTechnicianId: r.assignedTechnicianId,
    assignedTechnicianName: r.assignedTechnicianId ? names.get(r.assignedTechnicianId) ?? null : null,
    ownerId: r.ownerId,
    ownerName: r.owner?.fullName ?? null,
    legacyRef: r.legacyRef,
    raisedByPortal: r.raisedByPortal, createdAt: r.createdAt, jobType: r.jobType, closedAt: r.closedAt,
    amcContractNo: cover.get(r.customerId)?.contractNo ?? null,
    amcDaysToExpiry: cover.get(r.customerId)?.daysToExpiry ?? null,
    amcItemised: cover.get(r.customerId)?.itemised ?? false,
  }));
}

export interface ComplaintDetail extends ComplaintRow {
  /**
   * The ids, not just the display names, because coverage resolution needs
   * them - `resolveCoverageFor` asks "does this customer hold a contract
   * covering this product". `productId` is null on the 3,548 migrated
   * complaints, which is why the coverage rule has to treat unidentified
   * equipment as uncertain rather than as uncovered.
   */
  customerId: string;
  productId: string | null;
  customFields: Record<string, string>;
  activities: { id: string; kind: string; body: string | null; statusFrom: string | null; statusTo: string | null; visibleToPortal: boolean; createdById: string | null; createdByName: string | null; createdAt: Date }[];
  visits: {
    id: string; technicianName: string; purpose: string; scheduledAt: Date; status: string; outcomeNote: string | null; completedAt: Date | null; checkedInAt: Date | null; checkInDistanceM: number | null; checkInWithinRange: boolean | null;
    /** Reschedules and cancellation, oldest first (workflow spec §4.2). */
    changes: { id: string; kind: string; fromAt: Date; toAt: Date | null; reason: string; changedByName: string | null; requestedByCustomer: boolean; createdAt: Date }[];
  }[];
  /** Field-job engine (lib/job-flow). */
  jobType: string;
  acceptedAt: Date | null;
  declinedReason: string | null;
  reopenCount: number;
  closedAt: Date | null;
  timeOnSiteSec: number;
  overrideUsed: boolean;
  rating: { stars: number; techStars: number | null; comment: string | null } | null;
  waitingEstimatePaise: number | null;
  signOff: string | null;
  needsCallback: boolean;
  /** An installation job's sales order (workflow slice 9). */
  salesOrder: { id: string; orderNo: string } | null;
  /** Bill this job (28 Sep 2026): its invoice, and where billing stands. */
  invoice: { id: string; invoiceNo: string; lifecycle: string } | null;
  billingStatus: string;
  challans: { id: string; challanNo: string; productName: string; qty: number; costPaise: number; dispatchedAt: Date }[];
}

export async function getComplaintDetail(scope: StoreScope, id: string): Promise<ComplaintDetail | null> {
  const c = await db.complaint.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      customer: { select: { firstName: true, lastName: true, companyName: true, phone: true } },
      product: {
        select: {
          productName: true, categoryId: true,
          category: { select: { name: true } },
        },
      },
      owner: { select: { fullName: true } },
      activities: { orderBy: { createdAt: 'desc' } },
      visits: { include: { technician: { select: { fullName: true } }, changes: { orderBy: { createdAt: 'asc' } } }, orderBy: { scheduledAt: 'desc' } },
      estimates: { where: { status: 'waiting' }, orderBy: { createdAt: 'desc' }, take: 1, select: { totalPaise: true } },
      salesOrder: { select: { id: true, orderNo: true } },
      invoice: { select: { id: true, invoiceNo: true, lifecycle: true } },
      challans: { include: { product: { select: { productName: true } } }, orderBy: { dispatchedAt: 'desc' } },
    },
  });
  if (!c) return null;

  const names = await technicianNames([
    c.assignedTechnicianId, ...c.activities.map((a) => a.createdBy), ...c.visits.flatMap((v) => v.changes.map((ch) => ch.changedBy)),
  ]);

  return {
    id: c.id, complaintNo: c.complaintNo,
    jobType: c.jobType, acceptedAt: c.acceptedAt, declinedReason: c.declinedReason, reopenCount: c.reopenCount, closedAt: c.closedAt,
    timeOnSiteSec: c.timeOnSiteSec, overrideUsed: c.overrideUsed,
    rating: c.ratedAt && c.ratingStars ? { stars: c.ratingStars, techStars: c.techRatingStars, comment: c.ratingComment } : null,
    waitingEstimatePaise: c.estimates[0]?.totalPaise ?? null,
    signOff: c.signOff, needsCallback: c.needsCallback,
    salesOrder: c.salesOrder ? { id: c.salesOrder.id, orderNo: c.salesOrder.orderNo } : null,
    invoice: c.invoice ? { id: c.invoice.id, invoiceNo: c.invoice.invoiceNo, lifecycle: c.invoice.lifecycle } : null,
    billingStatus: c.billingStatus,
    customerId: c.customerId,
    productId: c.productId,
    customerName: c.customer.companyName || [c.customer.firstName, c.customer.lastName].filter(Boolean).join(' '),
    customerPhone: c.customer.phone,
    siteLocation: c.siteLocation,
    siteLat: c.siteLat ? Number(c.siteLat) : null, siteLng: c.siteLng ? Number(c.siteLng) : null,
    siteSource: c.siteSource,
    productName: c.product?.productName ?? null,
    productCategoryId: c.product?.categoryId ?? null,
    productCategoryName: c.product?.category?.name ?? null,
    description: c.description, status: c.status, resolutionType: c.resolutionType, priority: c.priority,
    assignedTechnicianId: c.assignedTechnicianId,
    assignedTechnicianName: c.assignedTechnicianId ? names.get(c.assignedTechnicianId) ?? null : null,
    ownerId: c.ownerId,
    ownerName: c.owner?.fullName ?? null,
    legacyRef: c.legacyRef,
    /**
     * Null on the DETAIL, deliberately.
     *
     * The tracker resolves coverage properly via `resolveCoverageFor` - which
     * checks the product, the warranty and the dates - and shows that. These
     * three fields are the LIST approximation, and having both on one screen
     * would let a weaker answer sit next to a stronger one and contradict it.
     */
    amcContractNo: null,
    amcDaysToExpiry: null,
    amcItemised: false,
    raisedByPortal: c.raisedByPortal, createdAt: c.createdAt,
    customFields: (c.customFields as Record<string, string> | null) ?? {},
    activities: c.activities.map((a) => ({
      id: a.id, kind: a.kind, body: a.body, statusFrom: a.statusFrom, statusTo: a.statusTo,
      visibleToPortal: a.visibleToPortal, createdById: a.createdBy,
      createdByName: a.createdBy ? names.get(a.createdBy) ?? null : null, createdAt: a.createdAt,
    })),
    visits: c.visits.map((v) => ({
      id: v.id, technicianName: v.technician.fullName, purpose: v.purpose, scheduledAt: v.scheduledAt,
      status: v.status, outcomeNote: v.outcomeNote, completedAt: v.completedAt,
      checkedInAt: v.checkedInAt, checkInDistanceM: v.checkInDistanceM, checkInWithinRange: v.checkInWithinRange,
      changes: v.changes.map((ch) => ({
        id: ch.id, kind: ch.kind, fromAt: ch.fromAt, toAt: ch.toAt, reason: ch.reason,
        changedByName: ch.changedBy ? names.get(ch.changedBy) ?? null : null, requestedByCustomer: ch.requestedByCustomer, createdAt: ch.createdAt,
      })),
    })),
    challans: c.challans.map((ch) => ({
      id: ch.id, challanNo: ch.challanNo, productName: ch.product.productName, qty: ch.qty,
      costPaise: ch.costPaise, dispatchedAt: ch.dispatchedAt,
    })),
  };
}

/** Products this customer has actually bought - so the complaint form offers real purchases, not the whole catalogue. */
export interface CustomerPurchase {
  productId: string;
  productName: string;
  /**
   * So the complaint form can narrow a long list instead of making somebody
   * read it. A customer with a hundred line items gets a hundred options, and
   * the one they want is somewhere in the middle.
   */
  productCode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  subCategoryId: string | null;
  subCategoryName: string | null;
  /** How many of it they have bought - the clue to which one they mean. */
  qty: number;
  /** The most recent invoice date for it, newest first in the list. */
  lastBoughtAt: Date | null;
}

export async function listCustomerPurchases(
  scope: StoreScope, customerId: string,
): Promise<CustomerPurchase[]> {
  const items = await db.invoiceItem.findMany({
    where: {
      productId: { not: null }, deletedAt: null,
      invoice: { partyId: customerId, ...scopeWhere(scope), deletedAt: null, lifecycle: { not: 'cancelled' } },
    },
    select: {
      productId: true, productName: true, productCode: true, qty: true,
      invoice: { select: { invoiceDate: true } },
    },
    take: LIST_MAX_ROWS,
  });

  /**
   * Rolled up here rather than with `distinct`, because the useful row is one
   * per product with its total and its latest date - and `distinct` would keep
   * an arbitrary one of the duplicates and throw the rest away.
   */
  const byProduct = new Map<string, CustomerPurchase>();
  for (const i of items) {
    if (!i.productId) continue;
    const at = i.invoice?.invoiceDate ?? null;
    const existing = byProduct.get(i.productId);
    if (existing) {
      existing.qty += i.qty;
      if (at && (!existing.lastBoughtAt || at > existing.lastBoughtAt)) existing.lastBoughtAt = at;
      continue;
    }
    byProduct.set(i.productId, {
      productId: i.productId,
      productName: i.productName,
      productCode: i.productCode,
      categoryId: null, categoryName: null, subCategoryId: null, subCategoryName: null,
      qty: i.qty,
      lastBoughtAt: at,
    });
  }

  /**
   * Categories come from the PRODUCT, not the invoice line.
   *
   * The line carries a name and code snapshotted at the time of sale, which is
   * right for a document, but a category that was changed since would then be
   * wrong on this screen. One extra query keeps the filter honest.
   */
  const ids = [...byProduct.keys()];
  if (ids.length > 0) {
    const products = await db.product.findMany({
      where: { id: { in: ids }, ...scopeWhere(scope) },
      select: {
        id: true, categoryId: true, subCategoryId: true,
        category: { select: { name: true } },
        subCategory: { select: { name: true } },
      },
    });
    for (const p of products) {
      const row = byProduct.get(p.id);
      if (!row) continue;
      row.categoryId = p.categoryId;
      row.categoryName = p.category?.name ?? null;
      row.subCategoryId = p.subCategoryId;
      row.subCategoryName = p.subCategory?.name ?? null;
    }
  }

  // Most recently bought first: on a service call it is usually the newest thing.
  return [...byProduct.values()].sort(
    (a, b) => (b.lastBoughtAt?.getTime() ?? 0) - (a.lastBoughtAt?.getTime() ?? 0),
  );
}

// ------------------------------------------------------------------ mutate

export async function logActivity(
  tx: Prisma.TransactionClient | typeof db,
  complaintId: string, kind: string, userId: string | null,
  extra: { body?: string; statusFrom?: string; statusTo?: string; visibleToPortal?: boolean } = {},
) {
  // Internal unless the caller says otherwise (27 Sep 2026: challans used to
  // reach customers' timelines because this defaulted to true). The portal
  // also reads only CUSTOMER_VISIBLE_KINDS - lib/job-flow.
  const { visibleToPortal = false, ...rest } = extra;
  await tx.complaintActivity.create({
    data: { complaintId, kind, createdBy: userId, visibleToPortal, ...rest },
  });
}

export interface CreateComplaintInput {
  customerId: string;
  productId: string | null;
  /** Optional supplementary note - "Gate 3, near the warehouse". Never the
   * primary location signal; see siteLat/siteLng below. */
  siteLocation: string | null;
  /** One of the customer's named sites (Phase 5), when the complaint is at one. */
  siteId?: string | null;
  /**
   * Captured via the browser's own location or a resolved Google Maps link
   * (components/ui/LocationCapture.tsx), never typed. A technician's field
   * check-in matches against this.
   *
   * Mandatory from 18 Sep 2026; configurable from 5 Oct 2026 - a branch may
   * switch it off under Settings > Custom Fields > Complaints, in which case
   * the technician captures the pin on arrival (fallback: delegate). Null
   * only when the rule allows it; the server checks, not the form.
   */
  siteLat: number | null;
  siteLng: number | null;
  siteSource: 'gps' | 'maps_link' | null;
  description: string;
  priority: string;
  customFields: Record<string, string>;
  /** True when the customer's own portal login raised this, not staff. */
  raisedByPortal?: boolean;
  /**
   * The items (10 Oct 2026, stage 2): exact serials, products, or "not our
   * product". Absent - the phone app and the portal, which still send one
   * `productId` - makes one item from that product, so every new complaint
   * has items either way.
   */
  items?: import('./complaint-items').ComplaintItemInput[];
}

export async function createComplaint(scope: StoreScope, input: CreateComplaintInput, userId: string | null): Promise<string> {
  const storeId = scopeForWrite(scope);
  // "What is wrong" has fallback 'block' - it can never be switched off.
  if (!input.description.trim()) throw new ComplaintError('Description is required.');

  /**
   * The branch's field rules, enforced HERE and not only on the form.
   * AGENTS.md section 4: a field hidden in the UI must also be accepted as
   * empty by the server, and one marked required must be refused when empty,
   * whatever the request claims. A replayed or hand-built request gets the
   * same answer as the screen.
   */
  const rules = await fieldSetup(scope, 'complaint');
  const needs = (k: string) => stdShown(rules, k) && stdRequired(rules, k);

  const hasPin = Number.isFinite(input.siteLat) && Number.isFinite(input.siteLng)
    && Math.abs(input.siteLat ?? 999) <= 90 && Math.abs(input.siteLng ?? 999) <= 180
    && !(input.siteLat === 0 && input.siteLng === 0);

  if (needs('siteLocation') && !hasPin) {
    throw new ComplaintError('Share a location or paste a Maps link before raising the complaint.');
  }
  const itemInputs = input.items?.length
    ? input.items
    : input.productId ? [{ ours: true, productId: input.productId }] : [];
  if (needs('productId') && !input.productId && !itemInputs.length) throw new ComplaintError('Equipment is required.');
  if (needs('siteId') && !input.siteId) throw new ComplaintError('Site is required.');
  if (needs('siteNote') && !input.siteLocation?.trim()) throw new ComplaintError('Site note is required.');

  // A pin that was sent but is out of range is a bad request either way, and
  // a switched-off field is stored empty rather than as a junk coordinate.
  const siteLat = hasPin ? input.siteLat : null;
  const siteLng = hasPin ? input.siteLng : null;
  const siteSource = hasPin ? input.siteSource : null;

  const configs = await listFieldConfigs(scope);
  for (const f of configs) {
    if (f.required && !input.customFields[f.fieldKey]?.trim()) {
      throw new ComplaintError(`"${f.label}" is required.`);
    }
  }

  // Allocated before the transaction opens, not inside it - allocateDocumentNumber
  // runs its own query against the plain `db` client, never `tx`. Calling it from
  // inside an interactive transaction holds that transaction's one connection idle
  // while a second connection is acquired for the allocation - harmless on a large
  // pool, a self-deadlock on a small one (this is what timed out every attempt
  // while testing against a connection_limit=1 database). Every other document
  // type in this codebase already allocates its number before opening a
  // transaction, e.g. quotations.ts's createQuotation - this now matches that.
  // A site must belong to this customer - a crafted id cannot pin the
  // complaint to someone else's premises.
  if (input.siteId) {
    const site = await db.partySite.findFirst({ where: { id: input.siteId, storeId, partyId: input.customerId }, select: { id: true } });
    if (!site) throw new ComplaintError('That site does not belong to this customer.');
  }

  const { prepareItems } = await import('./complaint-items');
  const items = await prepareItems(storeId, input.customerId, itemInputs);
  // The first item we sold names the complaint's equipment, for lists, the
  // portal and the old single-product screens.
  const productId = input.productId ?? items.find((i) => i.productId)?.productId ?? null;

  const complaintNo = await allocateDocumentNumber(storeId, 'CMP');

  return db.$transaction(async (tx) => {
    const complaint = await tx.complaint.create({
      data: {
        storeId, complaintNo, customerId: input.customerId, productId,
        ...(items.length ? { items: { createMany: { data: items.map((i) => ({ ...i, createdBy: userId })) } } } : {}),
        siteLocation: input.siteLocation, siteId: input.siteId ?? null,
        siteLat, siteLng, siteSource,
        description: input.description.trim(),
        priority: input.priority, customFields: input.customFields, createdBy: userId,
        raisedByPortal: input.raisedByPortal ?? false,
      },
    });
    await logActivity(tx, complaint.id, 'note', userId, {
      body: input.raisedByPortal ? 'Complaint raised by the customer.' : 'Complaint raised.',
      visibleToPortal: true,
    });
    return complaint.id;
  });
}

export async function assignTechnician(scope: StoreScope, complaintId: string, technicianId: string, userId: string | null) {
  const storeId = scopeForWrite(scope);
  const complaint = await db.complaint.findFirst({ where: { id: complaintId, storeId } });
  if (!complaint) throw new ComplaintError('That complaint is not in your scope.');

  await db.$transaction(async (tx) => {
    await tx.complaint.update({
      where: { id: complaintId },
      // Before work starts, a (new) technician must accept it (job-flow).
      data: {
        assignedTechnicianId: technicianId, assignedAt: new Date(),
        ...(PRE_WORK.includes(complaint.status) ? { status: 'assigned', acceptedAt: null } : {}),
      },
    });
    await logActivity(tx, complaintId, 'assignment', userId, {
      statusFrom: complaint.status, statusTo: PRE_WORK.includes(complaint.status) ? 'assigned' : complaint.status,
    });
  });
  await jobEvent(complaintId, 'assigned');
}

export async function setResolutionType(scope: StoreScope, complaintId: string, resolutionType: 'field_visit' | 'direct_replacement', userId: string | null) {
  const storeId = scopeForWrite(scope);
  const complaint = await db.complaint.findFirst({ where: { id: complaintId, storeId } });
  if (!complaint) throw new ComplaintError('That complaint is not in your scope.');

  await db.$transaction(async (tx) => {
    await tx.complaint.update({ where: { id: complaintId }, data: { resolutionType } });
    await logActivity(tx, complaintId, 'note', userId, {
      body: resolutionType === 'field_visit' ? 'Decided: needs a field visit.' : 'Decided: direct replacement.',
    });
  });
}

/**
 * Move a job to another status - only along lib/job-flow's rulebook, for the
 * actor asking (office on the website, technician on the phone, customer in
 * the portal/app). `reason` is required for a decline.
 */
export async function updateComplaintStatus(
  scope: StoreScope, complaintId: string, status: string, userId: string | null,
  actor: JobActor = 'office', reason?: string | null,
  /** The person's permissions - Complaints: Approve may close without an Approval Rule. */
  permissions?: ReadonlySet<string>,
) {
  const storeId = scopeForWrite(scope);
  const complaint = await db.complaint.findFirst({ where: { id: complaintId, storeId } });
  if (!complaint) throw new ComplaintError('That complaint is not in your scope.');
  const rule = findTransition(complaint.status, status, actor);
  if (!rule) throw new ComplaintError(transitionError(complaint.status, status));
  // Visit booked / waiting for estimate are what scheduling a visit and sending
  // an estimate set; the office cannot claim them by hand (10 Oct 2026).
  if (actor === 'office' && (SET_BY_THEIR_OWN_ACTION as readonly string[]).includes(status)) {
    throw new ComplaintError(status === 'scheduled' ? 'Schedule a visit - the job becomes "Visit booked" when one is booked.' : 'Send an estimate - the job waits for approval once one is sent.');
  }
  // The move is legal in the rulebook; this business may still have switched
  // the step off or handed it to somebody else (F1a / D16, server/flow-gate).
  await assertActionAllowed(storeId, rule.action, actor);
  // THE CLOSE GATE (10 Oct 2026, repair flow stage 6): nothing taken away may
  // still be out, and no visit still booked, when the job is called done. Nor
  // may it be cancelled with the customer's item still away - the complaint is
  // the only record that we have it.
  if (status === 'resolved' || status === 'closed' || status === 'awaiting_customer' || status === 'cancelled') {
    const { assertCanClose } = await import('./item-handback');
    await assertCanClose(complaintId, { ignoreVisits: status === 'awaiting_customer' || status === 'cancelled' });
    if (status === 'closed') await (await import('./item-handback')).assertBilledToClose(scope, complaintId);
  }
  const why = reason?.trim() || null;
  if (rule.action === 'decline' && !why) throw new ComplaintError('Say why you cannot take this job.');
  // Closing from the office follows Settings > Field jobs (workflow slice 6).
  if (status === 'closed' && actor === 'office') {
    const { getJobSettings } = await import('./job-settings');
    if ((await getJobSettings(storeId)).approvalToClose) {
      // Closing from the job page decides the close approval when this person
      // may (live test 28 Sep 2026: the office was sent off to My Desk).
      // With an Approval Rule the request's approvers decide; without one the
      // close waits for the owner (My Desk) - so the owner may close here too.
      const { openApprovalRequest } = await import('./hierarchy');
      const { mayDecideDirect } = await import('./approvals');
      if (await openApprovalRequest(scope, 'job_close', complaintId) || (userId && await mayDecideDirect(scope, userId, 'job_close', permissions))) {
        const { decideJobClose } = await import('./job-signoff');
        await decideJobClose(scope, complaintId, 'approved', userId ?? '', why, false);
        return;
      }
      throw new ComplaintError('Closing this job needs approval - the owner, or someone whose role has Complaints & visits: Approve, closes it (My Desk > Waiting on me). The owner can switch this off in Settings > Field jobs.');
    }
    if (complaint.needsCallback && !why) {
      throw new ComplaintError('The technician marked this "customer approved" without a code - call the customer and note what they said.');
    }
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.complaint.update({
      where: { id: complaintId },
      data: {
        status,
        ...(status === 'accepted' ? { acceptedAt: now } : {}),
        // Declined: back to the office with nobody on it.
        ...(rule.action === 'decline' ? { assignedTechnicianId: null, assignedAt: null, declinedReason: why } : {}),
        ...(status === 'resolved' ? { resolvedAt: now } : {}),
        ...(status === 'closed' ? { closedAt: now, closedBy: userId, closeNote: why } : {}),
        ...(status === 'resolved' && actor === 'office' ? { signOff: 'office' } : {}),
        ...(rule.action === 'reopen' ? { closedAt: null, closedBy: null, reopenCount: { increment: 1 } } : {}),
      },
    });
    // The customer sees the step only when their milestone actually changes.
    const customerSees = customerLabel(complaint.status) !== customerLabel(status);
    await logActivity(tx, complaintId, 'status_change', userId, {
      statusFrom: complaint.status, statusTo: status, visibleToPortal: customerSees,
      ...(why ? { body: why } : {}),
    });
  });
  if (rule.action === 'accept') await jobEvent(complaintId, 'accepted', 'your technician');
  if (rule.action === 'reopen') await jobEvent(complaintId, 'reopened', why ?? 'reopened by the office');
  if (rule.action === 'send_back') await jobEvent(complaintId, 'sent_back', why ?? '');
  if (status === 'closed') await jobEvent(complaintId, 'closed');
  // The office marked the work done: the customer confirms, with their code.
  if (status === 'awaiting_customer' && actor === 'office') {
    const { askCustomerToConfirm } = await import('./job-signoff');
    await askCustomerToConfirm(complaintId);
  }
  // Marked done by the office: on to Waiting to close (auto-close / approval).
  if (status === 'resolved' && actor === 'office') {
    const { afterResolved } = await import('./job-signoff');
    await afterResolved(storeId, complaintId, userId, 'office');
  }
}

export async function addComplaintNote(
  scope: StoreScope, complaintId: string, body: string, userId: string | null,
  visibleToPortal = false,
) {
  const storeId = scopeForWrite(scope);
  const complaint = await db.complaint.findFirst({ where: { id: complaintId, storeId } });
  if (!complaint) throw new ComplaintError('That complaint is not in your scope.');
  if (!body.trim()) throw new ComplaintError('Note cannot be empty.');
  // Internal by default - a free-text staff note is not automatically shown
  // on the customer's portal login unless they tick "share with customer".
  // `remark`, not `note` (9 Oct 2026): `note` also carries Atlas's own
  // sentences, so the page could not tell a person's words from the log.
  await logActivity(db, complaintId, 'remark', userId, { body: body.trim(), visibleToPortal });
}

// ---------------------------------------------------------- service visits

export interface ServiceVisitRow {
  id: string;
  /**
   * WHAT THE VISIT IS ABOUT - exactly one of these is set (7 Oct 2026).
   *
   * A visit used to be a complaint's visit and nothing else, which is why
   * Vcare had two of them against 906 installation challans. `subject` is
   * what a screen should branch on; the two ids are for linking.
   */
  subject: 'complaint' | 'installation';
  complaintId: string | null;
  installationChallanId: string | null;
  /** The complaint number or the challan number - whichever this visit is for. */
  docNo: string;
  /** The customer, so the name opens their page (G-35). Null when an installation has no order. */
  customerId: string | null;
  customerName: string;
  technicianId: string;
  technicianName: string;
  purpose: string;
  reason: string;
  scheduledAt: Date;
  status: string;
  outcomeNote: string | null;
  /** Site coordinates to check in against - null if this complaint predates 18 Sep 2026. */
  siteLat: number | null;
  siteLng: number | null;
  checkedInAt: Date | null;
  checkInDistanceM: number | null;
  checkInWithinRange: boolean | null;
}

export async function listServiceVisits(scope: StoreScope, opts: { status?: string } = {}): Promise<ServiceVisitRow[]> {
  const rows = await db.serviceVisit.findMany({
    where: {
      ...(opts.status ? { status: opts.status } : {}),
      /*
        A visit now belongs to EITHER a complaint or an installation challan,
        so scoping cannot go through the complaint any more. Every visit
        carries its own `storeId` (filled from the complaint for the rows that
        existed before), and the OR keeps any row the backfill could not reach
        reachable through the complaint it does have - rather than quietly
        dropping it off the screen.
      */
      OR: [scopeWhere(scope), { complaint: scopeWhere(scope) }],
    },
    include: {
      technician: { select: { fullName: true } },
      complaint: { select: { complaintNo: true, customerId: true, siteLat: true, siteLng: true, customer: { select: { firstName: true, lastName: true, companyName: true } } } },
      installationChallan: {
        // The order carries the customer's name denormalised, as every
        // document in this schema does - what they were called then.
        select: { challanNo: true, salesOrder: { select: { customerName: true, partyId: true } } },
      },
    },
    orderBy: { scheduledAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((v) => ({
    id: v.id,
    subject: (v.complaint ? 'complaint' : 'installation') as 'complaint' | 'installation',
    complaintId: v.complaintId,
    installationChallanId: v.installationChallanId,
    docNo: v.complaint?.complaintNo ?? v.installationChallan?.challanNo ?? '-',
    /*
      An installation's customer comes through its sales order, and a challan
      raised without one has no customer to name. Saying so beats an empty
      cell that reads as a loading failure.
    */
    customerId: v.complaint ? v.complaint.customerId : (v.installationChallan?.salesOrder?.partyId ?? null),
    customerName: v.complaint
      ? (v.complaint.customer.companyName || [v.complaint.customer.firstName, v.complaint.customer.lastName].filter(Boolean).join(' '))
      : (v.installationChallan?.salesOrder?.customerName || 'No order on the challan'),
    technicianId: v.technicianId, technicianName: v.technician.fullName,
    purpose: v.purpose, reason: v.reason, scheduledAt: v.scheduledAt, status: v.status, outcomeNote: v.outcomeNote,
    // Only a complaint carries site coordinates, so only a complaint visit can
    // be checked in against one. An installation visit checks in against the
    // order's site, which is Wave 3's open edge - see PROJECT-STATE.
    siteLat: v.complaint?.siteLat ? Number(v.complaint.siteLat) : null,
    siteLng: v.complaint?.siteLng ? Number(v.complaint.siteLng) : null,
    checkedInAt: v.checkedInAt, checkInDistanceM: v.checkInDistanceM, checkInWithinRange: v.checkInWithinRange,
  }));
}

/**
 * Book an appointment for a NEW INSTALLATION (7 Oct 2026).
 *
 * The other half of the scheduler. A challan already says which goods went
 * out and who is carrying them; what it never held was the date the customer
 * was given, which is why Vcare's office was agreeing times on the phone and
 * keeping them nowhere. This writes that date against the challan.
 *
 * It deliberately does NOT touch the challan's own status. Pending / work done
 * / approved is the store's paperwork and belongs to whoever signs it off;
 * booking a visit is the office promising a day. Conflating the two would mean
 * a cancelled appointment silently un-approved a challan.
 */
export async function scheduleInstallationVisit(
  scope: StoreScope, challanId: string, technicianId: string, reason: string, scheduledAt: Date, userId: string | null,
) {
  const storeId = scopeForWrite(scope);
  if (visitSubject(reason) !== 'installation') {
    throw new ComplaintError('That reason belongs to a complaint, not to an installation.');
  }
  if (Number.isNaN(scheduledAt.getTime())) throw new ComplaintError('Choose the visit date and time.');
  const challan = await db.installationChallan.findFirst({ where: { id: challanId, storeId }, select: { id: true, challanNo: true } });
  if (!challan) throw new ComplaintError('That installation challan is not in your scope.');
  const tech = await db.user.findFirst({ where: { id: technicianId, ...userInScope(scope) }, select: { id: true } });
  if (!tech) throw new ComplaintError('That technician is not in your scope.');

  // A survey trip is for looking, not fitting - so it carries the
  // `info_collection` purpose and never asks for a site check-in.
  const purpose = reason === 'installation_survey' ? 'info_collection' : 'field_visit';
  await db.serviceVisit.create({
    data: { storeId, installationChallanId: challanId, technicianId, purpose, reason, scheduledAt, createdBy: userId },
  });
}

export async function scheduleVisit(
  scope: StoreScope, complaintId: string, technicianId: string, purpose: string, scheduledAt: Date, userId: string | null,
  actor: JobActor = 'office',
  /**
   * Why the technician is going. Defaults to the only answer that was
   * possible before this existed, so every old caller keeps working.
   */
  reason = 'existing_complaint',
) {
  const storeId = scopeForWrite(scope);
  if (visitSubject(reason) !== 'complaint') {
    throw new ComplaintError('That reason belongs to a new installation. Book it from the installation instead.');
  }
  let complaint = await db.complaint.findFirst({ where: { id: complaintId, storeId } });
  if (!complaint) throw new ComplaintError('That complaint is not in your scope.');
  if (Number.isNaN(scheduledAt.getTime())) throw new ComplaintError('Choose the visit date and time.');
  // A field visit is the job's own technician's (live test 28 Sep: a visit
  // booked for one person while the job sat with another left the phone
  // with no job steps). Unassigned: booking the visit assigns the job.
  if (purpose === 'field_visit' && complaint.assignedTechnicianId !== technicianId) {
    if (complaint.assignedTechnicianId) {
      const names = await technicianNames([complaint.assignedTechnicianId]);
      throw new ComplaintError(`This job is assigned to ${names.get(complaint.assignedTechnicianId) ?? 'another technician'}. Book the visit for them, or reassign the job first.`);
    }
    await assignTechnician(scope, complaintId, technicianId, userId);
    complaint = (await db.complaint.findFirst({ where: { id: complaintId, storeId } }))!;
  }
  const current = complaint;

  await db.$transaction(async (tx) => {
    await tx.serviceVisit.create({
      data: { storeId, complaintId, technicianId, purpose, reason, scheduledAt, createdBy: userId },
    });
    // The job moves to "Visit booked" where the rulebook allows (lib/job-flow).
    if (findTransition(current.status, 'scheduled', actor)) {
      await tx.complaint.update({ where: { id: complaintId }, data: { status: 'scheduled' } });
    }
    await logActivity(tx, complaintId, 'visit_scheduled', userId, {
      body: `Visit scheduled for ${scheduledAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}.`,
      visibleToPortal: true,
    });
  });
  await jobEvent(complaintId, 'visit_booked', scheduledAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }));
}

/**
 * Move a visit to a new date/time. A reason is required; the old and new
 * times are kept in VisitChange and the customer sees the change with its
 * reason (workflow spec §4.2, Pravin round 2).
 */
export async function rescheduleVisit(
  scope: StoreScope, visitId: string, newAt: Date, reason: string, userId: string | null,
  opts: { requestedByCustomer?: boolean } = {},
) {
  scopeForWrite(scope);
  const why = reason.trim();
  if (!why) throw new ComplaintError('Say why the visit is moving - the customer sees it.');
  if (Number.isNaN(newAt.getTime())) throw new ComplaintError('Choose the new date and time.');
  const visit = await db.serviceVisit.findFirst({
    // Either leg: a visit carries its own store now, and the complaint route
    // still finds any row the backfill could not reach.
    where: { id: visitId, OR: [scopeWhere(scope), { complaint: scopeWhere(scope) }] },
  });
  if (!visit) throw new ComplaintError('That visit is not in your scope.');
  if (visit.status !== 'scheduled') throw new ComplaintError('Only a visit that is still booked can be moved.');
  if (visit.scheduledAt.getTime() === newAt.getTime()) throw new ComplaintError('That is the same time as now.');

  const fmt = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  await db.$transaction(async (tx) => {
    await tx.visitChange.create({
      data: { visitId, fromAt: visit.scheduledAt, toAt: newAt, kind: 'reschedule', reason: why, changedBy: userId, requestedByCustomer: !!opts.requestedByCustomer },
    });
    await tx.serviceVisit.update({ where: { id: visitId }, data: { scheduledAt: newAt } });
    /*
      An installation visit has no complaint, so there is no complaint trail
      to write to and no job to notify. Guarded rather than made to work on
      both: the challan has its own paperwork, and inventing a complaint for
      an installation would put a fault on a customer's record that nobody
      ever reported.
    */
    if (visit.complaintId) {
      await logActivity(tx, visit.complaintId, 'visit_changed', userId, {
        body: `Visit moved from ${fmt(visit.scheduledAt)} to ${fmt(newAt)}. Reason: ${why}`,
        visibleToPortal: true,
      });
    }
  });
  if (visit.complaintId) await jobEvent(visit.complaintId, 'visit_changed', `now ${fmt(newAt)} (${why})`);
}

/** Call a booked visit off, with a reason (kept in the trail; the customer is told). */
export async function cancelVisit(scope: StoreScope, visitId: string, reason: string, userId: string | null) {
  scopeForWrite(scope);
  const why = reason.trim();
  if (!why) throw new ComplaintError('Say why the visit is cancelled - the customer sees it.');
  const visit = await db.serviceVisit.findFirst({
    // Either leg: a visit carries its own store now, and the complaint route
    // still finds any row the backfill could not reach.
    where: { id: visitId, OR: [scopeWhere(scope), { complaint: scopeWhere(scope) }] },
  });
  if (!visit) throw new ComplaintError('That visit is not in your scope.');
  if (visit.status !== 'scheduled') throw new ComplaintError('Only a visit that is still booked can be cancelled.');
  await db.$transaction(async (tx) => {
    await tx.visitChange.create({ data: { visitId, fromAt: visit.scheduledAt, toAt: null, kind: 'cancel', reason: why, changedBy: userId } });
    await tx.serviceVisit.update({ where: { id: visitId }, data: { status: 'cancelled' } });
    if (visit.complaintId) {
      await logActivity(tx, visit.complaintId, 'visit_changed', userId, { body: `Visit cancelled. Reason: ${why}`, visibleToPortal: true });
    }
  });
  if (visit.complaintId) await jobEvent(visit.complaintId, 'visit_changed', `cancelled (${why})`);
}

export async function completeVisit(
  scope: StoreScope, visitId: string, outcomeNote: string, userId: string | null,
  /**
   * The office marks a visit done from the complaint page (25 Oct 2026,
   * Vcare) when the technician did the work but never checked in on the
   * phone. Allowed only with a reason, which stays on the job.
   */
  officeOverride?: string | null,
) {
  scopeForWrite(scope);
  const visit = await db.serviceVisit.findFirst({
    // Either leg: a visit carries its own store now, and the complaint route
    // still finds any row the backfill could not reach.
    where: { id: visitId, OR: [scopeWhere(scope), { complaint: scopeWhere(scope) }] },
  });
  if (!visit) throw new ComplaintError('That visit is not in your scope.');
  // Done twice (a phone replaying its queue) is done once; a cancelled visit stays cancelled.
  if (visit.status === 'completed') return;
  if (visit.status === 'cancelled') throw new ComplaintError('This visit was cancelled. Schedule a new one instead.');

  // A field visit exists to fix something in person - it cannot be marked
  // done until the check-in below has proven the technician was actually
  // there. An info-collection call has nothing to check in against and is
  // unaffected.
  const override = officeOverride?.trim() || null;
  if (visit.purpose === 'field_visit' && !visit.checkedInAt && !override) {
    throw new ComplaintError('Check in at the site before marking this visit completed.');
  }
  const noCheckIn = visit.purpose === 'field_visit' && !visit.checkedInAt;

  /**
   * WHICH CONTRACT, IF ANY, THIS VISIT DRAWS FROM.
   *
   * Resolved at COMPLETION, not at scheduling: a visit booked and never made
   * must not consume a customer's allowance, because what they paid for is the
   * work. Stamped here so `visitAllowance` can count it - see the note on
   * `ServiceVisit.amcContractId`.
   *
   * Resolved against the day the work was actually done, so a visit made
   * inside a contract period stays attributed to it even if the contract has
   * since ended.
   *
   * Read BEFORE the transaction rather than inside it. This is a lookup, not a
   * write, and holding a pooled connection (connection_limit=1) open across
   * three more queries would serialise every other request behind it.
   */
  const complaint = visit.complaintId
    ? await db.complaint.findFirst({
      // Scoped although the visit above already was: a second filter costs
      // nothing and keeps this read honest on its own terms.
      where: { id: visit.complaintId, ...scopeWhere(scope) },
      select: { customerId: true, productId: true },
    })
    // An installation visit consumes nobody's contract allowance - a contract
    // covers servicing what the customer already owns, not fitting it.
    : null;

  let amcContractId: string | null = null;
  if (complaint) {
    const coverage = await resolveCoverageFor(scope, {
      customerId: complaint.customerId,
      productId: complaint.productId,
      onDate: new Date(),
    });
    // Only an AMC draws on an allowance. A warranty visit is the
    // manufacturer's problem and a chargeable one is the customer's.
    if (coverage.kind === 'amc') amcContractId = coverage.contractId;
  }

  await db.$transaction(async (tx) => {
    await tx.serviceVisit.update({
      where: { id: visitId },
      data: {
        status: 'completed',
        outcomeNote: outcomeNote.trim() || null,
        completedAt: new Date(),
        amcContractId,
      },
    });
    // Only a complaint has a trail to write to; an installation visit's
    // record is the challan's.
    if (visit.complaintId) {
      await logActivity(tx, visit.complaintId, 'visit_completed', userId, { body: outcomeNote.trim() || 'Visit completed.', visibleToPortal: true });
      if (noCheckIn) {
        await logActivity(tx, visit.complaintId, 'note', userId, { body: `Visit marked completed from the office without a check-in. Reason: ${override}` });
      }
    }
  });
}

export interface FieldCheckInInput {
  visitId: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
}

export interface FieldCheckInResult {
  withinRange: boolean;
  distanceMeters: number;
  radiusMeters: number;
}

/**
 * The technician proves they are physically at the site.
 *
 * GPS only - never a pasted Maps link, unlike the customer's own site
 * capture. A technician "sharing" a link for someone else's position would
 * make the whole check meaningless; the point of this specific capture is
 * live proof, not a description of somewhere.
 *
 * Never refuses to record a mismatch - see the note on checkGeofence in
 * attendance-geo.ts, same reasoning: the result is recorded so an owner can
 * see it, not silently enforced in a way that could strand a technician who
 * is honestly there but whose fix is 200 m off (a large site, a recorded
 * link to the wrong gate). completeVisit is what actually gates on a
 * check-in having happened at all, not on it having matched.
 */
export async function fieldCheckIn(
  scope: StoreScope, input: FieldCheckInInput, userId: string,
): Promise<FieldCheckInResult> {
  const storeId = scopeForWrite(scope);

  const visit = await db.serviceVisit.findFirst({
    where: { id: input.visitId, OR: [scopeWhere(scope), { complaint: scopeWhere(scope) }] },
    include: {
      complaint: { select: { id: true, siteLat: true, siteLng: true } },
      installationChallan: { select: { id: true, challanNo: true, siteLat: true, siteLng: true } },
    },
  });
  if (!visit) throw new ComplaintError('That visit is not in your scope.');
  if (visit.purpose !== 'field_visit') {
    throw new ComplaintError('Only a field visit needs a site check-in.');
  }
  /*
    AN INSTALLATION VISIT CANNOT BE CHECKED IN YET (7 Oct 2026).
    
    Check-in measures the technician against the SITE, and the site location
    lives on the complaint - captured by GPS or a pasted Maps link when the
    complaint is raised. A new installation has no complaint, so there is no
    recorded location to measure against, and checking in against the
    customer's billing address would be a number that looks like proof and
    is not. Refused in plain words until the order's site is captured the
    same way; that is the next piece, not a silent pass.
  */
  /*
    G-21 (10 Oct 2026): an installation challan raised from a sales order now
    carries the site pin the office captured, so its visit checks in against
    that. A challan without one (older ones, or the pin was skipped) still
    says so plainly instead of pretending.
  */
  const challan = visit.installationChallan;
  const site = visit.complaint ?? (challan ? { id: null, siteLat: challan.siteLat, siteLng: challan.siteLng } : null);
  if (!site) throw new ComplaintError('That visit has nothing to check in against.');
  if (site.siteLat === null || site.siteLng === null) {
    throw new ComplaintError(challan && !visit.complaint
      ? 'This installation has no site location saved - mark the visit done with a note instead.'
      : 'This complaint has no site location to check in against.');
  }

  const policy = await db.attendancePolicy.findUnique({ where: { storeId }, select: { defaultRadiusMeters: true } });
  const radiusMeters = policy?.defaultRadiusMeters ?? 150;

  const distanceMeters = metresBetween(
    { lat: input.lat, lng: input.lng },
    { lat: Number(site.siteLat), lng: Number(site.siteLng) },
  );
  const withinRange = distanceMeters <= radiusMeters;
  const now = new Date();

  await db.$transaction(async (tx) => {
    await tx.serviceVisit.update({
      where: { id: input.visitId },
      data: { checkedInAt: now, checkInDistanceM: distanceMeters, checkInWithinRange: withinRange },
    });
    await tx.attendanceEvent.create({
      data: {
        storeId, userId, lat: input.lat, lng: input.lng, accuracyM: input.accuracyM,
        source: 'field_check_in', complaintId: site.id, recordedAt: now,
      },
    });
    // A complaint keeps the check-in in its activity log; a challan has the visit row itself.
    if (site.id) {
      await logActivity(tx, site.id, 'field_check_in', userId, {
        body: withinRange
          ? `Technician checked in at the site (${distanceMeters} m away).`
          : `Technician checked in ${distanceMeters} m from the recorded site location.`,
      });
    }
  });

  return { withinRange, distanceMeters, radiusMeters };
}

// --------------------------------------------------------- repair challans

export interface RepairChallanRow {
  id: string;
  challanNo: string;
  complaintId: string;
  complaintNo: string;
  /** The customer, so the name opens their page (G-35). */
  customerId: string;
  customerName: string;
  productName: string;
  qty: number;
  costPaise: number;
  dispatchedAt: Date;
  /**
   * Added 23 Sep 2026 with the Vcare migration. `status` and
   * `physicalChallanNo` existed in the source system and had nowhere to live
   * here, so 6,819 migrated rows had lost both. `legacy_unknown` means the row
   * predates the column and its real state could not be recovered - the UI
   * reads that as "not recorded" rather than implying anything.
   */
  status: string;
  physicalChallanNo: string | null;
  technicianRemark: string | null;
  legacyRef: string | null;
  /** Who the challan was assigned to (restored from the old app, 26 Sep 2026). */
  assigneeIds: string[];
  assigneeNames: string[];

  /**
   * Whether this customer holds live maintenance cover.
   *
   * Worth showing HERE specifically: a repair challan is a part being replaced
   * at the customer's expense or ours, and that is the question the challan
   * settles. The list approximation, same caveat as on the complaints list -
   * it knows the customer has a contract, not that this part is covered.
   */
  amcContractNo: string | null;
  amcItemised: boolean;
}

export async function listRepairChallans(scope: StoreScope): Promise<RepairChallanRow[]> {
  const rows = await db.repairChallan.findMany({
    where: scopeWhere(scope),
    include: {
      product: { select: { productName: true } },
      complaint: {
        select: {
          complaintNo: true, customerId: true,
          customer: { select: { firstName: true, lastName: true, companyName: true } },
        },
      },
    },
    orderBy: { dispatchedAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  // ONE query for the whole list - see `customersWithCover`.
  const cover = await customersWithCover(scope);
  const assigneeIds = [...new Set(rows.flatMap((r) => r.assigneeIds))];
  const who = new Map((assigneeIds.length
    ? await db.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, fullName: true } })
    : []).map((u) => [u.id, u.fullName]));

  return rows.map((r) => ({
    id: r.id, challanNo: r.challanNo, complaintId: r.complaintId, complaintNo: r.complaint.complaintNo,
    customerId: r.complaint.customerId,
    customerName: r.complaint.customer.companyName || [r.complaint.customer.firstName, r.complaint.customer.lastName].filter(Boolean).join(' '),
    productName: r.product.productName, qty: r.qty, costPaise: r.costPaise, dispatchedAt: r.dispatchedAt,
    status: r.status, physicalChallanNo: r.physicalChallanNo,
    technicianRemark: r.technicianRemark, legacyRef: r.legacyRef,
    assigneeIds: r.assigneeIds,
    assigneeNames: r.assigneeIds.map((id) => who.get(id)).filter((n): n is string => !!n),
    amcContractNo: cover.get(r.complaint.customerId)?.contractNo ?? null,
    amcItemised: cover.get(r.complaint.customerId)?.itemised ?? false,
  }));
}

// Repair challans: history only since 28 Sep 2026. New parts go through the
// job's own challan (server/job-challans: approval, then a GDN). The old
// create path moved stock at once with no approval, so it is gone.

/** People to offer in the assignment dropdown: everyone active in the
 * branch, the service team first (lib/technicians - service department from
 * the Service Team setting or the name guess, CALL-6, or a technician-type
 * role). It used to be the service department ONLY (27 Sep 2026). */
export async function listTechnicians(scope: StoreScope): Promise<AssignablePerson[]> {
  const serviceDeptIds = new Set((await serviceDepartments(scope)).serviceIds);
  const storeIds = scope.kind === 'single' ? [scope.storeId] : scope.storeIds;

  const people = await db.user.findMany({
    where: {
      isActive: true,
      /**
       * ALWAYS scoped, including in All Company mode.
       *
       * This previously read `scope.kind === 'all' ? {} : {...}`, which dropped
       * the filter entirely for All Company and — because `User` has no
       * `storeId` column to fall back on — returned every active user in the
       * database. A tenant's Assign-technician dropdown listed other tenants'
       * staff and would happily assign a complaint to one of them. Found
       * 23 Sep 2026 while provisioning a migrated client's logins.
       *
       * `scopeWhere` is the right tool precisely because All Company is a
       * widened set and not an absent one (`store-scope.ts` rule 2), so the
       * relation filter works unchanged for both scope kinds. `User` is not
       * covered by `store-scope-coverage.test.ts`, which walks models carrying
       * a `storeId` column - relation-scoped models like this one need the
       * scoping written by hand, so prefer `scopeWhere` over an inline literal.
       */
      ...userInScope(scope),
    },
    select: {
      id: true, fullName: true, departmentId: true,
      storeRoles: { where: { storeId: { in: storeIds } }, select: { role: { select: { name: true } } } },
    },
    orderBy: { fullName: 'asc' },
    take: LIST_MAX_ROWS,
  });
  return orderAssignable(people.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    serviceTeam: isServiceTeamMember(p.departmentId, p.storeRoles.map((r) => r.role.name), serviceDeptIds),
  })));
}

// ------------------------------------------------ repair challan: one + edit

export interface RepairChallanDetail extends RepairChallanRow {
  productId: string;
  note: string | null;
  customerId: string;
  customerPhone: string;
  createdByName: string | null;
  createdAt: Date;
  /** Units this challan has actually taken out of stock, per product (StockMovement). */
  stockMoved: { productId: string; productName: string; qty: number }[];
}

/** One repair challan, for its own page (health check I2 / SVC-3). */
export async function getRepairChallanDetail(scope: StoreScope, id: string): Promise<RepairChallanDetail | null> {
  const r = await db.repairChallan.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      product: { select: { productName: true } },
      complaint: {
        select: {
          complaintNo: true, customerId: true,
          customer: { select: { firstName: true, lastName: true, companyName: true, phone: true } },
        },
      },
    },
  });
  if (!r) return null;
  const [moves, creator, cover] = await Promise.all([
    db.stockMovement.groupBy({
      by: ['productId'], where: { storeId: r.storeId, refType: 'RepairChallan', refId: r.id }, _sum: { qty: true },
    }),
    r.createdBy ? db.user.findUnique({ where: { id: r.createdBy }, select: { fullName: true } }) : Promise.resolve(null),
    customersWithCover(scope),
  ]);
  const names = new Map((await db.product.findMany({
    where: { id: { in: moves.map((m) => m.productId) }, storeId: r.storeId }, select: { id: true, productName: true },
  })).map((p) => [p.id, p.productName]));
  return {
    id: r.id, challanNo: r.challanNo, complaintId: r.complaintId, complaintNo: r.complaint.complaintNo,
    customerName: r.complaint.customer.companyName || [r.complaint.customer.firstName, r.complaint.customer.lastName].filter(Boolean).join(' '),
    customerId: r.complaint.customerId, customerPhone: r.complaint.customer.phone,
    productId: r.productId, productName: r.product.productName, qty: r.qty, costPaise: r.costPaise,
    dispatchedAt: r.dispatchedAt, status: r.status, physicalChallanNo: r.physicalChallanNo,
    technicianRemark: r.technicianRemark, legacyRef: r.legacyRef, note: r.note,
    assigneeIds: r.assigneeIds,
    assigneeNames: r.assigneeIds.length
      ? (await db.user.findMany({ where: { id: { in: r.assigneeIds } }, select: { fullName: true } })).map((u) => u.fullName)
      : [],
    amcContractNo: cover.get(r.complaint.customerId)?.contractNo ?? null,
    amcItemised: cover.get(r.complaint.customerId)?.itemised ?? false,
    createdByName: creator?.fullName ?? null, createdAt: r.createdAt,
    stockMoved: moves
      .filter((m) => (m._sum.qty ?? 0) !== 0)
      .map((m) => ({ productId: m.productId, productName: names.get(m.productId) ?? '?', qty: -(m._sum.qty ?? 0) })),
  };
}

export interface UpdateChallanInput {
  id: string;
  productId: string;
  qty: number;
  costPaise: number;
  dispatchedAt: Date;
  status: string;
  physicalChallanNo: string | null;
  technicianRemark: string | null;
  note: string | null;
}

export const REPAIR_CHALLAN_STATUSES = ['pending', 'work_done', 'approved', 'rejected', 'legacy_unknown'] as const;

/**
 * Correct a repair challan after it was saved (health check SVC-3,
 * decision 2 of 25 Sep 2026: work records are editable, with a history).
 *
 * STOCK. A challan that took stock out keeps the books right: the difference
 * between what it has already moved (its StockMovement rows) and what it
 * should now have moved is posted as a correcting movement - never by
 * rewriting old movements. A migrated challan that never moved stock is
 * left alone; changing its quantity changes the record, not the shelf.
 * The audit trigger records every field changed; the complaint's timeline
 * gets one line saying what changed.
 */
export async function updateRepairChallan(scope: StoreScope, input: UpdateChallanInput, userId: string | null): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (input.qty <= 0) throw new ComplaintError('Quantity must be at least 1.');
  if (input.costPaise < 0) throw new ComplaintError('Cost cannot be negative.');
  if (!(REPAIR_CHALLAN_STATUSES as readonly string[]).includes(input.status)) throw new ComplaintError('Choose a valid status.');

  const current = await db.repairChallan.findFirst({ where: { id: input.id, storeId }, include: { product: { select: { productName: true } } } });
  if (!current) throw new ComplaintError('That challan is not in your scope.');
  // Approving / rejecting finished work: same approver check as My Reminders & Requests (27 Sep 2026).
  if (current.status === 'work_done' && (input.status === 'approved' || input.status === 'rejected') && userId) {
    const { screenDecision } = await import('./approval-hooks');
    await screenDecision(scope, 'repair_challan', input.id, input.status, userId, null);
  }
  const product = await db.product.findFirst({ where: { id: input.productId, storeId }, select: { id: true, productName: true } });
  if (!product) throw new ComplaintError('That product is not in your scope.');

  await db.$transaction(async (tx) => {
    const moved = await tx.stockMovement.groupBy({
      by: ['productId'], where: { storeId, refType: 'RepairChallan', refId: current.id }, _sum: { qty: true },
    });
    const movedStock = moved.some((m) => (m._sum.qty ?? 0) !== 0);
    if (movedStock && (current.productId !== input.productId || current.qty !== input.qty)) {
      const want = new Map<string, number>([[input.productId, -input.qty]]);
      const have = new Map(moved.map((m) => [m.productId, m._sum.qty ?? 0]));
      const ids = new Set([...want.keys(), ...have.keys()]);
      await applyMovements(tx, storeId, userId, [...ids].map((pid) => ({
        productId: pid,
        qty: (want.get(pid) ?? 0) - (have.get(pid) ?? 0),
        reason: 'repair_replacement' as const,
        refType: 'RepairChallan', refId: current.id, refNo: current.challanNo,
        note: 'Correction after the challan was edited',
      })));
    }

    await tx.repairChallan.update({
      where: { id: current.id },
      data: {
        productId: input.productId, qty: input.qty, costPaise: input.costPaise, dispatchedAt: input.dispatchedAt,
        status: input.status, physicalChallanNo: input.physicalChallanNo?.trim() || null,
        technicianRemark: input.technicianRemark?.trim() || null, note: input.note?.trim() || null,
      },
    });

    const changes: string[] = [];
    if (current.productId !== input.productId) changes.push(`product ${current.product.productName} → ${product.productName}`);
    if (current.qty !== input.qty) changes.push(`qty ${current.qty} → ${input.qty}`);
    if (current.costPaise !== input.costPaise) changes.push(`cost ₹${current.costPaise / 100} → ₹${input.costPaise / 100}`);
    if (current.status !== input.status) changes.push(`status ${current.status} → ${input.status}`);
    if ((current.physicalChallanNo ?? '') !== (input.physicalChallanNo?.trim() ?? '')) changes.push('paper slip number');
    if (changes.length) {
      await logActivity(tx, current.complaintId, 'note', userId, {
        body: `Repair challan ${current.challanNo} edited: ${changes.join(', ')}.`, visibleToPortal: false,
      });
    }
  });
  await postRepairChallanCost(scope, current.id, userId).catch((e) => console.error('[repair challan] cost re-posting failed', e));
}

/**
 * The cost of the parts a repair challan sent out (health check ACC-1).
 *
 * Stock left the shelf but nothing reached the books, so the stock value
 * stayed overstated. Now: Warranty Replacement Cost when the repair was
 * covered (AMC or warranty), Service Parts Consumed when the customer pays,
 * against Inventory, at stock cost. Re-run after an edit: the previous
 * posting is reversed and the current one posted, so the history shows both.
 * Only a challan that actually moved stock is booked.
 */
export async function postRepairChallanCost(scope: StoreScope, challanId: string, userId: string | null): Promise<void> {
  const c = await db.repairChallan.findFirst({
    where: { id: challanId, ...scopeWhere(scope) },
    select: { id: true, storeId: true, challanNo: true, productId: true, qty: true, dispatchedAt: true, complaint: { select: { customerId: true, productId: true } } },
  });
  if (!c) return;
  const who = userId ?? 'system';

  const previous = await db.journalEntry.findMany({
    where: { ...scopeWhere(scope), sourceType: 'repair_challan', sourceId: c.id, reversedBy: null, reversalOfId: null },
    select: { id: true },
  });
  for (const e of previous) await reverseJournalEntry(scope, e.id, who, `Repair challan ${c.challanNo} was edited`);

  const moved = await db.stockMovement.aggregate({ where: { storeId: c.storeId, refType: 'RepairChallan', refId: c.id }, _sum: { qty: true } });
  const qtyOut = -(moved._sum.qty ?? 0);
  if (qtyOut <= 0) return;
  const unit = (await costsFor(scope, [c.productId])).get(c.productId)?.unitCostPaise ?? 0;
  const cost = unit * qtyOut;
  if (cost <= 0) return;
  const cover = await resolveCoverageFor(scope, { customerId: c.complaint.customerId, productId: c.complaint.productId, onDate: c.dispatchedAt });
  await postJournalEntry(scope, {
    entryDate: c.dispatchedAt,
    description: `Parts on repair challan ${c.challanNo} (${cover.kind === 'chargeable' ? 'chargeable' : 'covered'})`,
    sourceType: 'repair_challan',
    sourceId: c.id,
    lines: [
      { accountCode: repairCostAccount(cover.kind), debitPaise: cost },
      { accountCode: '1200', creditPaise: cost },
    ],
  }, who);
}
