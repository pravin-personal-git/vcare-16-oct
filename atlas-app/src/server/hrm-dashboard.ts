import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { getAssetDashboard } from './assets';

/**
 * `/hrm` - the HRM segment's own landing page. The Admin Dashboard's HR tab
 * (`dashboard-tabs.ts#getHrTab`) already covers day-to-day attendance in
 * detail; this is deliberately a different job - a command centre over the
 * HRM sub-modules themselves (payroll, approvals, assets, helpdesk), the
 * thing the sidebar's HRM group has never had a landing page for.
 *
 * Does NOT recompute a payroll gross/net figure of its own. `getHrTab`'s
 * `payroll` field reads the legacy flat `EmployeeSalary` table, which the
 * new `SalaryContract`/`PayrollRun` system already supersedes for anyone
 * using it (see the roadmap memory - `EmployeeSalary` stays in-schema
 * unused pending a `/hrm/salary` rebuild). Building a SECOND estimate here,
 * from a third source, is exactly the "two reports disagree about the same
 * number" bug this codebase has a documented history of avoiding elsewhere
 * (`REVENUE_ORDER_WHERE`, `incentivePaise`). Showing the latest real
 * `PayrollRun` instead is honest about what's actually known.
 */

export interface HrmDashboard {
  headcount: number;
  latestRun: { id: string; label: string; status: string; periodEnd: Date } | null;
  approvals: { entityType: string; label: string; count: number }[];
  approvalsTotal: number;
  helpdesk: { open: number; inProgress: number; unassigned: number };
  assets: { total: number; assigned: number; pendingRequests: number };
}

const APPROVAL_LABELS: Record<string, string> = {
  leave: 'Leave',
  wfh: 'Work From Home',
  comp_off: 'Comp-Off Redemption',
  asset_request: 'Asset Requests',
};

export async function getHrmDashboard(scope: StoreScope): Promise<HrmDashboard> {
  // Sequential, not Promise.all - five concurrent DB-touching calls fighting
  // over one PgBouncer connection (connection_limit=1, see CLAUDE.md)
  // doesn't run any faster than sequential, it just adds connection-
  // acquisition contention on top. Found live, 20 Sep 2026, investigating
  // production slowness after the Vcare Global load.
  const headcountRows = await db.userStoreRole.findMany({ where: scopeWhere(scope), distinct: ['userId'], select: { userId: true } });
  const latestRun = await db.payrollRun.findFirst({ where: scopeWhere(scope), orderBy: { periodEnd: 'desc' } });
  const approvalGroups = await db.approvalRequest.groupBy({
    by: ['entityType'],
    where: { ...scopeWhere(scope), status: 'PENDING', entityType: { in: Object.keys(APPROVAL_LABELS) } },
    _count: { _all: true },
  });
  const helpdeskTickets = await db.helpdeskTicket.findMany({ where: scopeWhere(scope), select: { status: true, assignedToId: true } });
  const assetDashboard = await getAssetDashboard(scope);

  const countByType = new Map(approvalGroups.map((g) => [g.entityType, g._count._all]));
  const approvals = Object.entries(APPROVAL_LABELS).map(([entityType, label]) => ({
    entityType, label, count: countByType.get(entityType) ?? 0,
  }));

  return {
    headcount: headcountRows.length,
    latestRun: latestRun && {
      id: latestRun.id, label: latestRun.label, status: latestRun.status, periodEnd: latestRun.periodEnd,
    },
    approvals,
    approvalsTotal: approvals.reduce((n, a) => n + a.count, 0),
    helpdesk: {
      open: helpdeskTickets.filter((t) => t.status === 'open').length,
      inProgress: helpdeskTickets.filter((t) => t.status === 'in_progress').length,
      unassigned: helpdeskTickets.filter((t) => !t.assignedToId && (t.status === 'open' || t.status === 'in_progress')).length,
    },
    assets: {
      total: assetDashboard.total,
      assigned: assetDashboard.assigned,
      pendingRequests: assetDashboard.pendingRequests,
    },
  };
}
