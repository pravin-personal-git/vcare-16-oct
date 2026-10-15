import { requireContext } from '@/server/context';
import { transactionsList } from '@/server/transactions-list';
import { listStorePeople } from '@/server/transactions';
import { duplicateExpenses } from '@/server/duplicate-expenses';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { TransactionsClient } from './TransactionsClient';

/** Transactions, one page at a time (F1b server paging, 6 Oct 2026) - filters in server/transactions-list. */
export default async function TransactionsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const [list, people, duplicates] = await Promise.all([
    transactionsList(ctx, sp),
    listStorePeople(ctx.scope),
    // "Is the same spend in here twice under two names?" - see
    // server/duplicate-expenses. Nothing is hidden or merged; it only asks.
    duplicateExpenses(ctx.scope),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp));

  return (
    <TransactionsClient
      rows={page.rows.map((r) => ({ ...r, txnDate: r.txnDate.toISOString() }))}
      paging={page.paging}
      totals={list.totals}
      filter={list.card}
      canEdit={ctx.permissions.has('accounts.edit')}
      canApprove={ctx.permissions.has('accounts.edit')}
      people={people}
      duplicates={duplicates}
    />
  );
}
