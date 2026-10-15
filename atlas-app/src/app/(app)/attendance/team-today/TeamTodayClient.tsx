'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { useListParams } from '@/components/ui/useListParams';
import { useEffect, useState } from 'react';
import { Badge, EmptyState, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { DEVICE_STATUS_LABEL } from '@/lib/device-trust';
import { formatWorked } from '@/lib/shift';
import type { TeamRow } from '@/server/team-today';

// India time always - this page is first drawn on a server that runs in UTC (lib/ist).
const fmtClock = (d: string) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const SOURCE_LABEL: Record<string, string> = { app: 'phone', web: 'website', biometric: 'device', manual: 'entered by office' };
const ago = (d: string) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};
const mapUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}&z=16`;

/** The four groups the cards count and filter by (?card=). */
const CARD_TEST: Record<string, (r: TeamRow) => boolean> = {
  on_shift: (r) => r.status === 'on_shift',
  done: (r) => r.status === 'done',
  not_marked: (r) => r.status === 'not_marked',
  phones: (r) => r.phone === 'not_reporting' || r.phone === 'app_removed' || r.mockedToday > 0,
};

export function TeamTodayClient({ rows: allRows, canLocate, canExport, views }: {
  rows: TeamRow[]; canLocate: boolean; canExport: boolean; views: FilterBarViews;
}) {
  const router = useRouter();
  const list = useListParams();
  const sp = useSearchParams();
  // A small live board, so the filtering happens here - but from the address,
  // like every other list, so a refresh or a shared link keeps it.
  const card = sp.get('card') && CARD_TEST[sp.get('card')!] ? sp.get('card')! : null;
  const q = (sp.get('q') ?? '').trim().toLowerCase();
  const rows = allRows.filter((r) => (!card || CARD_TEST[card](r)) && (!q || r.name.toLowerCase().includes(q)));
  const [, tick] = useState(0);
  // A live board: refresh the data every two minutes, the relative times every 30 s.
  useEffect(() => {
    const a = setInterval(() => router.refresh(), 120_000);
    const b = setInterval(() => tick((n) => n + 1), 30_000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [router]);

  const count = (k: string) => allRows.filter(CARD_TEST[k]).length;
  const cards: KpiCard[] = [
    { key: 'on_shift', label: 'On shift', count: count('on_shift'), icon: 'check-circle', tone: 'success' },
    { key: 'done', label: 'Finished', count: count('done'), icon: 'clock' },
    { key: 'not_marked', label: 'Not marked', count: count('not_marked'), icon: 'user', tone: count('not_marked') ? 'warning' : 'default' },
    { key: 'phones', label: 'Phones needing a look', count: count('phones'), icon: 'phone', tone: count('phones') ? 'danger' : 'default' },
  ];

  return (
    <div>
      <PageHeader
        badge="users"
        title="Team Today"
        subtitle="Who is working now, and whether their phone is reporting"
        actions={<Button icon="refresh" onClick={() => router.refresh()}>Refresh</Button>}
      />

      <FilterBar
        searchPlaceholder="Name…"
        shown={rows.length}
        clearKeys={['card']}
        exportScreen={canExport ? 'team_today' : null}
        views={views}
      />
      <KpiStrip cards={cards} activeKey={card} onSelect={(k) => list.set({ card: k })} columns={4} />

      <SectionCard title={`People (${rows.length})`} icon="users" bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState icon="users" title={allRows.length === 0 ? 'Nobody in this branch yet' : 'Nobody matches'} hint={allRows.length === 0 ? undefined : 'Try another card or Clear all filters.'} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.status === 'on_shift' ? 'bg-success' : r.status === 'done' ? 'bg-border-strong' : 'bg-muted'}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {r.status === 'not_marked' && 'Not clocked in'}
                    {r.status === 'on_shift' && r.firstInAt && `In since ${fmtClock(r.firstInAt)}${r.workedMinutes !== null ? ` · ${formatWorked(r.workedMinutes)} so far` : ''}`}
                    {r.status === 'done' && r.firstInAt && `${fmtClock(r.firstInAt)} - ${r.lastOutAt ? fmtClock(r.lastOutAt) : '?'} · ${formatWorked(r.workedMinutes)}`}
                    {r.status !== 'not_marked' && r.source && ` · via ${SOURCE_LABEL[r.source] ?? r.source}`}
                    {canLocate && r.lastFix && (
                      <>
                        {' · '}
                        <a href={mapUrl(r.lastFix.lat, r.lastFix.lng)} target="_blank" rel="noreferrer noopener" className="text-brand hover:underline">
                          last seen {ago(r.lastFix.at)}
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.inWithinPolicy === false && <Badge tone="warning">Clocked in outside zone</Badge>}
                  {r.mockedToday > 0 && <Badge tone="danger">Fake location ×{r.mockedToday}</Badge>}
                  {r.phone === 'none' ? (
                    <Badge tone="neutral">No phone paired</Badge>
                  ) : r.phone !== 'active' && (
                    <Badge tone={r.phone === 'never_reported' ? 'neutral' : 'danger'}>{DEVICE_STATUS_LABEL[r.phone]}</Badge>
                  )}
                  {/* A route exists only for a phone check-in - a website Present has no trail. */}
                  {canLocate && r.lastSessionId && r.source === 'app' && (
                    <Link href={`/attendance/shifts/${r.lastSessionId}`}>
                      <Button size="sm">Route</Button>
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
