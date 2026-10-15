'use client';

import { EmployeeLink } from '@/components/document/EmployeeLink';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge, Card, Field, SectionCard } from '@/components/ui/Layout';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { useListParams } from '@/components/ui/useListParams';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { formatHours, formatWorked } from '@/lib/shift';
import { istDate } from '@/lib/date-ranges';
import { correctShiftAction } from './actions';

/**
 * Who worked, when, and roughly where.
 *
 * THE UNCLOSED COLUMN IS THE POINT OF THIS SCREEN.
 *
 * A shift nobody ended is closed by the server after sixteen hours and its
 * hours are excluded from every total here - not estimated, not prorated,
 * excluded. It will look like the numbers do not add up, and they do not:
 * "started work, never said they stopped" is unknown, and unknown must not
 * reach a wage calculation dressed as a plausible day.
 *
 * The alternative is worse than it sounds. Fill the gap with a guess and it is
 * indistinguishable from a real figure, so nobody ever asks the employee what
 * actually happened - and the first time somebody is underpaid or overpaid from
 * a guess, every number on this page becomes arguable.
 */

interface SummaryVM {
  userId: string;
  userName: string;
  daysWorked: number;
  daysUnclosed: number;
  totalMinutes: number | null;
  avgStartMinute: number | null;
  callsOnShift: number;
  callsAfterHours: number;
  lastSeenAt: string | null;
}

interface ShiftVM {
  id: string;
  /** app (phone), web (Present button), biometric, manual. */
  source: string;
  userId: string;
  userName: string;
  startedAt: string;
  endedAt: string | null;
  autoClosed: boolean;
  correctedEndedAt: string | null;
  correctionReason: string | null;
  workedMinutes: number | null;
  startLat: number | null;
  startLng: number | null;
  startLatIsApprox: boolean;
  endLat: number | null;
  endLng: number | null;
  note: string | null;
  callCount: number;
  pingCount: number;
  overtimeMinutes: number;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });

const fmtClock = (d: string) =>
  new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

/** Minutes past midnight back to `08:42`. */
function fmtMinuteOfDay(m: number | null): string {
  if (m === null) return '-';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Google Maps at a coarse zoom - matching how coarse the fix actually is. */
const mapUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}&z=15`;

export function ShiftsClient({
  rangeLabel, problems, openNow, paging, canExport, views, summary, shifts, canLocate, canEdit,
}: {
  /** The shift-date range in force, in words. */
  rangeLabel: string;
  /** ?problems=1 - only shifts that never ended. */
  problems: boolean;
  /** People on shift right now, counted over the whole range. */
  openNow: number;
  /** One page of shifts, filtered on the server (server/shifts-list). */
  paging: ServerPaging;
  canExport: boolean;
  views: FilterBarViews;
  summary: SummaryVM[];
  shifts: ShiftVM[];
  canLocate: boolean;
  canEdit: boolean;
}) {
  const list = useListParams();
  const router = useRouter();
  const params = useSearchParams();
  const activeUserId = params.get('person') ?? params.get('user');

  const totals = useMemo(() => {
    const t = summary.reduce(
      (acc, s) => ({
        worked: acc.worked + s.daysWorked,
        unclosed: acc.unclosed + s.daysUnclosed,
        minutes: acc.minutes + (s.totalMinutes ?? 0),
        afterHours: acc.afterHours + s.callsAfterHours,
      }),
      { worked: 0, unclosed: 0, minutes: 0, afterHours: 0 },
    );
    return { ...t, open: openNow };
  }, [summary, openNow]);

  const cards: KpiCard[] = [
    {
      key: 'days', label: 'Shifts completed', count: totals.worked,
      subLabel: `across ${summary.length} ${summary.length === 1 ? 'person' : 'people'}`,
      icon: 'check-circle', tone: 'success',
    },
    {
      // `formatHours`, not `formatWorked`. A zero total means zero hours; it
      // does not mean somebody forgot to clock off, and the first version of
      // this card said "Not ended" on an empty week because of that confusion.
      key: 'hours', label: 'Hours recorded', count: formatHours(totals.minutes),
      subLabel: 'completed shifts only', icon: 'clock',
    },
    {
      key: 'open', label: 'On shift now', count: totals.open,
      subLabel: totals.open > 0 ? 'currently working' : 'nobody clocked in',
      icon: 'users',
    },
    {
      key: 'unclosed', label: 'Never ended', count: totals.unclosed,
      subLabel: totals.unclosed > 0 ? 'hours unknown' : 'all closed properly',
      icon: 'alert-triangle', tone: totals.unclosed > 0 ? 'warning' : 'default',
    },
  ];

  // Clicking a row in the per-person table filters to that person - the same filter as the bar's.
  const setUser = (userId: string | null) => list.set({ person: userId, user: null });

  const columns: Column<ShiftVM>[] = [
    {
      key: 'date', header: 'Date', sortValue: (s) => new Date(s.startedAt).getTime(),
      render: (s) => (
        canLocate
          ? (
            <Link href={`/attendance/shifts/${s.id}`} className="text-xs text-brand hover:underline">
              {fmtDate(s.startedAt)}
            </Link>
          )
          : <span className="text-xs">{fmtDate(s.startedAt)}</span>
      ),
    },
    {
      key: 'who', header: 'Employee', sortValue: (s) => s.userName,
      render: (s) => <span className="font-medium"><EmployeeLink id={s.userId}>{s.userName}</EmployeeLink></span>,
    },
    {
      key: 'source', header: 'Checked in by', sortValue: (s) => s.source,
      render: (s) => <Badge tone={s.source === 'app' ? 'info' : 'neutral'}>{({ app: 'Phone', web: 'Website', biometric: 'Device', manual: 'Office' } as Record<string, string>)[s.source] ?? s.source}</Badge>,
    },
    {
      key: 'in', header: 'Started', sortValue: (s) => new Date(s.startedAt).getTime(),
      render: (s) => <span className="tabular-nums">{fmtClock(s.startedAt)}</span>,
    },
    {
      key: 'out', header: 'Ended', sortValue: (s) => (s.endedAt ? new Date(s.endedAt).getTime() : 0),
      render: (s) => {
        if (s.correctedEndedAt) {
          // Both versions on screen. A correction that looked identical to a
          // real clock-off would be the one thing this must never do.
          return (
            <span className="flex flex-col">
              <span className="tabular-nums">{fmtClock(s.correctedEndedAt)}</span>
              <span className="text-xs text-muted-foreground" title={s.correctionReason ?? ''}>
                corrected
              </span>
            </span>
          );
        }
        if (!s.endedAt) return <Badge tone="info">On shift</Badge>;
        if (s.autoClosed) return <Badge tone="warning">Not ended</Badge>;
        return <span className="tabular-nums">{fmtClock(s.endedAt)}</span>;
      },
    },
    {
      key: 'worked', header: 'Worked', align: 'end',
      sortValue: (s) => s.workedMinutes ?? -1,
      render: (s) => (
        s.workedMinutes === null
          ? (
            canEdit
              ? <FixButton shift={s} onDone={() => router.refresh()} />
              : <span className="text-xs text-warning">Unknown</span>
          )
          : <span className="tabular-nums font-medium">{formatWorked(s.workedMinutes)}</span>
      ),
    },
    {
      key: 'calls', header: 'Calls', align: 'end', sortValue: (s) => s.callCount,
      render: (s) => (
        s.callCount > 0
          // The calls themselves live in Call Logs - one home for calls (27 Sep 2026).
          ? <Link href={`/call-logs?person=${s.userId}&range=custom&from=${istDate(new Date(s.startedAt))}&to=${istDate(new Date(s.endedAt ?? s.startedAt))}`} className="tabular-nums text-brand hover:underline">{s.callCount}</Link>
          : <span className="text-muted-foreground">-</span>
      ),
    },
    {
      key: 'overtime', header: 'Overtime', align: 'end', optional: true,
      sortValue: (s) => s.overtimeMinutes,
      render: (s) => (
        s.overtimeMinutes > 0
          ? <span className="tabular-nums font-medium text-brand">{formatWorked(s.overtimeMinutes)}</span>
          : <span className="text-muted-foreground">-</span>
      ),
    },
    ...(canLocate ? [{
      key: 'where', header: 'Location', optional: true,
      sortValue: (s: ShiftVM) => (s.startLat === null ? 0 : 1),
      render: (s: ShiftVM) => {
        if (s.startLat === null || s.startLng === null) {
          return <span className="text-xs text-muted-foreground">Not shared</span>;
        }
        return (
          <span className="flex flex-col gap-0.5">
            <a
              href={mapUrl(s.startLat, s.startLng)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-brand hover:underline"
              title={s.startLatIsApprox ? 'From a location ping during the shift, not the clock-in moment' : undefined}
            >
              {s.startLatIsApprox ? 'Location on map' : 'Start on map'}
            </a>
            {s.endLat !== null && s.endLng !== null && (
              <a
                href={mapUrl(s.endLat, s.endLng)}
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs text-brand hover:underline"
              >
                End on map
              </a>
            )}
          </span>
        );
      },
    } as Column<ShiftVM>] : []),
  ];

  return (
    <>
      <PageHeader
        badge="SL"
        title="Shift Log"
        subtitle={`${rangeLabel} · ${totals.worked} completed · ${formatHours(totals.minutes)} recorded`}
      />

      {totals.unclosed > 0 && (
        <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          {/*
            SHORT ON A PHONE, FULL ON A DESKTOP.

            The whole paragraph is five lines on a 360px screen: it pushed the
            filters, the totals and the table itself below the fold, so the
            first thing anyone saw on the Shift Log was a warning about two
            rows they could not yet see. The instruction survives on both; only
            the reasoning is desktop-only, where there is room for it.
          */}
          <p className="flex-1 text-xs leading-relaxed">
            <strong>{totals.unclosed} shift{totals.unclosed === 1 ? '' : 's'} ended without
            anyone pressing End Shift.</strong>{' '}
            <span className="hidden sm:inline">
              Their hours are shown as unknown and are left out of every total on this page,
              not estimated. Ask the person what time they actually finished, then use
              <strong> Set finish time</strong> on the row. The original stays on the record
              beside your correction, so nobody can later mistake one for the other.
            </span>
            <span className="sm:hidden">
              Hours unknown, left out of the totals. Ask what time they finished, then use
              <strong> Set finish time</strong> on the row.
            </span>
          </p>
        </Card>
      )}

      <FilterBar
        searchPlaceholder="Employee, note, correction reason…"
        dates={{ defaultPreset: 'all', label: 'Shifts', activeLabel: rangeLabel }}
        people={{ label: 'Employee', options: summary.map((x) => ({ id: x.userId, fullName: x.userName })) }}
        shown={paging.total}
        clearKeys={['problems', 'user', 'days']}
        exportScreen={canExport ? 'shifts' : null}
        views={views}
      />

      <div className="mb-3">
        {/* The Never ended card is the filter - it was also a chip on the
            toolbar until 4 Oct 2026, the same thing twice. */}
        <KpiStrip cards={cards} activeKey={problems ? 'unclosed' : null}
          onSelect={(k) => list.set({ problems: k === 'unclosed' ? '1' : null })} columns={4} />
      </div>

      {summary.length > 0 && (
        <SectionCard title="By employee" icon="users" className="mb-4" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Employee</th>
                  <th className="px-3 py-2 text-right font-semibold">Shifts</th>
                  <th className="px-3 py-2 text-right font-semibold">Hours</th>
                  <th className="px-3 py-2 text-right font-semibold">Usual start</th>
                  <th className="px-3 py-2 text-right font-semibold">Calls on shift</th>
                  <th className="px-3 py-2 text-right font-semibold">After hours</th>
                  <th className="px-3 py-2 text-right font-semibold">Never ended</th>
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
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{s.daysWorked}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.totalMinutes === null
                        ? <span className="text-muted-foreground">-</span>
                        : formatHours(s.totalMinutes)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {fmtMinuteOfDay(s.avgStartMinute)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.callsOnShift}</td>
                    <td className="px-3 py-2 text-right">
                      {s.callsAfterHours > 0 ? (
                        <span className="tabular-nums text-muted-foreground">
                          {s.callsAfterHours}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.daysUnclosed > 0 ? (
                        <span className="tabular-nums font-medium text-warning">
                          {s.daysUnclosed}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="border-t border-border bg-muted/20 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <strong>Hours</strong> counts only shifts that were properly ended - a shift in the
            Never ended column contributes nothing to it. <strong>After hours</strong> is work
            calls made outside a shift; they are recorded but deliberately kept out of the
            on-shift figure, so the same number means the same thing for everybody.
          </p>
        </SectionCard>
      )}

      <DataGrid
        rows={shifts}
        server={paging}
        columns={columns}
        rowKey={(s) => s.id}
        emptyIcon="clock"
        emptyMessage={
          shifts.length === 0
            ? 'No shifts recorded yet'
            : 'No shifts match this filter'
        }
        emptyHint={
          shifts.length === 0
            ? 'Staff clock in from the Vcare app on their phone.'
            : undefined
        }
      />

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Shifts come from the Vcare app - the employee presses Clock in when they begin and
        Clock out when they finish; their calls are sent to the office at clock-out and during
        the shift.
        {canLocate
          ? ' Location is recorded only during a shift, only if the employee allowed it, and is'
            + ' accurate to roughly 100 metres - it shows the area someone was in, not an exact spot.'
          : ' Location is recorded during shifts but you do not have permission to view it.'}
      </p>
    </>
  );
}

/**
 * Fix a shift nobody closed.
 *
 * The time defaults to the shift's START, not to a plausible evening hour.
 * That is on purpose: a default of "18:00" gets accepted without thought by
 * somebody clicking through a list, and a plausible wrong wage is far worse
 * than an obviously wrong one that forces a moment's attention.
 */
function FixButton({ shift, onDone }: { shift: ShiftVM; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState(() => {
    const d = new Date(shift.startedAt);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
      + `T${p(d.getHours())}:${p(d.getMinutes())}`;
  });

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Set finish time</Button>
      {open && (
        <Modal
          title={`${shift.userName} - ${fmtDate(shift.startedAt)}`}
          subtitle={`Started ${fmtClock(shift.startedAt)}. Nobody pressed End Shift.`}
          icon="clock"
          size="sm"
          onClose={() => setOpen(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!reason.trim() || busy}
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const r = await correctShiftAction(shift.id, when, reason);
                  setBusy(false);
                  if (r.error) setError(r.error);
                  else { setOpen(false); onDone(); }
                }}
              >
                Save correction
              </Button>
            </div>
          }
        >
          {error && <p className="mb-2 text-xs text-danger">{error}</p>}

          <Field label="What time did they actually finish?">
            <input
              type="datetime-local"
              className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </Field>

          <div className="mt-3">
            <Field label="Why" hint="Recorded with your name and today's date.">
              <input
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Forgot to press End Shift; confirmed with him"
              />
            </Field>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            The system&apos;s original entry is kept beside your correction. The row will show
            your time and be marked <strong>corrected</strong> - it will never look as though
            the employee clocked off themselves.
          </p>
        </Modal>
      )}
    </>
  );
}
