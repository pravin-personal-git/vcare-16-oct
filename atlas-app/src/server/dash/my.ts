import 'server-only';
import { db } from '../db';
import { scopeWhere } from '../store-scope';
import { listIncentives } from '../incentives';
import { myDeskOptions } from '../my-desk';
import { listNotices } from '../notices';
import { countsAsRevenue } from '@/lib/revenue';
import { addDays, dayEnd, dayStart, monthEnd, monthStart } from '@/lib/dash/period';
import { inrC, num, pct } from '@/lib/dash/format';
import { partyName, proratedTarget, rs, sum, daysSince, type DashCtx } from './common';

export interface MyData {
  name: string;
  role: string;
  isTech: boolean;
  punch: { at: string | null; source: string };
  tech: {
    jobsToday: number; doneToday: number; onsite: number;
    monthJobs: number; rating: string; ratingCount: number; billed: number;
    visits: { t: string; c: string; s: string; st: 'done' | 'onsite' | 'next'; href: string; mapQuery: string | null }[];
  };
  sales: {
    target: number; achieved: number; chase: number; oldest: number | null; incentive: number;
    daily: number[]; cum: number[]; pace: number[]; labels: string[];
  };
  tasks: { id: string; t: string; d: string; tone: 'danger' | 'warning' | 'neutral' }[];
  leaveLeft: number | null;
  newNotices: number;
}

const clock = (d: Date) => { const x = new Date(d.getTime() + 330 * 60_000); const h = x.getUTCHours(); const m = x.getUTCMinutes(); return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h >= 12 ? ' pm' : ' am'}`; };

export async function myDashboard(ctx: DashCtx, user: { id: string; fullName: string; roleNames: string[] }): Promise<MyData> {
  const { scope, now, today } = ctx;
  const w = scopeWhere(scope);
  const mFrom = monthStart(today); const mTo = monthEnd(today);
  const month = { gte: dayStart(mFrom), lt: dayEnd(today) };

  const day = await db.attendanceDay.findFirst({ where: { ...w, userId: user.id, workDate: today }, select: { firstInAt: true, firstInSource: true } });
  const SOURCE: Record<string, string> = { biometric: 'Attendance device', app: 'Phone app', web: 'Website', manual: 'Marked by office' };

  // ---- technician ---------------------------------------------------------------
  const visits = await db.serviceVisit.findMany({
    where: { ...w, technicianId: user.id, scheduledAt: { gte: dayStart(today), lt: dayEnd(addDays(today, 1)) }, status: { not: 'cancelled' } },
    select: {
      scheduledAt: true, checkedInAt: true, completedAt: true, purpose: true, reason: true,
      complaint: { select: { id: true, complaintNo: true, description: true, siteLocation: true, customer: { select: { companyName: true, firstName: true, lastName: true } } } },
    },
    orderBy: { scheduledAt: 'asc' },
  });
  const todays = visits.filter((v) => v.scheduledAt < dayEnd(today));
  const closedMonth = await db.complaint.findMany({ where: { ...w, assignedTechnicianId: user.id, closedAt: month }, select: { techRatingStars: true, invoiceId: true } });
  const rated = closedMonth.filter((c) => c.techRatingStars);
  const invIds = closedMonth.map((c) => c.invoiceId).filter((x): x is string => !!x);
  const billed = invIds.length ? rs((await db.invoice.aggregate({ where: { ...w, id: { in: invIds }, lifecycle: 'sent' }, _sum: { grandTotalPaise: true } }))._sum.grandTotalPaise ?? 0) : 0;
  const assigned = await db.complaint.count({ where: { ...w, assignedTechnicianId: user.id } });
  const isTech = assigned > 0 || visits.length > 0 || user.roleNames.some((r) => /tech|service|engineer/i.test(r));

  // ---- salesperson ----------------------------------------------------------------
  const targets = await db.userTarget.findMany({ where: { ...w, userId: user.id, periodStart: { lte: dayEnd(mTo) }, periodEnd: { gte: dayStart(mFrom) } }, select: { periodStart: true, periodEnd: true, targetPaise: true } });
  const target = rs(proratedTarget(targets, { from: mFrom, to: mTo, label: '' }));
  const orders = await db.salesOrder.findMany({ where: { ...w, salespersonId: user.id, orderDate: month }, select: { orderDate: true, grandTotalPaise: true, fulfilmentStatus: true } });
  const live = orders.filter((o) => countsAsRevenue(o.fulfilmentStatus));
  const dayN = Number(today.slice(8)); const monthN = Number(mTo.slice(8));
  const daily = Array.from({ length: dayN }, (_, i) => {
    const d = addDays(mFrom, i);
    return rs(sum(live.filter((o) => o.orderDate >= dayStart(d) && o.orderDate < dayEnd(d)).map((o) => o.grandTotalPaise)));
  });
  const cum: number[] = []; daily.reduce((a, v, i) => (cum[i] = a + v), 0);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const chase = await db.quotation.findMany({ where: { ...w, salespersonId: user.id, status: 'sent', closedAt: null, OR: [{ sentAt: { lt: weekAgo } }, { sentAt: null, quotationDate: { lt: weekAgo } }] }, select: { sentAt: true, quotationDate: true } });
  const incentives = await listIncentives(scope).catch(() => null);
  const inc = rs(sum((incentives?.rows ?? []).filter((r) => r.salespersonId === user.id && r.quotationDate >= dayStart(mFrom)).map((r) => r.incentivePaise)));

  // ---- tasks, leave, notices ---------------------------------------------------------
  const tasks = await db.task.findMany({
    where: { ...w, assignedToId: user.id, status: { notIn: ['Completed', 'Cancelled'] } },
    orderBy: [{ dueDate: 'asc' }], take: 4, select: { id: true, title: true, dueDate: true },
  });
  const dueLabel = (d: Date | null): { d: string; tone: 'danger' | 'warning' | 'neutral' } => {
    if (!d) return { d: 'Any time', tone: 'neutral' };
    const n = Math.round((dayStart(new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10)).getTime() - dayStart(today).getTime()) / 86_400_000);
    if (n < 0) return { d: 'Overdue', tone: 'danger' };
    if (n === 0) return { d: 'Today', tone: 'danger' };
    if (n === 1) return { d: 'Tomorrow', tone: 'warning' };
    return { d: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d.getTime() + 330 * 60_000).getUTCDay()], tone: 'neutral' };
  };
  const desk = await myDeskOptions(scope, user.id).catch(() => null);
  const leaveLeft = desk ? sum(desk.leaveTypes.map((t) => t.balanceDays ?? 0)) : null;
  const notices = await listNotices(scope).catch(() => []);
  const newNotices = notices.filter((n) => n.createdAt.getTime() > now.getTime() - 7 * 86_400_000).length;

  return {
    name: user.fullName.split(' ')[0],
    role: user.roleNames[0] ?? (isTech ? 'Technician' : 'Staff'),
    isTech,
    punch: { at: day?.firstInAt ? clock(day.firstInAt) : null, source: day?.firstInSource ? SOURCE[day.firstInSource] ?? day.firstInSource : 'Not punched in yet' },
    tech: {
      jobsToday: todays.length, doneToday: todays.filter((v) => v.completedAt).length, onsite: todays.filter((v) => v.checkedInAt && !v.completedAt).length,
      monthJobs: closedMonth.length,
      rating: rated.length ? `★ ${(sum(rated.map((r) => r.techRatingStars!)) / rated.length).toFixed(1)}` : '—', ratingCount: rated.length, billed,
      visits: visits.map((v) => ({
        t: v.scheduledAt < dayEnd(today) ? clock(v.scheduledAt) : `Tomorrow ${clock(v.scheduledAt)}`,
        c: v.complaint ? partyName(v.complaint.customer) : v.purpose === 'installation' ? 'Installation' : 'Visit',
        s: v.complaint ? `${v.complaint.complaintNo} · ${v.complaint.description.slice(0, 48)}` : v.reason,
        st: v.completedAt ? 'done' : v.checkedInAt ? 'onsite' : 'next',
        href: v.complaint ? `/services/complaints/${v.complaint.id}` : '/services/visits',
        mapQuery: v.complaint?.siteLocation ?? null,
      })),
    },
    sales: {
      target, achieved: rs(sum(live.map((o) => o.grandTotalPaise))), chase: chase.length,
      oldest: chase.length ? Math.max(...chase.map((q) => daysSince(q.sentAt ?? q.quotationDate, now))) : null,
      incentive: inc, daily, cum, pace: Array.from({ length: dayN }, (_, i) => target * (i + 1) / monthN), labels: daily.map((_, i) => String(i + 1)),
    },
    tasks: tasks.map((t) => ({ id: t.id, t: t.title, ...dueLabel(t.dueDate) })),
    leaveLeft, newNotices,
  };
}

export { inrC, num, pct };
