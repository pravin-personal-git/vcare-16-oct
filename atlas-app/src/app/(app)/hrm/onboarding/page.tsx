import { requireContext } from '@/server/context';
import { ONBOARDING_LIST, runCardList } from '@/server/card-lists';
import { listChecklistItems } from '@/server/lifecycle';
import { OnboardingClient } from './OnboardingClient';

export default async function OnboardingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [joiners, steps] = await Promise.all([
    ONBOARDING_LIST.load(ctx),
    listChecklistItems(ctx.scope, 'onboarding', { activeOnly: true }),
  ]);

  // One page on the wire (F1b server paging, 6 Oct 2026).
  const list = runCardList(ONBOARDING_LIST, joiners, sp, ctx);

  return (
    <OnboardingClient
      listPage={{ server: list.server, chipCounts: list.chipCounts, total: list.all }}
      joiners={list.rows.map((j) => ({
        ...j,
        dateOfJoining: j.dateOfJoining ? j.dateOfJoining.toISOString() : null,
        confirmedAt: j.confirmedAt ? j.confirmedAt.toISOString() : null,
      }))}
      steps={steps}
      canManage={ctx.permissions.has('hrm.edit')}
    />
  );
}
