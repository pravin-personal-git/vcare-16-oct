import { requireContext } from '@/server/context';
import { getOpeningBalance } from '@/server/balance-sheet';
import { OpeningBalanceClient } from './OpeningBalanceClient';
import { istDate } from '@/lib/date-ranges';

export default async function OpeningBalancePage() {
  const ctx = await requireContext();
  const existing = await getOpeningBalance(ctx.scope);

  return (
    <OpeningBalanceClient
      existing={existing ? {
        asOfDate: istDate(existing.asOfDate),
        cashPaise: existing.cashPaise,
        bankPaise: existing.bankPaise,
        capitalPaise: existing.capitalPaise,
        fixedAssetsPaise: existing.fixedAssetsPaise,
        loansPaise: existing.loansPaise,
        note: existing.note,
      } : null}
      canEdit={ctx.permissions.has('accounts.edit')}
      scopeIsAll={ctx.scope.kind === 'all'}
    />
  );
}
