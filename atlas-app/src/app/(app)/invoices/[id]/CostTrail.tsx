'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card } from '@/components/ui/Layout';
import { formatCurrency } from '@/lib/format';
import type { LineTrail } from '@/server/consolidated-invoice';
import { loadCostTrail } from '../actions';

/**
 * Where every charge on this invoice came from.
 *
 * Pravin's requirement, in his words: the customer's PDF shows the cost and the
 * thing it is being charged for, and an employee can "click all the things and
 * see the trail of what cost came from where and why".
 *
 * Three decisions worth stating:
 *
 * 1. `print:hidden`, and it is not decoration. This panel is the one part of
 *    an invoice the customer must never see; a PDF that quietly carried it
 *    would hand them our order numbers and our supply chain.
 *
 * 2. Loaded on demand rather than with the page. The permission is checked on
 *    the server when the button is pressed, so a user without it never
 *    receives the data at all - not even hidden in the markup, where "hidden"
 *    means "a right-click away". AGENTS.md: hiding is enforced on the server.
 *
 * 3. NOTHING HERE IS PLAIN TEXT. Every document number is a link that lands on
 *    that exact document. A reference somebody has to go and look up by hand
 *    is the thing this was built to replace.
 */
export function CostTrail({ invoiceId, allowed }: { invoiceId: string; allowed: boolean }) {
  const [pending, start] = useTransition();
  const [trail, setTrail] = useState<LineTrail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // No permission, no panel - not a disabled button explaining what they are
  // missing. Somebody who cannot see costs does not need to be told daily that
  // costs exist.
  if (!allowed) return null;

  const open = () => {
    setError(null);
    start(async () => {
      const r = await loadCostTrail(invoiceId);
      if (r.error) { setError(r.error); return; }
      setTrail(r.trail ?? []);
    });
  };

  return (
    <Card className="mt-3 p-4 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="file-text" className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold">Where these costs came from</h3>
        <span className="text-xs text-muted-foreground">
          Internal. Never printed, never on the customer&rsquo;s copy.
        </span>
        <div className="ms-auto">
          {trail === null ? (
            <Button variant="outline" icon="search" onClick={open} loading={pending}>
              Show the trail
            </Button>
          ) : (
            <Button variant="outline" icon="eye-off" onClick={() => setTrail(null)}>
              Hide
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-on-tint-danger">
          {error}
        </p>
      )}

      {trail !== null && trail.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Nothing recorded. This invoice was raised before the trail existed, or
          directly, without a challan or order behind it.
        </p>
      )}

      {trail !== null && trail.length > 0 && (
        <div className="mt-3 space-y-2">
          {trail.map((line) => (
            <div key={line.invoiceItemId} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <p className="text-sm font-medium">{line.productName}</p>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {line.qty} &times;
                </span>
                <span className="ms-auto font-mono text-xs font-semibold tabular-nums">
                  {formatCurrency(line.lineTotalPaise)}
                </span>
              </div>

              {line.entries.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  No source document. Added by hand.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {line.entries.map((e, n) => (
                    <li key={`${e.docNo}-${n}`} className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge tone={e.kind === 'installation_challan' ? 'info' : 'neutral'}>
                        {e.kind === 'installation_challan' ? 'challan' : 'order'}
                      </Badge>
                      {e.href ? (
                        <Link href={e.href} className="font-mono font-semibold text-brand hover:underline">
                          {e.docNo}
                        </Link>
                      ) : (
                        <span className="font-mono font-semibold">{e.docNo}</span>
                      )}
                      <span className="text-muted-foreground">
                        {e.qty} of the {line.qty}
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(e.docDate).toLocaleDateString('en-IN', {
                          timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {line.units.length > 0 && (
                <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">The actual items: </span>
                  {line.units.slice(0, 12).map((u, n) => (
                    <span key={u.id}>
                      {n > 0 && ' · '}
                      <Link
                        href={`/product-journey?unit=${encodeURIComponent(u.id)}`}
                        className="font-mono text-brand hover:underline"
                      >
                        {u.serialNo ?? u.id.slice(-8)}
                      </Link>
                    </span>
                  ))}
                  {line.units.length > 12 && ` · and ${line.units.length - 12} more`}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
