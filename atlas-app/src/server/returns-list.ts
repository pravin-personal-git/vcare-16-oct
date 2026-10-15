import 'server-only';
import type { AppContext } from './context';
import { listReturns } from './sales-returns';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { inRange, resolveRange } from '@/lib/date-ranges';

/**
 * Sales returns, filtered on the server - shared by the screen (one page at a
 * time) and its export (every page). F1b server paging, 6 Oct 2026; the same
 * filters the screen used to run in the browser.
 *
 * Address: ?card= (draft | uncredited | damaged | cancelled), ?cust=, ?q=,
 * ?sort= &dir=.
 */
type Sp = Record<string, string | undefined>;
export type ReturnListRow = Awaited<ReturnType<typeof listReturns>>[number];

/** Received, not cancelled, and no credit note standing against it. */
export const isUncredited = (r: ReturnListRow) =>
  r.lifecycle === 'received' && !r.creditNotes.some((c) => c.lifecycle === 'issued');

export const RETURN_CARDS: Record<string, (r: ReturnListRow) => boolean> = {
  damaged: (r) => r.damagedQty > 0,
  draft: (r) => r.lifecycle === 'draft',
  uncredited: isUncredited,
  cancelled: (r) => r.lifecycle === 'cancelled',
};

export const RETURN_GRID: PageOptions<ReturnListRow> = {
  search: (r) => [r.returnNo, r.invoiceNo, r.customerName, r.reason],
  sort: {
    returnNo: (r) => r.returnNo, invoice: (r) => r.invoiceNo, customer: (r) => r.customerName,
    date: (r) => r.returnedAt, items: (r) => r.totalQty, disposition: (r) => r.damagedQty,
    value: (r) => r.valuePaise, credit: (r) => r.creditedPaise, status: (r) => r.lifecycle, reason: (r) => r.reason,
  },
};

export interface ReturnTotals {
  all: number; liveCount: number; drafts: number; value: number; uncreditedCount: number;
  uncreditedValue: number; cancelled: number; damaged: number;
}

export function returnTotals(rows: ReturnListRow[]): ReturnTotals {
  const live = rows.filter((r) => r.lifecycle !== 'cancelled');
  const uncredited = rows.filter(isUncredited);
  return {
    all: rows.length,
    liveCount: live.length,
    drafts: rows.filter((r) => r.lifecycle === 'draft').length,
    value: live.reduce((n, r) => n + r.valuePaise, 0),
    uncreditedCount: uncredited.length,
    uncreditedValue: uncredited.reduce((n, r) => n + r.valuePaise, 0),
    cancelled: rows.filter((r) => r.lifecycle === 'cancelled').length,
    damaged: live.reduce((n, r) => n + r.damagedQty, 0),
  };
}

export async function returnsList(ctx: AppContext, sp: Sp) {
  const all = await listReturns(ctx.scope);
  const card = sp.card && RETURN_CARDS[sp.card] ? sp.card : null;
  const customer = sp.cust ?? '';
  // The date filter (9 Oct 2026); totals stay over every return, like Invoices.
  const range = resolveRange({ range: sp.range, from: sp.from, to: sp.to }, 'all');
  const filtered = all.filter((r) => inRange(r.returnedAt, range)
    && (!customer || r.customerName === customer) && (!card || RETURN_CARDS[card](r)));
  return {
    rows: searchAndSort(filtered, parseGridQuery(sp), RETURN_GRID),
    totals: returnTotals(all),
    customers: [...new Set(all.map((r) => r.customerName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    card, customer, rangeLabel: range.label,
  };
}
