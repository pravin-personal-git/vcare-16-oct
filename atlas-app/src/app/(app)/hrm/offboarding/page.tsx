import { requireContext } from '@/server/context';
import { OFFBOARDING_LIST, runCardList } from '@/server/card-lists';
import { listChecklistItems } from '@/server/lifecycle';
import { OffboardingClient } from './OffboardingClient';

export default async function OffboardingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const canViewAll = ctx.permissions.has('hrm.view') || ctx.permissions.has('hrm.edit');

  const [resignations, steps] = await Promise.all([
    OFFBOARDING_LIST.load(ctx),
    listChecklistItems(ctx.scope, 'offboarding', { activeOnly: true }),
  ]);

  // One page on the wire (F1b server paging, 6 Oct 2026). Whether the viewer
  // has their own resignation pending is read from every row, not the page.
  const list = runCardList(OFFBOARDING_LIST, resignations, sp, ctx);
  const hasOwnPending = resignations.some((r) => r.userId === ctx.user.id && r.status === 'submitted');

  return (
    <OffboardingClient
      listPage={{ server: list.server, chipCounts: list.chipCounts, total: list.all }}
      hasOwnPending={hasOwnPending}
      resignations={list.rows.map((r) => ({
        ...r,
        resignedOn: r.resignedOn.toISOString(),
        lastWorkingDay: r.lastWorkingDay.toISOString(),
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      }))}
      steps={steps}
      canViewAll={canViewAll}
      canManage={ctx.permissions.has('hrm.edit')}
    />
  );
}
