'use client';

import type { AccountsData } from '@/server/dash/accounts';
import { whatsappLink } from '@/lib/revenue';
import { dm } from '@/lib/dash/period';
import { inrFull } from '@/lib/dash/format';
import { Badge, Btn, Card, Combo, DIcon, Empty, Kpi, Legend, ShareRows, StackBar, Waterfall, cv, inrC, tone, useUI } from './kit';

const RECV_COL = [tone.success, cv(1), tone.warning, cv(5), tone.danger];
const PAY_COL = [tone.success, cv(1), tone.warning, tone.danger];

export function AccountsDash({ data, rangeLabel, today }: { data: AccountsData; rangeLabel: string; today: string }) {
  const ui = useUI();
  const { flow, pl, gst } = data;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 min-[1360px]:grid-cols-6">
        {data.kpis.map((k) => <Kpi key={k.id} k={{ ...k, drill: { eyebrow: `Accounts · ${rangeLabel}`, ...k.drill } }} />)}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card id="a-flow" className="xl:col-span-2" title="Cash flow" icon="bank" sub="Up = money in · down = money out · line = cash & bank balance"
          right={<Legend items={[{ label: 'In', color: tone.success }, { label: 'Out', color: tone.danger }, { label: 'Balance', color: cv(1) }]} />}>
          <Combo labels={ui.labels} onPick={ui.zoom} series={[
            { key: 'i', label: 'Money in', color: tone.success, type: 'bar', data: flow.mIn },
            { key: 'o', label: 'Money out', color: tone.danger, type: 'bar', data: flow.mOut },
            { key: 'n', label: 'Balance ÷ 10', color: cv(1), type: 'line', data: flow.balance.map((v) => v / 10) },
          ]} />
          <div className="mt-2 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm sm:grid-cols-3">
            {data.cash.map((c) => <button type="button" key={c.label} onClick={() => ui.go(c.href)} className="rounded-sm text-start hover:bg-muted"><div className="micro-l">{c.label}</div><div className="font-mono font-semibold">{inrC(c.value)}</div></button>)}
          </div>
        </Card>
        <Card id="a-pl" title="Profit, step by step" icon="sparkle" sub={`${rangeLabel} · click a bar`} route="/reports/profit-loss">
          <Waterfall steps={[
            { label: 'Sales', value: pl.sales, kind: 'total' },
            { label: 'Cost', value: pl.cost, kind: 'minus' },
            { label: 'Gross', value: pl.gross, kind: 'total' },
            { label: 'Expenses', value: pl.expenses, kind: 'minus' },
            { label: 'Net', value: pl.net, kind: 'total', last: true },
          ]} onPick={() => ui.go('/reports/profit-loss')} />
          <div className="text-center text-xs text-muted-foreground">Gross margin <b className="font-mono text-foreground">{pl.grossPct.toFixed(1)}%</b> · net margin <b className="font-mono text-foreground">{pl.netPct.toFixed(1)}%</b></div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card id="a-recv" title="Owed to you, by age" icon="inbox" sub="Click a band for the invoices in it" route="/customer/account">
          <StackBar segs={data.recv.map((r, i) => ({ ...r, color: RECV_COL[i], ink: i === 4 ? tone.danger : undefined }))}
            onPick={(s) => ui.drill({
              eyebrow: 'Receivables', title: s.label, value: inrC(s.value), ink: 'danger', route: '/invoices?card=overdue',
              note: 'Opens the overdue invoices; sort by due date there to work through this band.',
              actions: [{ label: 'Remind all on WhatsApp', icon: 'whatsapp', toast: 'Arrives with WhatsApp Business (phase W1).' }],
            })} />
        </Card>
        <Card id="a-pay" title="You owe, by age" icon="truck" sub="Supplier bills not yet paid" route="/purchase/payables">
          <StackBar segs={data.pay.map((r, i) => ({ ...r, color: PAY_COL[i] }))} onPick={() => ui.go('/purchase/payables')} />
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card id="a-debtors" className="xl:col-span-2" title="Who owes you most" icon="users" sub="Collect from the top - every action is one tap" route="/customer/account" pad={false}>
          {data.debtors.length === 0 ? <div className="px-5 pb-5"><Empty text="Nobody owes you anything." /></div> : (
            <div className="divide-y divide-border">
              {data.debtors.map((d) => (
                <div key={d.who} className="flex flex-wrap items-center gap-3 px-5 py-2.5 hover:bg-muted">
                  <button type="button" onClick={() => ui.go(d.partyId ? `/customers/${d.partyId}` : '/customers')} className="min-w-0 flex-1 text-start"><div className="truncate text-sm font-medium hover:text-brand hover:underline">{d.who}</div><div className="text-xs text-muted-foreground">oldest {d.days} days · {d.last}</div></button>
                  <Badge t={d.days > 60 ? 'danger' : d.days > 30 ? 'warning' : 'neutral'}>{d.days > 60 ? '60+ days' : d.days > 30 ? '30+ days' : 'recent'}</Badge>
                  <span className="w-24 text-end font-mono text-sm font-semibold text-danger">{inrC(d.amt)}</span>
                  <div className="flex gap-1">
                    <button type="button" disabled={!d.phone} onClick={() => d.phone && window.open(`tel:${d.phone}`)} className="rounded-full p-2 text-muted-foreground hover:bg-card hover:text-brand disabled:opacity-40" title="Call" aria-label={`Call ${d.who}`}><DIcon n="phone" s={15} /></button>
                    <button type="button" disabled={!d.phone} onClick={() => d.phone && window.open(whatsappLink(d.phone, `Hello ${d.who}, a reminder that ${inrFull(d.amt)} is due to us. Thank you.`), '_blank')} className="rounded-full p-2 text-muted-foreground hover:bg-card hover:text-success disabled:opacity-40" title="WhatsApp" aria-label={`WhatsApp ${d.who}`}><DIcon n="whatsapp" s={15} /></button>
                    <Btn size="sm" kind="money" onClick={() => ui.go('/receipts?pay=1')}>Record payment</Btn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card id="a-gst" title="GST this period" icon="gst" sub="From invoices and purchase bills" route="/reports/gst">
          <div className="space-y-2 text-sm">
            {([['Output tax (on sales)', gst.out, ''], ['Input tax (on purchases)', -gst.inp, 'text-success'], ['Net to pay', gst.net, 'text-danger font-bold']] as const).map(([l, v, c]) => (
              <div key={l} className={`flex justify-between ${l.startsWith('Net') ? 'border-t border-border pt-2' : ''}`}><span className="text-muted-foreground">{l}</span><span className={`font-mono ${c}`}>{inrFull(v)}</span></div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-sm bg-warning/10 p-2.5 text-xs"><div className="font-semibold text-warning">GSTR-1</div><div className="text-muted-foreground">Due {gst.r1Due} · {gst.r1Days} day{gst.r1Days === 1 ? '' : 's'}</div></div>
            <div className="rounded-sm bg-warning/10 p-2.5 text-xs"><div className="font-semibold text-warning">GSTR-3B</div><div className="text-muted-foreground">Due {gst.r3Due} · {gst.r3Days} day{gst.r3Days === 1 ? '' : 's'}</div></div>
          </div>
          <div className="mt-4"><div className="micro-l mb-2">Expenses by head</div>
            <ShareRows rows={data.heads.slice(0, 4)} onPick={() => ui.go('/transactions?card=expense')} empty="No expenses in this period." />
          </div>
        </Card>
      </div>

      <Card id="a-upcoming" title="Next 14 days: money going out" icon="calendar" sub="Supplier bills by due date, GST and salaries - plan the cash">
        {data.upcoming.length === 0 ? <Empty text="Nothing falls due in the next 14 days." /> : (
          <div className="flex gap-2 overflow-x-auto pb-1 thin-scroll">
            {data.upcoming.map((u) => (
              <button type="button" key={u.w + u.s} onClick={() => ui.go(u.href)} className="dash-tile min-w-[150px] flex-1 rounded-sm border border-border p-3 text-start">
                <div className="flex items-center justify-between"><span className="micro-l">{u.day === today ? 'Today' : dm(u.day)}</span><DIcon n={u.ic} s={14} className="text-muted-foreground" /></div>
                <div className="mt-1 truncate text-sm font-medium">{u.w}</div>
                <div className="text-xs text-muted-foreground">{u.s}</div>
                <div className="mt-1 font-mono font-semibold">{inrC(u.a)}</div>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
