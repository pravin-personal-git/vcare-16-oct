'use client';

import { EmployeeLink } from '@/components/document/EmployeeLink';
import { useState } from 'react';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { istDate } from '@/lib/date-ranges';
import { weekdayOf as weekdayNumber } from '@/lib/attendance-day';
import { PageHeader, Badge, Card, Field, SectionCard } from '@/components/ui/Layout';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import {
  DAY_STATUS_LABEL, DAY_STATUS_SHORT, payableDays, type DayStatus,
} from '@/lib/attendance';
import { formatHours } from '@/lib/shift';
import { addHolidayAction, decideLeaveAction, requestLeaveAction } from './actions';

/**
 * The month grid.
 *
 * COLOUR CARRIES THE MEANING, BUT NEVER ALONE.
 *
 * Every cell also holds a letter - P, L, A, Lv - and a tooltip. Roughly one man
 * in twelve cannot reliably separate red from green, and this is a screen made
 * almost entirely of red and green boxes. A grid that only works for people
 * with unimpaired colour vision is a grid that quietly excludes a colleague
 * from doing their job.
 */

interface DayVM {
  date: string;
  status: DayStatus;
  startedAt: string | null;
  workedMinutes: number | null;
}

interface RowVM {
  userId: string;
  userName: string;
  departmentName: string | null;
  days: DayVM[];
  totals: {
    present: number; late: number; halfDay: number; wfh: number;
    leave: number; absent: number; unmarked: number; workingDays: number;
  };
}

interface GridVM {
  year: number;
  month: number;
  dates: string[];
  rows: RowVM[];
  holidays: { date: string; name: string; kind: string }[];
  today: {
    present: number; late: number; onLeave: number;
    wfh: number; unmarked: number; halfDay: number;
  };
  isCurrentMonth: boolean;
  pendingRequests: number;
}

interface RequestVM {
  id: string;
  userId: string;
  userName: string;
  kind: string;
  leaveTypeCode: string | null;
  fromDate: string;
  toDate: string;
  reason: string | null;
  status: string;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

/** Background, text, and border for each state. */
const CELL: Record<DayStatus, string> = {
  present: 'bg-success/15 text-on-tint-success border-success/25',
  late: 'bg-warning/15 text-on-tint-warning border-warning/25',
  half_day: 'bg-brand/15 text-on-tint-brand border-brand/25',
  wfh: 'bg-info/15 text-on-tint-info border-info/25',
  leave: 'bg-navy/10 text-on-tint-navy border-navy/20',
  holiday: 'bg-muted text-muted-foreground border-border',
  weekend: 'bg-muted/40 text-muted-foreground border-transparent',
  absent: 'bg-danger/15 text-on-tint-danger border-danger/25',
  unmarked: 'bg-card text-muted-foreground border-border',
  future: 'bg-transparent text-transparent border-transparent',
};

const LEGEND: DayStatus[] = [
  'present', 'late', 'half_day', 'wfh', 'leave', 'absent', 'unmarked', 'holiday', 'weekend',
];

const KIND_LABEL: Record<string, string> = {
  leave: 'Leave',
  wfh: 'Work from home',
  half_day: 'Half day',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const dayNum = (iso: string) => Number(iso.slice(8, 10));
const weekdayOf = (iso: string) =>
  ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][weekdayNumber(iso)];

interface LeaveTypeVM { id: string; code: string; name: string }

export function GridClient({
  grid, requests, leaveTypes, canEdit, canExport, views,
}: {
  canExport: boolean;
  views: FilterBarViews;
  grid: GridVM;
  requests: RequestVM[];
  leaveTypes: LeaveTypeVM[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [showLeave, setShowLeave] = useState(false);
  const [showHoliday, setShowHoliday] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pending = requests.filter((r) => r.status === 'pending');
  const holidayByDate = new Map(grid.holidays.map((h) => [h.date, h]));

  const shift = (delta: number) => {
    const d = new Date(grid.year, grid.month + delta, 1);
    // Keeps the person search while moving between months.
    const q = new URLSearchParams(window.location.search).get('q');
    router.push(`/attendance/grid?m=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  };

  const cards: KpiCard[] = [
    { key: 'p', label: 'Present today', count: grid.today.present, subLabel: 'clocked in', icon: 'check-circle', tone: 'success' },
    { key: 'l', label: 'Late', count: grid.today.late, subLabel: 'after shift start + grace', icon: 'clock', tone: grid.today.late > 0 ? 'warning' : 'default' },
    { key: 'lv', label: 'On leave / WFH', count: grid.today.onLeave + grid.today.wfh, subLabel: 'approved', icon: 'users', tone: 'info' },
    { key: 'u', label: 'Not marked', count: grid.today.unmarked, subLabel: grid.today.unmarked > 0 ? 'no shift started' : 'everyone accounted for', icon: 'alert-triangle', tone: grid.today.unmarked > 0 ? 'warning' : 'success' },
  ];

  return (
    <>
      <PageHeader
        badge="AT"
        title="Attendance"
        subtitle={`${MONTHS[grid.month]} ${grid.year} · ${grid.rows.length} staff`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon="arrow-left" onClick={() => shift(-1)}>Prev</Button>
            <Button size="sm" onClick={() => router.push('/attendance/grid')}>This month</Button>
            <Button size="sm" onClick={() => shift(1)}>Next</Button>
            {canEdit && (
              <>
                <Button size="sm" icon="plus" onClick={() => setShowLeave(true)}>Leave</Button>
                <Button size="sm" icon="calendar" onClick={() => setShowHoliday(true)}>Holiday</Button>
              </>
            )}
            <Link href="/attendance/shifts">
              <Button size="sm" icon="clock">Shift log</Button>
            </Link>
          </div>
        }
      />

      <FilterBar
        searchPlaceholder="Person…"
        shown={grid.rows.length}
        exportScreen={canExport ? 'attendance_month' : null}
        views={views}
      />

      {message && (
        <Card className="mb-3 border-success/30 bg-success/[0.06] px-3 py-2.5">
          <p className="text-xs">{message}</p>
        </Card>
      )}

      {grid.rows.length === 0 && (
        <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="flex-1 text-xs leading-relaxed">
            <strong>Nobody has a paired phone yet.</strong> Attendance comes from the Vcare
            app - staff appear here once their phone is paired under{' '}
            <Link href="/settings/call-devices" className="font-medium text-brand hover:underline">
              Phones
            </Link>
            . People without a phone are deliberately left off: they cannot clock in, so every
            day would read as an absence.
          </p>
        </Card>
      )}

      {grid.isCurrentMonth && (
        <div className="mb-3">
          <KpiStrip cards={cards} activeKey={null} onSelect={() => undefined} columns={4} />
        </div>
      )}

      {pending.length > 0 && (
        <SectionCard
          title={`Requests waiting for a decision (${pending.length})`}
          icon="alert-triangle"
          className="mb-4"
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border">
            {pending.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                canEdit={canEdit}
                onDone={(m) => { setMessage(m); router.refresh(); }}
              />
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title={`${MONTHS[grid.month]} ${grid.year}`}
        icon="calendar"
        className="mb-4"
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                  Employee
                </th>
                {grid.dates.map((iso) => {
                  const hol = holidayByDate.get(iso);
                  const wd = weekdayOf(iso);
                  return (
                    <th
                      key={iso}
                      title={hol ? hol.name : undefined}
                      className={`w-8 px-0 py-1 text-center text-xs font-medium ${
                        hol ? 'text-brand' : wd === 'Su' ? 'text-muted-foreground' : ''
                      }`}
                    >
                      <span className="block text-xs text-muted-foreground">{wd}</span>
                      {dayNum(iso)}
                    </th>
                  );
                })}
                {/* Totals. Deliberately at the far right, after the month, so
                    the eye reads the shape first and the arithmetic second. */}
                <th className="px-2 py-2 text-center text-xs font-semibold text-success">P</th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-warning">L</th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-danger">A</th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-navy">Lv</th>
                <th className="px-2 py-2 text-center text-xs font-semibold">Paid</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.userId} className="border-b border-border last:border-0">
                  <td className="sticky left-0 z-10 bg-card px-3 py-1.5">
                    <Link
                      href={`/attendance/shifts?user=${row.userId}`}
                      className="block truncate font-medium text-brand hover:underline"
                    >
                      <EmployeeLink id={row.userId}>{row.userName}</EmployeeLink>
                    </Link>
                    {row.departmentName && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.departmentName}
                      </span>
                    )}
                  </td>

                  {row.days.map((d) => (
                    <td key={d.date} className="p-0.5 text-center">
                      <span
                        title={
                          `${d.date} - ${DAY_STATUS_LABEL[d.status]}`
                          + (d.startedAt ? ` · in ${d.startedAt}` : '')
                          + (d.workedMinutes !== null ? ` · ${formatHours(d.workedMinutes)}` : '')
                        }
                        className={`mx-auto flex h-6 w-6 items-center justify-center rounded border text-xs font-semibold ${CELL[d.status]}`}
                      >
                        {DAY_STATUS_SHORT[d.status]}
                      </span>
                    </td>
                  ))}

                  <td className="px-2 text-center tabular-nums font-medium text-success">
                    {row.totals.present || ''}
                  </td>
                  <td className="px-2 text-center tabular-nums text-warning">
                    {row.totals.late || ''}
                  </td>
                  <td className="px-2 text-center tabular-nums text-danger">
                    {row.totals.absent || ''}
                  </td>
                  <td className="px-2 text-center tabular-nums text-navy">
                    {row.totals.leave || ''}
                  </td>
                  <td className="px-2 text-center tabular-nums font-semibold">
                    {payableDays(row.totals)}
                    <span className="text-xs text-muted-foreground">
                      /{row.totals.workingDays}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
          {LEGEND.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className={`flex h-4 w-4 items-center justify-center rounded border text-xs font-semibold ${CELL[s]}`}
              >
                {DAY_STATUS_SHORT[s]}
              </span>
              <span className="text-xs text-muted-foreground">{DAY_STATUS_LABEL[s]}</span>
            </span>
          ))}
        </div>

        <p className="border-t border-border bg-muted/20 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <strong>Paid</strong> counts a half day as half and does not count leave. It is shown
          against working days - Sundays and holidays are excluded from both, so &ldquo;18/22&rdquo;
          means something that &ldquo;18/30&rdquo; would not. Somebody who worked on a holiday
          shows as present, because they did.
        </p>
      </SectionCard>

      {grid.holidays.length > 0 && (
        <SectionCard title="Holidays this month" icon="calendar" className="mb-4">
          <div className="flex flex-wrap gap-2">
            {grid.holidays.map((h) => (
              <Badge key={`${h.date}-${h.name}`} tone="brand">
                {dayNum(h.date)} - {h.name}
              </Badge>
            ))}
          </div>
        </SectionCard>
      )}

      {requests.filter((r) => r.status !== 'pending').length > 0 && (
        <SectionCard title="Decided requests" icon="check-circle" bodyClassName="p-0">
          <div className="divide-y divide-border">
            {requests.filter((r) => r.status !== 'pending').slice(0, 20).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
                <span className="font-medium"><EmployeeLink id={r.userId}>{r.userName}</EmployeeLink></span>
                <Badge tone="neutral">{KIND_LABEL[r.kind] ?? r.kind}{r.leaveTypeCode ? ` · ${r.leaveTypeCode}` : ''}</Badge>
                <span className="text-muted-foreground">
                  {r.fromDate}{r.toDate !== r.fromDate ? ` → ${r.toDate}` : ''}
                </span>
                <Badge tone={r.status === 'approved' ? 'success' : 'danger'}>{r.status}</Badge>
                {r.decisionNote && (
                  <span className="text-xs text-muted-foreground">{r.decisionNote}</span>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {showLeave && (
        <LeaveModal
          staff={grid.rows.map((r) => ({ id: r.userId, name: r.userName }))}
          leaveTypes={leaveTypes}
          onClose={() => setShowLeave(false)}
          onSaved={(m) => { setShowLeave(false); setMessage(m); router.refresh(); }}
        />
      )}

      {showHoliday && (
        <HolidayModal
          onClose={() => setShowHoliday(false)}
          onSaved={(m) => { setShowHoliday(false); setMessage(m); router.refresh(); }}
        />
      )}
    </>
  );
}

/**
 * One waiting request, on the Monthly Grid.
 *
 * This is where a leave, work-from-home or comp-off request is decided, and
 * it is where My Desk's "Open" link lands - so the row carries its own id for
 * OpenTarget to find (8 Oct 2026). Without it the link arrived at the right
 * screen and left the person to scroll.
 */
function RequestRow({
  request, canEdit, onDone,
}: {
  request: RequestVM;
  canEdit: boolean;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(true);
    setError(null);
    const r = await decideLeaveAction(request.id, decision, null);
    setBusy(false);
    if (r.error) setError(r.error);
    else onDone(r.message ?? 'Done.');
  };

  const days = Math.round(
    (new Date(request.toDate).getTime() - new Date(request.fromDate).getTime()) / 86_400_000,
  ) + 1;

  return (
    <div data-row-id={request.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{request.userName}</span>
          <Badge tone="info">{KIND_LABEL[request.kind] ?? request.kind}{request.leaveTypeCode ? ` · ${request.leaveTypeCode}` : ''}</Badge>
          <span className="text-xs text-muted-foreground">
            {request.fromDate}
            {request.toDate !== request.fromDate ? ` → ${request.toDate}` : ''}
            {' · '}{days} day{days === 1 ? '' : 's'}
          </span>
        </div>
        {request.reason && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {request.reason}
          </p>
        )}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>

      {canEdit && (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="danger" disabled={busy} onClick={() => decide('rejected')}>
            Reject
          </Button>
          <Button size="sm" variant="primary" disabled={busy} loading={busy} onClick={() => decide('approved')}>
            Approve
          </Button>
        </div>
      )}
    </div>
  );
}

function LeaveModal({
  staff, leaveTypes, onClose, onSaved,
}: {
  staff: { id: string; name: string }[];
  leaveTypes: LeaveTypeVM[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  // India's today - the UTC date is yesterday until 05:30.
  const today = istDate(new Date());
  const [userId, setUserId] = useState('');
  const [kind, setKind] = useState<'leave' | 'wfh' | 'half_day'>('leave');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      title="Record leave or work from home"
      subtitle="It is created pending, and still needs approving below"
      icon="users"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!userId || busy}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await requestLeaveAction({
                userId, kind, leaveTypeId: kind === 'leave' && leaveTypeId ? leaveTypeId : null,
                fromDate: from, toDate: to, reason: reason.trim() || null,
              });
              setBusy(false);
              if (r.error) setError(r.error);
              else onSaved(r.message ?? 'Recorded.');
            }}
          >
            Record it
          </Button>
        </div>
      }
    >
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who">
          <select
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">Choose…</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>

        <Field label="Type">
          <select
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="leave">Leave</option>
            <option value="wfh">Work from home</option>
            <option value="half_day">Half day</option>
          </select>
        </Field>

        {kind === 'leave' && leaveTypes.length > 0 && (
          <Field label="Leave type" hint="Optional - leave blank if this store hasn't categorised leave yet.">
            <select
              className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              value={leaveTypeId}
              onChange={(e) => setLeaveTypeId(e.target.value)}
            >
              <option value="">Not specified</option>
              {leaveTypes.map((lt) => <option key={lt.id} value={lt.id}>{lt.code} - {lt.name}</option>)}
            </select>
          </Field>
        )}

        <Field label="From">
          <input
            type="date"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={from}
            onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }}
          />
        </Field>

        <Field label="To">
          <input
            type="date"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Reason" hint="Optional, but it is what a decision is made on.">
          <input
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Family function"
          />
        </Field>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Sundays and holidays inside the range are not counted as leave days - somebody taking
        Monday to Friday off does not spend a leave day on the Sunday in the middle.
      </p>
    </Modal>
  );
}

function HolidayModal({
  onClose, onSaved,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [date, setDate] = useState(istDate(new Date()));
  const [name, setName] = useState('');
  const [kind, setKind] = useState('public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      title="Add a holiday"
      subtitle="For this branch only"
      icon="calendar"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!name.trim() || busy}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await addHolidayAction(date, name, kind);
              setBusy(false);
              if (r.error) setError(r.error);
              else onSaved(r.message ?? 'Added.');
            }}
          >
            Add it
          </Button>
        </div>
      }
    >
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}

      <Field label="Date">
        <input
          type="date"
          className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>

      <div className="mt-3">
        <Field label="Name">
          <input
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Diwali"
          />
        </Field>
      </div>

      <div className="mt-3">
        <Field
          label="Type"
          hint="An optional holiday does not excuse an absence by itself - staff choose whether to take it."
        >
          <select
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="public">Public holiday</option>
            <option value="optional">Optional holiday</option>
            <option value="closure">Branch closure</option>
          </select>
        </Field>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Holidays are set per branch, because a Chhattisgarh office and a Kerala office close on
        different days. A national list would mark the wrong people absent in both.
      </p>
    </Modal>
  );
}
