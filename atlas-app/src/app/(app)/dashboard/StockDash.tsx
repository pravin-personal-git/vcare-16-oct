'use client';

import { useState } from 'react';
import type { StockData } from '@/server/dash/stock';
import { Btn, Card, Combo, DIcon, Donut, Empty, Kpi, Legend, ShareRows, StackBar, cv, inrC, num, tone, useUI } from './kit';

const AGE_COL = [cv(2), cv(1), tone.warning, tone.danger];

export function StockDash({ data, rangeLabel, onMakePo }: { data: StockData; rangeLabel: string; onMakePo: (ids: string[]) => void }) {
  const ui = useUI();
  const [sel, setSel] = useState<Set<string>>(() => new Set(data.reorder.slice(0, 3).map((r) => r.id)));
  const f = data.flow;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 min-[1360px]:grid-cols-6">
        {data.kpis.map((k) => <Kpi key={k.id} k={{ ...k, drill: { eyebrow: `Stock · ${rangeLabel}`, ...k.drill } }} />)}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card id="k-flow" className="xl:col-span-2" title="Stock in, stock out, stock value" icon="box" sub="Bars: goods received / goods sold (at cost) · line: value on hand"
          right={<Legend items={[{ label: 'In', color: cv(2) }, { label: 'Out', color: cv(3) }, { label: 'Value', color: cv(1) }]} />}>
          <Combo labels={ui.labels} onPick={ui.zoom} series={[
            { key: 'i', label: 'Received', color: cv(2), type: 'bar', data: f.inward },
            { key: 'o', label: 'Sold (cost)', color: cv(3), type: 'bar', data: f.outward },
            { key: 'v', label: 'Value on hand ÷ 20', color: cv(1), type: 'line', data: f.value.map((v) => v / 20) },
          ]} />
          <p className="mt-1 text-cap text-muted-foreground">Value line drawn at 1/20 scale to share the axis - the tile above shows the true figure.</p>
        </Card>
        <Card id="k-cat" title="Where the money is sitting" icon="grid" sub="Stock value by category · click to open">
          {data.cats.length === 0 ? <Empty text="No stock with a known cost." /> : (
            <Donut segs={data.cats.map((c, i) => ({ ...c, color: cv((i % 6) + 1) }))} fmt={inrC} center={inrC(data.total)} sub="on hand" onPick={() => ui.go('/reports/product-stock')} />
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card id="k-reorder" className="xl:col-span-2" title="Re-order now" icon="cart" sub="Below re-order level · tick and make one purchase order per supplier" pad={false}
          right={<Btn size="sm" kind="primary" icon="cart" disabled={sel.size === 0} onClick={() => onMakePo([...sel])}>Make PO ({sel.size})</Btn>}>
          {data.reorder.length === 0 ? <div className="px-5 pb-5"><Empty text="Nothing is below its re-order level." /></div> : (
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-surface"><tr><th className="w-10 px-4" aria-label="Pick" />{['Product', 'In stock', 'Re-order at', 'Sold / 30 d', 'Usual supplier'].map((h, i) => <th key={h} className={`micro-l px-4 py-2 ${i && i < 4 ? 'text-end' : 'text-start'}`}>{h}</th>)}</tr></thead>
                <tbody>{data.reorder.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted">
                    <td className="px-4"><input type="checkbox" aria-label={`Pick ${r.p}`} checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} className="h-4 w-4 accent-brand" /></td>
                    <td className="px-4 py-2.5"><button type="button" onClick={() => ui.go(`/product-journey?product=${r.id}`)} className="text-start font-medium hover:text-brand hover:underline">{r.p}</button></td>
                    <td className={`px-4 py-2.5 text-end font-mono ${r.have <= 0 ? 'font-bold text-danger' : 'text-warning'}`}>{num(r.have)}</td>
                    <td className="px-4 py-2.5 text-end font-mono">{num(r.lvl)}</td>
                    <td className="px-4 py-2.5 text-end font-mono">{num(r.sold)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.sup}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
        <Card id="k-age" title="How old the stock is" icon="clock" sub="By days since received · older = money stuck" route="/reports/stock-health">
          <StackBar segs={data.ageing.map((a, i) => ({ ...a, color: AGE_COL[i] }))} onPick={() => ui.go('/goods-dispatch/dead-stock')} />
          <div className="mt-4"><div className="micro-l mb-1">Fast movers this period</div>
            <ShareRows color={cv(2)} fmt={num} rows={data.fast.map((r) => ({ ...r, extra: 'pcs' }))} onPick={(r) => ui.go(`/product-journey?product=${String(r.id)}`)} empty="Nothing sold in this period." />
          </div>
        </Card>
      </div>

      <Card id="k-units" title="Serial units outside the shelf" icon="pin" sub="Every serialised unit that is not on the shelf and not sold - who has it">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([['With technicians (van stock)', data.units.van, 'user', '/van-stock'], ['In repair (customer’s)', data.units.repair, 'wrench', '/stock-units'], ['At suppliers (RMA)', data.units.supplier, 'truck', '/services/dispatch'], ['Reserved for orders', data.units.reserved, 'tag', '/stock-units']] as const).map(([l, v, ic, h]) => (
            <button type="button" key={l} onClick={() => ui.go(h)} className="dash-tile flex items-center gap-3 rounded-sm border border-border p-3 text-start">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted"><DIcon n={ic} s={17} /></span>
              <span><span className="block font-mono text-xl font-bold">{num(v)}</span><span className="text-xs text-muted-foreground">{l}</span></span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
