import 'server-only';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { scopeWhere, type StoreScope } from '../store-scope';
import { currentApprovers } from '../approvals';
import { RULE_LABEL, type RuleKey, type ScorecardSettings } from '@/lib/scorecard/settings';
import { median } from '@/lib/scorecard/segments';
import { workingMinutes } from '@/lib/scorecard/period';
import { addEvidence, clearKey, groupBy, newOut, pct, reliability, setVal, type EngineOut } from './common';

/**
 * OFFICE SCORECARD NUMBERS (31 Oct 2026). Spec: "Office metrics" and "Office
 * hygiene". Hygiene is read from the audit trail: a filled customer, site or
 * product changed after the job moved on is a correction, counted against
 * whoever entered the old value - never against the person who fixed it.
 */

const MIN = 60_000, HOUR = 3_600_000;
const DONE = ['resolved', 'closed'];
const digits = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '').slice(-10);

interface AuditRow { id: bigint; tableName: string; rowId: string; action: string; actorId: string | null; changed: unknown; createdAt: Date }

/** A field's value as an audit row recorded it: inserts carry the row, updates [old, new]. */
function setTo(e: AuditRow, field: string): { has: boolean; value: unknown } {
  const c = (e.changed ?? {}) as Record<string, unknown>;
  if (!(field in c)) return { has: false, value: undefined };
  if (e.action === 'insert') return { has: true, value: c[field] };
  const v = c[field];
  return Array.isArray(v) ? { has: true, value: v[1] } : { has: false, value: undefined };
}

export async function officeEngine(
  scope: StoreScope, storeIds: string[], userIds: string[], from: Date, to: Date,
  s: ScorecardSettings, cleared: Set<string>,
): Promise<EngineOut> {
  const out = newOut();
  if (!userIds.length) return out;
  const people = new Set(userIds);
  const range = { gte: from, lt: to };
  const now = Math.min(Date.now(), to.getTime());
  const inPeriod = (t: number) => t >= from.getTime() && t < to.getTime();
  const misses = new Map<string, number>();
  const docs = new Map<string, number>();
  const fixes = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string | null | undefined, n = 1) => { if (k) m.set(k, (m.get(k) ?? 0) + n); };

  /** Count a hygiene hit against `who`, if the rule is on and nobody cleared it. */
  const hit = (rule: RuleKey, who: string | null | undefined, refId: string, refNo: string, href: string, at: Date, text: string, times = 1) => {
    const r = s.rules[rule];
    if (!who || !people.has(who) || !r.on) return;
    if (cleared.has(clearKey(who, rule, refId))) return;
    const weight = (r.kind === 'mistake' ? 2 : r.kind === 'sop' ? 1 : 0) * times;
    bump(misses, who, weight);
    addEvidence(out, who, { metric: 'o_hygiene', ruleKey: rule, refId, refNo, href, at, text: `${RULE_LABEL[rule]}: ${text}`, weight });
  };

  // ---- jobs raised in the period, and what happened to them
  const raised = await db.complaint.findMany({
    where: { ...scopeWhere(scope), deletedAt: null, createdAt: range },
    select: {
      id: true, complaintNo: true, createdAt: true, createdBy: true, ownerId: true, customerId: true, productId: true, siteId: true,
      raisedByPortal: true, status: true, resolvedAt: true, _count: { select: { items: true } },
    },
  });
  const raisedIds = raised.map((c) => c.id);
  const assignActs = raisedIds.length ? await db.complaintActivity.findMany({
    where: { complaintId: { in: raisedIds }, kind: 'assignment', deletedAt: null }, orderBy: { createdAt: 'asc' },
    select: { complaintId: true, createdBy: true, createdAt: true },
  }) : [];
  const firstAssign = new Map<string, { createdBy: string | null; createdAt: Date }>();
  for (const a of assignActs) if (!firstAssign.has(a.complaintId)) firstAssign.set(a.complaintId, a);
  const assignMin = new Map<string, number[]>();
  const multiSite = new Set((await db.partySite.groupBy({
    by: ['partyId'], where: { ...scopeWhere(scope), isActive: true, partyId: { in: [...new Set(raised.map((c) => c.customerId))] } }, _count: { _all: true },
  })).filter((g) => g._count._all > 1).map((g) => g.partyId));

  for (const c of raised) {
    bump(docs, c.createdBy);
    if (c.ownerId && c.ownerId !== c.createdBy) bump(docs, c.ownerId);
    const href = `/services/complaints/${c.id}`;
    const first = firstAssign.get(c.id);
    const startedAt = c.createdAt.getTime();
    if (first) {
      const m = workingMinutes(startedAt, first.createdAt.getTime());
      if (first.createdBy && people.has(first.createdBy)) {
        const l = assignMin.get(first.createdBy) ?? []; l.push(m); assignMin.set(first.createdBy, l);
      }
      if (m > s.limits.unassignedMinutes) hit('c_unassigned', c.ownerId ?? c.createdBy, c.id, c.complaintNo, href, first.createdAt, `assigned after ${Math.round(m)} working minutes`);
    } else if (c.status !== 'cancelled' && workingMinutes(startedAt, now) > s.limits.unassignedMinutes) {
      hit('c_unassigned', c.ownerId ?? c.createdBy, c.id, c.complaintNo, href, c.createdAt, 'still not assigned');
    }
    if (c.raisedByPortal) continue;
    if (!c.siteId && multiSite.has(c.customerId)) hit('c_no_site', c.createdBy, c.id, c.complaintNo, href, c.createdAt, 'customer has more than one site');
    if (!c.productId && c._count.items === 0) hit('c_no_product', c.createdBy, c.id, c.complaintNo, href, c.createdAt, 'no product or equipment');
  }
  if (s.rules.c_duplicate.on) {
    const byCustomer = groupBy(raised.filter((c) => c.productId), (c) => `${c.customerId}|${c.productId}`);
    for (const c of raised) {
      if (!c.productId) continue;
      const earlier = await db.complaint.findFirst({
        where: {
          ...scopeWhere(scope), deletedAt: null, customerId: c.customerId, productId: c.productId, id: { not: c.id },
          createdAt: { lt: c.createdAt, gte: new Date(c.createdAt.getTime() - s.limits.duplicateDays * 24 * HOUR) },
          OR: [{ resolvedAt: null }, { resolvedAt: { gt: c.createdAt } }], status: { not: 'cancelled' },
        },
        select: { complaintNo: true },
      });
      if (earlier && (byCustomer.get(`${c.customerId}|${c.productId}`)?.length ?? 0) > 0) hit('c_duplicate', c.createdBy, c.id, c.complaintNo, `/services/complaints/${c.id}`, c.createdAt, `same as ${earlier.complaintNo}, still open`);
    }
  }

  // ---- corrections of a filled site, customer or product after the job moved on
  const changes = await db.$queryRaw<AuditRow[]>(Prisma.sql`
    SELECT id, "tableName", "rowId", action, "actorId", changed, "createdAt" FROM "AuditEvent"
    WHERE "tableName" IN ('Complaint', 'InstallationChallan', 'ServiceVisit') AND action = 'update'
      AND "storeId" = ANY(${storeIds}) AND "createdAt" >= ${from} AND "createdAt" < ${to}
      AND (jsonb_exists(changed, 'siteId') OR jsonb_exists(changed, 'siteLocation') OR jsonb_exists(changed, 'customerId') OR jsonb_exists(changed, 'productId'))`);
  const rowsTouched = [...new Set(changes.map((c) => c.rowId))];
  const trail = rowsTouched.length ? await db.$queryRaw<AuditRow[]>(Prisma.sql`
    SELECT id, "tableName", "rowId", action, "actorId", changed, "createdAt" FROM "AuditEvent"
    WHERE "rowId" = ANY(${rowsTouched}) AND "tableName" IN ('Complaint', 'InstallationChallan', 'ServiceVisit')
    ORDER BY "createdAt" ASC, id ASC`) : [];
  const trailBy = groupBy(trail, (t) => `${t.tableName}|${t.rowId}`);
  const firstAssignAll = rowsTouched.length ? await db.complaintActivity.groupBy({
    by: ['complaintId'], where: { complaintId: { in: rowsTouched }, kind: 'assignment', deletedAt: null }, _min: { createdAt: true },
  }) : [];
  const assignedAtBy = new Map(firstAssignAll.map((g) => [g.complaintId, g._min.createdAt?.getTime() ?? null]));
  const FIELDS: [string, RuleKey][] = [['siteId', 'c_site_change'], ['siteLocation', 'c_site_change'], ['customerId', 'c_customer_change'], ['productId', 'c_customer_change']];
  const counted = new Set<string>();
  for (const e of changes) {
    const c = (e.changed ?? {}) as Record<string, unknown>;
    const rows = trailBy.get(`${e.tableName}|${e.rowId}`) ?? [];
    const born = rows.find((r) => r.action === 'insert')?.createdAt.getTime() ?? null;
    for (const [field, rule] of FIELDS) {
      const pair = c[field];
      if (!Array.isArray(pair) || pair[0] === null || pair[0] === '' || pair[0] === pair[1]) continue;
      // Moved on: a job once assigned; a challan or visit once past the draft window.
      const movedOn = e.tableName === 'Complaint'
        ? (assignedAtBy.get(e.rowId) ?? Infinity) < e.createdAt.getTime()
        : born !== null && e.createdAt.getTime() - born > s.limits.draftMinutes * MIN;
      if (!movedOn) continue;
      // Who entered the old value: the latest row before this one that set it.
      const before = rows.filter((r) => r.createdAt.getTime() < e.createdAt.getTime() || (r.createdAt.getTime() === e.createdAt.getTime() && r.id < e.id));
      const setter = [...before].reverse().find((r) => { const v = setTo(r, field); return v.has && v.value === pair[0]; });
      if (!setter?.actorId) continue;
      if (setter.actorId === e.actorId && e.createdAt.getTime() - setter.createdAt.getTime() < s.limits.draftMinutes * MIN) continue;
      const refId = `${e.tableName}:${e.rowId}:${field}:${e.createdAt.getTime()}`;
      if (counted.has(`${e.rowId}|${rule}|${e.createdAt.getTime()}`)) continue;
      counted.add(`${e.rowId}|${rule}|${e.createdAt.getTime()}`);
      const label = e.tableName === 'Complaint' ? 'job' : e.tableName === 'InstallationChallan' ? 'installation' : 'visit';
      const href = e.tableName === 'InstallationChallan' ? `/services/installations/${e.rowId}` : e.tableName === 'Complaint' ? `/services/complaints/${e.rowId}` : '/services/board';
      hit(rule, setter.actorId, refId, label, href, e.createdAt, `${field.replace(/Id$/, '')} changed after the ${label} moved on`);
      if (e.actorId && e.actorId !== setter.actorId && people.has(e.actorId)) bump(fixes, e.actorId);
    }
  }

  // ---- site overrides: speed, and far-off pins
  const overrides = await db.siteOverride.findMany({
    where: { ...scopeWhere(scope), deletedAt: null, decidedAt: range },
    select: { id: true, complaintId: true, createdAt: true, decidedAt: true, decidedBy: true, status: true, distanceM: true, complaint: { select: { complaintNo: true, createdBy: true } } },
  });
  const overrideMin = new Map<string, number[]>();
  for (const o of overrides) {
    if (o.decidedBy && people.has(o.decidedBy)) {
      const l = overrideMin.get(o.decidedBy) ?? []; l.push(workingMinutes(o.createdAt.getTime(), o.decidedAt!.getTime())); overrideMin.set(o.decidedBy, l);
      bump(docs, o.decidedBy);
    }
    if (o.status === 'approved' && (o.distanceM ?? 0) > s.limits.overrideFarM) {
      hit('c_site_override', o.complaint.createdBy, o.id, o.complaint.complaintNo, `/services/complaints/${o.complaintId}`, o.decidedAt!, `phone was ${Math.round(o.distanceM ?? 0)} m from the pin`);
    }
  }

  // ---- closing: reopened, office sign-off without a note, closed without a remark, callbacks
  const reopens = await db.complaintActivity.findMany({
    where: { createdAt: range, deletedAt: null, statusFrom: { in: DONE }, NOT: { statusTo: { in: [...DONE, 'cancelled'] } }, complaint: scopeWhere(scope) },
    select: { complaintId: true, createdBy: true, createdAt: true, complaint: { select: { complaintNo: true } } },
  });
  const closesBy = groupBy(reopens.length ? await db.complaintActivity.findMany({
    where: { complaintId: { in: [...new Set(reopens.map((r) => r.complaintId))] }, statusTo: { in: DONE }, deletedAt: null },
    orderBy: { createdAt: 'desc' }, select: { complaintId: true, createdBy: true, createdAt: true },
  }) : [], (a) => a.complaintId);
  for (const r of reopens) {
    const closeAct = (closesBy.get(r.complaintId) ?? []).find((a) => a.createdAt < r.createdAt && a.createdAt.getTime() >= r.createdAt.getTime() - s.limits.reopenDays * 24 * HOUR);
    if (closeAct) hit('k_reopen', closeAct.createdBy, `${r.complaintId}:${r.createdAt.getTime()}`, r.complaint.complaintNo, `/services/complaints/${r.complaintId}`, r.createdAt, r.createdBy ? 'reopened after closing' : 'reopened by the customer', r.createdBy ? 1 : 2);
  }
  const closedJobs = await db.complaint.findMany({
    where: { ...scopeWhere(scope), deletedAt: null, resolvedAt: range },
    select: {
      id: true, complaintNo: true, signOff: true, closeNote: true, closedBy: true, resolvedAt: true, assignedTechnicianId: true,
      activities: { where: { OR: [{ kind: 'remark' }, { statusTo: { in: DONE } }] }, select: { kind: true, statusTo: true, createdBy: true, createdAt: true } },
      visits: { where: { deletedAt: null, outcomeNote: { not: null } }, select: { outcomeNote: true } },
    },
  });
  for (const c of closedJobs) {
    const closer = c.closedBy ?? [...c.activities].reverse().find((a) => a.statusTo && DONE.includes(a.statusTo))?.createdBy ?? null;
    const href = `/services/complaints/${c.id}`;
    if (c.signOff === 'office' && !c.closeNote?.trim()) hit('k_no_code', closer, `${c.id}:code`, c.complaintNo, href, c.resolvedAt!, 'closed by the office without a call note');
    const remark = c.activities.some((a) => a.kind === 'remark' && a.createdBy === c.assignedTechnicianId) || c.visits.some((v) => v.outcomeNote?.trim());
    if (!remark && closer && closer !== c.assignedTechnicianId) hit('k_no_remark', closer, `${c.id}:remark`, c.complaintNo, href, c.resolvedAt!, 'no technician remark on the job');
  }
  const callbacks = await db.complaint.findMany({
    where: { ...scopeWhere(scope), deletedAt: null, needsCallback: true, ratedAt: range },
    select: { id: true, complaintNo: true, ratedAt: true, ownerId: true, createdBy: true, customer: { select: { phone: true } } },
  });
  const cbKept = new Map<string, number>(), cbAll = new Map<string, number>();
  const cbCalls = callbacks.length ? await db.callLog.findMany({
    where: { storeId: { in: storeIds }, deletedAt: null, startedAt: { gte: from, lte: new Date(to.getTime() + s.limits.callbackHours * HOUR) } },
    select: { rawNumber: true, startedAt: true },
  }) : [];
  for (const c of callbacks) {
    const who = c.ownerId ?? c.createdBy;
    const num = digits(c.customer.phone);
    const until = c.ratedAt!.getTime() + s.limits.callbackHours * HOUR;
    const call = num ? cbCalls.find((x) => digits(x.rawNumber) === num && x.startedAt >= c.ratedAt! && x.startedAt.getTime() <= until) : null;
    bump(cbAll, who);
    if (call) bump(cbKept, who);
    else hit('k_callback', who, `${c.id}:callback`, c.complaintNo, `/services/complaints/${c.id}`, c.ratedAt!, `not called within ${s.limits.callbackHours} h`);
  }

  // ---- approvals: speed, waits, escalations
  const approvals = await db.approvalRequest.findMany({
    where: { ...scopeWhere(scope), deletedAt: null, OR: [{ decidedAt: range }, { status: 'PENDING', createdAt: { lt: to } }, { escalatedAt: range }] },
    select: { id: true, storeId: true, entityType: true, requestedBy: true, currentLevel: true, amountPaise: true, status: true, decidedBy: true, decidedAt: true, createdAt: true, escalatedAt: true, title: true, href: true },
  });
  const approvalH = new Map<string, number[]>();
  for (const a of approvals) {
    const waitedH = ((a.decidedAt?.getTime() ?? now) - a.createdAt.getTime()) / HOUR;
    const blame = a.decidedBy ? [a.decidedBy] : a.status === 'PENDING' ? await currentApprovers(a).catch(() => []) : [];
    if (a.decidedBy && a.decidedAt && inPeriod(a.decidedAt.getTime()) && people.has(a.decidedBy)) {
      const l = approvalH.get(a.decidedBy) ?? []; l.push(workingMinutes(a.createdAt.getTime(), a.decidedAt.getTime()) / 60); approvalH.set(a.decidedBy, l);
      bump(docs, a.decidedBy);
    }
    if (waitedH > s.limits.approvalHours) for (const b of blame) hit('a_pending', b, `${a.id}:wait`, a.title ?? 'Approval', a.href ?? '/approvals', a.decidedAt ?? new Date(now), `waited ${Math.round(waitedH)} h`);
    if (a.escalatedAt && inPeriod(a.escalatedAt.getTime())) for (const b of blame) hit('a_escalated', b, `${a.id}:esc`, a.title ?? 'Approval', a.href ?? '/approvals', a.escalatedAt, 'went up a level');
  }

  // ---- challan approvals: speed, and approvals undone
  const challans = await db.jobChallan.findMany({
    where: { ...scopeWhere(scope), deletedAt: null, approvedAt: range },
    select: { approvedBy: true, approvedAt: true, createdAt: true },
  });
  const challanMin = new Map<string, number[]>();
  for (const c of challans) {
    if (!c.approvedBy || !people.has(c.approvedBy)) continue;
    const l = challanMin.get(c.approvedBy) ?? []; l.push(workingMinutes(c.createdAt.getTime(), c.approvedAt!.getTime())); challanMin.set(c.approvedBy, l);
    bump(docs, c.approvedBy);
  }
  if (s.rules.a_reversed.on) {
    const undone = await db.materialIssue.findMany({
      where: { ...scopeWhere(scope), cancelledAt: range, cancelReason: { contains: 'approv', mode: 'insensitive' } },
      select: { id: true, gdnNo: true, cancelledAt: true, challan: { select: { id: true, approvedBy: true, complaintId: true } } },
    });
    for (const u of undone) hit('a_reversed', u.challan.approvedBy, u.id, u.gdnNo, u.challan.complaintId ? `/services/complaints/${u.challan.complaintId}` : '/services/dispatch', u.cancelledAt!, 'GDN cancelled: approved by mistake');
  }

  // ---- billing: revisions after issue, cancel and remake
  const revisions = await db.invoiceRevision.findMany({
    where: { storeId: { in: storeIds }, changedAt: range, deletedAt: null },
    select: { id: true, reason: true, changedAt: true, invoiceId: true },
  });
  const revInvoices = new Map((revisions.length ? await db.invoice.findMany({ where: { id: { in: revisions.map((r) => r.invoiceId) } }, select: { id: true, invoiceNo: true, createdBy: true } }) : []).map((i) => [i.id, i]));
  for (const r of revisions) {
    if (/customer/i.test(r.reason ?? '')) continue;
    const inv = revInvoices.get(r.invoiceId);
    if (inv) hit('b_revision', inv.createdBy, r.id, inv.invoiceNo, `/invoices/${inv.id}`, r.changedAt, r.reason?.trim() || 'changed after issue');
  }
  const invoices = await db.invoice.findMany({
    where: { ...scopeWhere(scope), deletedAt: null, OR: [{ createdAt: range }, { cancelledAt: range }] },
    select: { id: true, invoiceNo: true, partyId: true, createdBy: true, createdAt: true, cancelledAt: true },
  });
  const billed = new Map<string, number>();
  for (const i of invoices) {
    if (inPeriod(i.createdAt.getTime()) && !i.cancelledAt) { bump(billed, i.createdBy); bump(docs, i.createdBy); }
    if (!i.cancelledAt || !inPeriod(i.cancelledAt.getTime()) || !i.partyId) continue;
    const again = invoices.find((x) => x.id !== i.id && x.partyId === i.partyId && x.createdAt.getTime() >= i.cancelledAt!.getTime() - HOUR && x.createdAt.getTime() <= i.cancelledAt!.getTime() + s.limits.recreateHours * HOUR);
    if (again) hit('b_cancel_recreate', i.createdBy, i.id, i.invoiceNo, `/invoices/${i.id}`, i.cancelledAt, `remade as ${again.invoiceNo}`);
  }

  // ---- duplicate customers: a new party with a phone another party already has
  const newParties = await db.$queryRaw<AuditRow[]>(Prisma.sql`
    SELECT id, "tableName", "rowId", action, "actorId", changed, "createdAt" FROM "AuditEvent"
    WHERE "tableName" = 'Party' AND action = 'insert' AND "storeId" = ANY(${storeIds}) AND "createdAt" >= ${from} AND "createdAt" < ${to}`);
  const newNums = newParties.map((p) => digits(String(((p.changed ?? {}) as Record<string, unknown>).phone ?? ''))).filter((n) => n.length === 10);
  const samePhone = newNums.length ? await db.party.findMany({
    where: { storeId: { in: storeIds }, OR: newNums.map((n) => ({ phone: { contains: n } })) }, select: { id: true, phone: true, createdAt: true },
  }) : [];
  for (const p of newParties) {
    const c = (p.changed ?? {}) as Record<string, unknown>;
    const num = digits(typeof c.phone === 'string' ? c.phone : '');
    if (num.length < 10) continue;
    const other = samePhone.find((x) => x.id !== p.rowId && digits(x.phone) === num && x.createdAt < p.createdAt);
    if (other) hit('b_party_dup', p.actorId, p.rowId, String(c.firstName ?? 'Customer'), `/customers/${p.rowId}`, p.createdAt, 'phone already on another customer');
  }

  // ---- edits after a job closed (watch only by default)
  if (s.rules.b_closed_edit.on) {
    const late = await db.$queryRaw<AuditRow[]>(Prisma.sql`
      SELECT e.id, e."tableName", e."rowId", e.action, e."actorId", e.changed, e."createdAt" FROM "AuditEvent" e
      JOIN "Complaint" c ON c.id = e."rowId"
      WHERE e."tableName" = 'Complaint' AND e.action = 'update' AND e."storeId" = ANY(${storeIds})
        AND e."createdAt" >= ${from} AND e."createdAt" < ${to} AND c."closedAt" IS NOT NULL AND e."createdAt" > c."closedAt" + interval '1 minute'
        AND NOT jsonb_exists(e.changed, 'status')`);
    for (const e of late) hit('b_closed_edit', e.actorId, `${e.rowId}:${e.createdAt.getTime()}`, 'job', `/services/complaints/${e.rowId}`, e.createdAt, 'changed after it was closed');
  }

  // ---- throughput the office can count
  const [installs, tasks, calls] = await Promise.all([
    db.installationChallan.groupBy({ by: ['createdBy'], where: { ...scopeWhere(scope), deletedAt: null, createdAt: range, createdBy: { in: userIds } }, _count: { _all: true } }),
    db.task.groupBy({ by: ['assignedToId'], where: { ...scopeWhere(scope), deletedAt: null, completedAt: range, assignedToId: { in: userIds } }, _count: { _all: true } }),
    db.callLog.groupBy({ by: ['userId'], where: { storeId: { in: storeIds }, deletedAt: null, startedAt: range, userId: { in: userIds }, durationSec: { gt: 0 } }, _count: { _all: true } }),
  ]);
  for (const i of installs) bump(docs, i.createdBy, i._count._all);
  const raisedBy = new Map<string, number>();
  for (const c of raised) bump(raisedBy, c.createdBy);
  for (const i of installs) bump(raisedBy, i.createdBy, i._count._all);

  for (const id of userIds) {
    const handled = docs.get(id) ?? 0;
    const missed = misses.get(id) ?? 0;
    // Misses with nothing handled still count: per 100 of at least one document.
    setVal(out, 'o_hygiene', id, handled || missed ? (missed / Math.max(handled, 1)) * 100 : null, Math.max(handled, missed ? 99 : 0));
    setVal(out, 'o_assign', id, median(assignMin.get(id) ?? []), assignMin.get(id)?.length ?? 0);
    setVal(out, 'o_approval', id, median(approvalH.get(id) ?? []), approvalH.get(id)?.length ?? 0);
    setVal(out, 'o_challan', id, median(challanMin.get(id) ?? []), challanMin.get(id)?.length ?? 0);
    setVal(out, 'o_override', id, median(overrideMin.get(id) ?? []), overrideMin.get(id)?.length ?? 0);
    setVal(out, 'o_raised', id, raisedBy.get(id) ?? 0, 99);
    setVal(out, 'o_decisions', id, (approvalH.get(id)?.length ?? 0) + (challanMin.get(id)?.length ?? 0) + (overrideMin.get(id)?.length ?? 0), 99);
    setVal(out, 'o_tasks', id, tasks.find((t) => t.assignedToId === id)?._count._all ?? 0, 99);
    setVal(out, 'o_billed', id, billed.get(id) ?? 0, 99);
    setVal(out, 'o_calls', id, calls.find((c) => c.userId === id)?._count._all ?? 0, 99);
    setVal(out, 'o_callback', id, pct(cbKept.get(id) ?? 0, cbAll.get(id) ?? 0), cbAll.get(id) ?? 0);
    setVal(out, 'o_fixes', id, fixes.get(id) ?? 0, 99);
  }
  await reliability(scope, userIds, from, to, out);
  return out;
}
