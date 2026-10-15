'use client';

import type { ServiceData } from '@/server/dash/service';
import { Badge, Card, Combo, DIcon, Donut, Empty, Kpi, Legend, StackBar, Timeline, clickable, cv, inrC, num, pct, tone, useUI, type TlBlockUI, type TlRow } from './kit';

const TONE: Record<string, string> = { c1: cv(1), c2: cv(2), c4: cv(4), c6: cv(6), warning: tone.warning, success: tone.success };
const RMA_COL = [cv(2), cv(1), tone.warning, tone.danger];

export function ServiceDash({ data, rangeLabel }: { data: ServiceData; rangeLabel: string }) {
  const ui = useUI();
  const f = data.flow;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 min-[1360px]:grid-cols-6">
        {data.kpis.map((k) => <Kpi key={k.id} k={{ ...k, drill: { eyebrow: `Service · ${rangeLabel}`, ...k.drill } }} />)}
      </div>

      <Card id="v-stages" title="Where every open complaint is" icon="sliders" sub={`${data.openN} open · click a stage to open that list (same stages as the complaint page)`} route="/services/complaints?card=open">
        <div className="flex gap-1 overflow-x-auto pb-1 thin-scroll">
          {data.stages.map((s, i) => (
            <button type="button" key={s.label} onClick={() => ui.go(s.href)} className="group relative min-w-[118px] flex-1 rounded-sm border border-border bg-surface px-3 py-3 text-start hover:border-brand/50 hover:bg-card">
              <div className="h-1 w-8 rounded-full" style={{ background: TONE[s.tone] }} />
              <div className="mt-2 font-mono text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground group-hover:text-foreground">{s.label}</div>
              {i < data.stages.length - 1 && <DIcon n="chevRight" s={14} className="absolute -end-2.5 top-1/2 z-10 -translate-y-1/2 rounded-full bg-card text-muted-foreground" />}
            </button>
          ))}
        </div>
      </Card>

      <Card id="v-today" title="Technicians today" icon="clock" sub="Visits from the Visit Scheduler and phone check-ins - click a block to open the job" route="/services/board">
        {data.timeline.length === 0 ? <Empty text="No visits booked for today." /> : (
          <Timeline rows={data.timeline as unknown as TlRow[]} nowH={data.nowH} onPick={(r, b0) => {
            const b = b0 as TlBlockUI & { href: string; checkIn: string; photos: string };
            const row = r as TlRow & { phone: string | null };
            if (b.st === 'travel') return;
            ui.drill({
              eyebrow: `${r.name} · today`, title: b.label || 'Visit', sub: b.time, route: b.href,
              cols: [{ k: 'k', l: 'Step' }, { k: 'v', l: 'When' }],
              rows: [{ k: 'Checked in on site', v: b.checkIn }, { k: 'Finished', v: b.st === 'done' ? 'Yes' : '—' }, { k: 'Customer sign-off', v: b.photos }],
              actions: [
                ...(row.phone ? [{ label: 'Call technician', icon: 'phone', href: `tel:${row.phone}` }] : []),
                ...(b.st === 'late' ? [{ label: 'Move the visit', icon: 'calendar', href: '/services/visits' }] : []),
              ],
            });
          }} />
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card id="v-flow" className="xl:col-span-2" title="Coming in vs going out" icon="trend" sub="Opened (bars) vs closed (line) · dashed = backlog still open"
          right={<Legend items={[{ label: 'Opened', color: cv(1) }, { label: 'Closed', color: tone.success }, { label: 'Backlog', color: cv(3) }]} />}>
          <Combo labels={ui.labels} fmt={(v) => num(v)} onPick={ui.zoom} series={[
            { key: 'o', label: 'Opened', color: cv(1), type: 'bar', data: f.opened },
            { key: 'c', label: 'Closed', color: tone.success, type: 'line', data: f.closed },
            { key: 'b', label: 'Backlog', color: cv(3), type: 'dash', data: f.backlog },
          ]} />
        </Card>
        <Card id="v-rma" title="Repairs with suppliers" icon="truck" sub="Customer units out for repair, by days out" route="/services/dispatch">
          <StackBar fmt={num} segs={data.rma.map((r, i) => ({ ...r, color: RMA_COL[i] }))} onPick={(s) => {
            const band = data.rma.find((r) => r.label === s.label)!;
            ui.drill({
              eyebrow: 'With suppliers', title: band.label, value: `${num(band.value)} units`, route: '/services/dispatch',
              cols: [{ k: 'doc', l: 'Case' }, { k: 'sup', l: 'Supplier' }, { k: 'dk', l: 'Docket' }, { k: 'd', l: 'Days', num: true }], rows: band.rows,
            });
          }} />
          <div className="mt-4 space-y-2">
            {data.lateBoxes.map((b) => (
              <button type="button" key={b.id} onClick={() => ui.go(`/services/dispatch/${b.id}`)} className="flex w-full items-center justify-between rounded-sm bg-danger/5 px-3 py-2 text-start text-sm hover:bg-danger/10">
                <span><span className="font-mono text-brand">{b.no}</span><span className="block text-xs text-muted-foreground">{b.sub}</span></span><Badge t={b.days > 30 ? 'danger' : 'warning'}>{b.days} days</Badge>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card id="v-techs" className="xl:col-span-2" title="Technician scorecard" icon="users" sub={`${rangeLabel} · click a row`} route="/services/technicians" pad={false}>
          {data.techs.length === 0 ? <div className="px-5 pb-5"><Empty text="No technician jobs in this period." /></div> : (
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-surface"><tr>{['Technician', 'Done', 'Open', 'Days to close', 'First visit fix', 'Rating', 'Billed', 'Busy'].map((h, i) => <th key={h} className={`micro-l px-4 py-2 ${i ? 'text-end' : 'text-start'}`}>{h}</th>)}</tr></thead>
                <tbody>{data.techs.map((t) => (
                  <tr key={t.id} className="cursor-pointer border-t border-border hover:bg-muted" {...clickable(() => ui.drill({
                    eyebrow: 'Technician', title: t.n, value: `${t.done} jobs done`, sub: rangeLabel, route: `/services/complaints?tech=${t.id}`,
                    cols: [{ k: 'doc', l: 'Job' }, { k: 'who', l: 'Customer' }, { k: 'r', l: 'Rating' }], rows: t.rows,
                    actions: [{ label: 'See their day', icon: 'clock', href: '/services/board' }, { label: 'Team performance', icon: 'rupee', href: '/services/technicians' }],
                  }), t.n)}>
                    <td className="px-4 py-2.5 font-medium">{t.n}</td>
                    <td className="px-4 py-2.5 text-end font-mono">{t.done}</td>
                    <td className="px-4 py-2.5 text-end font-mono">{t.open}</td>
                    <td className={`px-4 py-2.5 text-end font-mono ${t.days !== null && t.days > 3.5 ? 'text-danger' : ''}`}>{t.days === null ? '—' : t.days.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-end font-mono">{t.ftf === null ? '—' : pct(t.ftf, 0)}</td>
                    <td className="px-4 py-2.5 text-end font-mono">{t.rate === null ? '—' : `${t.rate.toFixed(1)} ★`}</td>
                    <td className="px-4 py-2.5 text-end font-mono">{inrC(t.billed)}</td>
                    <td className="w-28 px-4 py-2.5">{t.util === null ? <span className="block text-end text-muted-foreground">—</span> : <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: pct(t.util, 0), background: t.util > 0.9 ? tone.danger : cv(2) }} /></div>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
        <Card id="v-amc" title="Maintenance contracts" icon="shield" sub="AMC renewals - the money you keep by calling on time" route="/services/amc">
          <Donut fmt={num} center={num(data.amc.total)} sub="AMCs"
            segs={[{ label: 'Running', value: data.amc.running, color: tone.success }, { label: 'Ending in 30 days', value: data.amc.ending, color: tone.warning }, { label: 'Lapsed - not renewed', value: data.amc.lapsed, color: tone.danger }]}
            onPick={(s) => ui.drill({
              eyebrow: 'AMC', title: s.label, value: num(s.value), route: `/services/amc?filter=${s.label.startsWith('Lap') ? 'expired' : 'active'}`,
              cols: [{ k: 'doc', l: 'Contract' }, { k: 'who', l: 'Customer' }, { k: 'end', l: 'Ends' }, { k: 'amt', l: 'Value', num: true }],
              rows: data.amc.rows[s.label] ?? [],
              actions: [{ label: 'Send renewal on WhatsApp', icon: 'whatsapp', toast: 'Arrives with WhatsApp Business (phase W1): the AMC renewal reminder template.' }],
            })} />
        </Card>
      </div>
    </div>
  );
}
