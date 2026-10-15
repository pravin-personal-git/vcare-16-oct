'use client';

import { useState } from 'react';
import type { SalesData } from '@/server/dash/sales';
import { whatsappLink } from '@/lib/revenue';
import { docMessage } from '@/lib/wa-message';
import { Badge, Card, Combo, DIcon, Donut, Empty, Funnel, Heat, Kpi, Legend, clickable, cv, inrC, num, pct, tone, useUI } from './kit';

const SRC_COL = [cv(1), cv(2), cv(3), cv(4), cv(5), cv(6)];
const HOURS = ['10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p'];

export function SalesDash({ data, rangeLabel, onLost }: { data: SalesData; rangeLabel: string; onLost: (id: string, no: string) => Promise<boolean> }) {
  const ui = useUI();
  const [lost, setLost] = useState<Set<string>>(new Set());
  const p = data.pace;
  const ahead = p.targetTotal !== null && p.total >= p.targetTotal;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 min-[1360px]:grid-cols-6">
        {data.kpis.map((k) => <Kpi key={k.id} k={{ ...k, drill: { eyebrow: `Sales · ${rangeLabel}`, ...k.drill } }} />)}
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card id="s-funnel" className="xl:col-span-2" title="From lead to cash" icon="sliders" sub="Where deals stop - click a step for its list" route="/crm/leads">
          <Funnel steps={data.funnel} onPick={(s) => {
            const st = data.funnel.find((x) => x.label === s.label)!;
            ui.drill({ eyebrow: 'Funnel step', title: st.label, value: num(st.count), sub: `${inrC(st.value)} in value`, route: st.href, cols: [{ k: 'doc', l: 'Record' }, { k: 'who', l: 'Customer' }, { k: 'st', l: 'Stuck for' }], rows: st.rows });
          }} />
        </Card>
        <Card id="s-pace" className="xl:col-span-3" title="Running total vs target" icon="target" sub="Bars = each day’s orders · line = running total · dashed = where the target says you should be"
          right={<Legend items={[{ label: 'Daily orders', color: cv(2) }, { label: 'Running total', color: cv(1) }, ...(p.target ? [{ label: 'Target pace', color: tone.danger, dash: true }] : [])]} />}>
          <Combo labels={ui.labels} onPick={ui.zoom} series={[
            { key: 'd', label: 'Daily orders', color: cv(2), type: 'bar', data: p.daily },
            { key: 'c', label: 'Running total', color: cv(1), type: 'area', data: p.cum },
            ...(p.target ? [{ key: 't', label: 'Target pace', color: tone.danger, type: 'dash' as const, data: p.target }] : []),
          ]} />
          {p.targetTotal !== null ? (
            <div className={`mt-2 rounded-sm px-3 py-2 text-sm ${ahead ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
              {ahead ? 'Ahead of target by ' : 'Behind target by '}<b className="font-mono">{inrC(Math.abs(p.total - p.targetTotal))}</b> for {rangeLabel}.
            </div>
          ) : (
            <button type="button" onClick={() => ui.go('/settings/user-target')} className="mt-2 w-full rounded-sm bg-surface px-3 py-2 text-start text-sm text-muted-foreground hover:bg-muted">No target covers this period - <span className="text-brand">set targets</span> to see the pace line.</button>
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card id="s-people" className="xl:col-span-2" title="Salespeople" icon="users" sub="Target from Settings › Targets · incentive from Settings › Incentive · click a person" route="/employee/incentive" pad={false}>
          {data.people.length === 0 ? <div className="px-5 pb-5"><Empty text="No orders or targets in this period." /></div> : (
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-surface"><tr>{['Salesperson', 'Achieved / target', '', 'Orders', 'Conversion', 'Incentive'].map((h, i) => <th key={i} className={`micro-l px-5 py-2 ${i > 2 ? 'text-end' : 'text-start'}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.people.map((s, i) => {
                    const r = s.t ? s.a / s.t : null;
                    return (
                      <tr key={s.id} className="cursor-pointer border-t border-border hover:bg-muted" {...clickable(() => ui.drill({
                        eyebrow: 'Salesperson', title: s.n, value: inrC(s.a), sub: s.t ? `Target ${inrC(s.t)} · ${pct(r!, 0)} done` : 'No target set',
                        route: `/sales/orders?salesperson=${s.id}`, cols: [{ k: 'doc', l: 'Order' }, { k: 'who', l: 'Customer' }, { k: 'amt', l: 'Value', num: true }], rows: s.rows,
                        actions: [{ label: 'Open their quotations', icon: 'file', href: `/quotation?salesperson=${s.id}` }],
                      }), s.n)}>
                        <td className="px-5 py-3"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-on-tint-brand">{s.n.split(' ').map((x) => x[0]).join('').slice(0, 2)}</span><span className="font-medium">{s.n}</span>{i === 0 && s.a > 0 && <Badge t="success">Top</Badge>}</div></td>
                        <td className="px-5 py-3 font-mono text-xs">{inrC(s.a)} <span className="text-muted-foreground">/ {s.t ? inrC(s.t) : '—'}</span></td>
                        <td className="w-40 px-5 py-3">{r === null ? <span className="text-xs text-muted-foreground">no target</span> : <><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="dash-bar h-full rounded-full" style={{ width: `${Math.min(100, r * 100)}%`, background: r >= 1 ? tone.success : r > 0.7 ? cv(1) : tone.warning }} /></div><div className="mt-0.5 text-end font-mono text-cap text-muted-foreground">{pct(r, 0)}</div></>}</td>
                        <td className="px-5 py-3 text-end font-mono">{s.o}</td>
                        <td className="px-5 py-3 text-end font-mono">{s.c === null ? '—' : pct(s.c, 0)}</td>
                        <td className="px-5 py-3 text-end font-mono text-success">{inrC(s.inc)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card id="s-src" title="Where leads come from" icon="user" sub={`${num(data.leads)} leads · click a source`} route="/crm/leads">
          {data.sources.length === 0 ? <Empty text="No leads in this period." /> : (
            <Donut segs={data.sources.map((s, i) => ({ ...s, color: SRC_COL[i % 6] }))} center={num(data.leads)} sub="leads" onPick={() => ui.go('/crm/leads')} />
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card id="s-follow" className="xl:col-span-2" title="Quotations to chase" icon="clock" sub={`Sent more than 7 days ago, no answer yet - oldest first${data.chaseTotal > data.chase.length ? ` · ${data.chaseTotal} in all` : ''}`} route="/quotation?card=sent" pad={false}>
          {data.chase.length === 0 ? <div className="px-5 pb-5"><Empty text="Nothing waiting more than a week." /></div> : (
            <div className="divide-y divide-border">
              {data.chase.filter((f) => !lost.has(f.id)).map((f) => (
                <div key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 hover:bg-muted">
                  <button type="button" onClick={() => ui.go(`/quotation/${f.id}`)} className="w-32 truncate text-start font-mono text-sm text-brand hover:underline">{f.doc}</button>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{f.who}</div><div className="text-xs text-muted-foreground">{f.by} · sent {f.age} ago</div></div>
                  <span className="font-mono text-sm font-semibold">{inrC(f.amt)}</span>
                  <div className="flex gap-1">
                    <button type="button" disabled={!f.phone} onClick={() => f.phone && window.open(`tel:${f.phone}`)} className="rounded-full p-2 text-muted-foreground hover:bg-card hover:text-brand disabled:opacity-40" title="Call" aria-label={`Call ${f.who}`}><DIcon n="phone" s={15} /></button>
                    <button type="button" disabled={!f.phone} onClick={() => f.phone && window.open(whatsappLink(f.phone, docMessage({ kind: 'quotation', number: f.doc, customerName: f.who, note: 'Following up on our quotation - shall we go ahead?' })), '_blank')} className="rounded-full p-2 text-muted-foreground hover:bg-card hover:text-success disabled:opacity-40" title="WhatsApp" aria-label={`WhatsApp ${f.who}`}><DIcon n="whatsapp" s={15} /></button>
                    <button type="button" onClick={async () => { if (await onLost(f.id, f.doc)) setLost((s) => new Set(s).add(f.id)); }} className="rounded-full px-2 text-xs text-muted-foreground hover:bg-card hover:text-danger">Lost</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card id="s-heat" title="When orders come in" icon="calendar" sub="Orders by weekday and hour - hover for count">
          <Heat rows={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']} cols={HOURS} values={data.heat} onPick={() => ui.go('/sales/orders')} />
          <p className="mt-2 text-xs text-muted-foreground">{data.heatBusiest ? <>Busiest: <b className="text-foreground">{data.heatBusiest}</b>. Useful for staffing the counter and timing WhatsApp offers.</> : 'No orders in this period yet.'}</p>
        </Card>
      </div>
    </div>
  );
}
