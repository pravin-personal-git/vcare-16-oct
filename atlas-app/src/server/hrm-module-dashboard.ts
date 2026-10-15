import 'server-only';
import { addDays, istToday, istYearMonth, storedBounds } from '@/lib/attendance-day';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { attendanceMonth } from './attendance';
import { HIERARCHY_ROUTED_ENTITIES } from './hierarchy';
import { withinUpcomingWindow } from '@/lib/upcoming-events';

/**
 * `/hrm/dashboard` - a real per-branch summary of HRM data, distinct from
 * `/hrm` (the Homescreen, a quick-nav hub - see `hrm-dashboard.ts`). Confirmed
 * scope, 19 Sep 2026 (HRM-REPLICATION-ROADMAP §4.1a): headcount, attendance,
 * leave, recruitment, payroll, approvals and upcoming events for whichever
 * branch is currently selected.
 *
 * Reuses `attendanceMonth` (the same source the grid and the Admin
 * Dashboard's HR tab already use) rather than re-deriving late/present
 * classification a second way - see `hrm-dashboard.ts`'s own note on why a
 * second estimate of the same fact is a bug waiting to happen, not a
 * convenience.
 *
 * Deliberately does NOT attempt on-time/late/EARLY-departure as a three-way
 * split - `DayStatus` (lib/attendance.ts) has no "early departure" status of
 * its own today. That belongs to Attendance's own "Late Arrival & Early
 * Departure" screen (roadmap §4.3), a dedicated feature, not something to
 * approximate here.
 */

export interface HrmModuleDashboard {
  headcount: { active: number; inactive: number };
  attendanceToday: { present: number; late: number; onLeave: number; wfh: number; halfDay: number; unmarked: number };
  attendanceTrend: { date: string; present: number; late: number; absent: number; onLeave: number }[];

  leave: {
    pendingCount: number;
    upcoming: { userId: string; name: string; fromDate: Date; toDate: Date; typeLabel: string }[];
  };

  recruitment: { openRoles: number; byStage: { stage: string; label: string; count: number }[] };

  payroll: { id: string; label: string; status: string; grossPaise: number; netPaise: number; periodEnd: Date } | null;

  approvals: { entityType: string; label: string; count: number }[];
  approvalsTotal: number;

  upcomingEvents: {
    holidays: { date: Date; name: string }[];
    birthdays: { userId: string; name: string; date: Date }[];
    anniversaries: { userId: string; name: string; date: Date; years: number }[];
  };
}

const STAGE_LABEL: Record<string, string> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  hired: 'Hired',
  rejected: 'Rejected',
};
const FUNNEL_STAGES = ['applied', 'screening', 'interview', 'offer', 'hired'];

const UPCOMING_EVENT_WINDOW_DAYS = 14;
const UPCOMING_LEAVE_WINDOW_DAYS = 14;

export async function getHrmModuleDashboard(scope: StoreScope, now = new Date()): Promise<HrmModuleDashboard> {
  // India days (lib/attendance-day): on the UTC server "today" from the clock
  // was yesterday until 05:30, and a leave ending today dropped off at 05:30.
  const today = istToday(now);
  const window = storedBounds(today, addDays(today, UPCOMING_LEAVE_WINDOW_DAYS));

  // Sequential, not Promise.all - eleven concurrent DB-touching calls
  // fighting over one PgBouncer connection (connection_limit=1, see
  // CLAUDE.md) doesn't run any faster than sequential, it just adds
  // connection-acquisition contention on top. Found live, 20 Sep 2026,
  // investigating production slowness after the Vcare Global load.
  const activeCount = await db.userStoreRole.findMany({ where: { ...scopeWhere(scope), user: { isActive: true } }, distinct: ['userId'], select: { userId: true } });
  const inactiveCount = await db.userStoreRole.findMany({ where: { ...scopeWhere(scope), user: { isActive: false } }, distinct: ['userId'], select: { userId: true } });
  const { year, month: monthIndex } = istYearMonth(now);
  const month = await attendanceMonth(scope, year, monthIndex, now);
  const pendingLeaveCount = await db.leaveRequest.count({ where: { ...scopeWhere(scope), status: 'pending' } });
  const upcomingLeaveRows = await db.leaveRequest.findMany({
    where: {
      ...scopeWhere(scope), status: 'approved', kind: 'leave',
      fromDate: { lte: window.lte }, toDate: { gte: window.gte },
    },
    select: {
      userId: true, fromDate: true, toDate: true,
      user: { select: { fullName: true } }, leaveType: { select: { name: true } },
    },
    orderBy: { fromDate: 'asc' },
    take: 20,
  });
  const openRolesCount = await db.jobOpening.count({ where: { ...scopeWhere(scope), status: 'open' } });
  const stageGroups = await db.candidate.groupBy({ by: ['stage'], where: scopeWhere(scope), _count: { _all: true } });
  const payrollRun = await db.payrollRun.findFirst({
    where: scopeWhere(scope),
    orderBy: { periodEnd: 'desc' },
    include: { payslips: { select: { grossPaise: true, netPaise: true } } },
  });
  const approvalGroups = await db.approvalRequest.groupBy({
    by: ['entityType'],
    where: { ...scopeWhere(scope), status: 'PENDING', entityType: { in: HIERARCHY_ROUTED_ENTITIES.map((e) => e.value) } },
    _count: { _all: true },
  });
  const profileRows = await db.employeeProfile.findMany({
    where: { user: { storeRoles: { some: scopeWhere(scope) } } },
    select: { dateOfBirth: true, dateOfJoining: true, user: { select: { id: true, fullName: true } } },
  });
  const holidayRows = await db.holiday.findMany({
    where: { ...scopeWhere(scope), date: window },
    select: { date: true, name: true },
    orderBy: { date: 'asc' },
  });

  // ---- attendance trend: the last 7 elapsed days of the current month ----
  const todayIndex = month.dates.indexOf(today);
  const trendIndices = todayIndex >= 0
    ? Array.from({ length: Math.min(7, todayIndex + 1) }, (_, i) => todayIndex - (Math.min(7, todayIndex + 1) - 1) + i)
    : [];
  const attendanceTrend = trendIndices.map((idx) => {
    const counts = { present: 0, late: 0, absent: 0, onLeave: 0 };
    for (const row of month.rows) {
      switch (row.days[idx]?.status) {
        case 'present': counts.present += 1; break;
        case 'late': counts.late += 1; break;
        case 'absent': counts.absent += 1; break;
        case 'leave': counts.onLeave += 1; break;
        default: break;
      }
    }
    return { date: month.dates[idx], ...counts };
  });

  const stageCountByKey = new Map(stageGroups.map((g) => [g.stage, g._count._all]));
  const byStage = FUNNEL_STAGES.map((stage) => ({
    stage, label: STAGE_LABEL[stage] ?? stage, count: stageCountByKey.get(stage) ?? 0,
  }));

  const approvalCountByType = new Map(approvalGroups.map((g) => [g.entityType, g._count._all]));
  const approvals = HIERARCHY_ROUTED_ENTITIES.map((e) => ({
    entityType: e.value, label: e.label, count: approvalCountByType.get(e.value) ?? 0,
  }));

  const birthdays: HrmModuleDashboard['upcomingEvents']['birthdays'] = [];
  const anniversaries: HrmModuleDashboard['upcomingEvents']['anniversaries'] = [];
  for (const p of profileRows) {
    if (p.dateOfBirth && withinUpcomingWindow(p.dateOfBirth, now, UPCOMING_EVENT_WINDOW_DAYS)) {
      birthdays.push({ userId: p.user.id, name: p.user.fullName, date: p.dateOfBirth });
    }
    if (p.dateOfJoining && withinUpcomingWindow(p.dateOfJoining, now, UPCOMING_EVENT_WINDOW_DAYS)) {
      const years = year - p.dateOfJoining.getFullYear();
      if (years > 0) anniversaries.push({ userId: p.user.id, name: p.user.fullName, date: p.dateOfJoining, years });
    }
  }

  const grossPaise = payrollRun?.payslips.reduce((n, p) => n + p.grossPaise, 0) ?? 0;
  const netPaise = payrollRun?.payslips.reduce((n, p) => n + p.netPaise, 0) ?? 0;

  return {
    headcount: { active: activeCount.length, inactive: inactiveCount.length },
    attendanceToday: {
      present: month.today.present, late: month.today.late, onLeave: month.today.onLeave,
      wfh: month.today.wfh, halfDay: month.today.halfDay, unmarked: month.today.unmarked,
    },
    attendanceTrend,
    leave: {
      pendingCount: pendingLeaveCount,
      upcoming: upcomingLeaveRows.map((r) => ({
        userId: r.userId, name: r.user.fullName, fromDate: r.fromDate, toDate: r.toDate,
        typeLabel: r.leaveType?.name ?? 'Leave',
      })),
    },
    recruitment: { openRoles: openRolesCount, byStage },
    payroll: payrollRun && {
      id: payrollRun.id, label: payrollRun.label, status: payrollRun.status, periodEnd: payrollRun.periodEnd,
      grossPaise, netPaise,
    },
    approvals,
    approvalsTotal: approvals.reduce((n, a) => n + a.count, 0),
    upcomingEvents: {
      holidays: holidayRows,
      birthdays: birthdays.sort((a, b) => a.date.getDate() - b.date.getDate()),
      anniversaries: anniversaries.sort((a, b) => a.date.getDate() - b.date.getDate()),
    },
  };
}
