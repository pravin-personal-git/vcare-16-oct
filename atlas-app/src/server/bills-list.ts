import 'server-only';
import type { AppContext } from './context';
import { listBills, type BillRow } from './purchases';
import { awaitingApproval } from './approvals';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { istDate, resolveRange } from '@/lib/date-ranges';

/**
 * Purchase bills, filtered on the server - shared by the screen (one page at
 * a time) and its export (every page). F1b server paging, 6 Oct 2026; the same
 * filters the screen used to run in the browser.
 *
 * Address: ?range= &from= &to= (default all time; an old ?days= still works), ?card= (owed | overdue |
 * drafts), ?supplier=, ?q=, ?sort= &dir=.
 */
type Sp = Record<string, string | undefined>;
export type BillListRow = BillRow & { awaitingApproval: boolean };

export const BILL_CARDS: Record<string, (b: BillListRow) => boolean> = {
  owed: (b) => b.lifecycle === 'received' && b.outstandingPaise > 0,
  overdue: (b) => b.status === 'overdue',
  drafts: (b) => b.status === 'draft',
};

export const BILL_GRID: PageOptions<BillListRow> = {
  search: (b) => [b.billNo, b.supplierBillNo, b.supplierName, b.status],
  sort: {
    billNo: (b) => b.billNo, supplier: (b) => b.supplierName, date: (b) => b.billDate, due: (b) => b.dueDate,
    total: (b) => b.grandTotalPaise, owed: (b) => b.outstandingPaise, status: (b) => b.status,
  },
};

export interface BillTotals { owed: number; overdue: number; purchased: number; drafts: number; count: number }

export function billTotals(bills: BillListRow[]): BillTotals {
  const live = bills.filter((b) => b.lifecycle === 'received');
  return {
    owed: live.reduce((n, b) => n + b.outstandingPaise, 0),
    overdue: live.filter((b) => b.status === 'overdue').reduce((n, b) => n + b.outstandingPaise, 0),
    purchased: live.reduce((n, b) => n + b.grandTotalPaise, 0),
    drafts: bills.filter((b) => b.lifecycle === 'draft').length,
    count: live.length,
  };
}

export const billDays = (sp: Sp) => Math.min(365, Math.max(1, Number(sp.days) || 90));

export async function billsList(ctx: AppContext, sp: Sp) {
  const days = billDays(sp);
  /*
    THE STANDARD DATE FILTER (9 Oct 2026). Bills had their own "90 days /
    180 days / This year" chips; they now take ?range= like every other list,
    default All time. An old ?days= link still works - it becomes a custom
    range of that many days ending today.
  */
  const legacy = !sp.range && !sp.from && !sp.to && sp.days
    ? { range: 'custom', from: istDate(new Date(Date.now() - (days - 1) * 86_400_000)), to: null }
    : { range: sp.range, from: sp.from, to: sp.to };
  const range = resolveRange(legacy, 'all');
  // listBills' upper bound is inclusive; the range's is exclusive.
  const base = await listBills(ctx.scope, {
    from: range.from ?? undefined, to: range.to ? new Date(range.to.getTime() - 1) : undefined,
  });
  const held = await awaitingApproval(ctx.scope, base.map((b) => b.id));
  const all: BillListRow[] = base.map((b) => ({ ...b, awaitingApproval: held.has(b.id) }));

  const card = sp.card && BILL_CARDS[sp.card] ? sp.card : null;
  const supplier = sp.supplier ?? '';
  const filtered = all.filter((b) => (!supplier || b.supplierName === supplier) && (!card || BILL_CARDS[card](b)));

  return {
    rows: searchAndSort(filtered, parseGridQuery(sp), BILL_GRID),
    total: all.length,
    totals: billTotals(all),
    suppliers: [...new Set(all.map((b) => b.supplierName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    rangeLabel: range.label, card, supplier,
  };
}
