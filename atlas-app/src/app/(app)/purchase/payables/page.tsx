import { requireContext } from '@/server/context';
import { listBills, listPayments, supplierBalances } from '@/server/purchases';
import { PayablesClient } from './PayablesClient';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * What the business owes, to whom, and how late.
 *
 * Every figure here is derived from the bills and the payments. `Party.payablePaise`
 * exists in the schema and is deliberately NOT read: it was maintained by hand
 * in the original system and drifted, exactly as `currentBalancePaise` did on
 * the customer side - where it was reporting that nobody owed anything while
 * the invoices said otherwise. Derived, always.
 */
export default async function PayablesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();

  const [balances, openBills, payments] = await Promise.all([
    supplierBalances(ctx.scope),
    listBills(ctx.scope, { take: LIST_MAX_ROWS }),
    listPayments(ctx.scope, { take: LIST_MAX_ROWS }),
  ]);

  return (
    <PayablesClient
      balances={balances.map((b) => ({
        ...b,
        oldestDueDate: b.oldestDueDate?.toISOString() ?? null,
      }))}
      bills={openBills
        .filter((b) => b.lifecycle === 'received' && b.outstandingPaise > 0)
        .map((b) => ({
          id: b.id,
          billNo: b.billNo,
          supplierBillNo: b.supplierBillNo,
          partyId: b.partyId,
          supplierName: b.supplierName,
          dueDate: b.dueDate.toISOString(),
          grandTotalPaise: b.grandTotalPaise,
          outstandingPaise: b.outstandingPaise,
          status: b.status,
        }))}
      payments={payments.map((p) => ({ ...p, paidAt: p.paidAt.toISOString() }))}
      canPay={ctx.permissions.has('purchase.pay')}
      payFor={sp.pay ?? null}
    />
  );
}
