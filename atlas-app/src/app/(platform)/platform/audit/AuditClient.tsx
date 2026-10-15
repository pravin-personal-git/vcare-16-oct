'use client';

import { useMemo, useState } from 'react';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import type { AuditEventRow } from '@/server/platform-admin';

type AuditVM = Omit<AuditEventRow, 'startedAt'> & { startedAt: string };

export function AuditClient({ events }: { events: AuditVM[] }) {
  const [query, setQuery] = useState('');

  const actionTypes = useMemo(() => [...new Set(events.map((e) => e.actionType))].sort(), [events]);
  const [actionFilter, setActionFilter] = useState('');

  const filtered = events.filter((e) => {
    if (actionFilter && e.actionType !== actionFilter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      e.actingUserName.toLowerCase().includes(q)
      || (e.organizationName?.toLowerCase().includes(q) ?? false)
      || (e.targetUserName?.toLowerCase().includes(q) ?? false)
      || (e.reason?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div>
      <PageHeader
        badge="clock"
        title="Audit"
        subtitle={`${events.length} privileged event${events.length === 1 ? '' : 's'} in scope, most recent 200`}
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by person, tenant or reason"
            className="w-64 rounded-lg border border-border bg-background py-2 ps-8 pe-3 text-sm text-foreground"
          />
        </div>
        <select
          value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="">Every action type</option>
          {actionTypes.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <Card><EmptyState icon="clock" title="No matching events" /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">By</th>
                <th className="px-4 py-2.5 font-medium">Tenant</th>
                <th className="px-4 py-2.5 font-medium">Target</th>
                <th className="px-4 py-2.5 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {new Date(e.startedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2.5"><Badge tone="navy">{e.actionType}</Badge></td>
                  <td className="px-4 py-2.5">{e.actingUserName}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{e.organizationName ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{e.targetUserName ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{e.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
