import { requireContext } from '@/server/context';
import { listReturnableInvoices } from '@/server/sales-returns';
import { returnsList } from '@/server/returns-list';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { ReturnsClient } from './ReturnsClient';

export default async function SalesReturnPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  // F1b server paging (6 Oct 2026): filters run in server/returns-list, one page is sent.
  const [list, invoices] = await Promise.all([
    returnsList(ctx, sp),
    listReturnableInvoices(ctx.scope),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp));

  return (
    <ReturnsClient
      rows={page.rows}
      paging={page.paging}
      totals={list.totals}
      customers={list.customers}
      filter={list.card ?? 'all'}
      customer={list.customer}
      invoices={invoices.map((i) => ({
        id: i.id,
        invoiceNo: i.invoiceNo,
        invoiceDate: i.invoiceDate.toISOString(),
        customerName: i.customerName,
        grandTotalPaise: i.grandTotalPaise,
        soldQty: i.soldQty,
        returnedQty: i.returnedQty,
      }))}
      canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('returns.edit')}
      canCredit={ctx.scope.kind === 'single' && ctx.permissions.has('returns.credit')}
      scopeIsAll={ctx.scope.kind === 'all'}
    />
  );
}
