import { requireContext } from '@/server/context';
import { getHrmDashboard } from '@/server/hrm-dashboard';
import { HrmDashboardClient } from './HrmDashboardClient';

export default async function HrmDashboardPage() {
  const ctx = await requireContext();
  const dashboard = await getHrmDashboard(ctx.scope);

  return (
    <HrmDashboardClient
      dashboard={{
        ...dashboard,
        latestRun: dashboard.latestRun && { ...dashboard.latestRun, periodEnd: dashboard.latestRun.periodEnd.toISOString() },
      }}
    />
  );
}
