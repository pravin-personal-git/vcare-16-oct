'use client';

import { useState } from 'react';
import type { PeopleData } from '@/server/dash/people';
import { DOW } from '@/lib/dash/period';
import { Badge, Card, Combo, DIcon, Donut, Empty, Kpi, Legend, ShareRows, cv, num, tone, useUI } from './kit';

export function PeopleDash({ data, rangeLabel, onDecide }: {
  data: PeopleData; rangeLabel: string;
  onDecide: (type: string, entityId: string, decision: 'approved' | 'rejected') => Promise<boolean>;
}) {
  const ui = useUI();
  const [done, setDone] = useState<Set<string>>(new Set());
  const t = data.today;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 min-[1360px]:grid-cols-6">
        {data.kpis.map((k) => <Kpi key={k.id} k={{ ...k, drill: { eyebrow: `People · ${rangeLabel}`, ...k.drill } }} />)}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card id="p-today" title="Today, right now" icon="clock" sub="Live from the attendance devices and the phone app" route="/attendance/team-today">
          <Donut size={120} thick={12} center={`${t.onTime + t.late}/${t.head}`} sub="in"
            segs={[{ label: 'On time', value: t.onTime, color: tone.success }, { label: 'Late', value: t.late, color: tone.warning }, { label: 'On leave', value: t.leave, color: cv(4) }, { label: 'Not in', value: t.notIn, color: tone.danger }]} />
          <div className="-mx-2 mt-4 divide-y divide-border">
            {data.notIn.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">Everyone is in.</p> : data.notIn.map((n) => (
              <button type="button" key={n.userId} onClick={() => ui.go(`/attendance/shifts?user=${n.userId}`)} className="flex w-full items-center justify-between px-2 py-2 text-start text-sm hover:bg-muted">
                <span className="font-medium">{n.n}</span><Badge t={n.t}>{n.s}</Badge>
              </button>
            ))}
          </div>
        </Card>
        <Card id="p-trend" className="xl:col-span-2" title="Attendance over time" icon="calendar" sub="Person-days per day · click a day to zoom in"
          right={<Legend items={[{ label: 'On time', color: tone.success }, { label: 'Late', color: tone.warning }, { label: 'Leave', color: cv(4) }, { label: 'Absent', color: tone.danger }]} />}>
          <Combo stacked labels={ui.labels} fmt={num} onPick={ui.zoom} series={[
            { key: 'p', label: 'On time', color: tone.success, type: 'bar', data: data.trend.onTime },
            { key: 'l', label: 'Late', color: tone.warning, type: 'bar', data: data.trend.late },
            { key: 'v', label: 'Leave', color: cv(4), type: 'bar', data: data.trend.leave },
            { key: 'a', label: 'Absent', color: tone.danger, type: 'bar', data: data.trend.absent },
          ]} />
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card id="p-cal" className="xl:col-span-2" title="Who is away, next 14 days" icon="calendar" sub="Approved and waiting leave · plan visits around it" route="/attendance/monthly-summary" pad={false}>
          <div className="overflow-x-auto px-5 pb-5 thin-scroll">
            {data.leaveCal.length === 0 ? <Empty text="Nobody is on leave in the next 14 days." /> : (
              <table className="w-full min-w-[620px] border-separate text-xs" style={{ borderSpacing: 2 }}>
                <thead><tr><th className="w-32" aria-label="Person" />{data.days14.map((d) => <th key={d.day} className={`font-medium ${d.dow === 0 ? 'text-danger' : 'text-muted-foreground'}`}>{DOW[d.dow][0]}<div className="font-mono">{Number(d.day.slice(8))}</div></th>)}</tr></thead>
                <tbody>{data.leaveCal.map((l, k) => (
                  <tr key={l.n + k}><td className="pe-2 text-sm font-medium">{l.n}</td>{data.days14.map((d, i) => (
                    <td key={i} className="p-0">
                      {l.days.includes(i)
                        ? <button type="button" aria-label={`${l.n} away ${d.day}`} onClick={() => (l.st === 'pending' ? ui.go('/my/reminders?tab=waiting') : ui.toast('Approved leave'))} className={`block h-7 w-full rounded-[5px] ${l.st === 'pending' ? 'border border-dashed border-warning bg-warning/15' : 'bg-[hsl(var(--c4)/.55)]'}`} />
                        : <span className={`block h-7 rounded-[5px] ${d.holiday ? 'bg-muted' : 'bg-surface'}`} />}
                    </td>
                  ))}</tr>
                ))}</tbody>
              </table>
            )}
            <div className="mt-2 flex flex-wrap gap-4 text-cap text-muted-foreground"><span className="flex items-center gap-1"><i className="inline-block h-2.5 w-3 rounded-sm bg-[hsl(var(--c4)/.55)]" />Approved</span><span className="flex items-center gap-1"><i className="inline-block h-2.5 w-3 rounded-sm border border-dashed border-warning bg-warning/15" />Waiting - click to approve</span><span className="flex items-center gap-1"><i className="inline-block h-2.5 w-3 rounded-sm bg-muted" />Sunday / holiday</span></div>
          </div>
        </Card>
        <Card id="p-payroll" title={`Payroll, last ${Math.max(1, data.payroll.labels.length)} months`} icon="rupee" sub="Net pay + PF + ESIC · click a month for its run" route="/hrm/payroll">
          {data.payroll.labels.length === 0 ? <Empty text="No payroll run yet." /> : (
            <Combo stacked height={200} labels={data.payroll.labels} onPick={(i) => ui.go(`/hrm/payroll/${data.payroll.ids[i]}`)} pickHint="Click to open that month’s run"
              series={[{ key: 'n', label: 'Net pay', color: cv(1), type: 'bar', data: data.payroll.net }, { key: 'p', label: 'PF', color: cv(2), type: 'bar', data: data.payroll.pf }, { key: 'e', label: 'ESIC', color: cv(3), type: 'bar', data: data.payroll.esic }]} />
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card id="p-approvals" title="Waiting for your OK" icon="check" sub="Approve here - each keeps its audit line" route="/my/reminders?tab=waiting">
          {data.approvals.length === 0 ? <Empty text="Nothing waiting for you." /> : (
            <div className="-mx-2 divide-y divide-border">
              {data.approvals.filter((a) => !done.has(a.entityId)).map((a) => (
                <div key={a.entityId} className="flex items-center gap-2 px-2 py-2">
                  <button type="button" onClick={() => ui.go(a.href)} className="min-w-0 flex-1 text-start"><div className="text-sm font-medium">{a.n}</div><div className="truncate text-xs text-muted-foreground">{a.s}</div></button>
                  <button type="button" onClick={async () => { if (await onDecide(a.type, a.entityId, 'approved')) setDone((s) => new Set(s).add(a.entityId)); }} className="rounded-full bg-success/10 p-1.5 text-on-tint-success hover:bg-success/20" title="Approve" aria-label={`Approve ${a.n}`}><DIcon n="check" s={14} w={2.4} /></button>
                  <button type="button" onClick={async () => { if (await onDecide(a.type, a.entityId, 'rejected')) setDone((s) => new Set(s).add(a.entityId)); }} className="rounded-full bg-danger/10 p-1.5 text-on-tint-danger hover:bg-danger/20" title="Reject" aria-label={`Reject ${a.n}`}><DIcon n="x" s={14} w={2.4} /></button>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card id="p-dept" title="People by department" icon="users" sub="Click to open the staff list">
          <ShareRows fmt={num} color={cv(4)} rows={data.depts} onPick={() => ui.go('/settings/employees')} empty="No staff yet." />
        </Card>
        <Card id="p-dates" title="Coming up" icon="cake" sub="Birthdays, work anniversaries, probation ends">
          {data.dates.length === 0 ? <Empty text="Nothing in the next three weeks." /> : (
            <div className="-mx-2 divide-y divide-border text-sm">
              {data.dates.map((d) => (
                <button type="button" key={d.n + d.s} onClick={() => ui.go(`/hrm/employees/${d.userId}`)} className="flex w-full items-center gap-3 px-2 py-2 text-start hover:bg-muted"><span className="text-lg">{d.e}</span><span><span className="block font-medium">{d.n}</span><span className="text-xs text-muted-foreground">{d.s}</span></span></button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
