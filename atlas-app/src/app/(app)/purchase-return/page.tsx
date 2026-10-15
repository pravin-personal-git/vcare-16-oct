import { requireContext } from '@/server/context';
import { listPurchaseReturns } from '@/server/purchase-returns';
import { PurchaseReturnClient } from './PurchaseReturnClient';

export default async function PurchaseReturnPage() {
  const ctx = await requireContext();
  const rows = await listPurchaseReturns(ctx.scope);

  return (
    <PurchaseReturnClient
      rows={rows.map((r) => ({
        ...r,
        returnedAt: r.returnedAt.toISOString(),
        totalPaise: r.items.reduce((n, i) => n + i.qty * i.unitCostPaise, 0),
        debitNotes: r.debitNotes,
      }))}
      canEdit={ctx.permissions.has('purchase.edit')}
      canIssueDebitNote={ctx.permissions.has('accounts.edit')}
    />
  );
}
