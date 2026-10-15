'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useListParams } from './useListParams';
import { Icon } from './Icon';

/**
 * `?open=<id>` - LAND ON THE RECORD, NOT THE LIST (Vcare, 7 Oct 2026).
 *
 * Pravin pressed "Open" on an expense voucher in My Desk and arrived at the
 * whole transactions list, his voucher somewhere inside it: "which is
 * misleading". Nineteen approval links behaved that way, because the targets
 * are list screens and only a few documents have a page of their own.
 *
 * Nineteen screens could each have grown its own deep-link handling. Instead
 * there is one rule: a list row carries `data-row-id`, which DataGrid now puts
 * on every row it draws, so eleven of those screens needed no change at all.
 * This component is mounted once in the app shell. It finds that row, scrolls
 * to it and rings it, and the person sees their own record.
 *
 * WHEN THE ROW IS NOT THERE it says so, which is the part that matters. The
 * row can be missing for three ordinary reasons - it is on another page of the
 * list, a filter excludes it, or (since today's date default) it is older than
 * the range - and in every one of them silence would read as "your record is
 * gone". So the bar offers the two ways out, all dates and page one, and the
 * person is never left guessing.
 */
export function OpenTarget() {
  const sp = useSearchParams();
  const id = sp.get('open');
  const list = useListParams();
  const [state, setState] = useState<'looking' | 'found' | 'missing'>('looking');

  useEffect(() => {
    if (!id) return;
    setState('looking');

    /*
      The row may not exist on the first frame: the page streams, and a client
      list can filter after hydrating. So look a few times over two seconds
      before concluding it is not here - long enough for a slow render, short
      enough that a genuinely absent row is reported while the person is still
      looking at the screen.
    */
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const look = () => {
      const el = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
      if (el) {
        setState('found');
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        // A ring rather than a background: rows already use background to mean
        // "selected", and this is not a selection.
        el.classList.add('atlas-open-target');
        timer = setTimeout(() => el.classList.remove('atlas-open-target'), 4000);
        return;
      }
      if (++tries >= 10) { setState('missing'); return; }
      timer = setTimeout(look, 200);
    };
    look();
    return () => clearTimeout(timer);
  }, [id]);

  if (!id || state !== 'missing') return null;

  return (
    <div
      role="status"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
    >
      <Icon name="alert-circle" className="h-3.5 w-3.5 shrink-0 text-warning" />
      <span className="font-medium">
        That record is not on this page — a filter or the date range is hiding it.
      </span>
      <button
        type="button"
        onClick={() => list.set({ range: 'all', from: null, to: null, q: null, page: null })}
        className="ms-auto inline-flex items-center gap-1 font-semibold text-brand hover:underline"
      >
        <Icon name="calendar" className="h-3 w-3" />
        Show all dates and clear filters
      </button>
    </div>
  );
}
