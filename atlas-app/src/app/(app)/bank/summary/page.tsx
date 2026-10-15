import { requireContext } from '@/server/context';
import { getBankSummary, listStatementLines } from '@/server/bank-summary';
import { BankSummaryClient } from './BankSummaryClient';

export default async function BankSummaryPage() {
  const ctx = await requireContext();
  const { totals, accounts } = await getBankSummary(ctx.scope);

  const initialAccountId = accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? null;
  const initial = initialAccountId ? await listStatementLines(ctx.scope, initialAccountId) : null;

  return (
    <BankSummaryClient
      totals={totals}
      accounts={accounts.map((a) => ({ ...a, lastTxnAt: a.lastTxnAt?.toISOString() ?? null }))}
      initialAccountId={initialAccountId}
      initialLines={
        initial
          ? initial.lines.map((l) => ({ ...l, txnDate: l.txnDate.toISOString(), matchedAt: l.matchedAt?.toISOString() ?? null }))
          : []
      }
      canEdit={ctx.permissions.has('accounts.edit')}
    />
  );
}
