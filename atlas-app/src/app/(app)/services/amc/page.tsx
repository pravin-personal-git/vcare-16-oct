import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { summariseAmcContracts, sweepExpiredAmcContracts, createContractsForInvoice } from '@/server/amc';
import { amcList } from '@/server/amc-list';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { AmcClient } from './AmcClient';

export default async function AmcPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  /**
   * Move lapsed contracts to `expired` before reading anything.
   *
   * `status` is stored rather than derived so that a manager can override it -
   * a customer who pays late is still covered, and that decision needs
   * somewhere to live. The price of storing it is that something must move it,
   * and with no scheduler in this deployment the honest place is here: a
   * status that updates whenever somebody looks is correct whenever anybody
   * looks, and the alternative - a screen that calls a contract active three
   * months after it ended - is the bug.
   *
   * Sequenced before the reads, not in the Promise.all below, so the list and
   * the totals both see the post-sweep state. Running them concurrently would
   * race: the tiles would count one thing and the grid show another.
   */
  await sweepExpiredAmcContracts(ctx.scope);

  /**
   * Safety net: create any contract an issued invoice owes but does not have.
   *
   * The invoice-issue action already does this immediately, and deliberately
   * does not fail the sale if it throws. This is what makes that choice safe -
   * anything missed there is picked up the next time somebody opens this
   * screen, so a sold AMC cannot be lost, only delayed.
   *
   * Idempotent and cheap: it asks for invoice lines with `amcOpted` and no
   * contract, which is almost always none.
   */
  await createContractsForInvoice(ctx.scope);

  const [list, totals, customers, products, invoices, views, roles] = await Promise.all([
    amcList(ctx, sp),
    summariseAmcContracts(ctx.scope),
    db.party.findMany({
      where: { ...scopeWhere(ctx.scope), isCustomer: true, status: 'active' },
      select: {
        id: true, title: true, firstName: true, lastName: true,
        companyName: true, phone: true, phoneCc: true, city: true,
      },
      orderBy: { firstName: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    db.product.findMany({
      where: { ...scopeWhere(ctx.scope), isActive: true },
      select: { id: true, productName: true, productCode: true, warrantyMonths: true },
      orderBy: { productName: 'asc' },
      take: LIST_MAX_ROWS,
    }),
    // Only issued invoices can have sold a contract - a draft has sold nothing.
    db.invoice.findMany({
      where: { ...scopeWhere(ctx.scope), lifecycle: { not: 'draft' } },
      select: { id: true, invoiceNo: true, customerName: true, partyId: true },
      orderBy: { invoiceDate: 'desc' },
      take: LIST_MAX_ROWS,
    }),
    listSavedViews(ctx, '/services/amc'),
    shareableRoles(ctx),
  ]);

  // One page on the wire (F1b server paging, 6 Oct 2026); totals and tiles still count everything.
  const page = slicePage(list.rows, parseGridQuery(sp));

  return (
    <AmcClient
      paging={page.paging}
      rows={page.rows.map((r) => ({
        ...r,
        startDate: r.startDate.toISOString(),
        endDate: r.endDate.toISOString(),
      }))}
      totals={totals}
      customers={customers.map((c) => ({
        id: c.id,
        name: c.companyName?.trim() || [c.title, c.firstName, c.lastName].filter(Boolean).join(' ').trim(),
        phone: `${c.phoneCc} ${c.phone}`,
        city: c.city,
      }))}
      products={products.map((p) => ({
        id: p.id, name: p.productName, code: p.productCode, warrantyMonths: p.warrantyMonths,
      }))}
      invoices={invoices.map((i) => ({
        id: i.id, invoiceNo: i.invoiceNo, customerName: i.customerName, partyId: i.partyId,
      }))}
      canEdit={ctx.permissions.has('amc.edit')}
      isSingleStore={ctx.scope.kind === 'single'}
      // ?filter= (dashboard tiles) and ?q= (global search) are applied on the server now.
      filter={list.filter}
      rangeLabel={list.filters.range.label}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      initialOpenId={sp.open ?? null}
    />
  );
}
