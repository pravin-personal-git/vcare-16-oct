'use client';

import { useState } from 'react';
import type { MyData } from '@/server/dash/my';
import { Badge, Btn, Card, Combo, Empty, SegCtl, DIcon, cv, inrC, num, pct, tone, useUI } from './kit';

export function MyDash({ data }: { data: MyData }) {
  const ui = useUI();
  const [who, setWho] = useState(data.isTech ? 'tech' : 'sales');
  const isTech = who === 'tech';
  const initials = data.name.slice(0, 2).toUpperCase();
  const s = data.sales;
  const hour = Number(new Date().toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const tiles = isTech
    ? [
      ['Punched in', data.punch.at ?? '—', data.punch.source, data.punch.at ? 'text-success' : '', '/employee/attendance'],
      ['Jobs today', num(data.tech.jobsToday), `${data.tech.doneToday} done · ${data.tech.onsite} on site`, '', '/services/board'],
      ['This month', `${num(data.tech.monthJobs)} jobs`, data.tech.ratingCount ? `${data.tech.rating} from ${data.tech.ratingCount} ratings` : 'no ratings yet', '', '/services/complaints'],
      ['Billed this month', inrC(data.tech.billed), 'from my closed jobs', 'text-success', '/services/complaints'],
    ]
    : [
      ['Punched in', data.punch.at ?? '—', data.punch.source, data.punch.at ? 'text-success' : '', '/employee/attendance'],
      ['Target this month', s.target ? pct(s.achieved / s.target, 0) : '—', s.target ? `${inrC(s.achieved)} of ${inrC(s.target)}` : 'no target set', s.target && s.achieved / s.target < 0.7 ? 'text-warning' : '', '/my/target'],
      ['Quotes to chase', num(s.chase), s.oldest !== null ? `oldest ${s.oldest} days` : 'none older than a week', s.chase ? 'text-danger' : '', '/quotation?card=sent'],
      ['Incentive so far', inrC(s.incentive), 'this month', 'text-success', '/employee/incentive'],
    ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand/10 font-bold text-on-tint-brand">{initials}</span>
          <div><div className="text-lg font-bold">{greet}, {data.name}</div><div className="text-sm text-muted-foreground">{data.role} · your day at a glance</div></div>
        </div>
        <SegCtl value={who} onChange={setWho} options={[{ k: 'tech', l: 'Technician' }, { k: 'sales', l: 'Salesperson' }]} size="sm" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([l, v, sub, c, h]) => (
          <button type="button" key={l} onClick={() => ui.go(h)} className="dash-tile rounded border border-border bg-card p-4 text-start">
            <div className="micro-l">{l}</div><div className={`mt-1 font-mono text-2xl font-bold ${c}`}>{v}</div><div className="text-xs text-muted-foreground">{sub}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {isTech ? (
          <Card id="m-visits" className="xl:col-span-2" title="My visits today" icon="pin" sub="Tap to open the job · Navigate opens maps">
            {data.tech.visits.length === 0 ? <Empty text="No visits booked for you today." /> : (
              <div className="space-y-2">
                {data.tech.visits.map((v, i) => (
                  <div key={i} className={`flex flex-wrap items-center gap-3 rounded-sm border p-3 ${v.st === 'onsite' ? 'border-brand/50 bg-brand/5' : 'border-border'}`}>
                    <span className="w-28 font-mono text-sm font-semibold">{v.t}</span>
                    <button type="button" onClick={() => ui.go(v.href)} className="min-w-0 flex-1 text-start"><div className="font-medium hover:text-brand">{v.c}</div><div className="truncate text-xs text-muted-foreground">{v.s}</div></button>
                    {v.st === 'done' ? <Badge t="success"><DIcon n="check" s={10} w={3} />Done</Badge>
                      : v.st === 'onsite' ? <><Badge t="info">On site</Badge><Btn size="sm" kind="primary" onClick={() => ui.go(v.href)}>Close job</Btn></>
                        : <Btn size="sm" icon="pin" onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.mapQuery ?? v.c)}`, '_blank')}>Navigate</Btn>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ) : (
          <Card id="m-target" className="xl:col-span-2" title="My month" icon="target" sub="Booked so far vs my target · dashed = where I should be today">
            <Combo height={220} labels={s.labels} series={[
              { key: 'd', label: 'Booked', color: cv(2), type: 'bar', data: s.daily },
              { key: 'c', label: 'Running total', color: cv(1), type: 'area', data: s.cum },
              ...(s.target ? [{ key: 't', label: 'Target pace', color: tone.danger, type: 'dash' as const, data: s.pace }] : []),
            ]} />
          </Card>
        )}
        <Card id="m-tasks" title="My tasks" icon="check" sub="From Task Manager and My Desk" route="/tasks">
          {data.tasks.length === 0 ? <Empty text="No open tasks." /> : (
            <div className="space-y-1.5">
              {data.tasks.map((t) => (
                <button type="button" key={t.id} onClick={() => ui.go('/tasks')} className="flex w-full items-start gap-2.5 rounded-sm px-2 py-2 text-start hover:bg-muted">
                  <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border-strong" />
                  <span className="flex-1 text-sm">{t.t}</span><Badge t={t.tone}>{t.d}</Badge>
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2 text-center">
            <button type="button" onClick={() => ui.go('/my/reminders?tab=requests')} className="rounded-sm bg-surface p-2.5 hover:bg-muted"><div className="font-mono text-lg font-bold">{data.leaveLeft === null ? '—' : num(data.leaveLeft)}</div><div className="text-cap text-muted-foreground">leave days left</div></button>
            <button type="button" onClick={() => ui.go('/notices')} className="rounded-sm bg-surface p-2.5 hover:bg-muted"><div className="font-mono text-lg font-bold">{num(data.newNotices)}</div><div className="text-cap text-muted-foreground">new notices</div></button>
          </div>
        </Card>
      </div>
    </div>
  );
}
