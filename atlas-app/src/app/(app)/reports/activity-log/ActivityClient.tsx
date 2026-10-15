'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge, EmptyState, PageHeader, SectionCard, type BadgeTone } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import type { AuditRow, EventRow } from '@/server/audit-log';
import { AREA_HINT, AREA_LABEL, AUDIT_AREAS, areaOf, type AuditArea } from '@/lib/audit-areas';

type Opt = { value: string; label: string };

const ACTION: Record<string, { label: string; tone: BadgeTone }> = {
  insert: { label: 'Created', tone: 'success' },
  update: { label: 'Changed', tone: 'info' },
  delete: { label: 'Deleted', tone: 'danger' },
};

const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const input = 'h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function ActivityClient({ tab, page, pageSize, filters, changes, signins, tables, people, areaCounts, storeLabel }: {
  tab: 'changes' | 'signins';
  page: number;
  pageSize: number;
  filters: Record<'area' | 'person' | 'table' | 'action' | 'row' | 'q' | 'from' | 'to', string>;
  changes: { rows: AuditRow[]; total: number };
  signins: { rows: EventRow[]; total: number };
  tables: Opt[];
  people: Opt[];
  areaCounts: Record<AuditArea | 'other', number> | null;
  storeLabel: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const [open, setOpen] = useState<string | null>(null);

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!('page' in patch)) next.delete('page');
    router.push(`/reports/activity-log?${next.toString()}`);
  };

  const total = tab === 'changes' ? changes.total : signins.total;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const exportHref = `/api/reports/activity-export?${new URLSearchParams({ ...Object.fromEntries(sp.entries()), tab }).toString()}`;

  return (
    <div>
      <PageHeader
        badge="clock"
        title="User Activity Log"
        subtitle={`Every change and sign-in · ${storeLabel} · cannot be edited or deleted`}
        actions={<a href={exportHref}><Button icon="download">Export CSV</Button></a>}
      />

      <div role="tablist" aria-label="Log type" className="mb-3 flex gap-1 rounded-lg bg-muted p-1 text-sm font-medium sm:w-fit">
        {([['changes', 'Changes to records'], ['signins', 'Sign-ins & security']] as const).map(([k, label]) => (
          <button
            key={k} role="tab" aria-selected={tab === k} type="button"
            onClick={() => go({ tab: k === 'changes' ? null : k })}
            className={`flex-1 rounded-md px-3 py-1.5 transition ${tab === k ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'}`}
          >{label}</button>
        ))}
      </div>

      {/* The first question anybody opening this log has is WHERE - "something
          is wrong with the money", "who touched the settings" - so area comes
          before the seventy-table "record type" list (Stage G, 3 Oct 2026). */}
      {tab === 'changes' && areaCounts && (
        <div role="group" aria-label="Area" className="mb-3 flex flex-wrap gap-1.5">
          {([['', 'Everything'], ...AUDIT_AREAS.map((a) => [a, AREA_LABEL[a]]), ...(areaCounts.other ? [['other', 'Other']] : [])] as [string, string][]).map(([key, label]) => {
            const active = filters.area === key;
            const count = key ? areaCounts[key as AuditArea | 'other'] : Object.values(areaCounts).reduce((t, n) => t + n, 0);
            return (
              <button
                key={key || 'all'} type="button" aria-pressed={active}
                title={key && key !== 'other' ? AREA_HINT[key as AuditArea] : undefined}
                onClick={() => go({ area: key || null, table: null })}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${active ? 'border-brand bg-brand text-white' : 'border-border bg-card text-foreground hover:border-brand'}`}
              >
                {label}
                <span className={`tabular-nums ${active ? 'text-white/80' : 'text-muted-foreground'}`}>{count.toLocaleString('en-IN')}</span>
              </button>
            );
          })}
        </div>
      )}

      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); go({ q: q.trim() || null }); }}
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Search
          <input id="activity-q" className={`${input} w-56`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'changes' ? 'Invoice no, product, name...' : 'Words in the entry'} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Person
          <select id="activity-person" className={input} value={filters.person} onChange={(e) => go({ person: e.target.value || null })}>
            <option value="">Everyone</option>
            {people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        {tab === 'changes' && (
          <>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Record type
              <select id="activity-table" className={input} value={filters.table} onChange={(e) => go({ table: e.target.value || null })}>
                <option value="">All</option>
                {tables
                  .filter((t) => !filters.area || (filters.area === 'other' ? !areaOf(t.value) : areaOf(t.value) === filters.area))
                  .map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Action
              <select id="activity-action" className={input} value={filters.action} onChange={(e) => go({ action: e.target.value || null })}>
                <option value="">All</option>
                <option value="insert">Created</option>
                <option value="update">Changed</option>
                <option value="delete">Deleted</option>
              </select>
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          From
          <input id="activity-from" type="date" className={input} value={filters.from} onChange={(e) => go({ from: e.target.value || null })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          To
          <input id="activity-to" type="date" className={input} value={filters.to} onChange={(e) => go({ to: e.target.value || null })} />
        </label>
        <Button type="submit" variant="primary">Apply</Button>
        {(filters.area || filters.person || filters.table || filters.action || filters.q || filters.from || filters.to || filters.row) && (
          <Button type="button" variant="ghost" onClick={() => router.push(`/reports/activity-log${tab === 'signins' ? '?tab=signins' : ''}`)}>Clear</Button>
        )}
      </form>

      {filters.row && (
        <p className="mb-3 text-sm text-muted-foreground">Showing the full history of one record. <button type="button" className="text-brand hover:underline" onClick={() => go({ row: null, table: null })}>Show all</button></p>
      )}

      <SectionCard title={`${total.toLocaleString('en-IN')} ${tab === 'changes' ? 'changes' : 'events'}`} icon="clock" bodyClassName="p-0">
        {tab === 'changes' ? (
          changes.rows.length === 0 ? (
            <EmptyState icon="clock" title="Nothing matches" hint="Changes are recorded from 25 September 2026, when this log started recording everything." />
          ) : (
            <ul className="divide-y divide-border">
              {changes.rows.map((r) => {
                const a = ACTION[r.action] ?? { label: r.action, tone: 'neutral' as BadgeTone };
                const isOpen = open === r.id;
                return (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start gap-3">
                      <Badge tone={a.tone}>{a.label}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {r.tableLabel}{r.label ? <span className="text-foreground"> · {r.label}</span> : null}
                        </p>
                        {r.context && (
                          <p className="mt-0.5 break-words text-sm text-foreground">{r.context}</p>
                        )}
                        <p className="mt-0.5 break-words text-xs text-muted-foreground">{r.summary}</p>
                        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                          {r.actor}{r.via ? ` · ${r.via}` : ''}{r.ip ? ` · ${r.ip}` : ''} · {fmt(r.at)}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        {r.changes.length > 0 && (
                          <Button size="sm" variant="ghost" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                            {isOpen ? 'Hide' : 'Details'}
                          </Button>
                        )}
                        {r.rowId && !filters.row && (
                          <Button size="sm" variant="ghost" onClick={() => go({ row: r.rowId, table: r.table })}>History</Button>
                        )}
                      </div>
                    </div>
                    {isOpen && (
                      <div className="thin-scroll mt-2 overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/60 text-muted-foreground">
                            <tr><th className="px-3 py-1.5 text-start font-medium">Field</th>{r.action !== 'insert' && <th className="px-3 py-1.5 text-start font-medium">Before</th>}{r.action !== 'delete' && <th className="px-3 py-1.5 text-start font-medium">After</th>}</tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {r.changes.map((c) => (
                              <tr key={c.field}>
                                <td className="px-3 py-1.5 font-medium">{c.field}</td>
                                {r.action !== 'insert' && <td className="px-3 py-1.5 text-danger">{c.from ?? <span className="text-muted-foreground">(empty)</span>}</td>}
                                {r.action !== 'delete' && <td className="px-3 py-1.5 text-success">{c.to ?? <span className="text-muted-foreground">(empty)</span>}</td>}
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
          )
        ) : signins.rows.length === 0 ? (
          <EmptyState icon="clock" title="Nothing matches" />
        ) : (
          <ul className="divide-y divide-border">
            {signins.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <Badge tone={/Failed|Locked/.test(r.type) ? 'danger' : r.type === 'Login' ? 'success' : 'neutral'}>{r.type}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{r.description}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{r.actor}{r.ip ? ` · ${r.ip}` : ''} · {fmt(r.at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button size="sm" disabled={page === 0} onClick={() => go({ page: String(page - 1) })}>Newer</Button>
          <span className="tabular-nums text-muted-foreground">Page {page + 1} of {pages.toLocaleString('en-IN')}</span>
          <Button size="sm" disabled={page + 1 >= pages} onClick={() => go({ page: String(page + 1) })}>Older</Button>
        </nav>
      )}
    </div>
  );
}
