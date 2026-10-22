import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeForWrite, scopeWhere, userInScope, type StoreScope } from './store-scope';
import { InstallationChallanError, setInstallationChallanStatus } from './installation-challans';
import { FEED_MAX_ROWS, LIST_MAX_ROWS } from '@/lib/list-limits';
import {
  INSTALL_STAGES, SURVEY_ITEMS, TESTING_ITEMS, isInstallStage, stageIndex,
  type InstallStage, type MaterialRow,
} from '@/lib/installation-stages';

/**
 * ONE INSTALLATION, ITS OWN PAGE (11 Oct 2026, ops-pages demo tab 1).
 *
 * An installation challan was a card in a list. It is now worked like a
 * complaint: a stage, technicians, visits with on-site check-in, the units
 * being fitted with their serials, a site survey, the material used, a testing
 * checklist and a handover - and every document around it linked.
 *
 * Two state fields, on purpose:
 *   stage   the working progress (planned ... handover, approved)
 *   status  the office's approval loop that already existed
 *           (pending -> work_done -> approved | rejected), which the phone
 *           app and the approval rules read. Handover moves status to
 *           work_done; the office approving sets stage approved; sending it
 *           back returns the stage to testing.
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
  const c = await db.installationChallan.findFirst({ where: { id, storeId }, select: { id: true, stage: true, status: true, challanNo: true } });
  if (!c) throw new InstallationChallanError('That installation is not in your branch.');
  return { ...c, storeId };
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
  site: { text: string | null; lat: number | null; lng: number | null };
  customer: { id: string | null; name: string | null; phone: string | null };
  order: { id: string; orderNo: string; totalPaise: number; quotation: { id: string; no: string } | null } | null;
  team: { id: string; name: string; phone: string | null }[];
  technicians: { id: string; name: string }[];
  /** qtyReturned / qtyReturnPending: unused, back against the order's GDN (R2, 22 Oct 2026). */
  items: { id: string; productId: string | null; productName: string; qty: number; qtyReturned: number; qtyReturnPending: number; placement: string | null; serialNo: string | null; fitStatus: string }[];
  /** Goods left on the order's GDN - nothing can come back before. */
  dispatched: boolean;
  survey: Record<string, boolean | string | number>;
  testing: Record<string, boolean>;
  materials: MaterialRow[];
  handover: { at: string | null; to: string | null; by: string | null };
  visits: { id: string; purpose: string; reason: string; scheduledAt: string; status: string; technician: string; checkedInAt: string | null; distanceM: number | null; withinRange: boolean | null; completedAt: string | null }[];
  onSiteMinutes: number;
  invoices: { id: string; no: string; lifecycle: string; totalPaise: number; paidPaise: number }[];
  receipts: { id: string; no: string; amountPaise: number; at: string }[];
  otherInstallations: { id: string; no: string; stage: string }[];
  activity: { id: string; kind: string; text: string; who: string | null; at: string }[];
}

export async function getInstallationPage(scope: StoreScope, id: string): Promise<InstallationPage | null> {
  const c = await db.installationChallan.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      items: { orderBy: { srNo: 'asc' } },
      assignees: { include: { user: { select: { id: true, fullName: true, phone: true } } } },
      salesOrder: {
        select: {
          id: true, orderNo: true, grandTotalPaise: true, partyId: true, customerName: true, phone: true,
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
  const stage = isInstallStage(c.stage) ? c.stage : 'planned';
  const json = (v: Prisma.JsonValue | null) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, never> : {});

  return {
    id: c.id, challanNo: c.challanNo, stage, status: c.status, priority: c.priority,
    rejectionReason: c.rejectionReason,
    createdAt: c.createdAt.toISOString(), dispatchedAt: c.dispatchedAt.toISOString(), completedAt: c.completedAt?.toISOString() ?? null,
    physicalChallanNo: c.physicalChallanNo, note: c.note, technicianRemark: c.technicianRemark,
    site: { text: c.siteLocation, lat: c.siteLat === null ? null : Number(c.siteLat), lng: c.siteLng === null ? null : Number(c.siteLng) },
    customer: { id: c.salesOrder?.partyId ?? null, name: c.salesOrder?.customerName ?? null, phone: c.salesOrder?.phone ?? null },
    order: c.salesOrder ? { id: c.salesOrder.id, orderNo: c.salesOrder.orderNo, totalPaise: c.salesOrder.grandTotalPaise, quotation: c.salesOrder.quotation ? { id: c.salesOrder.quotation.id, no: c.salesOrder.quotation.quotationNo } : null } : null,
    team: c.assignees.map((a) => ({ id: a.user.id, name: a.user.fullName, phone: a.user.phone })),
    technicians: techs.map((t) => ({ id: t.id, name: t.fullName })),
    items: c.items.map((i) => ({ id: i.id, productId: i.productId, productName: i.productName, qty: i.qty, qtyReturned: i.qtyReturned, qtyReturnPending: i.qtyReturnPending, placement: i.placement, serialNo: i.serialNo ?? i.barcode, fitStatus: i.fitStatus })),
    dispatched: (c.salesOrder?.items ?? []).some((i) => i.dispatchedQty > 0),
    survey: json(c.surveyJson),
    testing: json(c.testingJson),
    materials: Array.isArray(c.materialsJson) ? (c.materialsJson as unknown as MaterialRow[]) : [],
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
 * Move the working stage one step (or back, with a reason). Handover and the
 * office's approval have their own functions - they change more than a stage.
 */
export async function setInstallationStage(scope: StoreScope, id: string, to: string, userId: string, reason?: string | null): Promise<void> {
  const c = await own(scope, id);
  if (!isInstallStage(to)) throw new InstallationChallanError('That is not a stage an installation can be at.');
  if (c.status === 'approved') throw new InstallationChallanError('This installation is approved, so it is closed.');
  if (to === 'approved') throw new InstallationChallanError('The office approves an installation after handover - use Approve.');
  if (to === 'handover') throw new InstallationChallanError('Use Hand over - it records who received it and starts the warranty.');
  const from = isInstallStage(c.stage) ? c.stage : 'planned';
  if (from === to) return;
  const back = stageIndex(to) < stageIndex(from);
  if (back && !reason?.trim()) throw new InstallationChallanError('Say why it is going back a step.');
  await db.installationChallan.update({ where: { id }, data: { stage: to } });
  await log(c.storeId, id, userId, 'Stage', back ? `Back to ${label(to)}: ${reason!.trim()}` : `Moved to ${label(to)}`, from, to);
}

const label = (s: string) => INSTALL_STAGES.find((x) => x.key === s)?.label ?? s;

/** Hand over to the customer: stage handover, status work_done (office approves next), warranty starts. */
export async function handoverInstallation(scope: StoreScope, id: string, input: { to: string; note?: string | null }, userId: string, userName: string): Promise<void> {
  const c = await own(scope, id);
  const to = input.to.trim();
  if (!to) throw new InstallationChallanError('Who received it? Type the customer’s name.');
  if (c.status === 'approved') throw new InstallationChallanError('This installation is already approved.');
  const items = await db.installationChallanItem.findMany({ where: { challanId: id, challan: { storeId: c.storeId } }, select: { fitStatus: true, serialNo: true, barcode: true, stockUnitId: true } });
  const notFitted = items.filter((i) => i.fitStatus === 'to_fit').length;
  if (notFitted) throw new InstallationChallanError(`${notFitted} item${notFitted === 1 ? ' is' : 's are'} still to fit - mark them fitted first.`);
  // Settings › Required documents (11 Oct 2026): an Installation rule set to
  // Block (e.g. after photos) stops the handover until the file is attached.
  const { requiredRules, tagsOn } = await import('./attachments');
  const { blockMessage } = await import('@/lib/attachment-tags');
  const blocked = blockMessage(await requiredRules(c.storeId), 'installation', await tagsOn(c.storeId, 'installation_challan', id));
  if (blocked) throw new InstallationChallanError(blocked);
  const now = new Date();
  await db.installationChallan.update({
    where: { id },
    data: { stage: 'handover', handoverAt: now, handoverTo: to, handoverBy: userName, technicianRemark: input.note?.trim() || undefined },
  });
  // Warranty from the day it was handed over, for every serial fitted here
  // that Atlas knows as a unit with the customer (Settings: warranty starts
  // on installation date). A unit whose warranty already started is left alone.
  const serials = items.map((i) => (i.serialNo ?? i.barcode)?.trim()).filter((x): x is string => !!x);
  const unitIds = items.map((i) => i.stockUnitId).filter((x): x is string => !!x);
  if (serials.length || unitIds.length) {
    await db.stockUnit.updateMany({
      where: { storeId: c.storeId, warrantyFrom: null, OR: [{ id: { in: unitIds } }, { serialNo: { in: serials } }] },
      data: { warrantyFrom: now },
    });
  }
  if (c.status === 'pending' || c.status === 'rejected' || c.status === 'legacy_unknown') {
    await setInstallationChallanStatus(scope, { id, to: 'work_done' }, userId);
  }
  await log(c.storeId, id, userId, 'Handover', `Handed over to ${to}. Warranty starts today.${input.note?.trim() ? ` ${input.note.trim()}` : ''}`, c.stage, 'handover');
}

/** The office approves or sends back - the existing loop, with the stage kept in step. */
export async function decideInstallation(scope: StoreScope, id: string, decision: 'approved' | 'rejected', userId: string, reason?: string | null): Promise<void> {
  const c = await own(scope, id);
  await setInstallationChallanStatus(scope, { id, to: decision, reason: reason ?? null }, userId);
  await log(c.storeId, id, userId, decision === 'approved' ? 'Approved' : 'Sent back', decision === 'approved' ? 'Approved by the office.' : `Sent back: ${reason?.trim() ?? ''}`, c.stage, decision === 'approved' ? 'approved' : 'testing');
}

export async function updateInstallationItems(
  scope: StoreScope, id: string,
  items: { id: string; placement?: string | null; serialNo?: string | null; fitStatus?: string }[], userId: string,
): Promise<void> {
  const c = await own(scope, id);
  if (c.status === 'approved') throw new InstallationChallanError('This installation is approved, so it is closed.');
  const mine = new Set((await db.installationChallanItem.findMany({ where: { challanId: id, challan: { storeId: c.storeId } }, select: { id: true } })).map((i) => i.id));
  let fitted = 0;
  for (const it of items) {
    if (!mine.has(it.id)) continue;
    if (it.fitStatus && !['to_fit', 'fitted', 'tested'].includes(it.fitStatus)) continue;
    await db.installationChallanItem.update({
      where: { id: it.id },
      data: {
        ...(it.placement !== undefined ? { placement: it.placement?.trim() || null } : {}),
        ...(it.serialNo !== undefined ? { serialNo: it.serialNo?.trim() || null } : {}),
        ...(it.fitStatus ? { fitStatus: it.fitStatus } : {}),
      },
    });
    if (it.fitStatus === 'fitted' || it.fitStatus === 'tested') fitted++;
  }
  // The first unit fitted moves a planned / surveyed job to Installing.
  if (fitted && stageIndex(c.stage as InstallStage) < stageIndex('installing')) {
    await db.installationChallan.update({ where: { id }, data: { stage: 'installing' } });
    await log(c.storeId, id, userId, 'Stage', 'Moved to Installing (first unit fitted)', c.stage, 'installing');
  }
}

export async function saveInstallationChecklist(scope: StoreScope, id: string, which: 'survey' | 'testing', values: Record<string, boolean | string | number>, userId: string): Promise<void> {
  const c = await own(scope, id);
  const allowed = new Set<string>([...(which === 'survey' ? SURVEY_ITEMS : TESTING_ITEMS).map((i) => i.key as string), ...(which === 'survey' ? ['cableMetres', 'notes'] : [])]);
  const clean: Record<string, boolean | string | number> = {};
  for (const [k, v] of Object.entries(values)) if (allowed.has(k)) clean[k] = typeof v === 'string' ? v.slice(0, 500) : v;
  await db.installationChallan.update({ where: { id }, data: which === 'survey' ? { surveyJson: clean } : { testingJson: clean } });
  const done = Object.values(clean).filter((v) => v === true).length;
  await log(c.storeId, id, userId, which === 'survey' ? 'Survey' : 'Testing', `${which === 'survey' ? 'Site survey' : 'Testing checklist'} saved (${done} ticked)`);
}

export async function saveInstallationMaterials(scope: StoreScope, id: string, rows: MaterialRow[], userId: string): Promise<void> {
  const c = await own(scope, id);
  const clean = rows.slice(0, 40).map((r) => ({
    name: String(r.name ?? '').trim().slice(0, 120), unit: String(r.unit ?? '').trim().slice(0, 12),
    issued: Math.max(0, Number(r.issued) || 0), used: Math.max(0, Number(r.used) || 0),
    extraPaise: Math.max(0, Math.round(Number(r.extraPaise) || 0)),
  })).filter((r) => r.name);
  await db.installationChallan.update({ where: { id }, data: { materialsJson: clean as unknown as Prisma.InputJsonValue } });
  await log(c.storeId, id, userId, 'Material', `Material recorded (${clean.length} line${clean.length === 1 ? '' : 's'})`);
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
}

export async function addInstallationRemark(scope: StoreScope, id: string, text: string, userId: string): Promise<void> {
  const c = await own(scope, id);
  const t = text.trim();
  if (!t) throw new InstallationChallanError('Write something first.');
  await log(c.storeId, id, userId, 'Remark', t.slice(0, 2000));
}
