import 'server-only';
import { db } from '../db';
import { scopeWhere } from '../store-scope';
import { technicianReport } from '../technician-performance';
import { getJobSettings } from '../job-settings';
import { slaChecks, SLA_START } from '@/lib/job-sla';
import { addDays, dayEnd, dayStart, daysBetween, intoBuckets, istHour } from '@/lib/dash/period';
import { inrC, inrFull, num, pct } from '@/lib/dash/format';
import type { KpiData } from '@/lib/dash/types';
import { delta, partyName, rs, shortDate, sum, within, daysSince, type DashCtx } from './common';

const DONE = ['resolved', 'closed', 'cancelled'];

/** The complaint page's statuses, folded into the seven steps on the strip. */
export const STAGES: { label: string; statuses: string[]; card: string; tone: string }[] = [
  { label: 'New', statuses: ['received'], card: 'received', tone: 'c6' },
  { label: 'Assigned', statuses: ['assigned', 'accepted'], card: 'assigned', tone: 'c1' },
  { label: 'Visit booked', statuses: ['scheduled'], card: 'scheduled', tone: 'c1' },
  { label: 'In progress', statuses: ['on_the_way', 'on_site', 'in_progress'], card: 'in_progress', tone: 'c2' },
  { label: 'Waiting on customer', statuses: ['awaiting_estimate', 'awaiting_customer'], card: 'awaiting_customer', tone: 'warning' },
  { label: 'With supplier', statuses: [], card: 'open', tone: 'c4' },
  { label: 'Ready to close', statuses: ['resolved'], card: 'resolved', tone: 'success' },
];

export interface TlBlock { s: number; e: number; label: string; st: 'done' | 'onsite' | 'next' | 'late' | 'travel'; time: string; href: string; checkIn: string; photos: string }
export interface ServiceData {
  kpis: KpiData[];
  stages: { label: string; value: number; tone: string; href: string }[];
  openN: number;
  timeline: { name: string; sub: string; phone: string | null; blocks: TlBlock[] }[];
  nowH: number;
  flow: { opened: number[]; closed: number[]; backlog: number[] };
  rma: { label: string; value: number; key: string; rows: { doc: string; sup: string; dk: string; d: number; _href: string }[] }[];
  lateBoxes: { id: string; no: string; sub: string; days: number }[];
  techs: { id: string; n: string; done: number; open: number; days: number | null; ftf: number | null; rate: number | null; billed: number; util: number | null; rows: { doc: string; who: string; r: string; _href: string }[] }[];
  amc: { running: number; ending: number; lapsed: number; total: number; rows: Record<string, { doc: string; who: string; end: string; amt: string; _href: string }[]> };
}

const hm = (d: Date) => { const x = new Date(d.getTime() + 330 * 60_000); return x.getUTCHours() + x.getUTCMinutes() / 60; };
const clock = (h: number) => { const hh = Math.floor(h); const mm = Math.round((h - hh) * 60); return `${hh % 12 || 12}:${String(mm).padStart(2, '0')}`; };

export async function serviceDashboard(ctx: DashCtx): Promise<ServiceData> {
  const { scope, range, prev, buckets, now, today } = ctx;
  // Whose complaints count here (B4 step 4) - the same reach as the complaint
  // list, so a technician's dashboard is their jobs, a team lead's their team's.
  const w = scopeWhere(scope);
  const cw = ctx.complaints ? { AND: [ctx.complaints] } : {};

  // ---- open complaints, by stage -------------------------------------------
  const open = await db.complaint.findMany({
    where: { ...w, ...cw, status: { notIn: DONE } },
    select: {
      id: true, storeId: true, status: true, priority: true, createdAt: true, assignedAt: true, onSiteSince: true, timeOnSiteSec: true, legacyRef: true,
      visits: { where: { checkedInAt: { not: null } }, select: { id: true }, take: 1 },
      replacements: { where: { status: 'sent' }, select: { id: true }, take: 1 },
    },
  });
  const withSupplier = open.filter((c) => c.replacements.length > 0);
  const stages = STAGES.map((s) => {
    const value = s.label === 'With supplier'
      ? withSupplier.length
      : open.filter((c) => c.replacements.length === 0 && s.statuses.includes(c.status)).length;
    return { label: s.label, value, tone: s.tone, href: s.label === 'With supplier' ? '/services/replacements' : `/services/complaints?card=${s.card}` };
  });
  const settings = new Map<string, Awaited<ReturnType<typeof getJobSettings>>>();
  let missed = 0;
  for (const j of open) {
    if (j.legacyRef || j.createdAt < SLA_START) continue;
    if (!settings.has(j.storeId)) settings.set(j.storeId, await getJobSettings(j.storeId));
    if (slaChecks({ status: j.status, priority: j.priority, createdAt: j.createdAt, assignedAt: j.assignedAt, arrived: !!j.onSiteSince || j.timeOnSiteSec > 0 || j.visits.length > 0 }, settings.get(j.storeId)!.sla, now).some((c) => c.state === 'missed')) missed++;
  }

  // ---- in the period ----------------------------------------------------------
  const created = await db.complaint.findMany({ where: { ...w, ...cw, createdAt: within(range) }, select: { id: true, createdAt: true } });
  const closed = await db.complaint.findMany({
    where: { ...w, ...cw, closedAt: within(range) },
    select: {
      id: true, complaintNo: true, createdAt: true, closedAt: true, assignedTechnicianId: true, timeOnSiteSec: true, invoiceId: true,
      customer: { select: { companyName: true, firstName: true, lastName: true } },
      visits: { where: { status: 'completed' }, select: { id: true } },
      techRatingStars: true, ratingStars: true,
    },
  });
  const createdP = prev ? await db.complaint.count({ where: { ...w, ...cw, createdAt: within(prev) } }) : null;
  const closedP = prev ? await db.complaint.findMany({ where: { ...w, ...cw, closedAt: within(prev) }, select: { createdAt: true, closedAt: true, visits: { where: { status: 'completed' }, select: { id: true } } } }) : null;
  const avgDays = (rows: { createdAt: Date; closedAt: Date | null }[]) => rows.length ? sum(rows.map((c) => (c.closedAt!.getTime() - c.createdAt.getTime()) / 86_400_000)) / rows.length : null;
  const ftfOf = (rows: { visits: { id: string }[] }[]) => rows.length ? rows.filter((c) => c.visits.length <= 1).length / rows.length : null;
  const rated = await db.complaint.findMany({ where: { ...w, ...cw, ratedAt: within(range), ratingStars: { not: null } }, select: { ratingStars: true } });
  const ratedP = prev ? await db.complaint.aggregate({ where: { ...w, ...cw, ratedAt: within(prev), ratingStars: { not: null } }, _avg: { ratingStars: true } }) : null;
  const rating = rated.length ? sum(rated.map((r) => r.ratingStars!)) / rated.length : null;
  const low = rated.filter((r) => (r.ratingStars ?? 5) < 3).length;

  const opened = intoBuckets(buckets, created, (c) => c.createdAt, () => 1);
  const closedB = intoBuckets(buckets, closed, (c) => c.closedAt, () => 1);
  // Backlog at the end of each bucket, walked back from what is open now.
  const after = await db.complaint.count({ where: { ...w, ...cw, createdAt: { gte: dayEnd(range.to) } } });
  const closedAfter = await db.complaint.count({ where: { ...w, ...cw, closedAt: { gte: dayEnd(range.to) } } });
  let bl = open.length - after + closedAfter;
  const backlog: number[] = new Array(buckets.length).fill(0);
  for (let i = buckets.length - 1; i >= 0; i--) { backlog[i] = Math.max(0, bl); bl = bl - opened[i] + closedB[i]; }

  const d = avgDays(closed); const dP = closedP ? avgDays(closedP) : null;
  const f = ftfOf(closed); const fP = closedP ? ftfOf(closedP) : null;
  const jobCols = [{ k: 'doc', l: 'Complaint' }, { k: 'who', l: 'Customer' }, { k: 'age', l: 'Age', num: true }];
  const openRows = await db.complaint.findMany({
    where: { ...w, ...cw, status: { notIn: DONE } }, orderBy: { createdAt: 'asc' }, take: 6,
    select: { id: true, complaintNo: true, createdAt: true, customer: { select: { companyName: true, firstName: true, lastName: true } } },
  });
  const chart = { label: 'Opened', data: opened, type: 'bar' as const, fmt: 'num' as const };
  const kpis: KpiData[] = [
    {
      id: 'v-open', label: 'Open complaints', value: num(open.length), d: null, goodUp: false, sub: `${missed} past their deadline`, subTone: missed ? 'danger' : undefined,
      drill: { title: 'Open complaints', value: num(open.length), goodUp: false, chart, rowsTitle: 'Waiting longest', rowsTotal: open.length, cols: jobCols, rows: openRows.map((c) => ({ doc: c.complaintNo, _href: `/services/complaints/${c.id}`, who: partyName(c.customer), age: `${daysSince(c.createdAt, now)} d` })), route: '/services/complaints?card=open' },
    },
    {
      id: 'v-new', label: 'New', value: num(created.length), d: delta(created.length, createdP), goodUp: false, spark: opened, sparkTone: 'brand', sub: 'raised in this period',
      drill: { title: 'New complaints', value: num(created.length), delta: delta(created.length, createdP), goodUp: false, chart, route: withRangeC('/services/complaints', range, { card: 'all' }) },
    },
    {
      id: 'v-closed', label: 'Closed', value: num(closed.length), d: delta(closed.length, closedP?.length ?? null), spark: closedB, sub: created.length ? `${pct(closed.length / created.length, 0)} of new` : 'in this period',
      drill: { title: 'Closed', value: num(closed.length), delta: delta(closed.length, closedP?.length ?? null), chart: { label: 'Closed', data: closedB, fmt: 'num' }, cols: jobCols, rows: closed.slice(0, 6).map((c) => ({ doc: c.complaintNo, _href: `/services/complaints/${c.id}`, who: partyName(c.customer), age: `${((c.closedAt!.getTime() - c.createdAt.getTime()) / 86_400_000).toFixed(1)} d` })), rowsTotal: closed.length, route: '/services/complaints?card=closed' },
    },
    {
      id: 'v-ttc', label: 'Days to close', value: d === null ? '—' : d.toFixed(1), d: d === null ? null : delta(d, dP), goodUp: false, sub: 'average, raise → close',
      drill: { title: 'Days to close', value: d === null ? '—' : d.toFixed(1), goodUp: false, cols: jobCols, rows: [...closed].sort((a, b) => (b.closedAt!.getTime() - b.createdAt.getTime()) - (a.closedAt!.getTime() - a.createdAt.getTime())).slice(0, 6).map((c) => ({ doc: c.complaintNo, _href: `/services/complaints/${c.id}`, who: partyName(c.customer), age: `${((c.closedAt!.getTime() - c.createdAt.getTime()) / 86_400_000).toFixed(1)} d` })), rowsTitle: 'Slowest in this period', route: '/services/complaints?card=closed' },
    },
    {
      id: 'v-ftf', label: 'Fixed first visit', value: f === null ? '—' : pct(f, 0), d: f === null ? null : delta(f, fP), sub: 'no second visit needed',
      drill: { title: 'Fixed first visit', value: f === null ? '—' : pct(f, 0), note: 'Closed jobs that needed one completed visit or none.', route: '/services/complaints?card=closed' },
    },
    {
      id: 'v-rate', label: 'Customer rating', value: rating === null ? '—' : `${rating.toFixed(1)} ★`, d: rating === null ? null : delta(rating, ratedP?._avg.ratingStars ?? null), ink: 'success',
      sub: `${num(rated.length)} ratings · ${low} below 3★`,
      drill: { title: 'Customer rating', value: rating === null ? '—' : `${rating.toFixed(1)} ★`, ink: 'success', route: '/services/complaints?card=closed' },
    },
  ];

  // ---- technicians today ------------------------------------------------------
  const visits = await db.serviceVisit.findMany({
    where: { ...w, scheduledAt: { gte: dayStart(today), lt: dayEnd(today) }, status: { not: 'cancelled' } },
    select: {
      id: true, scheduledAt: true, status: true, checkedInAt: true, completedAt: true, checkInDistanceM: true, purpose: true,
      technician: { select: { id: true, fullName: true, phone: true } },
      complaint: { select: { id: true, complaintNo: true, signOff: true, customer: { select: { companyName: true, firstName: true, lastName: true } } } },
      installationChallan: { select: { id: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });
  const nowH = hm(now);
  const byTech = new Map<string, { name: string; phone: string | null; blocks: TlBlock[] }>();
  for (const v of visits) {
    const t = byTech.get(v.technician.id) ?? { name: v.technician.fullName, phone: v.technician.phone ?? null, blocks: [] };
    const s = hm(v.checkedInAt ?? v.scheduledAt);
    const e = v.completedAt ? hm(v.completedAt) : v.checkedInAt ? Math.max(nowH, s + 0.5) : s + 1;
    const st: TlBlock['st'] = v.completedAt ? 'done' : v.checkedInAt ? 'onsite' : v.scheduledAt < now ? 'late' : 'next';
    const prevBlock = t.blocks[t.blocks.length - 1];
    if (prevBlock && prevBlock.st === 'done' && v.checkedInAt && s - prevBlock.e > 0.1 && s - prevBlock.e < 2) {
      t.blocks.push({ s: prevBlock.e, e: s, label: '', st: 'travel', time: 'travel', href: '', checkIn: '', photos: '' });
    }
    const name = v.complaint ? partyName(v.complaint.customer) : v.purpose === 'installation' ? 'Installation' : 'Visit';
    t.blocks.push({
      s: Math.max(9, s), e: Math.min(19, Math.max(e, s + 0.4)), label: name, st,
      time: st === 'late' ? `booked ${clock(s)}, not started` : `${clock(s)}${v.completedAt ? `-${clock(e)}` : '-'}`,
      href: v.complaint ? `/services/complaints/${v.complaint.id}` : '/services/visits',
      checkIn: v.checkedInAt ? `${clock(hm(v.checkedInAt))}${v.checkInDistanceM !== null ? ` · ${v.checkInDistanceM} m from address` : ''}` : '—',
      photos: v.complaint?.signOff ? v.complaint.signOff : '—',
    });
    byTech.set(v.technician.id, t);
  }
  const timeline = [...byTech.values()].map((t) => ({ ...t, sub: `${t.blocks.filter((b) => b.st !== 'travel').length} jobs` }));

  // ---- with suppliers ---------------------------------------------------------
  const out = await db.replacementCase.findMany({
    where: { ...w, status: 'sent' },
    select: { id: true, caseNo: true, sentAt: true, supplierName: true, docketNo: true, courier: true, dispatchId: true },
  });
  const bands: [string, number, number, string][] = [['0–7 days', 0, 7, 'a'], ['8–15 days', 8, 15, 'b'], ['16–30 days', 16, 30, 'c'], ['Over 30 days', 31, 99999, 'd']];
  const rma = bands.map(([label, lo, hi, key]) => {
    const rows = out.filter((c) => { const dd = c.sentAt ? daysSince(c.sentAt, now) : 0; return dd >= lo && dd <= hi; });
    return {
      label, value: rows.length, key,
      rows: rows.slice(0, 8).map((c) => ({ doc: c.caseNo, _href: c.dispatchId ? `/services/dispatch/${c.dispatchId}` : '/services/replacements', sup: c.supplierName ?? '—', dk: [c.courier, c.docketNo].filter(Boolean).join(' ') || '—', d: c.sentAt ? daysSince(c.sentAt, now) : 0 })),
    };
  });
  const boxes = await db.supplierDispatch.findMany({
    where: { ...w, status: { in: ['sent', 'part_back'] } }, orderBy: { sentAt: 'asc' }, take: 2,
    select: { id: true, dispatchNo: true, supplierName: true, serviceCentre: true, sentAt: true, _count: { select: { cases: true } } },
  });
  const lateBoxes = boxes.map((b) => ({ id: b.id, no: b.dispatchNo, sub: `${b.supplierName ?? b.serviceCentre ?? 'Supplier'} · ${b._count.cases} unit${b._count.cases === 1 ? '' : 's'}`, days: daysSince(b.sentAt, now) }));

  // ---- technician scorecard -----------------------------------------------------
  const storeIds = scope.kind === 'single' ? [scope.storeId] : scope.storeIds;
  const rep = await technicianReport(scope, storeIds, dayStart(range.from), dayEnd(range.to), null, { withKm: false }).catch(() => ({ rows: [] as never[] }));
  const invIds = closed.map((c) => c.invoiceId).filter((x): x is string => !!x);
  const invs = invIds.length ? await db.invoice.findMany({ where: { ...w, id: { in: invIds }, lifecycle: 'sent' }, select: { id: true, grandTotalPaise: true } }) : [];
  const invAmt = new Map(invs.map((i) => [i.id, i.grandTotalPaise]));
  const workDays = Math.max(1, Array.from({ length: daysBetween(range.from, range.to) }, (_, i) => addDays(range.from, i)).filter((x) => new Date(`${x}T00:00:00Z`).getUTCDay() !== 0).length);
  const techs = rep.rows.map((r) => {
    const mine = closed.filter((c) => c.assignedTechnicianId === r.userId);
    return {
      id: r.userId, n: r.name, done: r.closed, open: r.openNow,
      days: r.avgCloseMin === null ? null : r.avgCloseMin / 1440,
      ftf: ftfOf(mine), rate: r.avgRating,
      billed: rs(sum(mine.map((c) => (c.invoiceId ? invAmt.get(c.invoiceId) ?? 0 : 0)))),
      util: mine.length ? Math.min(1, sum(mine.map((c) => c.timeOnSiteSec)) / (workDays * 8 * 3600)) : null,
      rows: mine.slice(0, 6).map((c) => ({ doc: c.complaintNo, _href: `/services/complaints/${c.id}`, who: partyName(c.customer), r: c.techRatingStars ? '★'.repeat(c.techRatingStars) : '—' })),
    };
  }).sort((a, b) => b.done - a.done);

  // ---- maintenance contracts ------------------------------------------------------
  const contracts = await db.amcContract.findMany({
    where: { ...w, status: { in: ['active', 'expired'] } },
    select: { id: true, contractNo: true, status: true, endDate: true, amountPaise: true, customer: { select: { companyName: true, firstName: true, lastName: true } }, _count: { select: { renewedTo: true } } },
    orderBy: { endDate: 'asc' },
  });
  const t0 = dayStart(today).getTime(); const t30 = dayEnd(addDays(today, 30)).getTime(); const yearAgo = dayStart(addDays(today, -365)).getTime();
  const isLapsed = (c: typeof contracts[number]) => c._count.renewedTo === 0 && c.endDate.getTime() < t0 && c.endDate.getTime() >= yearAgo;
  const running = contracts.filter((c) => c.status === 'active' && c.endDate.getTime() >= t30);
  const ending = contracts.filter((c) => c.status === 'active' && c.endDate.getTime() >= t0 && c.endDate.getTime() < t30);
  const lapsed = contracts.filter(isLapsed);
  const amcRow = (c: typeof contracts[number]) => ({ doc: c.contractNo, _href: `/services/amc?open=${c.id}`, who: partyName(c.customer), end: shortDate(c.endDate), amt: inrFull(rs(c.amountPaise)) });

  void inrC; void istHour;
  return {
    kpis, stages, openN: open.length, timeline, nowH,
    flow: { opened, closed: closedB, backlog },
    rma, lateBoxes, techs,
    amc: {
      running: running.length, ending: ending.length, lapsed: lapsed.length, total: running.length + ending.length + lapsed.length,
      rows: { Running: running.slice(0, 6).map(amcRow), 'Ending in 30 days': ending.slice(0, 6).map(amcRow), 'Lapsed - not renewed': lapsed.slice(-6).map(amcRow) },
    },
  };
}

function withRangeC(path: string, r: { from: string; to: string }, extra: Record<string, string>) {
  return `${path}?${new URLSearchParams({ ...extra, range: 'custom', from: r.from, to: r.to }).toString()}`;
}
void shortDate;
