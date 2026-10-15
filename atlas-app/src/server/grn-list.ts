import 'server-only';
import type { AppContext } from './context';
import { listGrns } from './goods-receipt';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';

/**
 * Goods receipts (GRN), filtered - shared by the screen and its export (F1).
 * A document list: received date defaults to this financial year. A posted
 * receipt is final, so there is no "older still open" notice here.
 */

type Sp = Record<string, string | undefined>;
type Grn = Awaited<ReturnType<typeof listGrns>>[number];
const qty = (g: Grn) => g.items.reduce((n, i) => n + i.qty, 0);
/** Posted, with a line that never reached stock - no product behind it (G1). */
export const addedNoStock = (g: Grn) => g.status === 'posted' && g.items.some((i) => !i.productId);

export const GRN_GRID: PageOptions<Grn> = {
  search: (g) => [g.grnNo, g.supplierName, g.supplierInvoiceNo, g.legacyRef, g.notes],
  sort: { grnNo: (g) => g.grnNo, supplier: (g) => g.supplierName, date: (g) => g.receivedDate, qty, status: (g) => g.status },
};

export async function grnList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const status = sp.status === 'posted' || sp.status === 'cancelled' || sp.status === 'nostock' ? sp.status : null;
  const all = await listGrns(ctx.scope);
  const inScope = all.filter((g) => inRange(g.receivedDate, filters.range));
  const counts = {
    posted: inScope.filter((g) => g.status === 'posted').length,
    cancelled: inScope.filter((g) => g.status === 'cancelled').length,
    noStock: inScope.filter(addedNoStock).length,
    total: inScope.length,
  };
  const picked = status === 'nostock' ? inScope.filter(addedNoStock) : status ? inScope.filter((g) => g.status === status) : inScope;
  const rows = searchAndSort(picked, parseGridQuery(sp), GRN_GRID);
  return { rows, counts, status, filters, totalAll: all.length, qty };
}
