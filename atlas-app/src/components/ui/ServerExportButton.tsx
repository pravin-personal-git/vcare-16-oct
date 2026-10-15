'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Icon } from './Icon';
import { useExportAllowed } from './ExportPermission';

/**
 * Export for a server-paged list (F1b, 6 Oct 2026): the screen holds one page,
 * so the file comes from /api/list-export, which runs the screen's own filter
 * function over every page with the filters now in the address. The route
 * checks permission again; this only hides the button from people it would
 * refuse.
 */
export function ServerExportButton({ screen, extra }: {
  screen: string;
  /** Address keys the export needs that the screen does not carry (e.g. team=service). */
  extra?: Record<string, string>;
}) {
  const sp = useSearchParams();
  const allowed = useExportAllowed();
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  const href = (format: 'xlsx' | 'csv') => {
    const q = new URLSearchParams(sp.toString());
    q.delete('page'); q.delete('size');
    for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v);
    q.set('screen', screen);
    q.set('format', format);
    return `/api/list-export?${q.toString()}`;
  };
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted">
        <Icon name="download" className="h-4 w-4" /> Export
      </button>
      {open && (
        <div className="absolute end-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-card shadow-card">
          <a href={href('xlsx')} onClick={() => setOpen(false)} className="block px-3 py-2 text-sm hover:bg-muted">Excel (.xlsx)</a>
          <a href={href('csv')} onClick={() => setOpen(false)} className="block px-3 py-2 text-sm hover:bg-muted">CSV</a>
        </div>
      )}
    </div>
  );
}
