import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { billsList } from '@/server/bills-list';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { scopeWhere } from '@/server/store-scope';
import { BillsClient } from './BillsClient';
import { unbilledReceipts } from '@/server/purchases';

/**
 * Every supplier bill, and what is still owed on each.
 *
 * This screen is the keystone described in ROAD-TO-FIRST-CLIENT §7. Four other
 * things were blocked behind it: payables, the supplier ledger, true stock cost
 * and every financial report - a profit and loss statement with no purchases in
 * it is a list of revenue.
 */
export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  // F1b server paging (6 Oct 2026): filters run in server/bills-list, one page is sent.
  const [list, unbilled, awaited] = await Promise.all([
    billsList(ctx, sp),
    // Goods in with nothing owed, and bills owed with goods not in (28 Oct 2026) -
    // counted from the day the bill form started asking, so old receipts do not cry wolf.
    unbilledReceipts(ctx.scope),
    db.purchaseBill.count({ where: { ...scopeWhere(ctx.scope), lifecycle: 'received', goodsStatus: 'awaited' } }),
  ]);
  const since = new Date('2026-10-28T00:00:00+05:30');

  const page = slicePage(list.rows, parseGridQuery(sp));

  return (
    <BillsClient
      rangeLabel={list.rangeLabel}
      paging={page.paging}
      total={list.total}
      totals={list.totals}
      supplierNames={list.suppliers}
      card={list.card}
      supplier={list.supplier}
      bills={page.rows.map((b) => ({
        ...b,
        billDate: b.billDate.toISOString(),
        dueDate: b.dueDate.toISOString(),
      }))}
      unbilled={unbilled.filter((g) => g.createdAt >= since).map((g) => ({ id: g.id, grnNo: g.grnNo, supplierName: g.supplierName, receivedDate: g.receivedDate.toISOString(), valuePaise: g.valuePaise }))}
      awaited={awaited}
      canEdit={ctx.permissions.has('purchase.edit')}
      canPay={ctx.permissions.has('purchase.pay')}
    />
  );
}
