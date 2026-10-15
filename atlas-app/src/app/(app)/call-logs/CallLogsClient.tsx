'use client';

import { EmployeeLink } from '@/components/document/EmployeeLink';
import { useMemo } from 'react';
import Link from 'next/link';
import { CustomerLink } from '@/components/document/CustomerLink';
import { PageHeader, Badge, Card, SectionCard } from '@/components/ui/Layout';
import { FilterChip } from '@/components/ui/Toolbar';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { useListParams } from '@/components/ui/useListParams';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  DIRECTION_LABEL, formatDuration, formatNumber, stalenessWarning,
  type CallMetrics,
} from '@/lib/call-log';

/**
 * Who called whom, and who was never called back.
 *
 * THE WARNING BANNER IS THE MOST IMPORTANT THING ON THIS PAGE.
 *
 * Every number below is only as true as the phones that reported it. When
 * Android kills the app - and on Xiaomi, Oppo, Vivo and Realme it will - the
 * calls simply stop arriving, and a manager reading "3 calls" concludes their
 * salesperson did almost nothing that week. That misreading, once, destroys
 * trust in the feature permanently.
 *
 * So the staleness banner sits ABOVE the figures, not beside them, and it names
 * the phone as the problem rather than the person.
 */

interface Summary {
  userId: string;
  userName: string;
  metrics: CallMetrics;
  lastSyncedAt: string | null;
  staleLabel: string;
  staleWarn: boolean;
  neverConnectedCount: number;
}

interface CallRowVM {
  id: string;
  userId: string;
  userName: string;
  rawNumber: string;
  e164Number: string;
  direction: string;
  startedAt: string;
  durationSec: number;
  matchedCrm: boolean;
  partyId: string | null;
  partyName: string | null;
  syncedAt: string;
}

const fmtTime = (d: string) =>
  new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

export function CallLogsClient({
  rangeLabel, type, team = null, capped, paging, canExport, views, activeUserId, summary, calls, devices, canManage, ownOnly = false,
}: {
  /** The call-date range in force, in words. */
  rangeLabel: string;
  /** outgoing | missed | null (?type=). */
  type: string | null;
  /**
   * Which half of the branch this view counts.
   *
   * 'service' since 27 Sep 2026; 'sales' added 8 Oct when Pravin asked for
   * the Sales menu to read "Sales Team Calls" rather than "Call Logs". One
   * screen, two doors into it - and the chip row says which door you came
   * through, so nobody has to read the address bar to know.
   */
  team?: 'service' | 'sales' | null;
  /** The period held more calls than one load returns - narrow it. */
  capped: boolean;
  /** One page of calls, filtered on the server (server/calls-list). */
  paging: ServerPaging;
  canExport: boolean;
  views: FilterBarViews;
  activeUserId: string | null;
  summary: Summary[];
  calls: CallRowVM[];
  devices: { userId: string; userName: string; lastSyncedAt: string | null; callHealth: { tone: 'ok' | 'warn' | 'bad'; text: string } }[];
  canManage: boolean;
  /** No calls.view: only the person's own calls are shown. */
  ownOnly?: boolean;
}) {
  const list = useListParams();

  const warning = useMemo(
    () => stalenessWarning(
      devices.map((d) => ({
        userName: d.userName,
        lastSyncedAt: d.lastSyncedAt ? new Date(d.lastSyncedAt) : null,
      })),
    ),
    [devices],
  );

  const totals = useMemo(() => {
    const m = summary.reduce(
      (acc, s) => ({
        connectedOutgoing: acc.connectedOutgoing + s.metrics.connectedOutgoing,
        total: acc.total + s.metrics.total,
        talkTimeSec: acc.talkTimeSec + s.metrics.talkTimeSec,
        notConnected: acc.notConnected + s.metrics.notConnected,
        neverConnected: acc.neverConnected + s.neverConnectedCount,
      }),
      { connectedOutgoing: 0, total: 0, talkTimeSec: 0, notConnected: 0, neverConnected: 0 },
    );
    return { ...m, unhealthy: summary.filter((s) => s.staleWarn).length };
  }, [summary]);

  const cards: KpiCard[] = [
    {
      key: 'connected', label: 'Calls connected', count: totals.connectedOutgoing,
      subLabel: `of ${totals.total} logged`, icon: 'phone', tone: 'success',
    },
    {
      key: 'talk', label: 'Talk time', count: formatDuration(totals.talkTimeSec),
      subLabel: `across ${summary.length} ${summary.length === 1 ? 'person' : 'people'}`,
      icon: 'clock',
    },
    {
      key: 'chasing', label: 'Never reached', count: totals.neverConnected,
      subLabel: 'numbers with no answer', icon: 'alert-triangle',
      tone: totals.neverConnected > 0 ? 'warning' : 'default',
    },
    {
      key: 'phones', label: 'Phones not reporting', count: totals.unhealthy,
      subLabel: totals.unhealthy > 0 ? 'figures incomplete' : 'all reporting',
      icon: 'alert-circle', tone: totals.unhealthy > 0 ? 'danger' : 'success',
    },
  ];

  // Clicking a row in "By employee" filters to that person - the same filter as the bar's.
  const setUser = (userId: string | null) => list.set({ person: userId, user: null });

  const columns: Column<CallRowVM>[] = [
    {
      key: 'when', header: 'When', sortValue: (c) => new Date(c.startedAt).getTime(),
      render: (c) => <span className="text-xs">{fmtTime(c.startedAt)}</span>,
    },
    {
      key: 'who', header: 'Employee', sortValue: (c) => c.userName,
      render: (c) => <span className="font-medium"><EmployeeLink id={c.userId}>{c.userName}</EmployeeLink></span>,
    },
    {
      key: 'number', header: 'Number', sortValue: (c) => c.e164Number,
      render: (c) => (
        <span className="flex flex-col">
          <span className="font-mono text-xs">{formatNumber(c.e164Number)}</span>
          {c.partyId ? (
            <Link href={`/customers/${c.partyId}`} className="text-xs text-brand hover:underline">
              {c.partyName}
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">Not in CRM</span>
          )}
        </span>
      ),
    },
    {
      key: 'direction', header: 'Type', sortValue: (c) => c.direction,
      render: (c) => {
        const label = DIRECTION_LABEL[c.direction] ?? c.direction;
        if (c.direction === 'outgoing') return <Badge tone="info">{label}</Badge>;
        if (c.direction === 'incoming') return <Badge tone="success">{label}</Badge>;
        return <Badge tone="warning">{label}</Badge>;
      },
    },
    {
      key: 'duration', header: 'Duration', align: 'end', sortValue: (c) => c.durationSec,
      render: (c) => (
        c.durationSec > 0
          ? <span className="tabular-nums">{formatDuration(c.durationSec)}</span>
          : <span className="text-xs text-muted-foreground">Not connected</span>
      ),
    },
    {
      key: 'synced', header: 'Reported', optional: true,
      sortValue: (c) => new Date(c.syncedAt).getTime(),
      render: (c) => (
        <span className="text-xs text-muted-foreground">{fmtTime(c.syncedAt)}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        badge="CL"
        title={ownOnly ? "My Calls" : "Call Logs"}
        subtitle={`${rangeLabel} · ${totals.total} calls · ${formatDuration(totals.talkTimeSec)} talk time`}
        actions={
          canManage ? (
            <Link href="/settings/call-devices">
              <Button icon="phone">Manage phones</Button>
            </Link>
          ) : undefined
        }
      />

      {/* Above the numbers, deliberately. A manager must read this before they
          read a count and draw a conclusion from it. */}
      {warning && (
        <Card className="mb-3 flex items-start gap-2.5 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="flex-1 text-xs leading-relaxed">
            {warning}
            {canManage && (
              <>
                {' '}
                <Link href="/settings/call-devices" className="font-medium text-brand hover:underline">
                  Check the phones
                </Link>
              </>
            )}
          </p>
        </Card>
      )}

      <FilterBar
        searchPlaceholder="Number, employee, customer…"
        dates={{ defaultPreset: 'all', label: 'Calls', activeLabel: rangeLabel }}
        people={ownOnly ? undefined : { label: 'Employee', options: summary.map((x) => ({ id: x.userId, fullName: x.userName })) }}
        extra={
          <>
            {!ownOnly && (
              <>
                <FilterChip label="Service team" icon="users" active={team === 'service'}
                  onClick={() => list.set({ team: team === 'service' ? null : 'service' })} />
                {/* One screen, two doors: the Sales menu arrives on this one. */}
                <FilterChip label="Sales team" icon="trending-up" active={team === 'sales'}
                  onClick={() => list.set({ team: team === 'sales' ? null : 'sales' })} />
              </>
            )}
            <FilterChip label="Outgoing" icon="phone" active={type === 'outgoing'}
              onClick={() => list.set({ type: type === 'outgoing' ? null : 'outgoing' })} />
            <FilterChip label="Not connected" icon="alert-triangle" active={type === 'missed'}
              onClick={() => list.set({ type: type === 'missed' ? null : 'missed' })} />
          </>
        }
        shown={paging.total}
        clearKeys={['type', 'user', 'days', 'team']}
        exportScreen={canExport ? 'calls' : null}
        views={views}
      />

      {/*
        Each view says who it counts and offers to make that certain. Until
        an admin ticks the departments, both teams are GUESSED from
        department and role names - which is better than a blank screen on
        day one, and much worse than being told it is a guess.
      */}
      {team === 'service' && (
        <p className="mb-3 text-xs text-muted-foreground">
          Service team = people in a service department or with a technician-type role.{' '}
          <Link href="/service?setup=1" className="font-medium text-brand hover:underline">Choose service departments</Link>
        </p>
      )}
      {team === 'sales' && (
        <p className="mb-3 text-xs text-muted-foreground">
          Sales team = people in a sales department or with a sales-type role.{' '}
          <Link href="/departments" className="font-medium text-brand hover:underline">Departments</Link>
        </p>
      )}

      {capped && (
        <p className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          This period holds more calls than one page load can bring back - pick a shorter range or one employee to see them all.
        </p>
      )}

      <div className="mb-3">
        <KpiStrip cards={cards} activeKey={null} onSelect={() => undefined} columns={4} />
      </div>

      {summary.length > 0 && !ownOnly && (
        <SectionCard title="By employee" icon="users" className="mb-4" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Employee</th>
                  <th className="px-3 py-2 text-right font-semibold">Connected</th>
                  <th className="px-3 py-2 text-right font-semibold">Attempted</th>
                  <th className="px-3 py-2 text-right font-semibold">Talk time</th>
                  <th className="px-3 py-2 text-right font-semibold">People</th>
                  <th className="px-3 py-2 text-right font-semibold">Never reached</th>
                  <th className="px-3 py-2 font-semibold">Phone</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr
                    key={s.userId}
                    onClick={() => setUser(activeUserId === s.userId ? null : s.userId)}
                    className={`cursor-pointer border-b border-border last:border-0 hover:bg-muted ${
                      activeUserId === s.userId ? 'bg-brand/[0.06]' : ''
                    }`}
                  >
                    <td className="px-3 py-2 font-medium"><EmployeeLink id={s.userId}>{s.userName}</EmployeeLink></td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {s.metrics.connectedOutgoing}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {s.metrics.total}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatDuration(s.metrics.talkTimeSec)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.metrics.uniqueNumbers}
                      {s.metrics.crmNumbers > 0 && (
                        <span className="ms-1 text-xs text-muted-foreground">
                          ({s.metrics.crmNumbers} in CRM)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.neverConnectedCount > 0 ? (
                        <span className="tabular-nums font-medium text-warning">
                          {s.neverConnectedCount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {s.staleWarn
                        ? <Badge tone="danger">{s.staleLabel}</Badge>
                        : <span className="text-xs text-muted-foreground">{s.staleLabel}</span>}
                      {/* Why a phone shows no calls - lib/device-trust callHealth (27 Sep 2026). */}
                      {devices.filter((d) => d.userId === s.userId && d.callHealth.tone !== 'ok').map((d) => (
                        <span key={d.userId + d.callHealth.text} className={`mt-0.5 block max-w-[16rem] text-xs leading-snug ${d.callHealth.tone === 'bad' ? 'text-danger' : 'text-warning'}`}>
                          {d.callHealth.text}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="border-t border-border bg-muted/20 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <strong>Connected</strong> is outgoing calls where somebody actually answered -
            the number worth judging effort on. <strong>Attempted</strong> counts everything
            including missed and rejected. A row with a red phone badge is reporting
            incompletely; read its figures as a floor, not a total.
          </p>
        </SectionCard>
      )}

      <DataGrid
        rows={calls}
        server={paging}
        columns={columns}
        rowKey={(c) => c.id}
        mobileCard={(c) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm">{formatNumber(c.e164Number)}</span>
              <span className="text-xs text-muted-foreground">{fmtTime(c.startedAt)}</span>
            </div>
            <p className="text-xs">
              {c.partyName ? <CustomerLink id={c.partyId}>{c.partyName}</CustomerLink> : <span className="text-muted-foreground">Not in CRM</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {c.userName} · {DIRECTION_LABEL[c.direction] ?? c.direction} · {c.durationSec > 0 ? formatDuration(c.durationSec) : 'not connected'}
            </p>
          </div>
        )}
        emptyIcon="phone"
        emptyMessage={
          devices.length === 0
            ? 'No phones are paired yet'
            : 'No calls in this period'
        }
        emptyHint={
          devices.length === 0
            ? 'Pair a phone under Settings → Phones, install Vcare on it, and calls start appearing here.'
            : 'Either nobody called anyone, or the phones have not reported. Check the phone column above before assuming the first.'
        }
      />

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Metadata only - number, direction, time and duration. No recordings and no
        messages: call recording is banned by Google Play and blocked by Android itself,
        and SMS access is not available for business use. Numbers are matched to customers
        when this page loads, so a number that becomes a customer next month will link
        back to calls made to it today.
      </p>
    </>
  );
}
