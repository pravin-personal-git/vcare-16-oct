import { redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { periodReport } from '@/server/accounting-periods';
import { getFinancialYear } from '@/lib/financial-year';
import { PeriodLockClient } from './PeriodLockClient';

/**
 * Closing the books for a month (3 Oct 2026).
 *
 * `ledger.ts` has always refused to post into a locked period, and until today
 * NOTHING in the codebase ever created an `AccountingPeriod` row - so the table
 * was empty for every tenant and the lock could never fire. Anybody could post
 * into last financial year. This is the key to a lock that already existed.
 */
export default async function PeriodLockPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.view')) redirect('/dashboard');

  const sp = await searchParams;
  const asked = Number(sp.fy);
  const financialYear = Number.isInteger(asked) && asked > 2000 && asked < 2100
    ? asked
    : getFinancialYear();

  const report = await periodReport(ctx.scope, financialYear);

  return (
    <PeriodLockClient
      report={{
        ...report,
        months: report.months.map((m) => ({
          ...m,
          startDate: m.startDate.toISOString(),
          endDate: m.endDate.toISOString(),
          lockedAt: m.lockedAt?.toISOString() ?? null,
        })),
      }}
      thisYear={getFinancialYear()}
      canEdit={ctx.permissions.has('accounts.edit') && ctx.scope.kind === 'single'}
      scopeIsAll={ctx.scope.kind === 'all'}
    />
  );
}
