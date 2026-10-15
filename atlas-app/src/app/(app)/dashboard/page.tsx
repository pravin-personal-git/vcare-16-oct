import { requireContext } from '@/server/context';
import { salesReach, withReach } from '@/server/sales-reach';
import { peopleReach } from '@/server/people-reach';
import { visibleComplaintWhere } from '@/server/complaint-visibility';
import { db } from '@/server/db';
import { scopeWhere, type StoreScope } from '@/server/store-scope';
import { readParams } from '@/lib/dash/period';
import { makeCtx } from '@/server/dash/common';
import { businessDashboard } from '@/server/dash/business';
import { accountsDashboard } from '@/server/dash/accounts';
import { serviceDashboard } from '@/server/dash/service';
import { salesDashboard } from '@/server/dash/sales';
import { stockDashboard } from '@/server/dash/stock';
import { peopleDashboard } from '@/server/dash/people';
import { myDashboard } from '@/server/dash/my';
import { DashboardShell, type TabData } from './DashboardShell';
import { allowedDashes, type DashKey } from './dashes';

/**
 * The dashboards (11 Oct 2026, from the approved dashboards demo).
 *
 * Seven dashboards behind one filter bar - period, comparison, branch - kept
 * in the address so a view can be bookmarked and shared. Only the dashboard
 * being looked at is loaded: each is a dozen queries, and the first screen
 * after sign-in should not wait on six it is not showing.
 *
 * Who sees what: `dashboard.view` opens all of them (it always has - the
 * business dashboard is the owner's screen). Without it, a dashboard opens
 * for whoever holds that module's own view permission - an accountant gets
 * Accounts, a service manager Service - and everyone gets My day. The
 * standalone Accounts and HRM dashboards now redirect to their tab here.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const params = readParams(sp);
  const tabs = allowedDashes(ctx.permissions, ctx.excludedModules, ctx.menuRoutes);
  const asked = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) as DashKey | undefined;
  const tab: DashKey = asked && tabs.includes(asked) ? asked : tabs[0];

  // The branch picker narrows an All Company view to one branch - never
  // widens a single-branch one, and never to a branch outside the person's own.
  let scope: StoreScope = ctx.scope;
  const branches = ctx.scope.kind === 'all' ? ctx.stores.map((s) => ({ id: s.id, name: s.name })) : [];
  if (ctx.scope.kind === 'all' && params.branch !== 'all' && ctx.scope.storeIds.includes(params.branch)) {
    scope = { kind: 'single', storeId: params.branch, writable: false };
  } else {
    params.branch = 'all';
  }
  const single = ctx.scope.kind === 'single' ? ctx.stores.find((s) => s.id === (ctx.scope as { storeId: string }).storeId) : null;

  const dctx = makeCtx(scope, params);
  // Whose quotations, orders and invoices count on the Sales dashboard (B4 step 3).
  const reach = await salesReach(ctx);
  dctx.sales = reach;
  // Whose attendance and leave count on the People dashboard (B4 step 4).
  dctx.people = await peopleReach(ctx);
  // Whose complaints count on the Service dashboard (B4 step 4).
  dctx.complaints = await visibleComplaintWhere(ctx);
  const w = scopeWhere(scope);
  const counts: Record<string, number> = {};
  let payload: TabData;

  switch (tab) {
    case 'business': {
      const data = await businessDashboard(dctx);
      counts.approvals = data.needs[0]?.count ?? 0;
      payload = { tab, data };
      break;
    }
    case 'accounts': payload = { tab, data: await accountsDashboard(dctx) }; break;
    case 'service': {
      payload = { tab, data: await serviceDashboard(dctx) };
      counts.complaints = payload.data.openN;
      counts.dispatch = await db.supplierDispatch.count({ where: { ...w, status: { in: ['sent', 'part_back'] } } });
      counts.amc = payload.data.amc.ending;
      break;
    }
    case 'sales': {
      payload = { tab, data: await salesDashboard(dctx) };
      counts.leads = await db.lead.count({ where: { ...w, isClosed: false } });
      counts.quotations = await db.quotation.count({ where: withReach({ ...w, closedAt: null, status: 'sent' }, reach) });
      counts.orders = await db.salesOrder.count({ where: withReach({ ...w, closedAt: null, fulfilmentStatus: { notIn: ['delivered', 'cancelled'] } }, reach) });
      break;
    }
    case 'stock': payload = { tab, data: await stockDashboard(dctx) }; break;
    case 'people': {
      payload = { tab, data: await peopleDashboard(dctx, ctx.user.id, ctx.permissions) };
      counts.leave = await db.leaveRequest.count({ where: { ...w, ...(dctx.people ? { userId: { in: [...dctx.people] } } : {}), status: 'pending' } });
      counts.helpdesk = await db.helpdeskTicket.count({ where: { ...w, status: { in: ['open', 'in_progress'] } } }).catch(() => 0);
      break;
    }
    case 'my':
    default:
      payload = { tab: 'my', data: await myDashboard(dctx, { id: ctx.user.id, fullName: ctx.user.fullName, roleNames: ctx.roleNames }) };
  }

  return (
    <DashboardShell
      userId={ctx.user.id}
      tabs={tabs}
      params={params}
      rangeLabel={dctx.range.label}
      compareLabel={dctx.prev?.label ?? null}
      gran={dctx.gran}
      buckets={dctx.buckets}
      today={dctx.today}
      branches={branches.length > 1 ? branches : []}
      singleName={single?.name ?? null}
      counts={counts}
      payload={payload}
    />
  );
}
