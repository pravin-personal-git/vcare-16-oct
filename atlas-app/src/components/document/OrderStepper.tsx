'use client';

import { Fragment } from 'react';
import { Icon } from '@/components/ui/Icon';
import { FULFILMENT_FLOW, type FulfilmentStatus } from '@/lib/sales-order-status';
import { stageColor, stageName, type OrderStageConfig } from '@/lib/order-stages';

/**
 * The order's stages as a stepper (11 Oct 2026, ops-pages demo tab 5).
 * Done steps green with a tick, the current one in its colour, the rest grey.
 * `onPick` makes the next step clickable; earlier steps are not - going back
 * is not a move the order rules allow.
 */
export function OrderStepper({ stages, current, cfg, onPick, allowed = [] }: {
  stages: FulfilmentStatus[];
  current: FulfilmentStatus;
  cfg: OrderStageConfig;
  onPick?: (s: FulfilmentStatus) => void;
  /** Stages the order may move to now. */
  allowed?: FulfilmentStatus[];
}) {
  const at = (() => {
    const i = stages.indexOf(current);
    if (i >= 0) return i;
    // An order at a stage that is switched off (or pending approval) sits after the last shown stage before it.
    const flowAt = FULFILMENT_FLOW.indexOf(current);
    return Math.max(0, stages.filter((s) => FULFILMENT_FLOW.indexOf(s) <= flowAt).length - 1);
  })();
  const offFlow = !stages.includes(current) && !FULFILMENT_FLOW.includes(current);
  return (
    <div className="flex items-center overflow-x-auto pb-1 thin-scroll">
      {stages.map((s, i) => {
        const done = !offFlow && i < at;
        const now = !offFlow && i === at;
        const can = !!onPick && allowed.includes(s);
        return (
          <Fragment key={s}>
            <button type="button" disabled={!can} onClick={() => onPick?.(s)} title={can ? `Mark ${stageName(cfg, s)}` : undefined}
              className={`flex shrink-0 flex-col items-center gap-1.5 px-2 ${can ? 'cursor-pointer' : 'cursor-default'}`}>
              <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white transition ${can ? 'ring-4 ring-brand/20' : ''}`}
                style={{ background: done ? 'hsl(var(--success))' : now ? stageColor(cfg, s) : 'hsl(var(--muted))', color: done || now ? undefined : 'hsl(var(--muted-foreground))' }}>
                {done ? <Icon name="check" className="h-4 w-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className={`whitespace-nowrap text-xs ${now ? 'font-semibold' : 'text-muted-foreground'}`}>{stageName(cfg, s)}</span>
            </button>
            {i < stages.length - 1 && <span className={`h-0.5 min-w-[20px] flex-1 rounded ${done ? 'bg-success' : 'bg-muted'}`} />}
          </Fragment>
        );
      })}
    </div>
  );
}
