import 'server-only';
import type { AppContext } from './context';
import { listReceipts } from './receipts';
import type { ReceiptRow } from '@/lib/receipt';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { parseGridQuery, searchAndSort, type PageOptions } from '@/lib/server-grid';

/**
 * Receipts, filtered - shared by the screen and its export (F1).
 * Receipt date defaults to this financial year. Money on account does not
 * expire on 1 April, so `olderOnAccount` counts receipts dated earlier that
 * still hold unapplied money - one click away.
 */

type Sp = Record<string, string | undefined>;

export const RECEIPT_GRID: PageOptions<ReceiptRow> = {
  search: (r) => [r.receiptNo, r.partyName, r.reference, r.note, r.method, ...r.appliedTo.map((a) => a.invoiceNo)],
  sort: {
    receiptNo: (r) => r.receiptNo, party: (r) => r.partyName, date: (r) => r.receivedAt, method: (r) => r.method,
    amount: (r) => r.amountPaise, applied: (r) => r.appliedTo.length, onAccount: (r) => r.unallocatedPaise,
    status: (r) => r.status, note: (r) => r.note,
  },
};

export async function receiptsList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(sp, { defaultRange: 'all', meId: ctx.user.id });
  const f = sp.f === 'unapplied' || sp.f === 'failed' || sp.f === 'received' ? sp.f : 'all';

  const all = await listReceipts(ctx.scope);
  const inScope = all.filter((r) => inRange(r.receivedAt, filters.range));
  const live = inScope.filter((r) => r.status === 'received');
  const totals = {
    count: inScope.length,
    liveCount: live.length,
    received: live.reduce((n, r) => n + r.amountPaise, 0),
    onAccount: live.reduce((n, r) => n + r.unallocatedPaise, 0),
    failed: inScope.filter((r) => r.status !== 'received').reduce((n, r) => n + r.amountPaise, 0),
    failedCount: inScope.filter((r) => r.status !== 'received').length,
    unappliedCount: live.filter((r) => r.unallocatedPaise > 0).length,
  };
  const olderOnAccount = inScope.length === all.length ? 0
    : all.filter((r) => r.status === 'received' && r.unallocatedPaise > 0 && !inRange(r.receivedAt, filters.range)).length;

  const shown = inScope.filter((r) => {
    if (f === 'unapplied') return r.status === 'received' && r.unallocatedPaise > 0;
    if (f === 'failed') return r.status !== 'received';
    if (f === 'received') return r.status === 'received';
    return true;
  });
  const rows = searchAndSort(shown, parseGridQuery(sp), RECEIPT_GRID);
  return { rows, totals, f, filters, olderOnAccount };
}
