import 'server-only';
import type { AppContext } from './context';
import { listTransactions, type TransactionRow } from './transactions';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { inRange, resolveRange } from '@/lib/date-ranges';

/**
 * Transactions (expense / income / transfer), filtered on the server - shared
 * by the screen (one page at a time) and its export (every page). F1b server
 * paging, 6 Oct 2026.
 *
 * Address: ?card= (pending | expense | income | transfer), ?q=, ?sort= &dir=.
 */
type Sp = Record<string, string | undefined>;

export const TXN_CARDS: Record<string, (r: TransactionRow) => boolean> = {
  pending: (r) => r.status === 'pending',
  expense: (r) => r.txnType === 'expense',
  income: (r) => r.txnType === 'income',
  transfer: (r) => r.txnType === 'transfer',
};

export const TXN_GRID: PageOptions<TransactionRow> = {
  // `paidToName` so searching a technician's name finds the fuel and welfare
  // cash handed to them (8 Oct 2026).
  search: (r) => [r.txnNo, r.description, r.txnType, r.status, r.paidToName],
  sort: {
    txnNo: (r) => r.txnNo, type: (r) => r.txnType, txnDate: (r) => r.txnDate, amount: (r) => r.amountPaise,
    description: (r) => r.description, status: (r) => r.status, paidTo: (r) => r.paidToName ?? '',
    category: (r) => (r.txnType === 'transfer' ? `${r.fromAccountCode ?? ''}>${r.toAccountCode ?? ''}` : r.categoryAccountCode ?? ''),
  },
};

export interface TxnTotals { all: number; expense: number; income: number; transfer: number; pending: number }

export function txnTotals(rows: TransactionRow[]): TxnTotals {
  const live = rows.filter((r) => r.status === 'approved');
  const sum = (t: string) => live.filter((r) => r.txnType === t).reduce((n, r) => n + r.amountPaise, 0);
  return { all: rows.length, expense: sum('expense'), income: sum('income'), transfer: sum('transfer'), pending: rows.filter((r) => r.status === 'pending').length };
}

export async function transactionsList(ctx: AppContext, sp: Sp) {
  const all = await listTransactions(ctx.scope);
  // The date filter (9 Oct 2026, ?range= &from= &to=, default all time). The
  // tiles follow it too: "expense this month" is the question being asked -
  // these are money that moved in a period, not a balance still owed.
  const range = resolveRange({ range: sp.range, from: sp.from, to: sp.to }, 'all');
  const dated = all.filter((r) => inRange(r.txnDate, range));
  const card = sp.card && TXN_CARDS[sp.card] ? sp.card : null;
  const filtered = card ? dated.filter(TXN_CARDS[card]) : dated;
  return { rows: searchAndSort(filtered, parseGridQuery(sp), TXN_GRID), totals: txnTotals(dated), card, rangeLabel: range.label };
}
