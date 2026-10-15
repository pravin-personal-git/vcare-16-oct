import 'server-only';
import { db } from '../db';
import { scopeWhere } from '../store-scope';
import { attendanceMonth } from '../attendance';
import { listLoans } from '../staff-loans';
import { withinUpcomingWindow } from '@/lib/upcoming-events';
import { addDays, dayEnd, dayStart, dowOf, istDay, type Day } from '@/lib/dash/period';
import { inrC, num, pct } from '@/lib/dash/format';
import type { KpiData } from '@/lib/dash/types';
import { delta, pendingApprovals, rs, shortDate, sum, type DashCtx } from './common';

export interface PeopleData {
  kpis: KpiData[];
  today: { head: number; onTime: number; late: number; leave: number; notIn: number };
  notIn: { userId: string; n: string; s: string; t: 'danger' | 'warning' | 'info' | 'success' }[];
  trend: { onTime: number[]; late: number[]; leave: number[]; absent: number[] };
  days14: { day: Day; dow: number; holiday: boolean }[];
  leaveCal: { n: string; days: number[]; st: 'pending' | 'ok' }[];
  payroll: { labels: string[]; net: number[]; pf: number[]; esic: number[]; ids: string[] };
  approvals: { type: string; entityId: string; n: string; s: string; href: string }[];
  approvalsTotal: number;
  depts: { label: string; value: number; id: string | null }[];
  dates: { e: string; n: string; s: string; userId: string }[];
}

export async function peopleDashboard(ctx: DashCtx, userId: string, permissions: ReadonlySet<string>): Promise<PeopleData> {
  const { scope, range, prev, buckets, now, today } = ctx;
  const w = scopeWhere(scope);
  // Whose attendance and leave count here (B4 step 4) - a team lead sees their team.
  const reach = ctx.people ?? null;
  const pf = reach ? { userId: { in: [...reach] } } : {};

  // ---- attendance, by month, for every month the period touches ------------
  const months: { y: number; m: number }[] = [];
  for (let d = `${range.from.slice(0, 7)}-01`; d <= range.to; ) {
    const [y, m] = d.split('-').map(Number); months.push({ y, m: m - 1 });
    d = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  }
  const dayStatus = new Map<string, Map<string, string>>(); // day -> user -> status
  let current = null as Awaited<ReturnType<typeof attendanceMonth>> | null;
  for (const mm of months.slice(-7)) {
    const month = await attendanceMonth(scope, mm.y, mm.m, now, reach).catch(() => null);
    if (!month) continue;
    if (month.isCurrentMonth) current = month;
    month.dates.forEach((date, i) => {
      if (date < range.from || date > range.to || date > today) return;
      const per = dayStatus.get(date) ?? new Map<string, string>();
      for (const row of month.rows) per.set(row.userId, row.days[i]?.status ?? 'absent');
      dayStatus.set(date, per);
    });
  }
  if (!current) {
    const [y, m] = today.split('-').map(Number);
    current = await attendanceMonth(scope, y, m - 1, now, reach).catch(() => null);
  }
  const count = (from: Day, to: Day, st: string[]) => {
    let n = 0;
    for (const [d, per] of dayStatus) if (d >= from && d <= to) for (const s of per.values()) if (st.includes(s)) n++;
    return n;
  };
  const trend = {
    onTime: buckets.map((b) => (b.future ? 0 : count(b.from, b.to, ['present', 'wfh', 'half_day']))),
    late: buckets.map((b) => (b.future ? 0 : count(b.from, b.to, ['late']))),
    leave: buckets.map((b) => (b.future ? 0 : count(b.from, b.to, ['leave']))),
    absent: buckets.map((b) => (b.future ? 0 : count(b.from, b.to, ['absent']))),
  };
  if (buckets[0]?.hour !== undefined) {
    // One day: show it as one column per hour would mean nothing - spread the
    // day's counts on the hour people clocked in instead.
    const per = dayStatus.get(range.from);
    const idx = new Map((current?.rows ?? []).map((r) => [r.userId, r]));
    const onT = buckets.map(() => 0); const lt = buckets.map(() => 0);
    if (per) for (const [uid, s] of per) {
      const row = idx.get(uid); const cell = row?.days.find((x) => x.date === range.from);
      const h = cell?.startedAt ? Number(cell.startedAt.slice(0, 2)) : null;
      if (h === null) continue;
      const i = Math.min(11, Math.max(0, h - 9));
      if (s === 'late') lt[i]++; else if (['present', 'wfh', 'half_day'].includes(s)) onT[i]++;
    }
    trend.onTime = onT; trend.late = lt; trend.leave = buckets.map(() => 0); trend.absent = buckets.map(() => 0);
  }

  const onTimeN = count(range.from, range.to, ['present', 'wfh', 'half_day']);
  const lateN = count(range.from, range.to, ['late']);
  const leaveN = count(range.from, range.to, ['leave']);
  const onTimePct = onTimeN + lateN ? onTimeN / (onTimeN + lateN) : null;

  // ---- today -----------------------------------------------------------------
  const rows = current?.rows ?? [];
  const head = rows.length;
  const tIdx = current?.dates.indexOf(today) ?? -1;
  const t = current?.today;
  const todayCounts = { head, onTime: (t?.present ?? 0) + (t?.wfh ?? 0) + (t?.halfDay ?? 0), late: t?.late ?? 0, leave: t?.onLeave ?? 0, notIn: t?.unmarked ?? 0 };
  const notIn: PeopleData['notIn'] = [];
  if (tIdx >= 0) {
    for (const r of rows) {
      const c = r.days[tIdx]; if (!c) continue;
      if (c.status === 'late') notIn.push({ userId: r.userId, n: r.userName, s: `Late · in ${c.startedAt ?? ''}`.trim(), t: 'warning' });
      else if (c.status === 'leave') notIn.push({ userId: r.userId, n: r.userName, s: 'On leave', t: 'info' });
      else if (c.status === 'absent' || c.status === 'unmarked' as never) notIn.push({ userId: r.userId, n: r.userName, s: 'Not in · no punch', t: 'danger' });
      else if (c.status === 'wfh') notIn.push({ userId: r.userId, n: r.userName, s: 'Working from home', t: 'success' });
    }
  }
  const order = { danger: 0, warning: 1, info: 2, success: 3 };
  notIn.sort((a, b) => order[a.t] - order[b.t]);

  // ---- headcount, joiners, leavers ---------------------------------------------
  const staff = await db.userStoreRole.findMany({ where: { ...w, ...pf, user: { isActive: true } }, distinct: ['userId'], select: { userId: true, user: { select: { fullName: true, departmentId: true, department: { select: { name: true } }, profile: { select: { dateOfBirth: true, dateOfJoining: true, confirmedAt: true } } } } } });
  const monthPrefix = today.slice(0, 7);
  const joined = staff.filter((s) => s.user.profile?.dateOfJoining && istDay(s.user.profile.dateOfJoining).startsWith(monthPrefix)).length;
  const left = await db.employeeProfile.count({ where: { ...pf, exitDate: { gte: dayStart(`${monthPrefix}-01`), lt: dayEnd(today) }, user: { storeRoles: { some: w } } } });

  // ---- leave --------------------------------------------------------------------
  const pendingLeave = await db.leaveRequest.count({ where: { ...w, ...pf, status: 'pending' } });
  const end14 = addDays(today, 13);
  const leaveRows = await db.leaveRequest.findMany({
    where: { ...w, ...pf, status: { in: ['approved', 'pending'] }, kind: 'leave', fromDate: { lt: dayEnd(end14) }, toDate: { gte: dayStart(today) } },
    select: { fromDate: true, toDate: true, status: true, user: { select: { fullName: true } } },
    orderBy: { fromDate: 'asc' }, take: 12,
  });
  const holidays = await db.holiday.findMany({ where: { ...w, date: { gte: dayStart(today), lt: dayEnd(end14) } }, select: { date: true } });
  const holidaySet = new Set(holidays.map((h) => istDay(h.date)));
  const days14 = Array.from({ length: 14 }, (_, i) => { const d = addDays(today, i); return { day: d, dow: dowOf(d), holiday: holidaySet.has(d) || dowOf(d) === 0 }; });
  const leaveCal = leaveRows.map((l) => {
    const f = istDay(l.fromDate); const to = istDay(l.toDate);
    return { n: l.user.fullName, st: (l.status === 'pending' ? 'pending' : 'ok') as 'pending' | 'ok', days: days14.map((d, i) => (d.day >= f && d.day <= to ? i : -1)).filter((i) => i >= 0) };
  });

  // ---- payroll ---------------------------------------------------------------------
  const runs = await db.payrollRun.findMany({
    where: w, orderBy: { periodEnd: 'desc' }, take: 6,
    select: { id: true, label: true, status: true, locked: true, periodStart: true, periodEnd: true, payslips: { select: { grossPaise: true, netPaise: true, lines: { where: { code: { in: ['PF', 'ESIC'] } }, select: { code: true, amountPaise: true } } } } },
  });
  const chron = [...runs].reverse();
  const payroll = {
    labels: chron.map((r) => r.label.split(' ')[0].slice(0, 3)),
    net: chron.map((r) => rs(sum(r.payslips.map((p) => p.netPaise)))),
    pf: chron.map((r) => rs(sum(r.payslips.flatMap((p) => p.lines.filter((l) => l.code === 'PF').map((l) => l.amountPaise))))),
    esic: chron.map((r) => rs(sum(r.payslips.flatMap((p) => p.lines.filter((l) => l.code === 'ESIC').map((l) => l.amountPaise))))),
    ids: chron.map((r) => r.id),
  };
  const inPeriod = runs.filter((r) => r.periodEnd >= dayStart(range.from) && r.periodStart < dayEnd(range.to));
  const shownRuns = inPeriod.length ? inPeriod : runs.slice(0, 1);
  const payCost = rs(sum(shownRuns.flatMap((r) => r.payslips.map((p) => p.grossPaise))));
  const prevRun = runs[shownRuns.length] ?? null;

  // ---- advances ----------------------------------------------------------------------
  const loans = (await listLoans(scope).catch(() => [])).filter((l) => l.kind === 'advance' && l.outstandingPaise > 0);
  const advOut = rs(sum(loans.map((l) => l.outstandingPaise)));
  const recovering = rs(sum(loans.map((l) => l.emiPaise)));

  // ---- approvals ------------------------------------------------------------------------
  const inbox = await pendingApprovals(scope);
  void userId; void permissions;
  const approvals = inbox.slice(0, 4).map((a) => ({ type: a.type, entityId: a.entityId, n: a.requesterName, s: `${a.typeLabel} · ${a.summary ?? a.title}${a.amountPaise ? ` · ${inrC(rs(a.amountPaise))}` : ''}`, href: a.href }));

  // ---- departments ----------------------------------------------------------------------
  const byDept = new Map<string, { n: number; id: string | null }>();
  for (const s of staff) { const k = s.user.department?.name ?? 'No department'; const c = byDept.get(k) ?? { n: 0, id: s.user.departmentId }; c.n++; byDept.set(k, c); }
  const depts = [...byDept.entries()].sort((a, b) => b[1].n - a[1].n).map(([label, c]) => ({ label, value: c.n, id: c.id }));

  // ---- coming up --------------------------------------------------------------------------
  const dates: PeopleData['dates'] = [];
  const nextOf = (d: Date) => { const [y] = today.split('-').map(Number); const x = istDay(d).slice(5); let s = `${y}-${x}`; if (s < today) s = `${y + 1}-${x}`; return s; };
  const when = (d: Day) => (d === today ? 'today' : d === addDays(today, 1) ? 'tomorrow' : shortDate(dayStart(d)));
  for (const s of staff) {
    const p = s.user.profile; if (!p) continue;
    if (p.dateOfBirth && withinUpcomingWindow(p.dateOfBirth, now, 21)) dates.push({ e: '🎂', n: s.user.fullName, s: `Birthday · ${when(nextOf(p.dateOfBirth))}`, userId: s.userId });
    if (p.dateOfJoining && withinUpcomingWindow(p.dateOfJoining, now, 21)) {
      const yrs = Number(nextOf(p.dateOfJoining).slice(0, 4)) - Number(istDay(p.dateOfJoining).slice(0, 4));
      if (yrs > 0) dates.push({ e: '🎉', n: s.user.fullName, s: `${yrs} year${yrs === 1 ? '' : 's'} · ${when(nextOf(p.dateOfJoining))}`, userId: s.userId });
    }
    if (p.dateOfJoining && !p.confirmedAt) {
      const ends = addDays(istDay(p.dateOfJoining), 180);
      if (ends >= today && ends <= addDays(today, 21)) dates.push({ e: '📋', n: s.user.fullName, s: `Probation ends · ${when(ends)}`, userId: s.userId });
    }
  }
  dates.sort((a, b) => a.s.localeCompare(b.s));

  const pplCols = [{ k: 'n', l: 'Person' }, { k: 'd', l: 'Department' }, { k: 'v', l: 'Detail' }];
  const deptOf = new Map(staff.map((s) => [s.userId, s.user.department?.name ?? '—']));
  const kpis: KpiData[] = [
    {
      id: 'p-head', label: 'Headcount', value: num(head || staff.length), d: null, sub: `${joined} joined, ${left} left this month`,
      drill: { title: 'Headcount', value: num(staff.length), cols: [{ k: 'n', l: 'Department' }, { k: 'v', l: 'People', num: true }], rows: depts.map((dd) => ({ n: dd.label, v: dd.value })), route: '/settings/employees' },
    },
    {
      id: 'p-in', label: 'In today', value: `${todayCounts.onTime + todayCounts.late}/${head}`, d: null, sub: `${todayCounts.late} late · ${todayCounts.notIn} not in`, subTone: 'warning',
      drill: { title: 'In today', value: `${todayCounts.onTime + todayCounts.late} of ${head}`, cols: pplCols, rows: notIn.slice(0, 8).map((x) => ({ n: x.n, _href: `/attendance/shifts?user=${x.userId}`, d: deptOf.get(x.userId) ?? '—', v: x.s })), rowsTitle: 'Not in, late or away', route: '/attendance/team-today' },
    },
    {
      id: 'p-ot', label: 'On time', value: onTimePct === null ? '—' : pct(onTimePct, 0), d: null, sub: 'of punches this period',
      drill: { title: 'On time', value: onTimePct === null ? '—' : pct(onTimePct, 0), cols: [{ k: 'n', l: 'Day status' }, { k: 'v', l: 'Person-days', num: true }], rows: [{ n: 'On time', v: onTimeN }, { n: 'Late', v: lateN }, { n: 'On leave', v: leaveN }], route: '/attendance/late-early' },
    },
    {
      id: 'p-leave', label: 'Leave taken', value: `${num(leaveN)} d`, d: null, goodUp: false, sub: `${pendingLeave} request${pendingLeave === 1 ? '' : 's'} waiting`,
      drill: { title: 'Leave taken', value: `${num(leaveN)} days`, goodUp: false, route: '/attendance/monthly-summary', actions: pendingLeave ? [{ label: 'Open waiting requests', icon: 'check', href: '/my/reminders?tab=waiting' }] : [] },
    },
    {
      id: 'p-pay', label: 'Payroll cost', value: inrC(payCost), d: prevRun && !inPeriod.length ? null : delta(payCost, prevRun ? rs(sum(prevRun.payslips.map((p) => p.grossPaise))) : null), goodUp: false,
      sub: shownRuns[0] ? `${shownRuns[0].label} · ${shownRuns[0].locked ? 'locked' : 'not yet locked'}` : 'no payroll run yet',
      drill: { title: 'Payroll cost', value: inrC(payCost), goodUp: false, cols: [{ k: 'n', l: 'Run' }, { k: 'd', l: 'Status' }, { k: 'v', l: 'Gross', num: true }], rows: runs.map((r) => ({ n: r.label, _href: `/hrm/payroll/${r.id}`, d: r.locked ? 'locked' : r.status, v: inrC(rs(sum(r.payslips.map((p) => p.grossPaise)))) })), route: '/hrm/payroll' },
    },
    {
      id: 'p-adv', label: 'Advances out', value: inrC(advOut), d: null, goodUp: false, sub: `${loans.length} staff · recovering ${inrC(recovering)}/month`,
      drill: { title: 'Advances out', value: inrC(advOut), goodUp: false, cols: [{ k: 'n', l: 'Person' }, { k: 'd', l: 'EMI', num: true }, { k: 'v', l: 'Still owed', num: true }], rows: loans.slice(0, 8).map((l) => ({ n: l.userName, d: inrC(rs(l.emiPaise)), v: inrC(rs(l.outstandingPaise)) })), route: '/hrm/loans' },
    },
  ];
  void prev;

  return { kpis, today: todayCounts, notIn: notIn.slice(0, 6), trend, days14, leaveCal, payroll, approvals, approvalsTotal: inbox.length, depts, dates: dates.slice(0, 5) };
}
