import { requireContext } from '@/server/context';
import { listAccounts } from '@/server/chart-of-accounts';
import { getAmcRevenueMode } from '@/server/amc-revenue';
import { ChartOfAccountsClient } from './ChartOfAccountsClient';
import { AmcRevenueSetting } from './AmcRevenueSetting';

/**
 * Browsing and extending the chart of accounts - one per organisation,
 * shared across every branch, same as the ledger itself.
 */
export default async function ChartOfAccountsPage() {
  const ctx = await requireContext();
  const [accounts, amcMode] = await Promise.all([listAccounts(ctx.organization.id), getAmcRevenueMode(ctx.organization.id)]);

  return (
    <>
      <ChartOfAccountsClient
        accounts={accounts}
        canEdit={ctx.permissions.has('accounts.edit')}
      />
      <AmcRevenueSetting mode={amcMode} canEdit={ctx.permissions.has('accounts.edit')} />
    </>
  );
}
