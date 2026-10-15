'use client';

import { useState } from 'react';
import { Icon } from './Icon';
import { BOM, toCsv, sanitise, type CsvColumn } from '@/lib/csv';
import { buildXlsx, type XlsxCell } from '@/lib/xlsx';
import { useExportAllowed } from './ExportPermission';

/**
 * Export for a list that already holds all its rows in the page (F1b, 6 Oct
 * 2026) - assets, notices, payroll runs, returns. Screens that page on the
 * server use FilterBar's export, which goes through /api/list-export.
 *
 * Who may export is decided on the server (server/can-export: office/admin
 * level AND exports not switched off) and handed down by the app layout;
 * `allowed` overrides it for a screen with a stricter rule. Hidden otherwise.
 * Exports exactly the rows passed in - the filtered set on screen.
 */
export function ExportButton<T>({ title, rows, columns, allowed }: {
  title: string;
  rows: T[];
  columns: CsvColumn<T>[];
  /** Defaults to the layout's decision (ExportPermission). */
  allowed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const fromLayout = useExportAllowed();
  if (!(allowed ?? fromLayout)) return null;

  const base = `${title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}_${new Date().toISOString().slice(0, 10)}`;
  const save = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const excel = () => {
    const cellOf = (v: unknown): XlsxCell => (typeof v === 'number' || typeof v === 'boolean' || v == null ? v as XlsxCell : sanitise(String(v)));
    const bytes = buildXlsx(title.slice(0, 31), columns.map((c) => c.header), rows.map((r) => columns.map((c) => cellOf(c.value(r)))));
    save(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${base}.xlsx`);
    setOpen(false);
  };
  const csv = () => {
    save(new Blob([BOM + toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} title={`Export ${rows.length} rows`}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted">
        <Icon name="download" className="h-4 w-4" /> Export
      </button>
      {open && (
        <div className="absolute end-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-card shadow-card">
          <button type="button" onClick={excel} className="block w-full px-3 py-2 text-start text-sm hover:bg-muted">Excel (.xlsx)</button>
          <button type="button" onClick={csv} className="block w-full px-3 py-2 text-start text-sm hover:bg-muted">CSV</button>
        </div>
      )}
    </div>
  );
}
