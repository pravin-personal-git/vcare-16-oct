import { requireContext } from '@/server/context';
import { listCustomerAccounts } from '@/server/customer-accounts';
import { CustomerAccountClient } from './CustomerAccountClient';

export default async function CustomerAccountPage() {
  const ctx = await requireContext();
  const result = await listCustomerAccounts(ctx.scope);

  return (
    <CustomerAccountClient
      rows={result.rows.map((r) => ({
        ...r,
        oldestUnpaidDueDate: r.oldestUnpaidDueDate?.toISOString() ?? null,
        followUpDate: r.followUpDate?.toISOString() ?? null,
      }))}
      cards={result.cards}
      canEdit={ctx.permissions.has('accounts.edit')}
    />
  );
}
