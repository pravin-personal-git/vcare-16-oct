import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { billsList } from '@/server/bills-list';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { scopeWhere } from '@/server/store-scope';
import { BillsClient } from './BillsClient';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

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
  const [list, suppliers, products] = await Promise.all([
    billsList(ctx, sp),
    // Suppliers first, but not suppliers only. The shop next door is very often
    // both a customer and a supplier, and making somebody tick a box on the
    // Customers screen before they can enter a bill is friction that teaches
    // nothing - `createBill` flips `isSupplier` by itself the first time.
    db.party.findMany({
      where: { ...scopeWhere(ctx.scope), status: 'active' },
      select: {
        id: true, title: true, firstName: true, lastName: true,
        companyName: true, gstin: true, isSupplier: true, state: true,
      },
      orderBy: [{ isSupplier: 'desc' }, { firstName: 'asc' }],
      take: LIST_MAX_ROWS,
    }),
    db.product.findMany({
      where: { ...scopeWhere(ctx.scope), isActive: true },
      select: {
        id: true, productName: true, productCode: true,
        hsnCode: true, sacCode: true, kind: true, unit: true,
      },
      orderBy: { productName: 'asc' },
      take: LIST_MAX_ROWS,
    }),
  ]);

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
      suppliers={suppliers.map((p) => ({
        id: p.id,
        // Same rule as the server module: company name wins, because suppliers
        // are usually firms and people are usually customers.
        name: p.companyName?.trim()
          || [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim(),
        gstin: p.gstin,
        isSupplier: p.isSupplier,
      }))}
      products={products.map((p) => ({
        id: p.id,
        name: p.productName,
        code: p.productCode,
        // Goods carry an HSN, services carry a SAC. One field on screen; the
        // difference matters to the GST return, not to the person typing.
        hsnCode: p.hsnCode ?? p.sacCode,
        kind: p.kind,
        unit: p.unit,
      }))}
      canEdit={ctx.permissions.has('purchase.edit')}
      canPay={ctx.permissions.has('purchase.pay')}
    />
  );
}
