'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, SectionCard, Field, Badge, EmptyState } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/format';
import type { TravelSettingsValue, Vehicle } from '@/lib/travel-allowance';
import type { TravelMonthRow, FuelRow } from '@/server/travel-allowance';
import { saveTravelSettingsAction, raiseTravelClaimsAction } from './actions';
import { ExportButton } from '@/components/ui/ExportButton';

const VEHICLE: Record<Vehicle, string> = { bike: 'Bike / scooter', car: 'Car' };

export function TravelClient({ month, settings, rows, fuel, staff, canManage }: {
  month: string;
  settings: TravelSettingsValue;
  rows: TravelMonthRow[];
  /** Fuel cash given vs distance ridden - works whether or not the allowance is on. */
  fuel: { rows: FuelRow[]; givenTotalPaise: number; expectedTotalPaise: number; unattributedPaise: number };
  staff: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [find, setFind] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<Set<string>>(new Set(rows.filter((r) => !r.claimStatus && r.amountPaise > 0).map((r) => r.userId)));

  const shownStaff = useMemo(() => {
    const q = find.trim().toLowerCase();
    return staff.filter((p) => !q || p.name.toLowerCase().includes(q) || s.vehicles[p.id]);
  }, [staff, find, s.vehicles]);

  // Both kinds of travel money at once - see the warning below.
  const clash = fuel.rows.filter((r) => (r.conveyancePaise ?? 0) > 0 && (r.givenPaise > 0 || settings.enabled));

  const rupees = (paise: number) => String(paise / 100);
  const total = rows.reduce((t, r) => t + (picked.has(r.userId) ? r.amountPaise : 0), 0);

  const save = () => start(async () => {
    const r = await saveTravelSettingsAction(s);
    setNote(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Saved.' });
    if (!r.error) router.refresh();
  });

  const claim = () => start(async () => {
    const r = await raiseTravelClaimsAction(month, [...picked]);
    setNote(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Done.' });
    if (!r.error) router.refresh();
  });

  return (
    <>
      <PageHeader
        badge="TA"
        title="Travel Allowance"
        subtitle="Fuel and travel money from the km people actually covered"
        actions={
          <div className="flex flex-wrap items-center gap-2">
          <ExportButton title={`Travel allowance ${month}`} rows={rows} columns={[
            { header: 'Person', value: (r) => r.name }, { header: 'Vehicle', value: (r) => r.vehicle },
            { header: 'Days', value: (r) => r.days.length }, { header: 'Km covered', value: (r) => r.rawKm },
            { header: 'Km paid', value: (r) => r.paidKm }, { header: 'Rate (Rs/km)', value: (r) => r.ratePaise / 100 },
            { header: 'Amount (Rs)', value: (r) => r.amountPaise / 100 }, { header: 'Claim', value: (r) => r.claimStatus ?? 'not claimed' },
          ]} />
          <input type="month" aria-label="Month" value={month} className="field-input h-9 w-auto py-1 text-sm"
            onChange={(e) => e.target.value && router.push(`/hrm/payroll/travel?month=${e.target.value}`)} />
          </div>
        }
      />
      <p className="-mt-3 mb-3 text-xs text-muted-foreground">
        Km × the rate for the person&apos;s vehicle, after the daily and monthly caps. Fake-GPS and too-rough location points never
        count. Claims go through the usual reimbursement approval and are paid from Payroll › Claims.
      </p>

      {note && (
        <p role="status" className={`mb-3 rounded-lg px-3 py-2 text-sm ${note.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>{note.text}</p>
      )}

      <SectionCard
        title={`${month} · ${s.enabled ? 'claims to raise' : 'switched off'}`} icon="receipt" className="mb-4"
        action={canManage && rows.length > 0 && s.enabled ? (
          <Button variant="primary" icon="send" disabled={pending || picked.size === 0} onClick={claim}>
            Raise {picked.size} claim{picked.size === 1 ? '' : 's'} · {formatCurrency(total)}
          </Button>
        ) : undefined}
        bodyClassName="p-0"
      >
        {rows.length === 0 ? (
          <EmptyState icon="map-pin" title="Nobody gets a travel allowance yet" hint="Give people a vehicle in the settings below." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2 text-start">Person</th>
                  <th className="px-3 py-2 text-end">Days</th>
                  <th className="px-3 py-2 text-end">Km covered</th>
                  <th className="px-3 py-2 text-end">Km paid</th>
                  <th className="px-3 py-2 text-end">Rate</th>
                  <th className="px-3 py-2 text-end">Amount</th>
                  <th className="px-3 py-2 text-start">Claim</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} className="border-t border-border">
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Claim for ${r.name}`} disabled={!!r.claimStatus || r.amountPaise <= 0 || !canManage}
                        checked={picked.has(r.userId)} onChange={(e) => {
                          const n = new Set(picked);
                          if (e.target.checked) n.add(r.userId); else n.delete(r.userId);
                          setPicked(n);
                        }} />
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{VEHICLE[r.vehicle]}</p>
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.days.length}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.rawKm}</td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {r.paidKm}{r.cappedDaily && <span className="ms-1 text-xs text-warning">daily cap</span>}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">₹{(r.ratePaise / 100).toFixed(2)}/km</td>
                    <td className="px-3 py-2 text-end font-semibold tabular-nums">
                      {formatCurrency(r.amountPaise)}{r.cappedMonthly && <span className="ms-1 text-xs font-normal text-warning">capped</span>}
                    </td>
                    <td className="px-3 py-2">
                      {r.claimStatus ? <Badge tone={r.claimStatus === 'paid' ? 'success' : 'info'}>{r.claimStatus}</Badge> : <span className="text-xs text-muted-foreground">not claimed</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/*
        G-18: the same petrol paid for twice. A flat Conveyance component is
        money for travel every month whatever happens; fuel cash and a km
        allowance are money for travel that did happen. Running both pays for
        the same litre twice, and nothing used to say so. Atlas names it and
        leaves the choice to whoever set the two up.
      */}
      {clash.length > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-danger/40 bg-danger/[0.06] p-3">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <div className="text-sm">
            <p className="font-medium">
              Paid for travel twice: {clash.length} {clash.length === 1 ? 'person' : 'people'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              These people draw a fixed <strong>Conveyance</strong> allowance on their salary every
              month <em>and</em> get travel money from here - fuel cash, or a km-based claim. That is
              the same petrol paid for twice. Pick one way per person: either take the Conveyance
              component off their contract (HRM &rsaquo; Contracts), or stop the travel money.
            </p>
            <ul className="mt-1.5 grid gap-0.5 text-xs">
              {clash.map((r) => (
                <li key={r.userId}>
                  <strong>{r.name}</strong> - Conveyance {formatCurrency(r.conveyancePaise ?? 0)}/month
                  {r.givenPaise > 0 ? <> · fuel cash {formatCurrency(r.givenPaise)} this month</> : null}
                  {r.givenPaise === 0 && s.enabled ? <> · also set up for the km allowance</> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/*
        The daily-cash half of the picture (8 Oct 2026). Vcare owns the bikes
        and hands out petrol money every day, so there is no claim to raise -
        the control they need is "who got how much, and does the riding
        explain it". Shown whether or not the allowance is switched on.
      */}
      <SectionCard
        title={`Fuel cash given vs distance ridden · ${month}`} icon="map-pin" className="mb-4" bodyClassName="p-0"
      >
        <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
          <strong>Given</strong> = petrol cash actually handed out this month (approved
          <em> Vehicle &amp; Fuel</em> expense vouchers with that person named on them).
          <strong> Would cost</strong> = the km they covered at the rate below - it is a yardstick, not money owed.
          A big <strong>difference</strong> with few km behind it is a bike being used for something else.
          Nothing here pays anybody or touches a payslip.
        </p>
        {fuel.rows.length === 0 ? (
          <EmptyState icon="map-pin" title="No fuel cash recorded this month"
            hint="Record it at Transactions › Add Expense → category Vehicle & Fuel, method Petty cash, and name who took it." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start">Person</th>
                  <th className="px-3 py-2 text-start">Company vehicle</th>
                  <th className="px-3 py-2 text-end">Km</th>
                  <th className="px-3 py-2 text-end">Would cost</th>
                  <th className="px-3 py-2 text-end">Given</th>
                  <th className="px-3 py-2 text-end">Difference</th>
                  <th className="px-3 py-2 text-end">Per km</th>
                </tr>
              </thead>
              <tbody>
                {fuel.rows.map((r) => (
                  <tr key={r.userId} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">
                      {r.name}
                      {(r.conveyancePaise ?? 0) > 0 && (
                        <Badge tone="danger" className="ms-1.5">
                          + Conveyance {formatCurrency(r.conveyancePaise ?? 0)}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.vehicle ?? '-'}</td>
                    <td className="px-3 py-2 text-end font-mono text-xs">{r.km}</td>
                    <td className="px-3 py-2 text-end font-mono text-xs text-muted-foreground">{formatCurrency(r.expectedPaise)}</td>
                    <td className="px-3 py-2 text-end font-mono text-xs">
                      {formatCurrency(r.givenPaise)}
                      {r.voucherCount > 0 && <span className="ms-1 text-muted-foreground">({r.voucherCount})</span>}
                    </td>
                    <td className={`px-3 py-2 text-end font-mono text-xs font-medium ${r.variancePaise > 0 ? 'text-danger' : 'text-success'}`}>
                      {r.variancePaise > 0 ? '+' : ''}{formatCurrency(r.variancePaise)}
                    </td>
                    <td className="px-3 py-2 text-end font-mono text-xs">
                      {r.perKmPaise === null
                        ? <Badge tone="warning">no km</Badge>
                        : formatCurrency(r.perKmPaise)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-muted/50 font-medium">
                  <td className="px-3 py-2" colSpan={3}>Total</td>
                  <td className="px-3 py-2 text-end font-mono text-xs">{formatCurrency(fuel.expectedTotalPaise)}</td>
                  <td className="px-3 py-2 text-end font-mono text-xs">{formatCurrency(fuel.givenTotalPaise)}</td>
                  <td className="px-3 py-2 text-end font-mono text-xs">
                    {formatCurrency(fuel.givenTotalPaise - fuel.expectedTotalPaise)}
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              </tbody>
            </table>
            {fuel.unattributedPaise > 0 && (
              <p className="border-t border-border px-4 py-3 text-xs text-warning">
                {formatCurrency(fuel.unattributedPaise)} of fuel cash this month has nobody named on it, so it
                explains nothing. Name the person on the expense voucher next time.
              </p>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Settings" icon="settings">
        <fieldset disabled={!canManage || pending} className="grid gap-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
            Pay a travel allowance from km
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Km come from" htmlFor="ta-src" hint={s.source === 'trail'
              ? 'The phone’s location trail - only people whose tracking is on.'
              : 'Straight lines between the job sites reached each day - a floor, not road distance.'}>
              <select id="ta-src" className="field-input" value={s.source}
                onChange={(e) => setS({ ...s, source: e.target.value === 'visits' ? 'visits' : 'trail' })}>
                <option value="trail">Location trail</option>
                <option value="visits">Between job sites</option>
              </select>
            </Field>
            <Field label="Bike / scooter (₹ per km)" htmlFor="ta-bike">
              <input id="ta-bike" type="number" min={0} step="0.5" className="field-input" value={rupees(s.ratePaise.bike)}
                onChange={(e) => setS({ ...s, ratePaise: { ...s.ratePaise, bike: Math.round(Number(e.target.value) * 100) } })} />
            </Field>
            <Field label="Car (₹ per km)" htmlFor="ta-car">
              <input id="ta-car" type="number" min={0} step="0.5" className="field-input" value={rupees(s.ratePaise.car)}
                onChange={(e) => setS({ ...s, ratePaise: { ...s.ratePaise, car: Math.round(Number(e.target.value) * 100) } })} />
            </Field>
            <Field label="Daily cap (km, 0 = none)" htmlFor="ta-day">
              <input id="ta-day" type="number" min={0} className="field-input" value={s.dailyCapKm}
                onChange={(e) => setS({ ...s, dailyCapKm: Math.max(0, Math.round(Number(e.target.value))) })} />
            </Field>
            <Field label="Monthly cap (₹, 0 = none)" htmlFor="ta-month">
              <input id="ta-month" type="number" min={0} className="field-input" value={rupees(s.monthlyCapPaise)}
                onChange={(e) => setS({ ...s, monthlyCapPaise: Math.max(0, Math.round(Number(e.target.value) * 100)) })} />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="me-auto text-sm font-medium">Who gets it, and on what</p>
              <input type="search" placeholder="Find a person" value={find} onChange={(e) => setFind(e.target.value)}
                className="field-input h-8 w-48 py-1 text-sm" />
            </div>
            <div className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">
              {shownStaff.map((p) => (
                <label key={p.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-sm">
                  <span className="truncate">{p.name}</span>
                  <select aria-label={`Vehicle for ${p.name}`} className="field-input h-8 w-36 py-0 text-xs" value={s.vehicles[p.id] ?? ''}
                    onChange={(e) => {
                      const vehicles = { ...s.vehicles };
                      if (e.target.value === 'bike' || e.target.value === 'car') vehicles[p.id] = e.target.value; else delete vehicles[p.id];
                      setS({ ...s, vehicles });
                    }}>
                    <option value="">No allowance</option>
                    <option value="bike">{VEHICLE.bike}</option>
                    <option value="car">{VEHICLE.car}</option>
                  </select>
                </label>
              ))}
            </div>
          </div>

          {canManage && (
            <div><Button variant="primary" icon="check" disabled={pending} onClick={save}>Save settings</Button></div>
          )}
        </fieldset>
      </SectionCard>
    </>
  );
}
