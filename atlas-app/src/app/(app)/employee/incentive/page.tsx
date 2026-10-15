import { requireContext } from '@/server/context';
import { listIncentives } from '@/server/incentives';
import { IncentiveClient } from './IncentiveClient';

export default async function IncentivePage() {
  const ctx = await requireContext();
  const { rows, cards } = await listIncentives(ctx.scope);

  return (
    <IncentiveClient
      rows={rows.map((r) => ({
        ...r,
        quotationDate: r.quotationDate.toISOString(),
        paidAt: r.paidAt?.toISOString() ?? null,
      }))}
      cards={cards}
      canPay={ctx.permissions.has('accounts.edit')}
    />
  );
}
