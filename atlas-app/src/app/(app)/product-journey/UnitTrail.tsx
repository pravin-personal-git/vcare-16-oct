'use client';

import Link from 'next/link';
import { Badge, Card, SectionCard } from '@/components/ui/Layout';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { UnitJourneyVM } from './serialise';

/**
 * One physical item's life, as a spine (1 Oct 2026, moved here 2 Oct).
 *
 * WHY A SPINE AND NOT A TABLE.
 *
 * The question is "what happened to this thing, in order" - and order is the
 * answer. A table of events sorted by date technically contains it, but the
 * reader has to assemble the story themselves. A single vertical line with
 * money on one side and documents on the other shows the shape at a glance:
 * where it came from, what it cost, who has it, what is still open.
 *
 * No `PageHeader` here on purpose: this is a SECTION of the product history
 * page, which owns the heading. Two headings on one screen is worse than one.
 */

const ICON: Record<string, IconName> = {
  bought: 'shopping-cart',
  received: 'package',
  billed: 'receipt',
  paid_out: 'credit-card',
  sold: 'trending-up',
  delivered: 'truck',
  installed: 'check-circle',
  serviced: 'alert-circle',
  returned: 'rotate-ccw',
};

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

const when = (iso: string | null) =>
  (iso
    ? new Date(iso).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    })
    : 'date unknown');

export function UnitTrail({ j, onClose }: { j: UnitJourneyVM; onClose?: () => void }) {
  const { money } = j;

  return (
    <>
      <Card className="mb-3 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-base font-bold">{j.serialNo ?? 'No serial number'}</p>
            <p className="text-sm text-muted-foreground">
              {j.productName}{j.productCode ? ` · ${j.productCode}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={j.status === 'in_stock' ? 'success' : 'info'}>{j.whereItIs}</Badge>
            {j.condition !== 'new' && <Badge tone="warning">{j.condition}</Badge>}
            {money.weOwe && <Badge tone="danger">We still owe the supplier</Badge>}
            {money.theyOwe && <Badge tone="danger">Customer still owes us</Badge>}
            {onClose && (
              <button
                type="button" onClick={onClose}
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/50"
              >
                Back to the model
              </button>
            )}
          </div>
        </div>

        {/* Money first, because it is the question behind the question. */}
        <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-3">
          <Figure label="We paid" value={money.costPaise} tone="text-danger" />
          <Figure label="We sold it for" value={money.soldPaise} tone="text-success" />
          <Figure
            label="Difference" value={money.marginPaise} strong
            tone={money.marginPaise !== null && money.marginPaise < 0 ? 'text-danger' : 'text-foreground'}
          />
        </div>
      </Card>

      <SectionCard title="What happened to this one item, in order" icon="clock">
        {j.stages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded against this item yet.</p>
        ) : (
          <ol className="relative grid gap-0">
            {/* The spine. Drawn behind the markers so each one sits on it. */}
            <span aria-hidden="true" className="absolute inset-y-3 start-[15px] w-px bg-border" />
            {j.stages.map((s, i) => (
              <li key={`${s.kind}-${i}`} className="relative flex gap-3 py-2.5">
                <span className={`z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border ${
                  s.open ? 'border-warning bg-warning/15 text-on-tint-warning' : 'border-border bg-card text-muted-foreground'
                }`}>
                  <Icon name={ICON[s.kind] ?? 'chevron-right'} className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold">{s.title}</span>
                    {s.party && <span className="text-sm text-muted-foreground">{s.party}</span>}
                    {s.open && <Badge tone="warning">open</Badge>}

                    {s.amountPaise !== null && (
                      <span className={`ms-auto whitespace-nowrap font-mono text-sm font-semibold tabular-nums ${
                        s.amountPaise < 0 ? 'text-danger' : 'text-success'
                      }`}>
                        {s.amountPaise < 0 ? '−' : '+'}{rupees(Math.abs(s.amountPaise))}
                      </span>
                    )}
                  </div>

                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{when(s.at)}</span>
                    {s.docNo && (
                      s.docHref
                        ? <Link href={s.docHref} className="font-mono text-brand hover:underline">{s.docNo}</Link>
                        : <span className="font-mono">{s.docNo}</span>
                    )}
                    {s.detail && <span className="min-w-0">{s.detail}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}

        {/* The one inference on this page, said out loud rather than implied. */}
        {j.stages.some((s) => s.kind === 'serviced') && (
          <p className="mt-3 border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
            Service calls are matched by customer and product, because a complaint records those
            and not a serial number. Where a customer holds two of the same product, both items
            show the same calls.
          </p>
        )}
      </SectionCard>
    </>
  );
}

function Figure({ label, value, tone, strong = false }: {
  label: string; value: number | null; tone: string; strong?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {value === null ? (
        /* Not "0". Unknown and zero are different, and only one of them is a
           claim about the business. */
        <p className="mt-1 text-sm text-muted-foreground">Not recorded</p>
      ) : (
        <p className={`mt-1 tabular-nums ${strong ? 'text-xl font-bold' : 'text-lg font-semibold'} ${tone}`}>
          {rupees(value)}
        </p>
      )}
    </div>
  );
}
