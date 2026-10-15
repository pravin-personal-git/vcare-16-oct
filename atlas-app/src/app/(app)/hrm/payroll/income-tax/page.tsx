import { requireContext } from '@/server/context';
import { listDeclarations, getMyDeclaration } from '@/server/income-tax';
import { getFinancialYear } from '@/lib/financial-year';
import { Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { IncomeTaxClient } from './IncomeTaxClient';

export default async function IncomeTaxPage() {
  const ctx = await requireContext();

  if (ctx.scope.kind === 'all') {
    return (
      <div>
        <PageHeader badge="IT" title="Income Tax Declarations" subtitle="Old-regime deductions, verified before payroll uses them" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="Declarations are kept per branch." />
        </Card>
      </div>
    );
  }

  const financialYear = getFinancialYear();
  const canManage = ctx.permissions.has('payroll.configure');

  const [mine, all] = await Promise.all([
    getMyDeclaration(ctx.scope, ctx.user.id, financialYear),
    canManage ? listDeclarations(ctx.scope, financialYear) : Promise.resolve([]),
  ]);

  return (
    <IncomeTaxClient
      financialYear={financialYear}
      mine={mine ? { ...mine, updatedAt: mine.updatedAt.toISOString() } : null}
      all={all.map((d) => ({ ...d, updatedAt: d.updatedAt.toISOString() }))}
      canManage={canManage}
    />
  );
}
