import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, userInScope, type StoreScope } from './store-scope';
import { InstallationChallanError, setInstallationChallanStatus } from './installation-challans';
import { FEED_MAX_ROWS, LIST_MAX_ROWS } from '@/lib/list-limits';
import { deriveStage, normaliseStage, stageLabel, type InstallStage } from '@/lib/installation-stages';

/**
 * ONE INSTALLATION, ITS OWN PAGE - rebuilt like a complaint (27 Oct 2026,
 * Vcare redesign; first written 11 Oct 2026).
 *
 * Customer first, sales order optional. The stage moves by itself
 * (`syncInstallationStage`, after every event that can move it). Items can be
 * added, changed and removed until the job is billed. Material goes out only
 * through a parts challan. "Bill this installation" bills it from here, the
 * way "Bill this job" bills a complaint, and billing - or Don't bill - closes
 * it. The site survey, the testing checklist, the free-text material table
 * and the separate handover and approval steps are gone; their old values
 * stay in the activity log.
 *
 * Two state fields still, on purpose:
 *   stage   where the job is (raised ... work_done, billed) - derived
 *   status  what the phone app and older screens read
 *           (pending -> work_done -> approved | rejected). Work done on the
 *           phone sets work_done; billing sets approved.
 *
 * What is said and done is written to ActivityLog (entityType
 * 'installation_challan') - the same log the rest of Atlas writes to.
 */

const ENTITY = 'installation_challan';

async function log(storeId: string, challanId: string, userId: string | null, activityType: string, description: string, from?: string | null, to?: string | null) {
  await db.activityLog.create({
    data: { storeId, userId, activityType, entityType: ENTITY, entityId: challanId, description, statusFrom: from ?? null, statusTo: to ?? null },
  });
}

async function own(scope: StoreScope, id: string) {
  const storeId = scopeForWrite(scope);
  const c = await db.installationChallan.findFirst({
    where: { id, storeId },
    select: { id: true, stage: true, status: true, challanNo: true, isInvoiced: true, notBilledReason: true },
  });
  if (!c) throw new InstallationChallanError('That installation is not in your branch.');
  return { ...c, storeId };
}

/** Billed, or closed without a bill: nothing on it changes any more. */
const closed = (c: { isInvoiced: boolean; notBilledReason: string | null }) => c.isInvoiced || !!c.notBilledReason;

/**
 * Put the stored stage where the facts say it is, and log the move. Called
 * after every event that can move it; never throws for a missing challan
 * (a visit's challan may have gone).
 */
export async function syncInstallationStage(challanId: string, userId: string | null = null): Promise<InstallStage | null> {
  const c = await db.installationChallan.findUnique({
    where: { id: challanId },
    select: {
      id: true, storeId: true, stage: true, status: true, isInvoiced: true, notBilledReason: true,
      _count: { select: { assignees: true } },
      // A survey is looking, not fitting - only an installation visit moves it to Visit.
      visits: { where: { status: { not: 'cancelled' }, reason: { not: 'installation_survey' } }, select: { checkedInAt: true } },
      items: { where: { fitStatus: { in: ['fitted', 'tested'] } }, select: { id: true }, take: 1 },
    },
  });
  if (!c) return null;
  const to = deriveStage({
    status: c.status, isInvoiced: c.isInvoiced, notBilledReason: c.notBilledReason,
    team: c._count.assignees, visits: c.visits.length,
    onSite: c.items.length > 0 || c.visits.some((v) => !!v.checkedInAt),
  });
  if (to !== c.stage) {
    await db.installationChallan.update({ where: { id: c.id }, data: { stage: to } });
    await log(c.storeId, c.id, userId, 'Stage', `Now at ${stageLabel(to)}`, c.stage, to);
  }
  return to;
}

export interface InstallationPage {
  id: string;
  challanNo: string;
  stage: InstallStage;
  status: string;
  priority: string;
  rejectionReason: string | null;
  createdAt: string;
  dispatchedAt: string;
  completedAt: string | null;
  physicalChallanNo: string | null;
  note: string | null;
  technicianRemark: string | null;
  /** `id`: the customer's saved site it is linked to (30 Oct 2026); null = another place, or before then. */
  site: { id: string | null; text: string | null; lat: number | null; lng: number | null };
  customer: { id: string | null; name: string | null; phone: string | null };
  order: { id: string; orderNo: string; totalPaise: number; quotation: { id: string; no: string } | null } | null;
  team: { id: string; name: string; phone: string | null }[];
  technicians: { id: string; name: string }[];
  /** qtyReturned / qtyReturnPending: unused, back against the order's GDN (R2, 22 Oct 2026). */
  items: { id: string; productId: string | null; productName: string; qty: number; qtyReturned: number; qtyReturnPending: number; placement: string | null; serialNo: string | null; fitStatus: string; stockUnitId: string | null }[];
  /** Goods left on the order's GDN - nothing can come back before. */
  dispatched: boolean;
  /** Billed or closed without a bill - read-only from here. */
  closed: boolean;
  notBilledReason: string | null;
  isInvoiced: boolean;
  handover: { at: string | null; to: string | null; by: string | null };
  visits: { id: string; purpose: string; reason: string; scheduledAt: string; status: string; technician: string; checkedInAt: string | null; distanceM: number | null; withinRange: boolean | null; completedAt: string | null }[];
  onSiteMinutes: number;
  invoices: { id: string; no: string; lifecycle: string; totalPaise: number; paidPaise: number }[];
  receipts: { id: string; no: string; amountPaise: number; at: string }[];
  otherInstallations: { id: string; no: string; stage: string }[];
  activity: { id: string; kind: string; text: string; who: string | null; at: string }[];
}

export async function getInstallationPage(scope: StoreScope, id: string): Promise<InstallationPage | null> {
  // The stage is put right on the way in, so an old challan reads in the new stages.
  const exists = await db.installationChallan.findFirst({ where: { id, ...scopeWhere(scope) }, select: { id: true } });
  if (!exists) return null;
  await syncInstallationStage(id);

  const c = await db.installationChallan.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      items: { orderBy: { srNo: 'asc' } },
      assignees: { include: { user: { select: { id: true, fullName: true, phone: true } } } },
      customer: { select: { id: true, firstName: true, lastName: true, companyName: true, phone: true, phoneCc: true, addressLine1: true } },
      salesOrder: {
        select: {
          id: true, orderNo: true, grandTotalPaise: true, partyId: true, customerName: true, phone: true, shippingAddress: true,
          items: { select: { dispatchedQty: true } },
          quotation: { select: { id: true, quotationNo: true } },
          installationChallans: { where: { deletedAt: null }, select: { id: true, challanNo: true, stage: true } },
        },
      },
      invoiceSources: { where: { invoice: { lifecycle: { not: 'cancelled' } } }, select: { invoice: { select: { id: true, invoiceNo: true, lifecycle: true, grandTotalPaise: true, amountPaidPaise: true } } } },
      visits: {
        orderBy: { scheduledAt: 'asc' },
        select: { id: true, purpose: true, reason: true, scheduledAt: true, status: true, checkedInAt: true, checkInDistanceM: true, checkInWithinRange: true, completedAt: true, technician: { select: { fullName: true } } },
      },
    },
  });
  if (!c) return null;

  const receipts = await db.receipt.findMany({
    where: { ...scopeWhere(scope), challanId: c.id, status: 'received' },
    select: { id: true, receiptNo: true, amountPaise: true, receivedAt: true }, orderBy: { receivedAt: 'asc' }, take: LIST_MAX_ROWS,
  });
  const techs = await db.user.findMany({ where: { ...userInScope(scope), isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' }, take: LIST_MAX_ROWS });
  const logs = await db.activityLog.findMany({
    where: { ...scopeWhere(scope), entityType: ENTITY, entityId: c.id },
    orderBy: { createdAt: 'desc' }, take: FEED_MAX_ROWS,
    select: { id: true, activityType: true, description: true, createdAt: true, user: { select: { fullName: true } } },
  });

  const onSite = c.visits.reduce((n, v) => n + (v.checkedInAt && v.completedAt ? Math.max(0, v.completedAt.getTime() - v.checkedInAt.getTime()) : 0), 0);
  // The customer on the challan; the order's buyer snapshot for one raised before 27 Oct.
  const cu = c.customer;
  const customer = cu
    ? { id: cu.id, name: cu.companyName || [cu.firstName, cu.lastName].filter(Boolean).join(' '), phone: cu.phone ? [cu.phoneCc, cu.phone].filter(Boolean).join(' ') : null }
    : { id: c.salesOrder?.partyId ?? null, name: c.salesOrder?.customerName ?? null, phone: c.salesOrder?.phone ?? null };

  return {
    id: c.id, challanNo: c.challanNo, stage: normaliseStage(c.stage), status: c.status, priority: c.priority,
    rejectionReason: c.rejectionReason,
    createdAt: c.createdAt.toISOString(), dispatchedAt: c.dispatchedAt.toISOString(), completedAt: c.completedAt?.toISOString() ?? null,
    physicalChallanNo: c.physicalChallanNo, note: c.note, technicianRemark: c.technicianRemark,
    site: {
      id: c.siteId,
      text: c.siteLocation ?? c.salesOrder?.shippingAddress ?? cu?.addressLine1 ?? null,
      lat: c.siteLat === null ? null : Number(c.siteLat), lng: c.siteLng === null ? null : Number(c.siteLng),
    },
    customer,
    order: c.salesOrder ? { id: c.salesOrder.id, orderNo: c.salesOrder.orderNo, totalPaise: c.salesOrder.grandTotalPaise, quotation: c.salesOrder.quotation ? { id: c.salesOrder.quotation.id, no: c.salesOrder.quotation.quotationNo } : null } : null,
    team: c.assignees.map((a) => ({ id: a.user.id, name: a.user.fullName, phone: a.user.phone })),
    technicians: techs.map((t) => ({ id: t.id, name: t.fullName })),
    items: c.items.map((i) => ({ id: i.id, productId: i.productId, productName: i.productName, qty: i.qty, qtyReturned: i.qtyReturned, qtyReturnPending: i.qtyReturnPending, placement: i.placement, serialNo: i.serialNo ?? i.barcode, fitStatus: i.fitStatus, stockUnitId: i.stockUnitId })),
    dispatched: (c.salesOrder?.items ?? []).some((i) => i.dispatchedQty > 0),
    closed: closed(c),
    notBilledReason: c.notBilledReason,
    isInvoiced: c.isInvoiced,
    handover: { at: c.handoverAt?.toISOString() ?? null, to: c.handoverTo, by: c.handoverBy },
    visits: c.visits.map((v) => ({
      id: v.id, purpose: v.purpose, reason: v.reason, scheduledAt: v.scheduledAt.toISOString(), status: v.status,
      technician: v.technician.fullName, checkedInAt: v.checkedInAt?.toISOString() ?? null,
      distanceM: v.checkInDistanceM, withinRange: v.checkInWithinRange, completedAt: v.completedAt?.toISOString() ?? null,
    })),
    onSiteMinutes: Math.round(onSite / 60_000),
    invoices: c.invoiceSources.map((s) => ({ id: s.invoice.id, no: s.invoice.invoiceNo, lifecycle: s.invoice.lifecycle, totalPaise: s.invoice.grandTotalPaise, paidPaise: s.invoice.amountPaidPaise })),
    receipts: receipts.map((r) => ({ id: r.id, no: r.receiptNo, amountPaise: r.amountPaise, at: r.receivedAt.toISOString() })),
    otherInstallations: (c.salesOrder?.installationChallans ?? []).filter((o) => o.id !== c.id).map((o) => ({ id: o.id, no: o.challanNo, stage: o.stage })),
    activity: logs.map((l) => ({ id: l.id, kind: l.activityType, text: l.description, who: l.user?.fullName ?? null, at: l.createdAt.toISOString() })),
  };
}

/**
 * Nobody moves a stage by hand any more (27 Oct 2026). Kept for phone builds
 * before 1.0.33, whose stage buttons call it: it only puts the stage where
 * the facts say, so an old button does no harm.
 */
export async function setInstallationStage(scope: StoreScope, id: string, _to: string, userId: string, _reason?: string | null): Promise<void> {
  await own(scope, id);
  await syncInstallationStage(id, userId);
}

/**
 * Work done - the phone's button, or the office's when the technician forgot
 * (27 Oct 2026). The status loop does the rest: every unit still "to fit" is
 * marked fitted and the warranty on its serial starts today.
 */
export async function markInstallationWorkDone(scope: StoreScope, id: string, userId: string, receivedBy?: string | null): Promise<void> {
  const c = await own(scope, id);
  if (closed(c)) throw new InstallationChallanError('This installation is billed, so it is closed.');
  if (receivedBy?.trim()) {
    await db.installationChallan.update({ where: { id }, data: { handoverTo: receivedBy.trim().slice(0, 120) } });
  }
  await setInstallationChallanStatus(scope, { id, to: 'work_done' }, userId);
  await log(c.storeId, id, userId, 'Work done', `Work done${receivedBy?.trim() ? ` - received by ${receivedBy.trim()}` : ''}. Warranty starts today.`, c.status, 'work_done');
}

/** Send back from Work done, with a reason: the job goes back to Fitting. */
export async function sendBackInstallation(scope: StoreScope, id: string, reason: string, userId: string): Promise<void> {
  const c = await own(scope, id);
  if (closed(c)) throw new InstallationChallanError('This installation is billed, so it is closed.');
  if (!reason.trim()) throw new InstallationChallanError('Say why it is going back, so the technician knows what to fix.');
  if (c.status !== 'work_done' && c.status !== 'approved') throw new InstallationChallanError('Only a job at Work done can be sent back.');
  if (c.status === 'approved') {
    // An old approval with no bill: straight back to work.
    await db.installationChallan.update({ where: { id }, data: { status: 'rejected', rejectionReason: reason.trim(), approvedAt: null, approvedBy: null, completedAt: null } });
  } else {
    await setInstallationChallanStatus(scope, { id, to: 'rejected', reason }, userId);
  }
  await log(c.storeId, id, userId, 'Sent back', `Sent back: ${reason.trim()}`, c.status, 'rejected');
  await syncInstallationStage(id, userId);
}

export async function updateInstallationItems(
  scope: StoreScope, id: string,
  items: { id: string; placement?: string | null; serialNo?: string | null; fitStatus?: string }[], userId: string,
): Promise<void> {
  const c = await own(scope, id);
  if (closed(c)) throw new InstallationChallanError('This installation is billed, so it is closed.');
  const mine = new Set((await db.installationChallanItem.findMany({ where: { challanId: id, challan: { storeId: c.storeId } }, select: { id: true } })).map((i) => i.id));
  for (const it of items) {
    if (!mine.has(it.id)) continue;
    // "Tested" went with the testing checklist; an older phone sending it means fitted.
    const fit = it.fitStatus === 'tested' ? 'fitted' : it.fitStatus;
    if (fit && !['to_fit', 'fitted'].includes(fit)) continue;
    await db.installationChallanItem.update({
      where: { id: it.id },
      data: {
        ...(it.placement !== undefined ? { placement: it.placement?.trim() || null } : {}),
        ...(it.serialNo !== undefined ? { serialNo: it.serialNo?.trim() || null } : {}),
        ...(fit ? { fitStatus: fit } : {}),
      },
    });
  }
  await syncInstallationStage(id, userId);
}

/**
 * Add a line, change its quantity, or take it off (27 Oct 2026) - until the
 * job is billed. A line the store has already sent goods back against, or one
 * with a serial unit on it, cannot be taken off: its paper trail would point
 * at nothing.
 */
export async function addInstallationItem(scope: StoreScope, id: string, input: { productId: string; qty: number; unitIds?: string[] }, userId: string): Promise<void> {
  const c = await own(scope, id);
  if (closed(c)) throw new InstallationChallanError('This installation is billed, so it is closed.');
  const qty = Math.trunc(input.qty);
  if (!Number.isFinite(qty) || qty < 1) throw new InstallationChallanError('The quantity must be at least 1.');
  const p = await db.product.findFirst({ where: { id: input.productId, storeId: c.storeId }, select: { id: true, productName: true, unit: true, trackingMode: true } });
  if (!p) throw new InstallationChallanError('That product is not in your branch.');
  const last = await db.installationChallanItem.aggregate({ where: { challanId: id }, _max: { srNo: true } });
  if (p.trackingMode !== 'serial') {
    await db.installationChallanItem.create({
      data: { challanId: id, productId: p.id, productName: p.productName, qty, unit: p.unit, srNo: (last._max.srNo ?? 0) + 1 },
    });
    await log(c.storeId, id, userId, 'Items', `Added ${p.productName} × ${qty}`);
    return;
  }
  // A serial product names its units (30 Oct 2026, Vcare): one line per unit, as
  // the phone's scan keeps them, so each carries its own serial and warranty.
  const ids = [...new Set(input.unitIds ?? [])];
  if (ids.length !== qty) throw new InstallationChallanError(`${p.productName} is kept by serial number - pick ${qty} serial${qty === 1 ? '' : 's'}.`);
  const units = await db.stockUnit.findMany({ where: { id: { in: ids }, storeId: c.storeId, productId: p.id, status: 'in_stock' }, select: { id: true, serialNo: true } });
  if (units.length !== ids.length || units.some((u) => !u.serialNo)) throw new InstallationChallanError('A serial picked is not on the shelf any more - pick again.');
  const { scanUnitOntoChallan } = await import('./field-app');
  let srNo = last._max.srNo ?? 0;
  for (const u of units) {
    const line = await db.installationChallanItem.create({
      data: { challanId: id, productId: p.id, productName: p.productName, qty: 1, unit: p.unit, srNo: ++srNo },
      select: { id: true },
    });
    try {
      await scanUnitOntoChallan(scope, { challanItemId: line.id, serialNo: u.serialNo! }, userId);
    } catch (e) {
      // No line left behind without its serial; the scan's words reach the office.
      await db.installationChallanItem.delete({ where: { id: line.id } });
      throw new InstallationChallanError(e instanceof Error ? e.message : 'Could not put that serial on the line.');
    }
  }
  await log(c.storeId, id, userId, 'Items', `Added ${p.productName} × ${qty} (S/N ${units.map((u) => u.serialNo).join(', ')})`);
}

export async function changeInstallationItemQty(scope: StoreScope, id: string, itemId: string, qty: number, userId: string): Promise<void> {
  const c = await own(scope, id);
  if (closed(c)) throw new InstallationChallanError('This installation is billed, so it is closed.');
  const it = await db.installationChallanItem.findFirst({ where: { id: itemId, challanId: id }, select: { id: true, productName: true, qty: true, qtyReturned: true, qtyReturnPending: true } });
  if (!it) throw new InstallationChallanError('That line is not on this installation.');
  const n = Math.trunc(qty);
  if (!Number.isFinite(n) || n < 1) throw new InstallationChallanError('The quantity must be at least 1. To take the line off, remove it.');
  if (n < it.qtyReturned + it.qtyReturnPending) throw new InstallationChallanError(`${it.qtyReturned + it.qtyReturnPending} of these are already coming back - the quantity cannot go below that.`);
  if (n === it.qty) return;
  await db.installationChallanItem.update({ where: { id: itemId }, data: { qty: n } });
  await log(c.storeId, id, userId, 'Items', `${it.productName}: quantity ${it.qty} → ${n}`);
}

export async function removeInstallationItem(scope: StoreScope, id: string, itemId: string, reason: string, userId: string): Promise<void> {
  const c = await own(scope, id);
  if (closed(c)) throw new InstallationChallanError('This installation is billed, so it is closed.');
  if (!reason.trim()) throw new InstallationChallanError('Say why the line is coming off.');
  const it = await db.installationChallanItem.findFirst({
    where: { id: itemId, challanId: id },
    select: { id: true, productName: true, qty: true, qtyReturned: true, qtyReturnPending: true, stockUnitId: true, _count: { select: { invoiceLines: true } } },
  });
  if (!it) throw new InstallationChallanError('That line is not on this installation.');
  if (it.qtyReturned || it.qtyReturnPending) throw new InstallationChallanError('Goods on this line are coming back through the store - it cannot be taken off.');
  if (it.stockUnitId) throw new InstallationChallanError('A serial unit is fitted on this line - take the serial off first.');
  if (it._count.invoiceLines) throw new InstallationChallanError('This line is on an invoice.');
  const left = await db.installationChallanItem.count({ where: { challanId: id } });
  if (left <= 1) throw new InstallationChallanError('Keep at least one line. To stop the job, Don’t bill it with a reason.');
  await db.installationChallanItem.delete({ where: { id: itemId } });
  await log(c.storeId, id, userId, 'Items', `Removed ${it.productName} × ${it.qty}: ${reason.trim()}`);
  await syncInstallationStage(id, userId);
}

export async function setInstallationTeam(scope: StoreScope, id: string, input: { assigneeIds: string[]; priority: string }, userId: string): Promise<void> {
  const c = await own(scope, id);
  const ids = [...new Set(input.assigneeIds)];
  if (ids.length) {
    const ok = await db.user.findMany({ where: { id: { in: ids }, ...userInScope(scope) }, select: { id: true, fullName: true } });
    if (ok.length !== ids.length) throw new InstallationChallanError('One of those people is not in this branch.');
  }
  const priority = ['low', 'normal', 'high', 'urgent'].includes(input.priority) ? input.priority : 'normal';
  await db.$transaction([
    db.installationChallanAssignee.deleteMany({ where: { challanId: id, userId: { notIn: ids } } }),
    db.installationChallanAssignee.createMany({ data: ids.map((u) => ({ challanId: id, userId: u })), skipDuplicates: true }),
    db.installationChallan.update({ where: { id }, data: { priority } }),
  ]);
  await log(c.storeId, id, userId, 'Team', `Technicians: ${ids.length} · priority ${priority}`);
  await syncInstallationStage(id, userId);
}

/**
 * Change where it is fitted (30 Oct 2026, Vcare) - the saved site, its words
 * and its pin together, by the rule every job uses. Until billed; logged.
 */
export async function changeInstallationSite(scope: StoreScope, id: string, input: { siteId: string | null; otherPlace: boolean; text: string | null }, userId: string): Promise<void> {
  const c = await own(scope, id);
  if (closed(c)) throw new InstallationChallanError('This installation is billed, so it is closed.');
  const ch = await db.installationChallan.findUnique({ where: { id }, select: { customerId: true, siteLocation: true } });
  if (!ch?.customerId) throw new InstallationChallanError('Set the customer first.');
  const { jobSite, SiteError } = await import('./sites');
  const place = await jobSite(c.storeId, ch.customerId, input).catch((e) => { throw e instanceof SiteError ? new InstallationChallanError(e.message) : e; });
  if (!place.siteId && !place.siteLocation) throw new InstallationChallanError('Type the address of the place.');
  await db.installationChallan.update({
    where: { id },
    data: { siteId: place.siteId, siteLocation: place.siteLocation, siteLat: place.siteLat, siteLng: place.siteLng },
  });
  await log(c.storeId, id, userId, 'Site', `Site changed: ${ch.siteLocation ?? 'none'} → ${place.siteLocation}`);
}

/** The customer on a challan that has none - older ones raised with no order (27 Oct 2026). */
export async function setInstallationCustomer(scope: StoreScope, id: string, customerId: string, userId: string): Promise<void> {
  const c = await own(scope, id);
  if (closed(c)) throw new InstallationChallanError('This installation is billed, so it is closed.');
  const p = await db.party.findFirst({ where: { id: customerId, storeId: c.storeId }, select: { id: true, firstName: true, lastName: true, companyName: true, addressLine1: true } });
  if (!p) throw new InstallationChallanError('That customer is not in your branch.');
  const cur = await db.installationChallan.findUnique({ where: { id }, select: { siteLocation: true } });
  await db.installationChallan.update({ where: { id }, data: { customerId: p.id, ...(cur?.siteLocation ? {} : { siteLocation: p.addressLine1 }) } });
  await log(c.storeId, id, userId, 'Customer', `Customer set: ${p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' ')}`);
}

export async function addInstallationRemark(scope: StoreScope, id: string, text: string, userId: string): Promise<void> {
  const c = await own(scope, id);
  const t = text.trim();
  if (!t) throw new InstallationChallanError('Write something first.');
  await log(c.storeId, id, userId, 'Remark', t.slice(0, 2000));
}

// ------------------------------------------------ billing (27 Oct 2026)

export interface InstallationBillLine { description: string; qty: number; unitPaise: number; taxRatePct: number; fromCatalogue: boolean }

export interface InstallationBillDraft {
  /** The fitted goods, at the order's price - or the product list's when there is no order. */
  goods: InstallationBillLine[];
  /** Material issued on its parts challans and not returned, at the product price. */
  material: (InstallationBillLine & { productCode: string | null; hsnCode: string | null })[];
  advancePaise: number;
  warnings: string[];
}

/** Material used on the job: issued minus returned on its issued parts challans. */
async function materialUsed(storeId: string, challanId: string) {
  const lines = await db.jobChallanLine.findMany({
    where: { challan: { installationChallanId: challanId, status: 'issued', type: { not: 'handback' } } },
    select: { productId: true, qtyIssued: true, qtyReturned: true },
  });
  const used = new Map<string, number>();
  for (const l of lines) used.set(l.productId, (used.get(l.productId) ?? 0) + Math.max(0, l.qtyIssued - l.qtyReturned));
  const ids = [...used.keys()].filter((k) => used.get(k)! > 0);
  const products = ids.length ? await db.product.findMany({
    where: { id: { in: ids }, storeId },
    select: { id: true, productName: true, productCode: true, hsnCode: true, prices: { where: { effectiveTo: null }, orderBy: { effectiveFrom: 'desc' }, take: 1, select: { dlpPaise: true, taxRatePct: true } } },
  }) : [];
  return products.map((p) => ({
    description: p.productName, productCode: p.productCode, hsnCode: p.hsnCode, qty: used.get(p.id)!,
    unitPaise: p.prices[0]?.dlpPaise ?? 0, taxRatePct: p.prices[0] ? Number(p.prices[0].taxRatePct) : 18, fromCatalogue: true,
  }));
}

export async function installationBillDraft(scope: StoreScope, id: string): Promise<InstallationBillDraft> {
  const c = await own(scope, id);
  if (c.isInvoiced) throw new InstallationChallanError('This installation is already billed.');
  const { previewConsolidatedInvoice } = await import('./consolidated-invoice');
  const draft = await previewConsolidatedInvoice(scope, { challanIds: [id], salesOrderIds: [] });
  return {
    goods: draft.lines.map((l) => ({ description: l.productName, qty: l.qty, unitPaise: l.unitPricePaise, taxRatePct: l.taxRatePct, fromCatalogue: l.pricedFromCatalogue })),
    material: await materialUsed(c.storeId, id),
    advancePaise: draft.advancePaise,
    warnings: draft.warnings,
  };
}

/** Billing closes the job: status approved (what the phone reads as finished), stage billed. */
async function closeJob(storeId: string, id: string, userId: string) {
  const now = new Date();
  await db.installationChallan.update({
    where: { id },
    data: { status: 'approved', approvedBy: userId, approvedAt: now, completedAt: now, rejectionReason: null },
  });
  // Any approval request still open for it is answered by the bill.
  await db.approvalRequest.updateMany({
    where: { storeId, entityType: 'installation_challan', entityId: id, status: 'PENDING' },
    data: { status: 'APPROVED', decidedBy: userId, decidedAt: now, note: 'Closed by billing the installation.' },
  });
  const { alignSaleAmcsToInstall } = await import('./amc');
  await alignSaleAmcsToInstall(storeId, id).catch((e) => console.error('[amc] align to install failed', e));
  await syncInstallationStage(id, userId);
}

/**
 * Bill this installation - a draft invoice, issued from Invoices as any other
 * (27 Oct 2026). The same engine as Invoices › Bill a site, so the per-line
 * trail, advances held on the challan and "already billed" all work alike.
 */
export async function billInstallation(
  scope: StoreScope, id: string,
  input: { includeMaterial: boolean; labourPaise: number; labourText?: string | null; termsDays?: number },
  userId: string,
): Promise<{ id: string; invoiceNo: string }> {
  const c = await own(scope, id);
  if (closed(c)) throw new InstallationChallanError(c.isInvoiced ? 'This installation is already billed.' : 'This installation was closed without a bill.');
  if (c.status !== 'work_done' && c.status !== 'approved') throw new InstallationChallanError('Mark the work done first - the bill is for what was fitted.');
  const extra: import('./consolidated-invoice').ExtraBillLine[] = [];
  if (input.includeMaterial) {
    for (const m of await materialUsed(c.storeId, id)) {
      if (m.unitPaise > 0) extra.push({ productName: m.description, qty: m.qty, unitPricePaise: m.unitPaise, taxRatePct: m.taxRatePct, productCode: m.productCode, hsnCode: m.hsnCode });
    }
  }
  const labour = Math.round(Number(input.labourPaise) || 0);
  if (labour < 0) throw new InstallationChallanError('Labour cannot be negative.');
  if (labour > 0) extra.push({ productName: input.labourText?.trim() || 'Installation labour', qty: 1, unitPricePaise: labour, taxRatePct: 18 });

  const { createConsolidatedInvoice } = await import('./consolidated-invoice');
  const invoice = await createConsolidatedInvoice(scope, {
    challanIds: [id], salesOrderIds: [], extraLines: extra,
    invoiceDate: new Date(), termsDays: Math.max(0, Math.trunc(input.termsDays ?? 0)),
    notes: `Installation ${c.challanNo}.`,
  }, userId);
  // The serial units fitted here are sold on this bill, as a complaint's are.
  const units = (await db.installationChallanItem.findMany({ where: { challanId: id, stockUnitId: { not: null } }, select: { stockUnitId: true } }))
    .map((i) => i.stockUnitId!).filter(Boolean);
  if (units.length) await db.stockUnit.updateMany({ where: { id: { in: units }, invoiceId: null }, data: { invoiceId: invoice.id } });
  await log(c.storeId, id, userId, 'Billed', `Billed on ${invoice.invoiceNo} (draft - issue it from Invoices).`);
  await closeJob(c.storeId, id, userId);
  return { id: invoice.id, invoiceNo: invoice.invoiceNo };
}

/** Don't bill, with a reason - goodwill, a mistake on our side. Closes the job. */
export async function waiveInstallationBilling(scope: StoreScope, id: string, reason: string, userId: string): Promise<void> {
  const c = await own(scope, id);
  const why = reason.trim();
  if (!why) throw new InstallationChallanError('Say why this installation is not being billed.');
  if (closed(c)) throw new InstallationChallanError('This installation is already closed.');
  await db.installationChallan.update({ where: { id }, data: { notBilledReason: why.slice(0, 500) } });
  await log(c.storeId, id, userId, 'Not billed', `Not billed: ${why}`);
  await closeJob(c.storeId, id, userId);
}
