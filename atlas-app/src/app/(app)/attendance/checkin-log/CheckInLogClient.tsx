'use client';

import { EmployeeLink } from '@/components/document/EmployeeLink';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { useListParams } from '@/components/ui/useListParams';

/**
 * Check-in / Check-out Log - the raw punch stream, one row per event.
 *
 * On the F1 standard since 29 Sep (F1b, D17). It was a bare table: no search,
 * no filters, no way to save a layout. On a branch of forty people that is
 * eighty rows a day and no way to answer "when did Ramesh come in".
 *
 * Filtering stays in the browser here, deliberately. The page already loads one
 * day for one branch - a few hundred rows at most - so a round trip per
 * keystroke would be slower and no more correct. Screens that load a year of
 * rows page on the server instead (see `shiftsList`).
 */

interface EventRowVM {
  id: string;
  userId: string;
  userName: string;
  eventType: 'Check-in' | 'Check-out';
  source: string;
  recordedAt: string;
  hasLocation: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  app: 'Phone app', web: 'Web', biometric: 'Biometric device', manual: 'Manual', unknown: 'Unknown',
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

export function CheckInLogClient({
  date, events, scopeIsAll, views,
}: {
  date: string;
  events: EventRowVM[];
  scopeIsAll: boolean;
  views: FilterBarViews;
}) {
  const router = useRouter();
  const list = useListParams();

  const search = (list.get('q') ?? '').trim().toLowerCase();
  const source = list.get('source');
  const kind = list.get('kind');

  const rows = useMemo(() => events.filter((e) => {
    if (source && e.source !== source) return false;
    if (kind && e.eventType !== kind) return false;
    if (!search) return true;
    return [e.userName, e.eventType, SOURCE_LABEL[e.source] ?? e.source, fmtTime(e.recordedAt)]
      .some((v) => v.toLowerCase().includes(search));
  }), [events, search, source, kind]);

  const columns: Column<EventRowVM>[] = [
    {
      key: 'time', header: 'Time', width: '90px',
      sortValue: (e) => e.recordedAt,
      render: (e) => <span className="font-mono text-xs tabular-nums">{fmtTime(e.recordedAt)}</span>,
    },
    {
      key: 'employee', header: 'Employee',
      sortValue: (e) => e.userName,
      render: (e) => <span className="font-medium"><EmployeeLink id={e.userId}>{e.userName}</EmployeeLink></span>,
    },
    {
      key: 'event', header: 'Event', width: '120px',
      sortValue: (e) => e.eventType,
      render: (e) => <Badge tone={e.eventType === 'Check-in' ? 'success' : 'neutral'}>{e.eventType}</Badge>,
    },
    {
      key: 'source', header: 'Source', width: '150px',
      sortValue: (e) => SOURCE_LABEL[e.source] ?? e.source,
      render: (e) => <span className="text-muted-foreground">{SOURCE_LABEL[e.source] ?? e.source}</span>,
    },
    {
      key: 'location', header: 'Location', width: '90px', align: 'center',
      sortValue: (e) => (e.hasLocation ? 'yes' : 'no'),
      render: (e) => (e.hasLocation
        ? <Icon name="map-pin" className="h-3.5 w-3.5 text-muted-foreground" aria-label="Location recorded" />
        : <span className="text-muted-foreground">-</span>),
    },
  ];

  if (scopeIsAll) {
    return (
      <div>
        <PageHeader badge="AT" title="Check-in / Check-out Log" subtitle="Every punch, in order" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="The event log is kept per branch." />
        </Card>
      </div>
    );
  }

  // Only the sources actually present, so a branch with no biometric machine is
  // not offered a filter that can only ever return nothing.
  const sourcesPresent = [...new Set(events.map((e) => e.source))].sort();

  return (
    <div>
      <PageHeader
        badge="AT"
        title="Check-in / Check-out Log"
        subtitle="Every punch on this day, whichever source recorded it"
        actions={
          <input
            type="date" value={date} aria-label="Day"
            onChange={(e) => router.push(`/attendance/checkin-log?d=${e.target.value}`)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand"
          />
        }
      />

      <FilterBar
        searchPlaceholder="Employee, event, source, time…"
        shown={rows.length}
        total={events.length}
        clearKeys={['source', 'kind']}
        views={views}
        extra={
          <>
            <select
              aria-label="Event" value={kind ?? ''}
              onChange={(e) => list.set({ kind: e.target.value || null })}
              className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand"
            >
              <option value="">All events</option>
              <option value="Check-in">Check-in</option>
              <option value="Check-out">Check-out</option>
            </select>
            {sourcesPresent.length > 1 && (
              <select
                aria-label="Source" value={source ?? ''}
                onChange={(e) => list.set({ source: e.target.value || null })}
                className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand"
              >
                <option value="">All sources</option>
                {sourcesPresent.map((s) => (
                  <option key={s} value={s}>{SOURCE_LABEL[s] ?? s}</option>
                ))}
              </select>
            )}
          </>
        }
      />

      <DataGrid
        exportAs={{ title: 'Check-in log' }}
        rows={rows}
        columns={columns}
        rowKey={(e) => e.id}
        emptyIcon="clock"
        emptyMessage={events.length === 0 ? 'No punches this day' : 'Nothing matches those filters'}
        emptyHint={events.length === 0
          ? 'Nobody checked in or out on this date.'
          : 'Clear the filters to see every punch on this day.'}
        mobileCard={(e) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{e.userName}</p>
              <p className="text-xs text-muted-foreground">
                {SOURCE_LABEL[e.source] ?? e.source}
                {e.hasLocation && ' · location recorded'}
              </p>
            </div>
            <div className="shrink-0 text-end">
              <Badge tone={e.eventType === 'Check-in' ? 'success' : 'neutral'}>{e.eventType}</Badge>
              <p className="mt-1 font-mono text-xs tabular-nums">{fmtTime(e.recordedAt)}</p>
            </div>
          </div>
        )}
      />
    </div>
  );
}
