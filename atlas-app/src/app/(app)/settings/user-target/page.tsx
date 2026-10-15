import { requireContext } from '@/server/context';
import { getTargets, getMonthlyReport } from '@/server/targets';
import { getFinancialYear } from '@/lib/financial-year';
import type { PeriodType } from '@/lib/target-period';
import { SalesTargetClient } from './SalesTargetClient';

export default async function SalesTargetPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; start?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const fy = getFinancialYear();

  const [view, monthly] = await Promise.all([
    getTargets(ctx.scope, {
      fy,
      periodType: (sp.period as PeriodType) ?? 'fy',
      periodStart: sp.start ? new Date(sp.start) : undefined,
    }),
    getMonthlyReport(ctx.scope, fy),
  ]);

  return (
    <SalesTargetClient
      view={{
        ...view,
        periods: view.periods.map((p) => ({
          type: p.type, label: p.label,
          startIso: p.start.toISOString(), endIso: p.end.toISOString(),
        })),
      }}
      monthly={monthly}
      canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('settings.edit')}
      scopeIsAll={ctx.scope.kind === 'all'}
    />
  );
}
