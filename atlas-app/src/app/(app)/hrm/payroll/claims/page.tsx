import { requireContext } from '@/server/context';
import { ENCASHMENT_LIST, REIMBURSEMENT_LIST, runCardList } from '@/server/card-lists';
import { listLeaveTypes } from '@/server/leave-types';
import { Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { ClaimsClient } from './ClaimsClient';

export default async function ClaimsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  if (ctx.scope.kind === 'all') {
    return (
      <div>
        <PageHeader badge="EC" title="Encashments & Reimbursements" subtitle="Leave encashment and expense claims" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="Claims are kept per branch." />
        </Card>
      </div>
    );
  }

  const [encashments, reimbursements, leaveTypes] = await Promise.all([
    ENCASHMENT_LIST.load(ctx),
    REIMBURSEMENT_LIST.load(ctx),
    listLeaveTypes(ctx.scope, { activeOnly: true }),
  ]);

  // One page of each on the wire (F1b server paging, 6 Oct 2026).
  const enc = runCardList(ENCASHMENT_LIST, encashments, sp, ctx);
  const reim = runCardList(REIMBURSEMENT_LIST, reimbursements, sp, ctx);

  return (
    <ClaimsClient
      encPage={{ server: enc.server, chipCounts: enc.chipCounts, total: enc.all }}
      reimPage={{ server: reim.server, chipCounts: reim.chipCounts, total: reim.all }}
      encashments={enc.rows.map((e) => ({
        ...e, decidedAt: e.decidedAt?.toISOString() ?? null, createdAt: e.createdAt.toISOString(),
      }))}
      reimbursements={reim.rows.map((r) => ({
        ...r, expenseDate: r.expenseDate.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }))}
      leaveTypes={leaveTypes.map((t) => ({ id: t.id, name: t.name }))}
      canManage={ctx.permissions.has('payroll.process')}
    />
  );
}
