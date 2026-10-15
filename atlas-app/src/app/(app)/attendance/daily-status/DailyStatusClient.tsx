'use client';

import { EmployeeLink } from '@/components/document/EmployeeLink';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card, EmptyState, PageHeader, type BadgeTone } from '@/components/ui/Layout';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { useListParams } from '@/components/ui/useListParams';
import type { DayStatus } from '@/lib/attendance';

/**
 * Daily Work Status - everyone's state for one day.
 *
 * On the F1 standard since 29 Sep (F1b, D17). The question this screen is
 * opened for is almost always "who is absent" or "who came late", and until now
 * the only way to answer it was to read every row.
 */

interface DailyStatusRowVM {
  userId: string;
  userName: string;
  status: DayStatus;
  statusLabel: string;
  startedAt: string | null;
  workedMinutes: number | null;
}

const STATUS_TONE: Record<DayStatus, BadgeTone> = {
  present: 'success', late: 'warning', half_day: 'warning', wfh: 'info', leave: 'info',
  holiday: 'neutral', weekend: 'neutral', absent: 'danger', unmarked: 'neutral', future: 'neutral',
};

const fmtHours = (minutes: number | null) => {
  if (minutes === null) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
};

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });

export function DailyStatusClient({
  date, rows: all, scopeIsAll, views,
}: {
  date: string;
  rows: DailyStatusRowVM[];
  scopeIsAll: boolean;
  views: FilterBarViews;
}) {
  const router = useRouter();
  const list = useListParams();

  const search = (list.get('q') ?? '').trim().toLowerCase();
  const status = list.get('status');

  const rows = useMemo(() => all.filter((r) => {
    if (status && r.status !== status) return false;
    if (!search) return true;
    return [r.userName, r.statusLabel].some((v) => v.toLowerCase().includes(search));
  }), [all, search, status]);

  const columns: Column<DailyStatusRowVM>[] = [
    {
      key: 'employee', header: 'Employee',
      sortValue: (r) => r.userName,
      render: (r) => <span className="font-medium"><EmployeeLink id={r.userId}>{r.userName}</EmployeeLink></span>,
    },
    {
      key: 'status', header: 'Status', width: '140px',
      sortValue: (r) => r.statusLabel,
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.statusLabel}</Badge>,
    },
    {
      key: 'started', header: 'Started', width: '110px',
      sortValue: (r) => r.startedAt ?? '',
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.startedAt ?? '-'}</span>,
    },
    {
      key: 'worked', header: 'Worked', width: '110px', align: 'end',
      sortValue: (r) => r.workedMinutes ?? -1,
      render: (r) => <span className="text-muted-foreground">{fmtHours(r.workedMinutes)}</span>,
    },
  ];

  if (scopeIsAll) {
    return (
      <div>
        <PageHeader badge="AT" title="Daily Work Status" subtitle="Everyone's status for one day" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="Daily status is kept per branch." />
        </Card>
      </div>
    );
  }

  // Only the statuses actually present this day, with their counts - the filter
  // doubles as the answer to "how many are absent".
  const present = [...new Set(all.map((r) => r.status))]
    .map((s) => ({ value: s, label: all.find((r) => r.status === s)!.statusLabel, n: all.filter((r) => r.status === s).length }))
    .sort((a, b) => b.n - a.n);

  return (
    <div>
      <PageHeader
        badge="AT"
        title="Daily Work Status"
        subtitle={fmtDate(date)}
        actions={
          <input
            type="date" value={date} aria-label="Day"
            onChange={(e) => router.push(`/attendance/daily-status?d=${e.target.value}`)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand"
          />
        }
      />

      <FilterBar
        searchPlaceholder="Employee or status…"
        shown={rows.length}
        total={all.length}
        clearKeys={['status']}
        views={views}
        extra={present.length > 1 ? (
          <select
            aria-label="Status" value={status ?? ''}
            onChange={(e) => list.set({ status: e.target.value || null })}
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand"
          >
            <option value="">All statuses</option>
            {present.map((s) => (
              <option key={s.value} value={s.value}>{s.label} ({s.n})</option>
            ))}
          </select>
        ) : undefined}
      />

      <DataGrid
        exportAs={{ title: 'Daily work status' }}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.userId}
        emptyIcon="users"
        emptyMessage={all.length === 0 ? 'Nobody to show' : 'Nothing matches those filters'}
        emptyHint={all.length === 0
          ? 'Nobody had a shift, leave, or a paired device this day.'
          : 'Clear the filters to see everyone.'}
        mobileCard={(r) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{r.userName}</p>
              <p className="text-xs text-muted-foreground">
                {r.startedAt ? `Started ${r.startedAt}` : 'Not started'} · {fmtHours(r.workedMinutes)}
              </p>
            </div>
            <Badge tone={STATUS_TONE[r.status]}>{r.statusLabel}</Badge>
          </div>
        )}
      />
    </div>
  );
}
