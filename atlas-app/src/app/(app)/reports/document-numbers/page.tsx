import { redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { documentNumberReport } from '@/server/document-number-report';
import { getFinancialYear } from '@/lib/financial-year';
import { DocumentNumbersClient } from './DocumentNumbersClient';

/**
 * Document numbers - every series, and every gap in it (3 Oct 2026).
 *
 * The screen that answers "where is invoice 0008?". A number is allocated before
 * its document is written, so a failed save used to leave an unexplained hole in
 * a series GST expects to be unbroken.
 *
 * `?fy=` so an auditor can look at last year without changing anything else.
 */
export default async function DocumentNumbersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireContext();
  if (!ctx.permissions.has('accounts.view')) redirect('/dashboard');

  const sp = await searchParams;
  const asked = Number(sp.fy);
  const financialYear = Number.isInteger(asked) && asked > 2000 && asked < 2100
    ? asked
    : getFinancialYear();

  const report = await documentNumberReport(ctx.scope, financialYear);

  return (
    <DocumentNumbersClient
      report={{
        ...report,
        ledgerFrom: report.ledgerFrom?.toISOString() ?? null,
        series: report.series.map((s) => ({
          ...s,
          gaps: s.gaps.map((g) => ({ ...g, allocatedAt: g.allocatedAt?.toISOString() ?? null })),
        })),
      }}
      thisYear={getFinancialYear()}
      scopeIsAll={ctx.scope.kind === 'all'}
    />
  );
}
