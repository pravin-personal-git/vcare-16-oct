import 'server-only';
import { db } from './db';
import { createReceipt, type ReceiptMethod } from './receipts';
import { scopeWhere, scopeForWrite, userInScope, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * Installation challans - the signed work slip for a NEW installation.
 *
 * WHY A SEPARATE MODULE FROM `complaints.ts`
 *
 * The migrated client ran two document chains that both end at one invoice:
 * service (Complaint -> repair challan) and installation (Lead -> Quotation ->
 * SalesOrder -> install challan). `complaints.ts` owns the first. This owns the
 * second. They share a status vocabulary and nothing else - an installation
 * challan has no complaint, and a repair challan has no sales order.
 *
 * THE APPROVAL LOOP
 *
 * pending -> work_done -> approved | rejected, and a rejected slip can be
 * resubmitted as work_done. This is the office's check on field work: the
 * person who did the job marks it done, the office accepts it or sends it back.
 * It is deliberately NOT routed through `ApprovalChain` (CLAUDE.md decision 7),
 * which exists for threshold-and-role chains over money; this is one step with
 * no thresholds.
 *
 * `legacy_unknown` is the fifth value and means "this row predates the status
 * column and its real state could not be recovered". It is not a state anything
 * transitions INTO - only out of.
 */

export class InstallationChallanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallationChallanError';
  }
}

export const CHALLAN_STATUSES = ['pending', 'work_done', 'approved', 'rejected', 'legacy_unknown'] as const;
export type ChallanStatus = (typeof CHALLAN_STATUSES)[number];

/**
 * What may follow what. A rejected slip goes back to `work_done` rather than
 * to `pending`, because the work was done - it is the sign-off that failed.
 * `legacy_unknown` can go anywhere: somebody is correcting a historical record
 * we could not recover, and refusing that would leave 5,627 rows permanently
 * stuck.
 */
const ALLOWED: Record<ChallanStatus, ChallanStatus[]> = {
  pending: ['work_done', 'rejected'],
  work_done: ['approved', 'rejected'],
  rejected: ['work_done'],
  approved: [],
  legacy_unknown: ['pending', 'work_done', 'approved', 'rejected'],
};

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  work_done: 'Work done',
  approved: 'Approved',
  rejected: 'Rejected',
  legacy_unknown: 'Not recorded',
};

export interface InstallationChallanRow {
  id: string;
  challanNo: string;
  legacyRef: string | null;
  status: string;
  physicalChallanNo: string | null;
  technicianRemark: string | null;
  note: string | null;
  /** Where it is fitted (G-21): the words, and the pin for a map link. */
  siteLocation: string | null;
  sitePin: { lat: number; lng: number } | null;
  /** Billed (G-30): the invoice it is on - money is then taken against the invoice, not here. */
  isInvoiced: boolean;
  invoice: { id: string; invoiceNo: string } | null;
  rejectionReason: string | null;
  salesOrderId: string | null;
  orderNo: string | null;
  /** The customer, through the order (G-35). Null with no order. */
  partyId: string | null;
  customerName: string | null;
  itemCount: number;
  totalQty: number;
  assignees: string[];
  /** Same order as `assignees` - for the person filter (F1). */
  assigneeIds: string[];
  dispatchedAt: Date;
  completedAt: Date | null;
}

export async function listInstallationChallans(
  scope: StoreScope,
  opts: { status?: string } = {},
): Promise<InstallationChallanRow[]> {
  const rows = await db.installationChallan.findMany({
    where: { ...scopeWhere(scope), ...(opts.status ? { status: opts.status } : {}) },
    include: {
      salesOrder: { select: { orderNo: true, customerName: true, partyId: true } },
      customer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
      invoiceSources: { where: { invoice: { lifecycle: { not: 'cancelled' } } }, take: 1, select: { invoice: { select: { id: true, invoiceNo: true } } } },
      items: { select: { qty: true } },
      assignees: { include: { user: { select: { fullName: true } } } },
    },
    orderBy: { dispatchedAt: 'desc' },
    take: LIST_MAX_ROWS,
  });

  return rows.map((r) => ({
    id: r.id,
    challanNo: r.challanNo,
    legacyRef: r.legacyRef,
    status: r.status,
    physicalChallanNo: r.physicalChallanNo,
    technicianRemark: r.technicianRemark,
    note: r.note,
    siteLocation: r.siteLocation,
    isInvoiced: r.isInvoiced,
    invoice: r.invoiceSources[0]?.invoice ?? null,
    sitePin: r.siteLat !== null && r.siteLng !== null ? { lat: Number(r.siteLat), lng: Number(r.siteLng) } : null,
    rejectionReason: r.rejectionReason,
    salesOrderId: r.salesOrderId,
    orderNo: r.salesOrder?.orderNo ?? null,
    partyId: r.customer?.id ?? r.salesOrder?.partyId ?? null,
    customerName: (r.customer && (r.customer.companyName || [r.customer.firstName, r.customer.lastName].filter(Boolean).join(' '))) || r.salesOrder?.customerName || null,
    itemCount: r.items.length,
    totalQty: r.items.reduce((s, i) => s + i.qty, 0),
    assignees: r.assignees.map((a) => a.user.fullName),
    assigneeIds: r.assignees.map((a) => a.userId),
    dispatchedAt: r.dispatchedAt,
    completedAt: r.completedAt,
  }));
}

export interface InstallationChallanDetail extends InstallationChallanRow {
  termsBody: string | null;
  assigneeIds: string[];
  items: {
    id: string; srNo: number; productId: string | null; productName: string; barcode: string | null;
    qty: number; unit: string | null;
  }[];
}

export async function getInstallationChallanDetail(
  scope: StoreScope,
  id: string,
): Promise<InstallationChallanDetail | null> {
  const c = await db.installationChallan.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      salesOrder: { select: { orderNo: true, customerName: true, partyId: true } },
      invoiceSources: { where: { invoice: { lifecycle: { not: 'cancelled' } } }, take: 1, select: { invoice: { select: { id: true, invoiceNo: true } } } },
      items: { orderBy: { srNo: 'asc' } },
      assignees: { include: { user: { select: { fullName: true } } } },
    },
  });
  if (!c) return null;

  return {
    id: c.id,
    challanNo: c.challanNo,
    legacyRef: c.legacyRef,
    status: c.status,
    physicalChallanNo: c.physicalChallanNo,
    technicianRemark: c.technicianRemark,
    note: c.note,
    siteLocation: c.siteLocation,
    isInvoiced: c.isInvoiced,
    invoice: c.invoiceSources[0]?.invoice ?? null,
    sitePin: c.siteLat !== null && c.siteLng !== null ? { lat: Number(c.siteLat), lng: Number(c.siteLng) } : null,
    rejectionReason: c.rejectionReason,
    salesOrderId: c.salesOrderId,
    orderNo: c.salesOrder?.orderNo ?? null,
    partyId: c.salesOrder?.partyId ?? null,
    customerName: c.salesOrder?.customerName ?? null,
    itemCount: c.items.length,
    totalQty: c.items.reduce((s, i) => s + i.qty, 0),
    assignees: c.assignees.map((a) => a.user.fullName),
    assigneeIds: c.assignees.map((a) => a.userId),
    dispatchedAt: c.dispatchedAt,
    completedAt: c.completedAt,
    termsBody: c.termsBody,
    items: c.items.map((i) => ({
      id: i.id, srNo: i.srNo, productId: i.productId, productName: i.productName,
      barcode: i.barcode, qty: i.qty, unit: i.unit,
    })),
  };
}

export interface StatusChangeInput {
  id: string;
  to: ChallanStatus;
  /** Required when moving to `rejected` - a slip sent back without a reason is a slip nobody can act on. */
  reason?: string | null;
}

export async function setInstallationChallanStatus(
  scope: StoreScope,
  input: StatusChangeInput,
  userId: string | null,
): Promise<void> {
  const storeId = scopeForWrite(scope);

  if (!CHALLAN_STATUSES.includes(input.to)) {
    throw new InstallationChallanError('That is not a status this document can hold.');
  }
  if (input.to === 'legacy_unknown') {
    throw new InstallationChallanError(
      '"Not recorded" describes a historical record whose state was lost. It cannot be set by hand.',
    );
  }

  const current = await db.installationChallan.findFirst({
    where: { id: input.id, storeId },
    select: { status: true, challanNo: true },
  });
  if (!current) throw new InstallationChallanError('That challan is not in your scope.');

  const from = (current.status as ChallanStatus) ?? 'pending';
  if (from === input.to) return;
  if (!ALLOWED[from]?.includes(input.to)) {
    throw new InstallationChallanError(
      `A challan that is "${STATUS_LABEL[from] ?? from}" cannot move to "${STATUS_LABEL[input.to]}".`,
    );
  }

  const reason = input.reason?.trim() || null;
  if (input.to === 'rejected' && !reason) {
    throw new InstallationChallanError('Say why it is being sent back, so the technician knows what to fix.');
  }
  // Approving / sending back a finished challan: same approver check as My
  // Reminders & Requests when a request is open (27 Sep 2026).
  if (from === 'work_done' && (input.to === 'approved' || input.to === 'rejected') && userId) {
    const { screenDecision } = await import('./approval-hooks');
    await screenDecision(scope, 'installation_challan', input.id, input.to, userId, reason);
  }

  await db.installationChallan.update({
    where: { id: input.id },
    data: {
      status: input.to,
      // Only an approval records who approved and when. A rejection records
      // the reason instead, and clears any earlier approval so the two can
      // never both appear to be true.
      approvedBy: input.to === 'approved' ? userId : null,
      approvedAt: input.to === 'approved' ? new Date() : null,
      rejectionReason: input.to === 'rejected' ? reason : null,
      completedAt: input.to === 'approved' ? new Date() : null,
      // Work done is when the customer has it (27 Oct 2026): the day the
      // warranty starts, and the day it was handed over.
      ...(input.to === 'work_done' ? { handoverAt: new Date() } : {}),
    },
  });
  if (input.to === 'work_done') {
    // Work done means everything on it is fitted - and the warranty on every
    // serial fitted here that Atlas knows starts today (once only).
    await db.installationChallanItem.updateMany({ where: { challanId: input.id, fitStatus: 'to_fit' }, data: { fitStatus: 'fitted' } });
    const items = await db.installationChallanItem.findMany({ where: { challanId: input.id }, select: { serialNo: true, barcode: true, stockUnitId: true } });
    const serials = items.map((i) => (i.serialNo ?? i.barcode)?.trim()).filter((x): x is string => !!x);
    const unitIds = items.map((i) => i.stockUnitId).filter((x): x is string => !!x);
    if (serials.length || unitIds.length) {
      await db.stockUnit.updateMany({
        where: { storeId, warrantyFrom: null, OR: [{ id: { in: unitIds } }, { serialNo: { in: serials } }] },
        data: { warrantyFrom: new Date() },
      });
    }
  }
  // The stage follows whatever happened, whoever did it - the page, My Desk or the phone.
  const { syncInstallationStage } = await import('./installation-page');
  await syncInstallationStage(input.id, userId);
  // Installed: AMCs sold with this equipment now start today (10 Oct 2026).
  if (input.to === 'approved') {
    const { alignSaleAmcsToInstall } = await import('./amc');
    await alignSaleAmcsToInstall(storeId, input.id).catch((e) => console.error('[amc] align to install failed', e));
  }
  // No approval request on Work done any more (27 Oct 2026): billing the
  // installation - or Don't bill - is the office's sign-off.
}

export interface PaperSlipInput {
  id: string;
  physicalChallanNo: string | null;
  technicianRemark: string | null;
  note: string | null;
}

/**
 * The paper slip number and the two free-text fields.
 *
 * Kept editable after the fact on purpose: the number comes off a pre-printed
 * book at the customer's site and is routinely filled in when the slip gets
 * back to the office. It was the most-used field in the source system (94% of
 * installation challans, 96% of repair challans) and Atlas had nowhere to put
 * it until 23 Sep 2026.
 */
export async function updateInstallationChallanPaperwork(
  scope: StoreScope,
  input: PaperSlipInput,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const found = await db.installationChallan.findFirst({ where: { id: input.id, storeId }, select: { id: true } });
  if (!found) throw new InstallationChallanError('That challan is not in your scope.');

  await db.installationChallan.update({
    where: { id: input.id },
    data: {
      physicalChallanNo: input.physicalChallanNo?.trim() || null,
      technicianRemark: input.technicianRemark?.trim() || null,
      note: input.note?.trim() || null,
    },
  });
}

export interface CreateInstallationChallanInput {
  salesOrderId: string | null;
  /** Required unless an order is chosen, whose customer it then is (27 Oct 2026). */
  customerId?: string | null;
  /** The customer's saved site (30 Oct 2026); with several sites one must be chosen, or `otherPlace`. */
  siteId?: string | null;
  otherPlace?: boolean;
  /** Words for the place - the address for "another place", or gate / floor for a saved site. */
  siteLocation?: string | null;
  /** A pin captured on the form for "another place". */
  siteLat?: number | null;
  siteLng?: number | null;
  /** The survey visit this job came from - linked to the new challan. */
  surveyVisitId?: string | null;
  physicalChallanNo: string | null;
  technicianRemark: string | null;
  note: string | null;
  assigneeIds: string[];
  items: { productId: string | null; productName: string; barcode: string | null; qty: number; unit: string | null; salesOrderItemId?: string | null }[];
}

export async function createInstallationChallan(
  scope: StoreScope,
  input: CreateInstallationChallanInput,
  userId: string | null,
): Promise<string> {
  const storeId = scopeForWrite(scope);

  if (input.items.length === 0) {
    throw new InstallationChallanError('Add at least one product - a slip with nothing on it records nothing.');
  }
  if (input.items.some((i) => i.qty <= 0)) {
    throw new InstallationChallanError('Every line needs a quantity of at least 1.');
  }

  let customerId = input.customerId ?? null;
  let fallback: string | null = null;
  if (input.salesOrderId) {
    const order = await db.salesOrder.findFirst({ where: { id: input.salesOrderId, storeId }, select: { id: true, partyId: true, shippingAddress: true } });
    if (!order) throw new InstallationChallanError('That sales order is not in your scope.');
    if (customerId && order.partyId && customerId !== order.partyId) throw new InstallationChallanError('That sales order is for a different customer.');
    customerId ??= order.partyId;
    fallback = order.shippingAddress;
  }
  if (!customerId) throw new InstallationChallanError('Choose the customer.');
  const cust = await db.party.findFirst({ where: { id: customerId, storeId }, select: { id: true, addressLine1: true } });
  if (!cust) throw new InstallationChallanError('That customer is not in your scope.');
  const survey = input.surveyVisitId
    ? await db.serviceVisit.findFirst({ where: { id: input.surveyVisitId, storeId, reason: 'installation_survey' }, select: { id: true, customerId: true, installationChallanId: true, siteId: true } })
    : null;
  if (input.surveyVisitId && !survey) throw new InstallationChallanError('That survey is not in your scope.');
  if (survey?.installationChallanId) throw new InstallationChallanError('That survey already belongs to another challan.');

  /*
    WHERE IT IS FITTED (30 Oct 2026, Vcare ICH-DURG001-2026-0004): the site the
    office chose - or the survey's - never the customer's main address by
    default. Several sites and none chosen is refused (server/sites jobSite).
  */
  const { jobSite, SiteError } = await import('./sites');
  let place;
  try {
    place = await jobSite(storeId, customerId, {
      siteId: input.siteId ?? (input.otherPlace ? null : survey?.siteId ?? null),
      otherPlace: input.otherPlace, text: input.siteLocation,
    });
  } catch (e) {
    if (e instanceof SiteError) throw new InstallationChallanError(e.message);
    throw e;
  }
  const pinned = input.siteLat != null && input.siteLng != null;
  // "Another place" with no words: the order's / customer's address only when no pin says otherwise.
  const siteLocation = place.siteLocation ?? (place.siteId || pinned ? null : fallback ?? cust.addressLine1);

  // Assignees must belong to this store - the same relation-scoping every user
  // query in this codebase uses, and the reason `userInScope` exists.
  if (input.assigneeIds.length > 0) {
    const valid = await db.user.findMany({
      where: { id: { in: input.assigneeIds }, ...userInScope(scope) },
      select: { id: true },
    });
    if (valid.length !== input.assigneeIds.length) {
      throw new InstallationChallanError('One of those people is not in this branch.');
    }
  }

  const challanNo = await allocateDocumentNumber(storeId, 'ICH');

  return db.$transaction(async (tx) => {
    const challan = await tx.installationChallan.create({
      data: {
        storeId,
        challanNo,
        salesOrderId: input.salesOrderId,
        customerId,
        siteId: place.siteId,
        siteLocation,
        siteLat: place.siteLat ?? (pinned ? input.siteLat : null),
        siteLng: place.siteLng ?? (pinned ? input.siteLng : null),
        status: 'pending',
        stage: input.assigneeIds.length ? 'technician' : 'raised',
        physicalChallanNo: input.physicalChallanNo?.trim() || null,
        technicianRemark: input.technicianRemark?.trim() || null,
        note: input.note?.trim() || null,
        createdBy: userId,
      },
    });

    await tx.installationChallanItem.createMany({
      data: input.items.map((i, idx) => ({
        challanId: challan.id,
        productId: i.productId,
        productName: i.productName,
        barcode: i.barcode?.trim() || null,
        qty: i.qty,
        unit: i.unit,
        srNo: idx + 1,
        salesOrderItemId: i.salesOrderItemId ?? null,
      })),
    });

    if (input.assigneeIds.length > 0) {
      await tx.installationChallanAssignee.createMany({
        data: [...new Set(input.assigneeIds)].map((userIdToAssign) => ({
          challanId: challan.id,
          userId: userIdToAssign,
        })),
        skipDuplicates: true,
      });
    }

    if (survey) {
      await tx.serviceVisit.update({ where: { id: survey.id }, data: { installationChallanId: challan.id } });
    }

    return challan.id;
  });
}


export interface UpdateInstallationChallanInput extends CreateInstallationChallanInput {
  id: string;
  dispatchedAt: Date;
  /** Existing lines keep their id (and any serial-unit link); lines without one are new. */
  items: (CreateInstallationChallanInput['items'][number] & { id?: string | null })[];
}

/**
 * Correct everything on a saved installation challan - order, lines,
 * technicians, paperwork, date (health check SVC-3; decision 2 of 25 Sep
 * 2026: work records are editable, with a history). An installation challan
 * moves no stock, so nothing else needs correcting; the audit trigger keeps
 * every before/after value. An approved slip is locked - send it back first.
 */
export async function updateInstallationChallan(
  scope: StoreScope, input: UpdateInstallationChallanInput, userId: string | null,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const current = await db.installationChallan.findFirst({
    where: { id: input.id, storeId }, select: { id: true, status: true, isInvoiced: true, notBilledReason: true, items: { select: { id: true } } },
  });
  if (!current) throw new InstallationChallanError('That challan is not in your scope.');
  if (current.isInvoiced || current.notBilledReason) {
    throw new InstallationChallanError('This installation is billed, so it is locked.');
  }
  if (input.items.length === 0) throw new InstallationChallanError('Add at least one product - a slip with nothing on it records nothing.');
  if (input.items.some((i) => i.qty <= 0)) throw new InstallationChallanError('Every line needs a quantity of at least 1.');
  if (Number.isNaN(input.dispatchedAt.getTime())) throw new InstallationChallanError('Choose a valid date.');
  let customerId = input.customerId ?? undefined;
  if (input.salesOrderId) {
    const order = await db.salesOrder.findFirst({ where: { id: input.salesOrderId, storeId }, select: { id: true, partyId: true } });
    if (!order) throw new InstallationChallanError('That sales order is not in your scope.');
    customerId ??= order.partyId ?? undefined;
  }
  if (customerId) {
    const cust = await db.party.findFirst({ where: { id: customerId, storeId }, select: { id: true } });
    if (!cust) throw new InstallationChallanError('That customer is not in your scope.');
  }
  const assignees = [...new Set(input.assigneeIds)];
  if (assignees.length > 0) {
    const valid = await db.user.findMany({ where: { id: { in: assignees }, ...userInScope(scope) }, select: { id: true } });
    if (valid.length !== assignees.length) throw new InstallationChallanError('One of those people is not in this branch.');
  }
  const known = new Set(current.items.map((i) => i.id));
  const keep = input.items.filter((i) => i.id && known.has(i.id));

  await db.$transaction(async (tx) => {
    await tx.installationChallan.update({
      where: { id: current.id },
      data: {
        salesOrderId: input.salesOrderId, dispatchedAt: input.dispatchedAt,
        ...(customerId ? { customerId } : {}),
        physicalChallanNo: input.physicalChallanNo?.trim() || null,
        technicianRemark: input.technicianRemark?.trim() || null,
        note: input.note?.trim() || null,
      },
    });
    await tx.installationChallanItem.deleteMany({ where: { challanId: current.id, id: { notIn: keep.map((i) => i.id!) } } });
    for (const [idx, i] of input.items.entries()) {
      const data = { productId: i.productId, productName: i.productName, barcode: i.barcode?.trim() || null, qty: i.qty, unit: i.unit, srNo: idx + 1 };
      if (i.id && known.has(i.id)) await tx.installationChallanItem.update({ where: { id: i.id }, data });
      else await tx.installationChallanItem.create({ data: { ...data, challanId: current.id } });
    }
    await tx.installationChallanAssignee.deleteMany({ where: { challanId: current.id, userId: { notIn: assignees } } });
    if (assignees.length) {
      await tx.installationChallanAssignee.createMany({
        data: assignees.map((u) => ({ challanId: current.id, userId: u })), skipDuplicates: true,
      });
    }
  });
  void userId;
}

/* -------------------------------------------------------------------------- */
/*  Money collected on site                                                   */
/* -------------------------------------------------------------------------- */

/**
 * An advance handed to the technician at the customer's premises.
 *
 * Pravin's rule, in his words: an advance "sits with the relevant challan". So
 * it is a real, numbered `Receipt` tied to this challan, HELD ON ACCOUNT -
 * there is no invoice yet for it to settle, and there will not be one for
 * weeks. `createReceipt` posts the journal entry, so the money is in the books
 * the day it is taken.
 *
 * It is NOT added to `SalesOrder.amountPaidPaise`. That column is a mirror of
 * what has been paid against the ORDER; money handed over on site belongs to
 * the challan, which is the whole point of recording it here. "Bill a site"
 * finds it through the challan and applies it to the final invoice.
 */
export async function recordChallanAdvance(
  scope: StoreScope,
  input: {
    challanId: string;
    amountPaise: number;
    method: ReceiptMethod;
    reference?: string | null;
    note?: string | null;
    receivedAt?: Date;
  },
  userId: string,
) {
  if (input.amountPaise <= 0) throw new Error('Enter an amount greater than zero.');
  if (!Number.isInteger(input.amountPaise)) throw new Error('Amounts are whole paise.');

  const challan = await db.installationChallan.findFirst({
    where: { id: input.challanId, ...scopeWhere(scope) },
    select: {
      id: true, challanNo: true, isInvoiced: true,
      salesOrder: { select: { partyId: true } },
    },
  });
  if (!challan) throw new Error('Challan not found in your scope.');

  /**
   * Refused once the challan is billed. After that the invoice exists and money
   * belongs on it - recorded here it would sit as unapplied credit nobody looks
   * at while the invoice still reads unpaid.
   */
  if (challan.isInvoiced) {
    throw new Error(
      `${challan.challanNo} is already on an invoice. Record the payment against the invoice instead.`,
    );
  }

  const partyId = challan.salesOrder?.partyId;
  if (!partyId) {
    throw new Error(
      `${challan.challanNo} has no customer behind it, so a receipt cannot be raised.`
      + ' Attach it to a sales order first.',
    );
  }

  return createReceipt(scope, {
    partyId,
    amountPaise: input.amountPaise,
    method: input.method,
    receivedAt: input.receivedAt,
    reference: input.reference ?? null,
    note: input.note ?? `Advance collected on ${challan.challanNo}`,
    // Held. There is no invoice yet, and inventing an allocation against an
    // older invoice would settle a debt the customer did not intend to pay.
    allocations: [],
    challanId: challan.id,
  }, userId);
}

/** Advances collected against one challan, and how much of each is still held. */
export async function challanAdvances(scope: StoreScope, challanId: string) {
  const receipts = await db.receipt.findMany({
    where: { ...scopeWhere(scope), challanId, status: 'received' },
    orderBy: { receivedAt: 'asc' },
    select: {
      id: true, receiptNo: true, receivedAt: true, amountPaise: true, method: true,
      allocations: { select: { amountPaise: true } },
    },
  });
  return receipts.map((r) => ({
    id: r.id,
    receiptNo: r.receiptNo,
    receivedAt: r.receivedAt,
    method: r.method,
    amountPaise: r.amountPaise,
    heldPaise: r.amountPaise - r.allocations.reduce((t, a) => t + a.amountPaise, 0),
  }));
}
