'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import { useState } from 'react';
import { Badge, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

export interface StuckCase {
  id: string;
  caseNo: string;
  productName: string;
  qty: number;
  customerId?: string | null;
  customerName: string | null;
  /** Where it went, as text - null when nothing was ever recorded. */
  goingTo: string | null;
  /** True once the vendor is a party on file rather than typed-in text. */
  vendorOnFile: boolean;
  docketNo: string | null;
  daysOut: number;
  daysLate: number;
}

/**
 * WHAT IS SITTING AT A VENDOR RIGHT NOW (Vcare, 7 Oct 2026).
 *
 * Pravin asked what data Repairs & Replacements actually holds before anything
 * was renamed. The answer, on his live copy:
 *
 *     566 cases      439 returned to the customer, 81 back in the office,
 *                    46 still out at a vendor
 *     44 of those 46 are more than 30 days past their expected date
 *     the oldest went out in July 2025 - a 2U rack, 438 days ago
 *     40 of the 46 have NO vendor recorded at all
 *
 * Every one of those is a customer's property, and the last fact is the one
 * that matters: for forty of them there is nobody to ring. That is not a
 * number that belongs behind a filter chip, so it is a panel at the top of
 * the screen, worst first, with the missing vendor said out loud.
 *
 * The screen already had an "Overdue" card. A count told nobody which case,
 * how long, or that most of them had no vendor - so the count was true and
 * useless. This is the same information arranged so somebody can act on it.
 *
 * It hides itself when nothing is out, which is the state to aim for.
 */
export function StuckPanel({ cases, onOpen }: {
  cases: StuckCase[];
  onOpen: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (cases.length === 0) return null;

  const noVendor = cases.filter((c) => !c.goingTo).length;
  const late = cases.filter((c) => c.daysLate > 0).length;
  // Worst first: longest out, because that is the order somebody would chase.
  const sorted = [...cases].sort((a, b) => b.daysOut - a.daysOut);
  const shown = showAll ? sorted : sorted.slice(0, 6);

  return (
    <Card className="mb-3 overflow-hidden border-warning/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-warning/[0.07] px-3 py-2">
        <Icon name="alert-triangle" className="h-4 w-4 shrink-0 text-warning" />
        <p className="text-xs font-semibold">
          {cases.length} item{cases.length === 1 ? '' : 's'} out at a vendor
        </p>
        {late > 0 && <Badge tone="danger">{late} past the date</Badge>}
        {/*
          Said as its own badge, not folded into "overdue". An item that is
          late but at a known vendor is a phone call; one with no vendor
          recorded is a search of the office.
        */}
        {noVendor > 0 && <Badge tone="warning">{noVendor} with no vendor recorded</Badge>}
      </div>

      <ul className="divide-y divide-border">
        {shown.map((c) => (
          <li key={c.id} data-row-id={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              className="font-mono text-xs font-semibold text-brand hover:underline"
            >
              {c.caseNo}
            </button>
            <span className="min-w-0 flex-1 truncate text-xs">
              {c.productName}{c.qty > 1 ? ` x${c.qty}` : ''}
              <span className="text-muted-foreground"> · {c.customerName ? <CustomerLink id={c.customerId}>{c.customerName}</CustomerLink> : 'no customer on the case'}</span>
            </span>

            {c.goingTo ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {c.goingTo}
                {/* Typed-in text cannot be rung, invoiced or chased. Marked. */}
                {!c.vendorOnFile && <span className="text-warning"> (not on file)</span>}
                {c.docketNo && <span className="font-mono"> · {c.docketNo}</span>}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                className="shrink-0 text-xs font-semibold text-warning hover:underline"
              >
                Nobody recorded — add the vendor
              </button>
            )}

            <span className={`shrink-0 font-mono text-xs tabular-nums ${c.daysLate > 0 ? 'text-danger' : 'text-muted-foreground'}`}>
              {c.daysOut}d out
            </span>
          </li>
        ))}
      </ul>

      {sorted.length > shown.length && (
        <div className="border-t border-border px-3 py-1.5">
          <Button size="sm" variant="ghost" icon="chevron-down" onClick={() => setShowAll(true)}>
            Show the other {sorted.length - shown.length}
          </Button>
        </div>
      )}
      {showAll && sorted.length > 6 && (
        <div className="border-t border-border px-3 py-1.5">
          <Button size="sm" variant="ghost" icon="chevron-up" onClick={() => setShowAll(false)}>Show fewer</Button>
        </div>
      )}
    </Card>
  );
}
