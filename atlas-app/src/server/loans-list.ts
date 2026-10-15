import 'server-only';
import type { AppContext } from './context';
import { listLoans, type LoanRow } from './staff-loans';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';
import { inRange, resolveRange } from '@/lib/date-ranges';

/**
 * Staff loans and advances, filtered on the server - shared by the screen (one
 * page at a time) and its export (every page). F1b server paging, 6 Oct 2026.
 * Address: ?q=, ?status=, ?sort= &dir= - the keys the screen already used.
 */
type Sp = Record<string, string | undefined>;

export const LOAN_GRID: PageOptions<LoanRow> = {
  // The number and the word, so "ADV" or "advance" both find the right rows.
  search: (l) => [l.loanNo, l.userName, l.reason, l.kind, l.status.replace('_', ' ')],
  sort: {
    kind: (l) => `${l.kind}${l.loanNo ?? ''}`,
    employee: (l) => l.userName, principal: (l) => l.principalPaise, emi: (l) => l.emiPaise,
    instalments: (l) => l.paidCount,
    outstanding: (l) => l.outstandingPaise, status: (l) => l.status,
    started: (l) => l.startPeriod, reason: (l) => l.reason ?? '',
  },
};

export async function loansList(ctx: AppContext, sp: Sp) {
  const all = await listLoans(ctx.scope);
  const status = sp.status ?? '';
  // The date filter (9 Oct 2026): when the loan or advance was given.
  const range = resolveRange({ range: sp.range, from: sp.from, to: sp.to }, 'all');
  const filtered = all.filter((l) => inRange(l.createdAt, range) && (!status || l.status === status));
  const statuses = [...new Set(all.map((l) => l.status))].map((s) => ({
    value: s, label: s.replace('_', ' '), n: all.filter((l) => l.status === s).length,
  }));
  return { rows: searchAndSort(filtered, parseGridQuery(sp), LOAN_GRID), total: all.length, statuses, status, rangeLabel: range.label };
}
