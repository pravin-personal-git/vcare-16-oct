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
 * Late Arrival & Early Departure.
 *
 * On the F1 standard since 29 Sep (F1b, D17). This is a report people act on -
 * it ends in a conversation with somebody - so being able to filter to one
 * person, or to only the late arrivals, is the difference between it being
 * usable and it being a printout.
 */

interface LateEarlyRowVM {
  userId: string;
  userName: string;
  workDate: string;
  firstInAt: string | null;
  lastOutAt: string | null;
  isLate: boolean;
  lateByMinutes: number;
  isEarlyDeparture: boolean;
  earlyByMinutes: number;
}

const MONTH_LABEL = (year: number, month: number) =>
  new Date(year, month, 1).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' });

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '-';

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });

const shiftMonth = (year: number, month: number, delta: number) => {
  const d = new Date(year, month + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function LateEarlyClient({
  year, month, rows: all, scopeIsAll, views,
}: {
  year: number;
  month: number;
  rows: LateEarlyRowVM[];
  scopeIsAll: boolean;
  views: FilterBarViews;
}) {
  const router = useRouter();
  const list = useListParams();

  const search = (list.get('q') ?? '').trim().toLowerCase();
  const flag = list.get('flag');

  const rows = useMemo(() => all.filter((r) => {
    if (flag === 'late' && !r.isLate) return false;
    if (flag === 'early' && !r.isEarlyDeparture) return false;
    if (!search) return true;
    return r.userName.toLowerCase().includes(search) || fmtDate(r.workDate).toLowerCase().includes(search);
  }), [all, search, flag]);

  const columns: Column<LateEarlyRowVM>[] = [
    {
      key: 'date', header: 'Date', width: '100px',
      sortValue: (r) => r.workDate,
      render: (r) => <span className="text-muted-foreground">{fmtDate(r.workDate)}</span>,
    },
    {
      key: 'employee', header: 'Employee',
      sortValue: (r) => r.userName,
      render: (r) => <span className="font-medium"><EmployeeLink id={r.userId}>{r.userName}</EmployeeLink></span>,
    },
    {
      key: 'arrived', header: 'Arrived', width: '100px',
      sortValue: (r) => r.firstInAt ?? '',
      render: (r) => <span className="font-mono text-xs">{fmtTime(r.firstInAt)}</span>,
    },
    {
      key: 'left', header: 'Left', width: '100px',
      sortValue: (r) => r.lastOutAt ?? '',
      render: (r) => <span className="font-mono text-xs">{fmtTime(r.lastOutAt)}</span>,
    },
    {
      key: 'flags', header: 'Flags', width: '200px',
      // Sorted by how bad it was, so one sort answers "who is worst".
      sortValue: (r) => r.lateByMinutes + r.earlyByMinutes,
      render: (r) => (
        <div className="flex gap-1.5">
          {r.isLate && <Badge tone="warning">{r.lateByMinutes}m late</Badge>}
          {r.isEarlyDeparture && <Badge tone="danger">{r.earlyByMinutes}m early</Badge>}
        </div>
      ),
    },
  ];

  if (scopeIsAll) {
    return (
      <div>
        <PageHeader badge="AT" title="Late Arrival & Early Departure" subtitle="Who ran late or left early" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="This report is kept per branch." />
        </Card>
      </div>
    );
  }

  const lateCount = all.filter((r) => r.isLate).length;
  const earlyCount = all.filter((r) => r.isEarlyDeparture).length;

  return (
    <div>
      <PageHeader
        badge="AT"
        title="Late Arrival & Early Departure"
        subtitle="Compared against this branch's shift start/end and grace period, from Attendance Settings"
        actions={
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => router.push(`/attendance/late-early?m=${shiftMonth(year, month, -1)}`)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card transition hover:bg-muted" aria-label="Previous month">
              <Icon name="chevron-left" className="h-4 w-4" />
            </button>
            <span className="px-2 text-sm font-medium">{MONTH_LABEL(year, month)}</span>
            <button type="button" onClick={() => router.push(`/attendance/late-early?m=${shiftMonth(year, month, 1)}`)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card transition hover:bg-muted" aria-label="Next month">
              <Icon name="chevron-right" className="h-4 w-4" />
            </button>
          </span>
        }
      />

      <FilterBar
        searchPlaceholder="Employee or date…"
        shown={rows.length}
        total={all.length}
        clearKeys={['flag']}
        views={views}
        extra={
          <select
            aria-label="Flag" value={flag ?? ''}
            onChange={(e) => list.set({ flag: e.target.value || null })}
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand"
          >
            <option value="">Late or early</option>
            <option value="late">Late arrivals ({lateCount})</option>
            <option value="early">Early departures ({earlyCount})</option>
          </select>
        }
      />

      <DataGrid
        exportAs={{ title: 'Late and early' }}
        rows={rows}
        columns={columns}
        rowKey={(r) => `${r.userId}-${r.workDate}`}
        emptyIcon="check-circle"
        emptyMessage={all.length === 0 ? 'Nothing to flag' : 'Nothing matches those filters'}
        emptyHint={all.length === 0
          ? 'Nobody arrived late or left early this month.'
          : 'Clear the filters to see everything flagged this month.'}
        mobileCard={(r) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{r.userName}</p>
              <p className="text-xs text-muted-foreground">
                {fmtDate(r.workDate)} · in {fmtTime(r.firstInAt)} · out {fmtTime(r.lastOutAt)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {r.isLate && <Badge tone="warning">{r.lateByMinutes}m late</Badge>}
              {r.isEarlyDeparture && <Badge tone="danger">{r.earlyByMinutes}m early</Badge>}
            </div>
          </div>
        )}
      />
    </div>
  );
}
