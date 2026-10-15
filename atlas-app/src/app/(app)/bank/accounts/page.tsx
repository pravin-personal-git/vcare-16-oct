import { requireContext } from '@/server/context';
import { listBankAccounts } from '@/server/bank-accounts';
import { BankAccountsClient } from './BankAccountsClient';

export default async function BankAccountsPage() {
  const ctx = await requireContext();
  const accounts = await listBankAccounts(ctx.scope);

  return (
    <BankAccountsClient
      accounts={accounts.map((a) => ({
        id: a.id,
        accountHolderName: a.accountHolderName,
        bankName: a.bankName,
        accountNumber: a.accountNumber,
        ifsc: a.ifsc,
        branch: a.branch,
        isDefault: a.isDefault,
        showOnDocuments: a.showOnDocuments,
        isActive: a.isActive,
      }))}
      canEdit={ctx.permissions.has('settings.edit')}
      isSingleStore={ctx.scope.kind === 'single'}
    />
  );
}
