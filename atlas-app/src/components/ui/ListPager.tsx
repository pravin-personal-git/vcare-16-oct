'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from './Icon';
import { useListParams } from './useListParams';
import type { ServerPaging } from './DataGrid';

/**
 * Page controls for card-style lists (F1 UI standard) - the same address keys
 * as DataGrid's footer (?page= &size=), for screens whose rows are cards with
 * their own buttons rather than table rows.
 */
export function ListPager({ paging, sizes = [25, 50, 100] }: { paging: ServerPaging; sizes?: number[] }) {
  const list = useListParams();
  const pageCount = Math.max(1, Math.ceil(paging.total / paging.pageSize));
  const first = paging.total === 0 ? 0 : paging.page * paging.pageSize + 1;
  const last = Math.min(paging.total, (paging.page + 1) * paging.pageSize);
  const router = useRouter();
  const sp = useSearchParams();
  // useListParams.set resets the page by design, so paging edits the address itself - as DataGrid's footer does.
  const go = (p: number) => {
    const next = new URLSearchParams(sp.toString());
    if (p > 0) next.set('page', String(p)); else next.delete('page');
    router.push(`?${next.toString()}`, { scroll: true });
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-card">
      <label className="flex items-center gap-1.5 text-muted-foreground">
        Per page
        <select
          value={paging.pageSize}
          onChange={(e) => list.set({ size: e.target.value })}
          className="h-10 sm:h-7 rounded border border-border bg-card px-1.5 text-xs"
        >
          {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <span className="text-muted-foreground">{first.toLocaleString('en-IN')}–{last.toLocaleString('en-IN')} of {paging.total.toLocaleString('en-IN')}</span>
      <div className="ms-auto flex items-center gap-1">
        <button type="button" aria-label="Previous page" disabled={paging.page === 0} onClick={() => go(paging.page - 1)}
          className="grid h-8 w-8 place-items-center rounded border border-border disabled:opacity-40">
          <Icon name="chevron-left" className="h-4 w-4" />
        </button>
        <span className="px-2">Page {paging.page + 1} of {pageCount}</span>
        <button type="button" aria-label="Next page" disabled={paging.page >= pageCount - 1} onClick={() => go(paging.page + 1)}
          className="grid h-8 w-8 place-items-center rounded border border-border disabled:opacity-40">
          <Icon name="chevron-right" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
