import { requireContext } from '@/server/context';
import { creditNotesList } from '@/server/credit-notes-list';
import { listReturnableInvoices } from '@/server/sales-returns';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { CreditNotesClient } from './CreditNotesClient';

/**
 * Credit notes, one page at a time (F1b server paging, 6 Oct 2026): filters,
 * search and sort run on the server (server/credit-notes-list), the tiles count
 * every note, and the export reads every page with the same filters.
 */
export default async function CreditNotesPage({ searchParams }: {
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
      canCredit={ctx.scope.kind === 'single' && ctx.permissions.has('returns.credit')}
      scopeIsAll={ctx.scope.kind === 'all'}
    />
  );
}
