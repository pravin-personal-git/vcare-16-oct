'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { JOB_STATUSES, OFFICE_LABEL, CUSTOMER_LABEL, type JobStatus } from '@/lib/job-flow';
import type { JobSettingsValue } from '@/lib/job-settings';
import { saveFieldJobsAction } from './actions';

/**
 * Settings > Field jobs (workflow spec §5). Everything a business can switch
 * for the job lifecycle: the on-site location check, accepting, customer
 * sign-off, closing, reopening, the visit charge, deadlines and the words.
 */
const PRIORITIES = [['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal'], ['low', 'Low']] as const;

export function FieldJobsClient({ initial, storeName, canEdit }: { initial: JobSettingsValue | null; storeName: string; canEdit: boolean }) {
  const [v, setV] = useState<JobSettingsValue | null>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (!v) {
    return (
      <div>
        <PageHeader badge="FJ" title="Field jobs" subtitle="How jobs move from accept to close" />
        <Card className="p-4 text-sm">Pick a branch in the top bar - these settings belong to one branch.</Card>
      </div>
    );
  }
  const set = (patch: Partial<JobSettingsValue>) => { setV({ ...v, ...patch }); setMsg(null); };
  const num = (s: string) => (s.trim() === '' ? 0 : Number(s));
  const label = (s: JobStatus, side: 'office' | 'customer', text: string) =>
    set({ labels: { ...v.labels, [s]: { ...v.labels[s], [side]: text } } });
  const save = () => start(async () => {
    const r = await saveFieldJobsAction(v);
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' });
  });
  const off = !canEdit;

  return (
    <div className="grid gap-4">
      <PageHeader badge="FJ" title="Field jobs" subtitle={`How jobs move from accept to close - ${storeName}`}
        actions={canEdit ? <Button variant="primary" icon="check" loading={pending} onClick={save}>Save</Button> : undefined} />
      {msg && <Card className={`p-3 text-sm ${msg.ok ? 'border-success/40 text-success' : 'border-danger/40 text-danger'}`}><span role="status">{msg.text}</span></Card>}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="On site" icon="map-pin">
          <div className="grid gap-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" disabled={off} checked={v.locationGate} onChange={(e) => set({ locationGate: e.target.checked })} className="mt-0.5" />
              <span><strong>Location check</strong> - &ldquo;Working on site&rdquo; unlocks only near the job&apos;s site. A technician whose GPS fails indoors can ask for a manager&apos;s override.</span>
            </label>
            <Field label="Allowed distance (metres)" htmlFor="fj-radius">
              <input id="fj-radius" type="number" min={10} max={1000} disabled={off || !v.locationGate} value={v.radiusMeters} onChange={(e) => set({ radiusMeters: num(e.target.value) })} className="field-input" />
            </Field>
            <Field label="Photos at site" htmlFor="fj-photos">
              <select id="fj-photos" disabled={off} value={v.photos} onChange={(e) => set({ photos: e.target.value === 'required' ? 'required' : 'optional' })} className="field-input">
                <option value="optional">Optional</option>
                <option value="required">Required before &ldquo;Work done&rdquo;</option>
              </select>
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Accepting and closing" icon="check-circle">
          <div className="grid gap-3">
            <p className="text-xs text-muted-foreground">A job not accepted in time alerts the office - the time is the Accept deadline for its priority, below.</p>
            <Field label="Customer confirms with a code (OTP)" htmlFor="fj-otp">
              <select id="fj-otp" disabled={off} value={v.customerOtp} onChange={(e) => set({ customerOtp: e.target.value as JobSettingsValue['customerOtp'] })} className="field-input">
                <option value="required">Required</option>
                <option value="optional">Optional</option>
                <option value="off">Off - technician marks it done</option>
              </select>
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" disabled={off} checked={v.approvalToClose} onChange={(e) => set({ approvalToClose: e.target.checked })} className="mt-0.5" />
              <span><strong>Closing needs approval</strong> - &ldquo;Waiting to close&rdquo; goes to whoever your Approval Rules name.</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" disabled={off} checked={v.autoCloseOnOtp} onChange={(e) => set({ autoCloseOnOtp: e.target.checked })} className="mt-0.5" />
              <span><strong>Close automatically</strong> when the customer confirms - with the code, or by tapping <em>Yes, it is resolved</em> in their app, portal or link.</span>
            </label>
            <Field label="Customer can reopen within (days, 0 = never)" htmlFor="fj-reopen">
              <input id="fj-reopen" type="number" min={0} max={90} disabled={off} value={v.reopenDays} onChange={(e) => set({ reopenDays: num(e.target.value) })} className="field-input" />
            </Field>
            <Field label="Visit charge for chargeable jobs (₹, 0 = none)" htmlFor="fj-charge">
              <input id="fj-charge" type="number" min={0} disabled={off} value={Math.round(v.visitChargePaise / 100)} onChange={(e) => set({ visitChargePaise: Math.round(num(e.target.value) * 100) })} className="field-input" />
            </Field>
            <Field label="Markup on a supplier's repair charge (%) - added when the customer pays for the repair" htmlFor="fj-markup">
              <input id="fj-markup" type="number" min={0} max={500} disabled={off} value={v.repairMarkupPct} onChange={(e) => set({ repairMarkupPct: num(e.target.value) })} className="field-input" />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" disabled={off} checked={v.courierToCustomer} onChange={(e) => set({ courierToCustomer: e.target.checked })} className="mt-0.5" />
              <span><strong>Charge courier to the customer</strong> - each chargeable item&apos;s share of the courier to and from the supplier goes on the job bill. Off: the business bears it.</span>
            </label>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Parts from the store" icon="truck">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" disabled={off} checked={v.autoIssueGdn} onChange={(e) => set({ autoIssueGdn: e.target.checked })} className="mt-0.5" />
          <span><strong>Create the GDN automatically</strong> when a job challan is approved - stock goes out at once and the store hands the parts over. If stock is short it waits in <em>Parts counter</em>. The store can correct or cancel a GDN if something was wrong.</span>
        </label>
      </SectionCard>

      <SectionCard title="Deadlines by priority (hours)" icon="clock" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-micro uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 text-start font-semibold">Priority</th>
                <th className="px-3 py-2 text-start font-semibold">Accept within</th>
                <th className="px-3 py-2 text-start font-semibold">Visit within</th>
                <th className="px-3 py-2 text-start font-semibold">Close within</th>
              </tr>
            </thead>
            <tbody>
              {PRIORITIES.map(([p, name]) => (
                <tr key={p} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-medium">{name}</td>
                  {(['accept', 'visit', 'close'] as const).map((k) => (
                    <td key={k} className="px-3 py-1.5">
                      <input aria-label={`${name} ${k} hours`} type="number" min={1} disabled={off} value={v.sla[p][k]}
                        onChange={(e) => set({ sla: { ...v.sla, [p]: { ...v.sla[p], [k]: num(e.target.value) } } })}
                        className="h-8 w-24 rounded-lg border border-border bg-card px-2 tabular-nums" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">The clock pauses while the job waits on the customer (estimate or confirmation).</p>
      </SectionCard>

      <SectionCard title="Your words for each step" icon="pencil" bodyClassName="p-0">
        <p className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">Leave blank to use the standard words. Renaming never changes how a job moves.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-micro uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 text-start font-semibold">Step</th>
                <th className="px-3 py-2 text-start font-semibold">Office sees</th>
                <th className="px-3 py-2 text-start font-semibold">Customer sees</th>
              </tr>
            </thead>
            <tbody>
              {JOB_STATUSES.map((s) => (
                <tr key={s} className="border-b border-border last:border-0">
                  <td className="px-4 py-1.5 text-muted-foreground">{OFFICE_LABEL[s]}</td>
                  <td className="px-3 py-1.5">
                    <input aria-label={`${OFFICE_LABEL[s]} office label`} disabled={off} placeholder={OFFICE_LABEL[s]} value={v.labels[s]?.office ?? ''}
                      onChange={(e) => label(s, 'office', e.target.value)} className="h-8 w-full min-w-40 rounded-lg border border-border bg-card px-2" />
                  </td>
                  <td className="px-3 py-1.5">
                    <input aria-label={`${OFFICE_LABEL[s]} customer label`} disabled={off} placeholder={CUSTOMER_LABEL[s]} value={v.labels[s]?.customer ?? ''}
                      onChange={(e) => label(s, 'customer', e.target.value)} className="h-8 w-full min-w-40 rounded-lg border border-border bg-card px-2" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
