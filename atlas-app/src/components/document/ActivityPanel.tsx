'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge, SectionCard, type BadgeTone } from '@/components/ui/Layout';
import type { AuditRow } from '@/server/audit-log';

const ACTION: Record<string, { label: string; tone: BadgeTone }> = {
  insert: { label: 'Created', tone: 'success' },
  update: { label: 'Changed', tone: 'info' },
  delete: { label: 'Removed', tone: 'danger' },
};

const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * Activity on a document (F1b detail-page standard, 6 Oct 2026): who created
 * or changed it, when, from where, and each field before and after - read
 * from the database's own audit trail, so no screen can skip it. Newest
 * first; the full history is one click away in the activity log.
 */
export function ActivityPanel({ rows, total, table, rowId }: {
  rows: AuditRow[]; total: number; table: string; rowId: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <SectionCard
      title={`Activity${total ? ` (${total})` : ''}`} icon="clock" className="mt-3 print:hidden" bodyClassName="p-0"
      action={total > rows.length ? (
        <Link href={`/reports/activity-log?table=${encodeURIComponent(table)}&row=${encodeURIComponent(rowId)}`}
          className="text-xs font-medium text-brand hover:underline">All {total}</Link>
      ) : undefined}
    >
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">No changes recorded yet. Changes are recorded from 25 September 2026.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const a = ACTION[r.action] ?? { label: r.action, tone: 'neutral' as BadgeTone };
            const isOpen = open === r.id;
            return (
              <li key={r.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-start gap-2">
                  <Badge tone={a.tone}>{a.label}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-xs">{r.summary}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      {r.actor}{r.via ? ` · ${r.via}` : ''} · {fmt(r.at)}
                    </p>
                  </div>
                  {r.changes.length > 0 && (
                    <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}
                      className="text-xs font-medium text-brand hover:underline">
                      {isOpen ? 'Hide' : 'Details'}
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div className="thin-scroll mt-2 overflow-x-auto rounded border border-border">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-border">
                        {r.changes.map((c) => (
                          <tr key={c.field}>
                            <td className="px-2 py-1 font-medium">{c.field}</td>
                            {r.action !== 'insert' && <td className="px-2 py-1 text-danger">{c.from ?? '(empty)'}</td>}
                            {r.action !== 'delete' && <td className="px-2 py-1 text-success">{c.to ?? '(empty)'}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
