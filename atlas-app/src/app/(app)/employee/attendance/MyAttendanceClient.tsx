'use client';

import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Badge, type BadgeTone, Card, EmptyState, PageHeader, SectionCard } from '@/components/ui/Layout';
import type { MyDay, MyMonth } from '@/server/my-attendance';

/**
 * A month of one person's days, and where each one came from.
 *
 * THE SOURCE COLUMN IS THE POINT.
 *
 * Every other attendance screen shows a status. This one also shows whether the
 * day came from the field phone or from the Present button, because those are
 * different strengths of evidence and the person whose pay depends on them is
 * entitled to see which they have. Hiding it would make the two look equal
 * right up until somebody disputed one.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SOURCE: Record<MyDay['source'], { label: string; tone: BadgeTone; icon: IconName }> = {
  phone: { label: 'Field phone', tone: 'success', icon: 'phone' },
  web: { label: 'Present button', tone: 'info', icon: 'check-circle' },
  biometric: { label: 'Biometric device', tone: 'success', icon: 'sparkles' },
  manual: { label: 'Entered by staff', tone: 'neutral', icon: 'user' },
  holiday: { label: 'Holiday', tone: 'brand', icon: 'calendar' },
  'week-off': { label: 'Week off', tone: 'neutral', icon: 'calendar' },
  leave: { label: 'Leave', tone: 'warning', icon: 'calendar' },
  none: { label: '', tone: 'neutral', icon: 'x' },
};

function duration(minutes: number | null): string {
  if (minutes === null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function dayLabel(iso: string): { day: string; weekday: string } {
  // Midnight India time, read in India time - the same day on any browser or server.
  const d = new Date(`${iso}T00:00:00+05:30`);
  return {
    day: iso.slice(8, 10),
    weekday: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' }),
  };
}

export function MyAttendanceClient({
  month, userName, storeName,
}: {
  month: MyMonth | null;
  userName: string;
  storeName: string;
}) {
  if (!month) {
    return (
      <div>
        <PageHeader badge="AT" title="My attendance" subtitle="Your own record, day by day" />
        <Card>
          <EmptyState
            icon="calendar"
            title="You are not assigned to a store"
            hint="Attendance is kept per branch, so your record needs one. Ask an administrator to assign you."
          />
        </Card>
      </div>
    );
  }

  const prev = month.month === 0
    ? { y: month.year - 1, m: 11 }
    : { y: month.year, m: month.month - 1 };
  const next = month.month === 11
    ? { y: month.year + 1, m: 0 }
    : { y: month.year, m: month.month + 1 };

  const cards: { label: string; value: number | string; tone: BadgeTone }[] = [
    { label: 'Present', value: month.totals.present, tone: 'success' },
    { label: 'Half days', value: month.totals.halfDay, tone: 'warning' },
    { label: 'Nothing recorded', value: month.totals.absent, tone: 'danger' },
    { label: 'Leave', value: month.totals.leave, tone: 'warning' },
    { label: 'Holidays', value: month.totals.holiday, tone: 'brand' },
    { label: 'Week offs', value: month.totals.weekOff, tone: 'neutral' },
    { label: 'Hours worked', value: duration(month.totals.minutes) || '0m', tone: 'info' },
  ];

  return (
    <div>
      <PageHeader
        badge="AT"
        title="My attendance"
        subtitle={
          <>
            {userName}
            {storeName ? ` · ${storeName}` : ''} · {month.policy.shiftStart} to {month.policy.shiftEnd}
            {month.policy.isConfigured ? '' : ' (default hours - nobody has set a policy for this branch)'}
          </>
        }
        actions={
          <div className="flex items-center gap-1">
            <Link
              href={`/employee/attendance?y=${prev.y}&m=${prev.m}`}
              className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card transition hover:bg-muted"
              aria-label="Previous month"
            >
              <Icon name="chevron-left" className="h-4 w-4" />
            </Link>
            <span className="min-w-[8.5rem] text-center text-sm font-semibold">
              {MONTHS[month.month]} {month.year}
            </span>
            <Link
              href={`/employee/attendance?y=${next.y}&m=${next.m}`}
              className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card transition hover:bg-muted"
              aria-label="Next month"
            >
              <Icon name="chevron-right" className="h-4 w-4" />
            </Link>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {cards.map((c) => (
          <Card key={c.label} className="p-3">
            <p className="text-micro uppercase tracking-wide text-muted-foreground">{c.label}</p>
            <p className="mt-0.5 text-lg font-semibold">{c.value}</p>
          </Card>
        ))}
      </div>

      <SectionCard title="Day by day" icon="calendar" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Finished</th>
                <th className="px-4 py-2 font-medium">Worked</th>
                <th className="px-4 py-2 font-medium">Where it came from</th>
              </tr>
            </thead>
            <tbody>
              {month.days.map((d) => {
                const { day, weekday } = dayLabel(d.date);
                const meta = SOURCE[d.source];
                const blank = d.source === 'none';
                return (
                  <tr
                    key={d.date}
                    className={`border-b border-border/60 last:border-0 ${
                      d.source === 'week-off' || d.source === 'holiday' ? 'bg-muted/25' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-2">
                      <span className="font-medium">{day}</span>
                      <span className="ms-1.5 text-xs text-muted-foreground">{weekday}</span>
                    </td>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">{d.startedAt ?? '-'}</td>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">
                      {d.endedAt ?? (d.unfinished ? <span className="text-warning">still open</span> : '-')}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{duration(d.workedMinutes) || '-'}</td>
                    <td className="px-4 py-2">
                      {blank ? (
                        <span className="text-xs text-muted-foreground">{d.note ?? ''}</span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={meta.tone} icon={meta.icon}>{meta.label}</Badge>
                          {d.note && <span className="text-xs text-muted-foreground">{d.note}</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        A day marked <strong>still open</strong> was started and never finished. It is not counted
        against you, and it is not counted for you either - a manager has to set the finish time on
        the Shift Log before it reaches payroll.
      </p>
    </div>
  );
}
