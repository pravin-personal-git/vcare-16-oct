import { requireContext } from '@/server/context';
import { creditNotesList } from '@/server/credit-notes-list';
import { listReturnableInvoices } from '@/server/sales-returns';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { Card } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import Link from 'next/link';
import { CreditNotesClient } from '../../credit-notes/CreditNotesClient';

/**
 * The same credit notes, under Accounts, without the buttons - see the note on
 * the sales-return copy beside this one (9 Oct 2026).
 */
export default async function AccountsCreditNotesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  const [list, invoices] = await Promise.all([
    creditNotesList(ctx, sp),
    listReturnableInvoices(ctx.scope),
  ]);
  const page = slicePage(list.rows, parseGridQuery(sp));

  return (
    <div>
      <Card className="mb-3 flex items-start gap-2.5 px-3 py-2.5">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Read-only, like the rest of Accounts. To raise a credit note, go to{' '}
          <Link href="/credit-notes" className="underline underline-offset-2">Returns &amp; Refunds</Link>.
        </p>
      </Card>

      <CreditNotesClient
        rows={page.rows.map((r) => ({ ...r, creditNoteDate: r.creditNoteDate.toISOString() }))}
        paging={page.paging}
        totals={list.totals}
        customers={list.customers}
        reasons={list.reasons}
        filter={list.card ?? 'all'}
        customer={list.customer}
        reason={list.reason}
        invoices={invoices.map((i) => ({
          id: i.id,
          invoiceNo: i.invoiceNo,
          customerName: i.customerName,
          grandTotalPaise: i.grandTotalPaise,
        }))}
        canCredit={false}
        scopeIsAll={ctx.scope.kind === 'all'}
      />
    </div>
  );
}
