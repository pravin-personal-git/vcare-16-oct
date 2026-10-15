'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { FULFILMENT_FLOW, FULFILMENT_LABEL, type FulfilmentStatus } from '@/lib/sales-order-status';
import {
  OPTIONAL_STAGES, PRESETS, STAGE_COLORS, STAGE_COLOR_VAR, shownStages, stageColor, stageName,
  type OrderStageConfig, type StageColor,
} from '@/lib/order-stages';
import { OrderStepper } from '@/components/document/OrderStepper';
import { saveOrderStagesAction } from './actions';

/**
 * The stage editor (ops-pages demo tab 5). Switch the in-between stages on or
 * off, rename and recolour any stage, or pick a preset. Booked and Delivered
 * are always on. The preview on the right is the stepper an order shows.
 */
export function OrderStagesClient({ initial, canEdit }: { initial: OrderStageConfig; canEdit: boolean }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<OrderStageConfig>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [colorFor, setColorFor] = useState<FulfilmentStatus | null>(null);

  const rows = FULFILMENT_FLOW.filter((s) => s !== 'pending_approval');
  const toggle = (s: FulfilmentStatus) => setCfg((c) => ({ ...c, enabled: c.enabled.includes(s) ? c.enabled.filter((x) => x !== s) : OPTIONAL_STAGES.filter((x) => x === s || c.enabled.includes(x)) }));
  const rename = (s: FulfilmentStatus, v: string) => setCfg((c) => ({ ...c, labels: { ...c.labels, [s]: v } }));
  const recolor = (s: FulfilmentStatus, v: StageColor) => setCfg((c) => ({ ...c, colors: { ...c.colors, [s]: v } }));
  const save = () => start(async () => {
    setMsg(null);
    const r = await saveOrderStagesAction(cfg);
    setMsg(r.error ?? 'Saved - orders use these stages now.');
    if (!r.error) router.refresh();
  });

  return (
    <div className="space-y-4">
      <PageHeader badge="OS" title="Sales order stages" subtitle="Which steps an order goes through, what they are called and their colour. Booked and Delivered always stay - stock, invoicing and reports hang off them." />
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded border border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="me-1 text-micro font-semibold uppercase text-muted-foreground">Start from</span>
            {PRESETS.map((p) => (
              <button key={p.key} type="button" disabled={!canEdit} onClick={() => setCfg((c) => ({ ...c, enabled: p.enabled }))}
                className="rounded-full bg-muted px-3 py-1 text-xs font-medium hover:bg-brand/10 hover:text-brand disabled:opacity-50">{p.label}</button>
            ))}
          </div>
          <div className="space-y-1.5">
            {rows.map((s) => {
              const always = s === 'booked' || s === 'delivered';
              const on = always || cfg.enabled.includes(s);
              return (
                <div key={s} className={`relative flex items-center gap-2 rounded-sm border border-border p-2 ${on ? '' : 'opacity-55'}`}>
                  <button type="button" disabled={!canEdit} aria-label={`Colour of ${stageName(cfg, s)}`} onClick={() => setColorFor(colorFor === s ? null : s)}
                    className="h-6 w-6 shrink-0 rounded-full ring-2 ring-card" style={{ background: stageColor(cfg, s) }} />
                  {colorFor === s && (
                    <div className="absolute start-2 top-10 z-20 grid w-max grid-cols-8 gap-1.5 rounded border border-border bg-card p-2 shadow-raised">
                      {STAGE_COLORS.map((c) => (
                        <button key={c} type="button" aria-label={c} onClick={() => { recolor(s, c); setColorFor(null); }}
                          className="h-6 w-6 rounded-full ring-2 ring-card transition hover:scale-110" style={{ background: STAGE_COLOR_VAR[c] }} />
                      ))}
                    </div>
                  )}
                  <input disabled={!canEdit} value={cfg.labels[s] ?? ''} placeholder={FULFILMENT_LABEL[s]} aria-label={`Name for ${FULFILMENT_LABEL[s]}`}
                    onChange={(e) => rename(s, e.target.value)}
                    className="min-w-0 flex-1 rounded-sm bg-transparent px-1.5 py-1 text-sm font-medium focus:bg-surface focus:outline-none" />
                  {s === 'dispatched' && <span className="hidden text-cap text-muted-foreground sm:inline">stock leaves here</span>}
                  {always
                    ? <span className="flex w-14 justify-center text-muted-foreground" title="Always on"><Icon name="lock" className="h-3.5 w-3.5" /></span>
                    : <button type="button" disabled={!canEdit} onClick={() => toggle(s)} className={`w-14 rounded-full py-0.5 text-cap font-semibold ${on ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>{on ? 'On' : 'Off'}</button>}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Pending approval appears only when an approval rule needs it. Hold, Failed, Returned and Void are always there as exceptions. With Dispatched off, stock leaves when the order is marked Delivered.</p>
          {canEdit && <div className="mt-3 flex items-center gap-3"><Button variant="primary" icon="check" loading={pending} onClick={save}>Save stages</Button>{msg && <span className="text-sm text-muted-foreground" role="status">{msg}</span>}</div>}
          {!canEdit && <p className="mt-3 text-sm text-muted-foreground">Only an admin can change these, with a single branch picked.</p>}
        </section>
        <section className="rounded border border-border bg-card p-4">
          <h3 className="mb-3 text-title font-semibold">How an order shows it</h3>
          <OrderStepper stages={shownStages(cfg)} current="confirmed" cfg={cfg} />
        </section>
      </div>
    </div>
  );
}
