'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { listDocPhotosAction, type DocPhoto } from './actions';

/** The photos a record was scanned from - an invoice on a goods receipt, a card on a lead. */
export function DocPhotos({ docType, docId }: { docType: 'goods_receipt' | 'lead'; docId: string }) {
  const [rows, setRows] = useState<DocPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listDocPhotosAction(docType, docId)
      .then((r) => { if (alive) { setRows(r.rows); setError(r.error ?? null); } })
      .catch(() => { if (alive) { setRows([]); setError('Could not load the files.'); } });
    return () => { alive = false; };
  }, [docType, docId]);

  if (rows === null) return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="py-6 text-center text-sm text-danger">{error}</p>;
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No files. A photo taken with the scanner is kept here.</p>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {rows.map((r) => (
        <li key={r.id} className="overflow-hidden rounded-md border border-border">
          {r.url ? (
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="block bg-muted/30">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL, not a static asset */}
              <img src={r.url} alt={r.label ?? r.fileName} className="h-48 w-full object-contain" />
            </a>
          ) : (
            <p className="grid h-48 place-items-center text-xs text-muted-foreground">
              <Icon name="alert-circle" className="h-5 w-5" /> File missing from storage
            </p>
          )}
          <p className="px-3 py-2 text-xs">
            <span className="font-medium">{r.label ?? r.fileName}</span>
            <span className="block text-xs text-muted-foreground">
              {new Date(r.uploadedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {r.uploadedByName ? ` · ${r.uploadedByName}` : ''}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}
