import { requireContext } from '@/server/context';
import { listLoanEligibleUsers } from '@/server/staff-loans';
import { getAdvanceRecovery, plainAdvanceHolders } from '@/server/staff-accounts';
import { loansList } from '@/server/loans-list';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { LoansClient } from './LoansClient';

export default async function LoansPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  if (ctx.scope.kind === 'all') {
    return (
      <div>
        <PageHeader badge="LN" title="Loans & Salary Advances" subtitle="Staff loans, EMI schedules and repayments" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="Loans are kept per branch." />
        </Card>
      </div>
    );
  }

  // F1b server paging (6 Oct 2026): filters run in server/loans-list, one page is sent.
  const [list, employees, views, roles, recovery, plainAdvances] = await Promise.all([
    loansList(ctx, sp),
    listLoanEligibleUsers(ctx.scope),
    listSavedViews(ctx, '/hrm/loans'),
    shareableRoles(ctx),
    // How older, unscheduled advances come back - the card under the list.
    getAdvanceRecovery(ctx.scope),
    plainAdvanceHolders(ctx.scope),
  ]);

  const page = slicePage(list.rows, parseGridQuery(sp));

  return (
    <LoansClient
      paging={page.paging}
      total={list.total}
      statuses={list.statuses}
      loans={page.rows.map((l) => ({ ...l, startPeriod: l.startPeriod.toISOString(), createdAt: l.createdAt.toISOString() }))}
      employees={employees}
      canManage={ctx.permissions.has('payroll.process')}
      views={{ initial: views, roles }}
      recovery={recovery}
      plainAdvances={plainAdvances}
    />
  );
}
