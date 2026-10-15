import 'server-only';
import { salesReach } from './sales-reach';
import type { AppContext } from './context';
import { listInvoices, type InvoiceRow } from './invoices';
import { db } from './db';
import { FEED_MAX_ROWS } from '@/lib/list-limits';
import { scopeWhere } from './store-scope';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { ALL_STATUSES, countByStatus } from '@/lib/invoice-status';

/**
 * The invoice list, filtered - shared by the screen and its export (F1).
 *
 * Invoice date defaults to THIS FINANCIAL YEAR (decision Q3). Money still owed
 * does not expire on 1 April, though, so `olderUnpaid` counts unpaid invoices
 * outside the chosen range and the screen offers them in one click - an old
 * overdue bill must never quietly vanish from the list that chases it.
 */

type Sp = Record<string, string | undefined>;
const UNPAID = new Set(['pending', 'sent', 'partially_paid', 'overdue']);

export const INVOICE_GRID: PageOptions<InvoiceRow> = {
  search: (r) => [r.invoiceNo, r.orderNo, r.customerName, r.organizationName, r.phone, r.gstin, r.salespersonName],
  sort: {
    invoiceNo: (r) => r.invoiceNo, orderNo: (r) => r.orderNo, customerName: (r) => r.customerName, gstin: (r) => r.gstin,
    stateId: (r) => r.stateId, invoiceDate: (r) => r.invoiceDate, dueDate: (r) => r.dueDate, taxableBase: (r) => r.taxableBasePaise,
    cgst: (r) => r.cgstPaise, sgst: (r) => r.sgstPaise, igst: (r) => r.igstPaise, grandTotal: (r) => r.grandTotalPaise,
    due: (r) => r.duePaise, status: (r) => r.status, salespersonName: (r) => r.salespersonName,
  },
};

export async function invoicesList(ctx: AppContext, sp: Sp) {
  const view: 'active' | 'history' = sp.view === 'history' ? 'history' : 'active';
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const card = (ALL_STATUSES as readonly string[]).includes(sp.card ?? '') ? sp.card! : null;

  // Whose invoices this person sees (B4 step 3) - before the counts, so the cards agree.
  const reach = await salesReach(ctx);
  const all = (await listInvoices(ctx.scope, view)).filter((r) => !reach || reach.allows(r.salespersonId));
  const inScope = all.filter((r) => inRange(r.invoiceDate, filters.range));
  const counts = countByStatus(inScope);
  const olderUnpaid = inScope.length === all.length ? 0
    : all.filter((r) => UNPAID.has(r.status) && !inRange(r.invoiceDate, filters.range)).length;

  const query = parseGridQuery(sp);
  /**
   * A serial in the search box finds the invoice it was billed on (15 Oct
   * 2026) - the serial lives on the sold unit, not on the invoice row, so the
   * matching invoice ids are looked up and searched as if they carried it.
   */
  const code = /^[A-Za-z0-9][A-Za-z0-9\-/]{4,}$/.test(query.q) && /\d/.test(query.q);
  const sold = code
    ? new Map((await db.stockUnit.findMany({
      where: { ...scopeWhere(ctx.scope), deletedAt: null, invoiceId: { not: null }, serialNo: { contains: query.q, mode: 'insensitive' } },
      select: { invoiceId: true, serialNo: true }, take: FEED_MAX_ROWS,
    })).map((u) => [u.invoiceId!, u.serialNo]))
    : null;
  const grid: typeof INVOICE_GRID = sold ? { ...INVOICE_GRID, search: (r) => [...INVOICE_GRID.search(r), sold.get(r.id) ?? null] } : INVOICE_GRID;
  const rows = searchAndSort(card ? inScope.filter((r) => r.status === card) : inScope, query, grid);
  return { rows, counts, card, view, filters, query, olderUnpaid };
}
