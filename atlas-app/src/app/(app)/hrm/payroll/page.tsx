import { requireContext } from '@/server/context';
import { listPayrollRuns, currentPayrollPeriod } from '@/server/payroll-run';
import { PayrollDashboardClient } from './PayrollDashboardClient';
import { EmptyState, PageHeader } from '@/components/ui/Layout';

export default async function PayrollDashboardPage() {
  const ctx = await requireContext();

  if (ctx.scope.kind !== 'single') {
    return (
      <div>
        <PageHeader badge="₹" title="Payroll Dashboard" subtitle="Cycles, payslips, and totals" />
        <EmptyState
          icon="building"
          title="Choose a branch first"
          hint="Payroll runs per branch - pick one from the branch switcher above."
        />
      </div>
    );
  }

  const [runs, currentPeriod] = await Promise.all([
    listPayrollRuns(ctx.scope),
    currentPayrollPeriod(ctx.scope.storeId),
  ]);

  return (
    <PayrollDashboardClient
      runs={runs.map((r) => ({ ...r, periodStart: r.periodStart.toISOString(), periodEnd: r.periodEnd.toISOString() }))}
      currentPeriodLabel={currentPeriod.label}
      canProcess={ctx.permissions.has('payroll.process')}
    />
  );
}
