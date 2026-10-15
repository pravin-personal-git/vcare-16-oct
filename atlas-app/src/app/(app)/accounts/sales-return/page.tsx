import { requireContext } from '@/server/context';
import { listReturnableInvoices } from '@/server/sales-returns';
import { returnsList } from '@/server/returns-list';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { Card } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import Link from 'next/link';
import { ReturnsClient } from '../../sales-return/ReturnsClient';

/**
 * THE SAME LIST, UNDER ACCOUNTS, WITHOUT THE BUTTONS (9 Oct 2026).
 *
 * Returns are RECORDED at Returns & Refunds. They are READ here, because a CA
 * or an owner going through the books should not have to leave the Accounts
 * menu to see what came back - and should not be able to record one from a
 * screen they opened to review.
 *
 * It renders the same client with `canEdit` and `canCredit` forced off, rather
 * than a second copy of the table: two tables of the same rows would drift
 * apart the first time either was touched.
 */
export default async function AccountsSalesReturnPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  const [list, invoices] = await Promise.all([
    returnsList(ctx, sp),
    listReturnableInvoices(ctx.scope),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp));

  return (
    <div>
      <Card className="mb-3 flex items-start gap-2.5 px-3 py-2.5">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Read-only, like the rest of Accounts. To record a return, go to{' '}
          <Link href="/sales-return" className="underline underline-offset-2">Returns &amp; Refunds</Link>.
        </p>
      </Card>

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
        canEdit={false}
        canCredit={false}
        scopeIsAll={ctx.scope.kind === 'all'}
      />
    </div>
  );
}
