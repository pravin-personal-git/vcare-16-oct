import { requireContext } from '@/server/context';
import { getTargets, type TargetRow } from '@/server/targets';
import { getFinancialYear } from '@/lib/financial-year';
import { periodContaining, type PeriodType } from '@/lib/target-period';
import { formatCurrency } from '@/lib/format';
import { Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';

/**
 * My Target - read only (5 Oct 2026).
 *
 * Setting targets is a setting, so it lives in Settings > Sales Target and left
 * the Sales menu. A salesperson still needs to see their own number, which is
 * what this is: this month, this quarter and this year, against what their
 * orders have reached. Same figures as the settings screen - one source,
 * `getTargets` - filtered to the person signed in. Open to everyone (`/my`):
 * it only ever shows your own row.
 */
export default async function MyTargetPage() {
  const ctx = await requireContext();
  const fy = getFinancialYear();
  const now = new Date();

  const periods: { type: PeriodType; title: string }[] = [
    { type: 'month', title: 'This month' },
    { type: 'quarter', title: 'This quarter' },
    { type: 'fy', title: 'This financial year' },
  ];
  const mine = await Promise.all(periods.map(async (p) => {
    const view = await getTargets(ctx.scope, { fy, periodType: p.type, periodStart: periodContaining(now, p.type).start });
    return { ...p, row: view.rows.find((r) => r.userId === ctx.user.id) ?? null };
  }));

  const anyTarget = mine.some((m) => (m.row?.targetPaise ?? 0) > 0);

  return (
    <div>
      <PageHeader badge="MT" title="My Target" subtitle="Your sales target and how far your orders have got. Targets are set in Settings › Sales Target." />
      {!anyTarget && (
        <Card className="mb-4 flex items-start gap-2 p-3 text-sm">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <span>No target has been set for you yet. Your sales below still count; ask your manager to set a target.</span>
        </Card>
      )}
      {mine.every((m) => !m.row) ? (
        <EmptyState icon="trending-up" title="Nothing to show" hint="You have no role in this branch, so no sales are counted here." />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {mine.map((m) => <TargetCard key={m.type} title={m.title} row={m.row} />)}
        </div>
      )}
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Counted from sales orders where you are the salesperson, by order date. Cancelled and failed orders do not count.
      </p>
    </div>
  );
}

function TargetCard({ title, row }: { title: string; row: TargetRow | null }) {
  if (!row) return null;
  const pct = row.achievementPct;
  const width = Math.max(0, Math.min(100, pct ?? 0));
  const tone = pct === null ? 'bg-muted-foreground' : pct >= 100 ? 'bg-success' : pct >= 60 ? 'bg-warning' : 'bg-danger';
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">{row.periodLabel}</p>
      <p className="mt-3 font-mono text-2xl font-bold tabular-nums">{formatCurrency(row.achievedPaise)}</p>
      <p className="text-sm text-muted-foreground">
        of {row.targetPaise > 0 ? formatCurrency(row.targetPaise) : 'no target'} · {row.orderCount} order{row.orderCount === 1 ? '' : 's'}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={`h-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs">
        <span className="font-semibold">{pct === null ? '-' : `${Math.round(pct)}%`}</span>
        <span className="text-muted-foreground">
          {row.targetPaise > 0 && row.gapPaise > 0 ? `${formatCurrency(row.gapPaise)} to go` : row.targetPaise > 0 ? 'Target reached' : ''}
        </span>
      </div>
      {row.incentivePaise > 0 && (
        <p className="mt-2 text-xs text-success">Incentive at {row.incentivePct}%: {formatCurrency(row.incentivePaise)}</p>
      )}
    </Card>
  );
}
