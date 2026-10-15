import { field } from '@/server/auth/v1-staff';
import { receiptsList } from '@/server/receipts-list';
import { transactionsList } from '@/server/transactions-list';
import { supplierBalances } from '@/server/purchases';

/**
 * Money on the phone (13 Oct 2026, native admin app part 5): the day's and
 * month's receipts (server/receipts-list), this month's expenses
 * (server/transactions-list) and what we owe suppliers
 * (server/purchases `supplierBalances` - the Payables page). Same lists and
 * rules as the website; Accounts: view.
 */
export async function GET(req: Request) {
  return field(req, ['accounts.view', 'accounts.edit'], null, async (ctx) => {
    const [today, month, txns, payables] = await Promise.all([
      receiptsList(ctx, { range: 'today', pageSize: '200' }),
      receiptsList(ctx, { range: 'this_month', pageSize: '200' }),
      transactionsList(ctx, { range: 'this_month', pageSize: '200' }),
      supplierBalances(ctx.scope),
    ]);
    const owed = payables.filter((p) => p.outstandingPaise > 0).sort((a, b) => b.outstandingPaise - a.outstandingPaise);
    return {
      receiptsToday: { totalPaise: today.totals.received, count: today.totals.liveCount },
      receiptsMonth: { totalPaise: month.totals.received, count: month.totals.liveCount },
      recentReceipts: month.rows.filter((r) => r.status === 'received').slice(0, 30).map((r) => ({
        id: r.id, receiptNo: r.receiptNo, partyName: r.partyName, amountPaise: r.amountPaise, method: r.method, receivedAt: r.receivedAt,
      })),
      expenseMonth: { totalPaise: txns.totals.expense, incomePaise: txns.totals.income, pending: txns.totals.pending },
      recentExpenses: txns.rows.filter((t) => t.txnType === 'expense').slice(0, 30).map((t) => ({
        id: t.id, txnNo: t.txnNo, amountPaise: t.amountPaise, date: t.txnDate, description: t.description, status: t.status, method: t.method,
      })),
      payables: {
        totalPaise: owed.reduce((n, p) => n + p.outstandingPaise, 0),
        suppliers: owed.slice(0, 40).map((p) => ({ partyId: p.partyId, name: p.supplierName, owedPaise: p.outstandingPaise, bills: p.billCount, oldestDueDate: p.oldestDueDate })),
      },
    };
  });
}
