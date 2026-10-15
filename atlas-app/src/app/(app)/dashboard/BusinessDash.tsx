'use client';

import type { BusinessData } from '@/server/dash/business';
import {
  ActionList, Badge, Card, Combo, DIcon, Donut, Gauge, Kpi, Legend, ShareRows, cv, inrC, tone, useUI,
} from './kit';

export function BusinessDash({ data, compare, rangeLabel, gran }: {
  data: BusinessData; compare: 'prev' | 'ly' | 'none'; rangeLabel: string; gran: string;
}) {
  const ui = useUI();
  const { trend: t } = data;
  const labels = ui.labels;
  const needsTotal = data.needs.reduce((a, n) => a + n.count, 0);
  const notIn = data.team;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 min-[1360px]:grid-cols-6">
        {data.kpis.map((k) => <Kpi key={k.id} k={{ ...k, drill: { eyebrow: `Business · ${rangeLabel}`, ...k.drill } }} />)}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card id="b-trend" className="xl:col-span-2" title="Sales, money in and expenses" icon="trend"
          sub={`${rangeLabel} · grouped by ${gran}${compare !== 'none' ? ` · dashed = ${compare === 'ly' ? 'last year' : 'previous period'}` : ''}`}
          right={<Legend items={[{ label: 'Sales', color: cv(1) }, { label: 'Money in', color: cv(2) }, { label: 'Expenses', color: cv(3) }, ...(t.prevSales ? [{ label: 'Sales before', color: 'hsl(var(--muted-foreground))', dash: true }] : [])]} />}>
          <Combo labels={labels} onPick={ui.zoom} pickHint={gran === 'hour' ? 'Click to see that hour' : `Click to zoom into this ${gran}`}
            series={[
              { key: 's', label: 'Sales', color: cv(1), type: 'bar', data: t.sales },
              { key: 'e', label: 'Expenses', color: cv(3), type: 'bar', data: t.exp },
              { key: 'c', label: 'Money in', color: cv(2), type: 'line', data: t.coll },
              ...(t.prevSales ? [{ key: 'p', label: 'Sales before', color: 'hsl(var(--muted-foreground))', type: 'dash' as const, data: t.prevSales }] : []),
            ]} />
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm">
            <div><div className="micro-l">Sales</div><div className="font-mono font-semibold">{inrC(t.tSales)}</div></div>
            <div><div className="micro-l">Money in</div><div className="font-mono font-semibold text-success">{inrC(t.tColl)}</div></div>
            <div><div className="micro-l">Net (in − expenses)</div><div className="font-mono font-semibold">{inrC(t.tColl - t.tExp)}</div></div>
          </div>
        </Card>
        <Card id="b-needs" title="Needs you today" icon="bolt" sub="Every row opens the work, not a report" right={<Badge t="danger">{needsTotal}</Badge>}>
          <ActionList items={data.needs.map((n) => ({
            ...n,
            onClick: () => ui.drill({
              eyebrow: 'Needs you today', title: n.label, sub: n.sub, rowsTitle: 'Items', rowsTotal: n.count,
              cols: [{ k: 'doc', l: 'Item' }, { k: 'who', l: 'Who' }, { k: 'age', l: 'Waiting' }, { k: 'amt', l: 'Amount', num: true }],
              rows: n.rows, route: n.href, actions: n.actions,
            }),
          }))} />
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card id="b-target" title="This month's target" icon="target" sub="Sales booked vs the target set in Settings › Targets" route="/settings/user-target">
          {data.target ? (
            <>
              <Gauge value={data.target.mtd} target={data.target.target} label={`${inrC(data.target.mtd)} of ${inrC(data.target.target)}`} />
              <div className="mt-1 rounded-sm bg-surface px-3 py-2 text-center text-xs text-muted-foreground">
                On pace for <b className="font-mono text-foreground">{inrC(data.target.pace)}</b> by month end · needs <b className="font-mono text-foreground">{inrC(data.target.perDay)}</b>/day
              </div>
            </>
          ) : (
            <div className="rounded-sm bg-surface px-3 py-6 text-center text-sm text-muted-foreground">
              No target set for this month.
              <button type="button" onClick={() => ui.go('/settings/user-target')} className="mt-2 block w-full py-2 text-xs font-medium text-brand hover:underline">Set targets</button>
            </div>
          )}
        </Card>
        <Card id="b-team" title="Team today" icon="users" sub={`${notIn.head} staff · punches from the devices + phone`} route="/attendance/team-today">
          <Donut size={120} thick={12} center={`${notIn.onTime + notIn.late}/${notIn.head}`} sub="in today"
            segs={[{ label: 'On time', value: notIn.onTime, color: tone.success }, { label: 'Late', value: notIn.late, color: tone.warning }, { label: 'On leave', value: notIn.leave, color: cv(4) }, { label: 'Not in', value: notIn.notIn, color: tone.danger }]} />
        </Card>
        <Card id="b-service" title="Service pulse" icon="wrench" sub="Complaints across branches" route="/services/complaints">
          <div className="grid grid-cols-2 gap-3">
            {([['Open', String(data.service.open), ''], ['Missed deadline', String(data.service.missed), 'text-danger'], ['Avg days to close', data.service.avgClose, ''], ['Rating', data.service.rating, 'text-success']] as const).map(([l, v, c]) => (
              <button type="button" key={l} onClick={() => ui.goTab('service')} className="rounded-sm bg-surface p-3 text-start hover:bg-muted">
                <div className="micro-l">{l}</div><div className={`font-mono text-xl font-bold ${c}`}>{v}</div>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => ui.goTab('service')} className="mt-1 flex w-full items-center justify-center gap-1 py-2 text-xs font-medium text-brand hover:underline">Open the Service dashboard <DIcon n="chevRight" s={12} /></button>
        </Card>
        <Card id="b-branch" title={data.branches ? 'Sales by branch' : 'Cash position'} icon={data.branches ? 'grid' : 'bank'} sub={data.branches ? 'Click a branch to filter the whole dashboard' : 'Balances as on today'}>
          {data.branches
            ? <ShareRows rows={data.branches.map((b, i) => ({ ...b, color: cv((i % 6) + 1) }))} onPick={(r) => ui.setBranch(String(r.storeId))} />
            : <ShareRows rows={data.cash} color={cv(2)} onPick={() => ui.go('/bank/summary')} />}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card id="b-cust" title="Top customers" icon="users" sub={rangeLabel} route="/customers">
          <ShareRows rows={data.topCustomers}
            onPick={(r) => {
              const c = data.topCustomers.find((x) => x.label === r.label)!;
              ui.drill({
                eyebrow: 'Customer', title: c.label, value: inrC(c.value), sub: `Sales in ${rangeLabel}`,
                route: c.partyId ? `/customers/${c.partyId}` : '/customers', rowsTitle: 'Invoices in this period',
                cols: [{ k: 'doc', l: 'Invoice' }, { k: 'date', l: 'Date' }, { k: 'st', l: 'Status' }, { k: 'amt', l: 'Amount', num: true }],
                rows: c.rows,
              });
            }} />
        </Card>
        <Card id="b-prod" title="Top products" icon="box" sub="By sales value" route="/products">
          <ShareRows color={cv(2)} rows={data.topProducts}
            onPick={(r) => {
              const p = data.topProducts.find((x) => x.label === r.label)!;
              ui.drill({ eyebrow: 'Product', title: p.label, value: inrC(p.value), sub: 'Opens the product’s journey: stock, sales, serials, repairs', note: `${p.extra} sold in ${rangeLabel}.`, route: p.productId ? `/product-journey?product=${p.productId}` : '/product-journey' });
            }} />
        </Card>
        <Card id="b-feed" title="Happening now" icon="clock" sub="Latest documents - click any to open it" right={<span className="flex items-center gap-1.5 text-xs text-success"><i className="dash-live inline-block h-2 w-2 rounded-full bg-success" />Live</span>}>
          {data.feed.length === 0 ? <div className="rounded-sm bg-surface px-3 py-6 text-center text-sm text-muted-foreground">Nothing recorded yet.</div> : (
            <div className="-mx-2 space-y-0.5">
              {data.feed.map((f) => (
                <button type="button" key={f.s + f.w} onClick={() => ui.go(f.href)} className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-start hover:bg-muted">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted"><DIcon n={f.i} s={14} /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{f.t}</span><span className="block truncate text-xs text-muted-foreground">{f.s}</span></span>
                  <span className="shrink-0 text-end"><span className={`block font-mono text-xs font-semibold ${f.c}`}>{f.a}</span><span className="block text-cap text-muted-foreground">{f.w}</span></span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
