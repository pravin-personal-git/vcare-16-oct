'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useState, useTransition } from 'react';
import { minuteToClock } from '@/lib/attendance';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import type { AttendancePolicyView, ZoneRow } from '@/server/attendance-policy';
import {
  MIN_CYCLE_START_DAY, MAX_CYCLE_START_DAY, isValidCycleStartDay, describeCycle, cycleIndexForDate,
} from '@/lib/payroll-cycle';
import {
  addHolidayAction, removeHolidayAction, savePolicyAction, saveZoneAction, removeZoneAction,
  savePayrollCycleAction, toggleGovernmentHolidayAction,
} from './actions';

/**
 * The rules, and the calendar, on one screen.
 *
 * They belong together because they answer the same question from two
 * directions: "was this person supposed to be at work today". Splitting them
 * across two menu entries would mean setting up attendance in two places and
 * discovering the second one a month later.
 */

interface HolidayRow { id: string; date: string; name: string; kind: string }

/**
 * Spelled out here rather than imported from the server module.
 *
 * `@/server/attendance-policy` is marked `server-only`, so importing a VALUE
 * from it into a client component would fail the build. The type import above
 * is erased at compile time and is safe; this list is not.
 */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const KINDS = [
  { value: 'public', label: 'Public holiday', hint: 'Everybody is off. Nobody is marked absent.' },
  { value: 'optional', label: 'Optional holiday', hint: 'Staff may take it or not. It does not excuse an absence by itself.' },
  { value: 'closure', label: 'Branch closure', hint: 'This branch is shut - a stocktake, a repair, a local strike.' },
];

function prettyDate(iso: string): string {
  return new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata',
    weekday: 'short', day: '2-digit', month: 'short',
  });
}

/**
 * Leaflet touches `window` at import time, so it cannot survive the server
 * render pass every client component still gets in the App Router. Loaded
 * only in the browser, after the rest of this screen is already up.
 */
const AttendanceZoneMap = dynamic(
  () => import('@/components/ui/AttendanceZoneMap').then((m) => m.AttendanceZoneMap),
  { ssr: false, loading: () => <div className="grid h-[320px] place-items-center rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground">Loading map…</div> },
);

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Rows of a calendar month, Sunday-first, padded with `null` outside the month. */
function monthMatrix(year: number, month: number): (number | null)[][] {
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** One month of the pay-period calendar, cycle bands alternating by colour, the start day ringed. */
function PayPeriodMonth({ year, month, startDay }: { year: number; month: number; startDay: number }) {
  const rows = monthMatrix(year, month);
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="mb-1.5 text-center text-xs font-semibold">{MONTH_NAMES[month]}</p>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs text-muted-foreground">
        {WEEKDAY_INITIALS.map((w, i) => <span key={i}>{w}</span>)}
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className="grid grid-cols-7 gap-0.5">
          {row.map((d, ci) => {
            if (d === null) return <span key={ci} className="h-5" />;
            const cycle = cycleIndexForDate(new Date(year, month, d), startDay);
            const isStart = d === startDay;
            return (
              <span
                key={ci}
                title={isStart ? 'Cycle start' : undefined}
                className={`grid h-5 place-items-center rounded text-xs tabular-nums ${
                  cycle % 2 === 0 ? 'bg-brand/10 text-on-tint-brand' : 'bg-accent/15 text-accent'
                } ${isStart ? 'ring-1 ring-inset ring-foreground/60 font-semibold' : ''}`}
              >
                {d}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const KIND_DOT: Record<string, string> = {
  public: 'bg-brand text-brand-fg',
  optional: 'bg-accent text-accent-fg',
  closure: 'bg-warning text-white',
};

/** One month of the holiday year-grid - every day off coloured by kind, everything else plain. */
function HolidayYearMonth({
  year, month, byDay,
}: {
  year: number;
  month: number;
  byDay: Map<string, HolidayRow>;
}) {
  const rows = monthMatrix(year, month);
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="mb-1.5 text-center text-xs font-semibold">{MONTH_NAMES[month]}</p>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs text-muted-foreground">
        {WEEKDAY_INITIALS.map((w, i) => <span key={i}>{w}</span>)}
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className="grid grid-cols-7 gap-0.5">
          {row.map((d, ci) => {
            if (d === null) return <span key={ci} className="h-5" />;
            const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const h = byDay.get(key);
            const isWeekend = new Date(year, month, d).getDay() === 0;
            return (
              <span
                key={ci}
                title={h ? `${h.name} (${KINDS.find((k) => k.value === h.kind)?.label ?? h.kind})` : undefined}
                className={`grid h-5 place-items-center rounded text-xs tabular-nums ${
                  h ? KIND_DOT[h.kind] ?? 'bg-brand text-brand-fg' : isWeekend ? 'bg-muted text-muted-foreground' : ''
                }`}
              >
                {d}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function SettingsClient({
  policy, holidays, zones: initialZones, governmentHolidays, year, storeName, scopeIsAll, canEdit,
}: {
  policy: AttendancePolicyView;
  holidays: HolidayRow[];
  zones: ZoneRow[];
  governmentHolidays: { id: string; date: string; name: string; state: string | null; appliedHolidayId: string | null }[];
  year: number;
  storeName: string;
  scopeIsAll: boolean;
  canEdit: boolean;
}) {
  const [form, setForm] = useState({
    weekOffDays: policy.weekOffDays,
    graceMinutes: String(policy.graceMinutes),
    fullDayMinutes: String(policy.fullDayMinutes),
    halfDayMinutes: String(policy.halfDayMinutes),
    shiftStart: policy.shiftStart,
    shiftEnd: policy.shiftEnd,
    geofencingEnabled: policy.geofencingEnabled,
    ipRestrictionEnabled: policy.ipRestrictionEnabled,
    allowedIpRanges: policy.allowedIpRanges,
    defaultRadiusMeters: String(policy.defaultRadiusMeters),
    autoAbsentEnabled: policy.autoAbsentAfterMinute !== null,
    autoAbsentAfterTime: policy.autoAbsentAfterMinute !== null ? minuteToClock(policy.autoAbsentAfterMinute) : '11:00',
    overtimeEnabled: policy.overtimeMinMinutes !== null,
    overtimeMinMinutes: String(policy.overtimeMinMinutes ?? 60),
  });
  const [cycleStartDay, setCycleStartDay] = useState(policy.payrollCycleStartDay);
  const [zones, setZones] = useState(initialZones);
  const [newZone, setNewZone] = useState({ label: '', lat: '', lng: '', radiusMeters: '150' });
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState('public');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const report = (res: { error?: string; message?: string }) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : res.message ?? null);
  };

  if (scopeIsAll) {
    return (
      <div>
        <PageHeader badge="HC" title="Attendance settings" subtitle="Working hours, week-offs and the holiday calendar" />
        <Card>
          <EmptyState
            icon="building"
            title="Choose a branch first"
            hint="A showroom closes on Sunday and a workshop on Tuesday. A company-wide calendar would mark half the staff absent on the wrong day, so these settings are kept per branch."
          />
        </Card>
      </div>
    );
  }

  const toggleDay = (d: number) => {
    setForm((f) => ({
      ...f,
      weekOffDays: f.weekOffDays.includes(d)
        ? f.weekOffDays.filter((x) => x !== d)
        : [...f.weekOffDays, d].sort(),
    }));
  };

  const save = () => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      report(await savePolicyAction({
        weekOffDays: form.weekOffDays,
        graceMinutes: Number(form.graceMinutes),
        fullDayMinutes: Number(form.fullDayMinutes),
        halfDayMinutes: Number(form.halfDayMinutes),
        shiftStart: form.shiftStart,
        shiftEnd: form.shiftEnd,
        geofencingEnabled: form.geofencingEnabled,
        ipRestrictionEnabled: form.ipRestrictionEnabled,
        allowedIpRanges: form.allowedIpRanges,
        defaultRadiusMeters: Number(form.defaultRadiusMeters),
        autoAbsentAfterTime: form.autoAbsentEnabled ? form.autoAbsentAfterTime : null,
        overtimeMinMinutes: form.overtimeEnabled ? Number(form.overtimeMinMinutes) : null,
      }));
    });
  };

  const addZone = () => {
    if (!newZone.label.trim() || !newZone.lat || !newZone.lng) {
      setError('A location needs a name and coordinates.');
      return;
    }
    startTransition(async () => {
      const input = {
        label: newZone.label, lat: Number(newZone.lat), lng: Number(newZone.lng),
        radiusMeters: Number(newZone.radiusMeters) || 150,
      };
      const res = await saveZoneAction(null, input);
      report(res);
      if (!res.error) {
        setZones((z) => [...z, { id: Math.random().toString(), isActive: true, ...input }]);
        setNewZone({ label: '', lat: '', lng: '', radiusMeters: '150' });
      }
    });
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError('This browser cannot share its location.'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setNewZone((z) => ({ ...z, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) })),
      () => setError('Could not read this browser’s location.'),
    );
  };

  const deleteZone = (id: string) => {
    setZones((z) => z.filter((zn) => zn.id !== id));
    startTransition(async () => report(await removeZoneAction(id)));
  };

  const saveCycle = () => {
    if (!isValidCycleStartDay(cycleStartDay)) {
      setError('The cycle must start on a day between 1 and 28.');
      return;
    }
    startTransition(async () => report(await savePayrollCycleAction(cycleStartDay)));
  };

  const add = () => {
    if (!newDate || !newName.trim()) {
      setError('A holiday needs a date and a name.');
      return;
    }
    startTransition(async () => {
      const res = await addHolidayAction(newDate, newName, newKind);
      report(res);
      if (!res.error) { setNewDate(''); setNewName(''); }
    });
  };

  const toggleGovHoliday = (govId: string, on: boolean) => {
    startTransition(async () => report(await toggleGovernmentHolidayAction(govId, on)));
  };

  const byDay = new Map(holidays.map((h) => [h.date, h]));

  const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

  return (
    <div>
      <PageHeader
        badge="HC"
        title="Attendance settings"
        subtitle={`${storeName} · working hours, week-offs and the holiday calendar`}
        actions={
          !policy.isConfigured && <Badge tone="warning" icon="alert-triangle">Using defaults</Badge>
        }
      />

      {error && (
        <div className="mb-3 flex gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className="mb-3 flex gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-on-tint-success">
          <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Working hours" icon="clock">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Day starts" htmlFor="ss" hint="Used to decide who is late.">
              <input id="ss" type="time" disabled={!canEdit} value={form.shiftStart}
                onChange={(e) => setForm((f) => ({ ...f, shiftStart: e.target.value }))} className={input} />
            </Field>
            <Field label="Day ends" htmlFor="se" hint="Also sent to the HR system for overtime.">
              <input id="se" type="time" disabled={!canEdit} value={form.shiftEnd}
                onChange={(e) => setForm((f) => ({ ...f, shiftEnd: e.target.value }))} className={input} />
            </Field>
            <Field label="Grace (minutes)" htmlFor="gr" hint="Arriving within this is still on time.">
              <input id="gr" type="number" min={0} max={240} disabled={!canEdit} value={form.graceMinutes}
                onChange={(e) => setForm((f) => ({ ...f, graceMinutes: e.target.value }))} className={input} />
            </Field>
            <div />
            <Field label="Full day (minutes)" htmlFor="fd" hint="480 is eight hours.">
              <input id="fd" type="number" min={60} max={1440} disabled={!canEdit} value={form.fullDayMinutes}
                onChange={(e) => setForm((f) => ({ ...f, fullDayMinutes: e.target.value }))} className={input} />
            </Field>
            <Field label="Half day (minutes)" htmlFor="hd" hint="Below this counts as an absence.">
              <input id="hd" type="number" min={15} max={1440} disabled={!canEdit} value={form.halfDayMinutes}
                onChange={(e) => setForm((f) => ({ ...f, halfDayMinutes: e.target.value }))} className={input} />
            </Field>
          </div>

          <div className="mt-4">
            <p className="field-label">Weekly offs</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {DAY_NAMES.map((name, d) => {
                const on = form.weekOffDays.includes(d);
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => toggleDay(d)}
                    className={`h-8 rounded-lg border px-3 text-sm font-medium transition disabled:opacity-60 ${
                      on ? 'border-brand bg-brand/10 text-on-tint-brand' : 'border-border bg-card text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {name.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Nobody is marked absent on a week-off. At least one day must remain a working day.
            </p>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <p className="field-label">Location and network</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Off by default. Turning these on does not change how the clock-in button works -
              it only records whether each punch matched, so you can see it later.
            </p>

            <label className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium">Geofencing</span>
                <span className="block text-xs text-muted-foreground">Check punches against the locations below</span>
              </span>
              <input type="checkbox" disabled={!canEdit} checked={form.geofencingEnabled}
                onChange={(e) => setForm((f) => ({ ...f, geofencingEnabled: e.target.checked }))}
                className="h-4 w-4 accent-brand" />
            </label>

            {form.geofencingEnabled && (
              <Field label="Match radius (metres)" htmlFor="rad" hint="How close counts as “there”. Kept approximate on purpose." className="mt-3">
                <input id="rad" type="number" min={10} max={5000} disabled={!canEdit} value={form.defaultRadiusMeters}
                  onChange={(e) => setForm((f) => ({ ...f, defaultRadiusMeters: e.target.value }))} className={input} />
              </Field>
            )}

            <label className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium">IP restriction</span>
                <span className="block text-xs text-muted-foreground">Only allow attendance from these networks</span>
              </span>
              <input type="checkbox" disabled={!canEdit} checked={form.ipRestrictionEnabled}
                onChange={(e) => setForm((f) => ({ ...f, ipRestrictionEnabled: e.target.checked }))}
                className="h-4 w-4 accent-brand" />
            </label>

            {form.ipRestrictionEnabled && (
              <Field label="Allowed IPs / ranges" htmlFor="ips" hint="Comma separated - exact IPs or a CIDR range like 203.0.113.0/24." className="mt-3">
                <input id="ips" disabled={!canEdit} value={form.allowedIpRanges}
                  onChange={(e) => setForm((f) => ({ ...f, allowedIpRanges: e.target.value }))} className={input} placeholder="203.0.113.10, 198.51.100.0/24" />
              </Field>
            )}
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <p className="field-label">Auto-absent and overtime</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Both off by default. Neither changes what a half day or late arrival means above.
            </p>

            <label className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium">Auto-absent</span>
                <span className="block text-xs text-muted-foreground">
                  Mark today absent if nobody has punched in by a set time
                </span>
              </span>
              <input type="checkbox" disabled={!canEdit} checked={form.autoAbsentEnabled}
                onChange={(e) => setForm((f) => ({ ...f, autoAbsentEnabled: e.target.checked }))}
                className="h-4 w-4 accent-brand" />
            </label>

            {form.autoAbsentEnabled && (
              <Field label="Mark absent after" htmlFor="autoabsent" hint="No punch by this time today = absent. Never applies to a past day - those are already absent without a punch." className="mt-3">
                <input id="autoabsent" type="time" disabled={!canEdit} value={form.autoAbsentAfterTime}
                  onChange={(e) => setForm((f) => ({ ...f, autoAbsentAfterTime: e.target.value }))} className={input} />
              </Field>
            )}

            <label className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium">Overtime</span>
                <span className="block text-xs text-muted-foreground">
                  Track minutes worked beyond a full day, shown on the Shift Log
                </span>
              </span>
              <input type="checkbox" disabled={!canEdit} checked={form.overtimeEnabled}
                onChange={(e) => setForm((f) => ({ ...f, overtimeEnabled: e.target.checked }))}
                className="h-4 w-4 accent-brand" />
            </label>

            {form.overtimeEnabled && (
              <Field label="Minimum extra minutes to qualify" htmlFor="ot" hint="Beyond a full day. Below this, staying a little late is not counted as overtime." className="mt-3">
                <input id="ot" type="number" min={0} max={720} disabled={!canEdit} value={form.overtimeMinMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, overtimeMinMinutes: e.target.value }))} className={input} />
              </Field>
            )}
          </div>

          {canEdit && (
            <button
              type="button"
              disabled={pending}
              onClick={save}
              className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              <Icon name={pending ? 'clock' : 'check'} className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
              Save rules
            </button>
          )}

          {policy.updatedAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              Last changed {new Date(policy.updatedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}.
            </p>
          )}
        </SectionCard>

        <SectionCard
          title={`Holidays in ${year}`}
          icon="calendar"
          bodyClassName="p-0"
          action={
            <span className="flex items-center gap-1">
              <Link href={`/settings/attendance?y=${year - 1}`} className="grid h-7 w-7 place-items-center rounded border border-border bg-card transition hover:bg-muted" aria-label="Previous year">
                <Icon name="chevron-left" className="h-3.5 w-3.5" />
              </Link>
              <Link href={`/settings/attendance?y=${year + 1}`} className="grid h-7 w-7 place-items-center rounded border border-border bg-card transition hover:bg-muted" aria-label="Next year">
                <Icon name="chevron-right" className="h-3.5 w-3.5" />
              </Link>
            </span>
          }
        >
          <div className="border-b border-border p-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 12 }, (_, m) => (
                <HolidayYearMonth key={m} year={year} month={m} byDay={byDay} />
              ))}
            </div>
          </div>

          {canEdit && (
            <div className="grid gap-2 border-b border-border p-4 sm:grid-cols-[auto_1fr_auto_auto]">
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className={input} aria-label="Holiday date" />
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Diwali" className={input} aria-label="Holiday name" />
              <select value={newKind} onChange={(e) => setNewKind(e.target.value)} className={input} aria-label="Holiday kind">
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <button
                type="button"
                disabled={pending}
                onClick={add}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
              >
                <Icon name="plus" className="h-4 w-4" />
                Add
              </button>
              <p className="text-xs text-muted-foreground sm:col-span-4">
                {KINDS.find((k) => k.value === newKind)?.hint}
              </p>
            </div>
          )}

          {governmentHolidays.length > 0 && (
            <div className="border-b border-border p-4">
              <p className="field-label">From the government master list</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {governmentHolidays.length} pre-loaded for {year}. Toggle one on to add it to this branch&rsquo;s calendar.
              </p>
              <div className="mt-2 grid gap-1.5">
                {governmentHolidays.map((g) => (
                  <label key={g.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">{prettyDate(g.date)}</span>
                      <span className="min-w-0 truncate text-sm font-medium">{g.name}</span>
                      {g.state && <Badge tone="neutral">{g.state}</Badge>}
                    </span>
                    <input
                      type="checkbox"
                      disabled={!canEdit || pending}
                      checked={g.appliedHolidayId !== null}
                      onChange={(e) => toggleGovHoliday(g.id, e.target.checked)}
                      className="h-4 w-4 shrink-0 accent-brand"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {holidays.length === 0 ? (
            <EmptyState
              icon="calendar"
              title={`No holidays set for ${year}`}
              hint="Until one is added, every working day counts as a day somebody was expected in."
            />
          ) : (
            <ul className="divide-y divide-border">
              {holidays.map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-24 shrink-0 text-sm tabular-nums text-muted-foreground">{prettyDate(h.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{h.name}</span>
                  <Badge tone={h.kind === 'public' ? 'brand' : h.kind === 'closure' ? 'warning' : 'neutral'}>
                    {KINDS.find((k) => k.value === h.kind)?.label ?? h.kind}
                  </Badge>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => startTransition(async () => report(await removeHolidayAction(h.id)))}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-danger/10 hover:text-danger disabled:opacity-60"
                      aria-label={`Remove ${h.name}`}
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard title="Payroll cycle" icon="refresh">
          <p className="text-xs leading-relaxed text-muted-foreground">
            The day of the month a pay period starts on. Used by payroll to group attendance
            into periods - it does not change what counts as late or absent.
          </p>

          <div className="mt-3 grid grid-cols-7 gap-1.5 sm:max-w-md">
            {Array.from({ length: MAX_CYCLE_START_DAY }, (_, i) => i + MIN_CYCLE_START_DAY).map((d) => (
              <button
                key={d}
                type="button"
                disabled={!canEdit}
                onClick={() => setCycleStartDay(d)}
                className={`h-8 rounded-lg border text-sm font-medium tabular-nums transition disabled:opacity-60 ${
                  cycleStartDay === d
                    ? 'border-brand bg-brand/10 text-on-tint-brand'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2.5">
            <p className="text-sm font-medium">{describeCycle(cycleStartDay).title}</p>
            <p className="text-xs text-muted-foreground">{describeCycle(cycleStartDay).detail}</p>
          </div>

          {canEdit && (
            <button
              type="button"
              disabled={pending || cycleStartDay === policy.payrollCycleStartDay}
              onClick={saveCycle}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              <Icon name={pending ? 'clock' : 'check'} className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
              Save cycle
            </button>
          )}

          <div className="mt-5 border-t border-border pt-4">
            <p className="field-label">{year} pay period calendar</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Alternating colour marks each cycle; the ringed date is where a new one starts.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 12 }, (_, m) => (
                <PayPeriodMonth key={m} year={year} month={m} startDay={cycleStartDay} />
              ))}
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Attendance locations"
          icon="map-pin"
          bodyClassName="p-0"
        >
          <p className="border-b border-border px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
            Where employees are allowed to clock in from, when geofencing is on above. Add as
            many as this branch needs - a warehouse, a site office, several client locations -
            unlike a single fixed circle that only fits one address.
          </p>

          {canEdit && (
            <div className="border-b border-border p-4">
              <AttendanceZoneMap
                zones={zones}
                draftLat={newZone.lat ? Number(newZone.lat) : null}
                draftLng={newZone.lng ? Number(newZone.lng) : null}
                draftRadiusMeters={Number(newZone.radiusMeters) || 150}
                onDraftChange={(lat, lng) => setNewZone((z) => ({ ...z, lat: lat.toFixed(6), lng: lng.toFixed(6) }))}
              />

              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
                <input value={newZone.label} onChange={(e) => setNewZone((z) => ({ ...z, label: e.target.value }))}
                  placeholder="Warehouse 2" className={input} aria-label="Location name" />
                <input value={newZone.lat} onChange={(e) => setNewZone((z) => ({ ...z, lat: e.target.value }))}
                  placeholder="Latitude" className={`${input} w-28`} aria-label="Latitude" />
                <input value={newZone.lng} onChange={(e) => setNewZone((z) => ({ ...z, lng: e.target.value }))}
                  placeholder="Longitude" className={`${input} w-28`} aria-label="Longitude" />
                <input type="number" min={10} max={5000} value={newZone.radiusMeters}
                  onChange={(e) => setNewZone((z) => ({ ...z, radiusMeters: e.target.value }))}
                  className={`${input} w-20`} aria-label="Radius metres" title="Radius, metres" />
                <div className="flex gap-2">
                  <button type="button" onClick={useMyLocation}
                    title="Use this browser's current location"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card transition hover:bg-muted">
                    <Icon name="map-pin" className="h-4 w-4" />
                  </button>
                  <button type="button" disabled={pending} onClick={addZone}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60">
                    <Icon name="plus" className="h-4 w-4" />
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {zones.length === 0 ? (
            <EmptyState
              icon="map-pin"
              title="No locations set"
              hint="With geofencing on and no locations added, every check-in is recorded as unmatched rather than refused."
            />
          ) : (
            <ul className="divide-y divide-border">
              {zones.map((z) => (
                <li key={z.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{z.label}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{z.lat.toFixed(5)}, {z.lng.toFixed(5)}</span>
                  <Badge tone="brand">{z.radiusMeters} m</Badge>
                  {canEdit && (
                    <button type="button" disabled={pending} onClick={() => deleteZone(z.id)}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-danger/10 hover:text-danger disabled:opacity-60"
                      aria-label={`Remove ${z.label}`}>
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
