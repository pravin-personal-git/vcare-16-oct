'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { loadFormOptions, type FormOptions } from '@/app/actions/form-options';
import { Icon } from '@/components/ui/Icon';

type Need = 'buyers' | 'catalogue' | 'leads' | 'parties' | 'stockProducts';

/**
 * Loads a form's picker lists when the form opens, then renders it
 * (health check PERF-2). Cached for the life of the page, so reopening the
 * form is instant; a full reload fetches fresh lists.
 */
const cache = new Map<Need, unknown>();

/** Drop cached lists after a change that makes them wrong - a product's tracking, say. */
export function forgetFormOptions(...needs: Need[]) {
  for (const n of needs) cache.delete(n);
}

export function WithFormOptions({ need, children, onClose }: {
  need: Need[];
  children: (o: Required<FormOptions>) => ReactNode;
  onClose?: () => void;
}) {
  const ready = () => need.every((n) => cache.has(n));
  const [loaded, setLoaded] = useState(ready);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loaded) return;
    let live = true;
    loadFormOptions(need.filter((n) => !cache.has(n)))
      .then((o) => {
        if (o.buyers) cache.set('buyers', o.buyers);
        if (o.catalogue) cache.set('catalogue', o.catalogue);
        if (o.leads) cache.set('leads', o.leads);
        if (o.parties) cache.set('parties', o.parties);
        if (o.stockProducts) cache.set('stockProducts', o.stockProducts);
        if (live) setLoaded(ready());
      })
      .catch(() => { if (live) setError('Could not load the lists for this form. Check the connection and try again.'); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) {
    return (
      <div className="fixed inset-0 z-[200] grid place-items-center bg-navy/40 p-4" role="dialog" aria-modal="true" aria-label="Loading">
        <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg bg-card px-6 py-5 text-center shadow-overlay">
          {error ? (
            <>
              <Icon name="alert-triangle" className="h-6 w-6 text-danger" />
              <p className="text-sm">{error}</p>
              {onClose && <button type="button" onClick={onClose} className="text-sm font-medium text-brand hover:underline">Close</button>}
            </>
          ) : (
            <>
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden />
              <p className="text-sm text-muted-foreground">Loading the form…</p>
            </>
          )}
        </div>
      </div>
    );
  }
  return <>{children({
    buyers: (cache.get('buyers') ?? []) as NonNullable<FormOptions['buyers']>,
    catalogue: (cache.get('catalogue') ?? []) as NonNullable<FormOptions['catalogue']>,
    leads: (cache.get('leads') ?? []) as NonNullable<FormOptions['leads']>,
    parties: (cache.get('parties') ?? []) as NonNullable<FormOptions['parties']>,
    stockProducts: (cache.get('stockProducts') ?? []) as NonNullable<FormOptions['stockProducts']>,
  })}</>;
}
