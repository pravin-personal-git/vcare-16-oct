'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SectionCard } from '@/components/ui/Layout';
import { setAmcRevenueModeAction } from './actions';

/**
 * How AMC fees become income - per business (decision 3, 25 Sep 2026).
 * Changing it affects AMC invoices issued from now on; earlier ones keep the
 * treatment they were posted with.
 */
export function AmcRevenueSetting({ mode, canEdit }: { mode: 'spread' | 'at_invoice'; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(mode);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const choose = (m: 'spread' | 'at_invoice') => {
    if (!canEdit || m === value) return;
    setValue(m);
    start(async () => {
      const r = await setAmcRevenueModeAction(m);
      if (r.error) { setError(r.error); setValue(value); return; }
      router.refresh();
    });
  };
  const options = [
    { key: 'spread' as const, title: 'Spread month by month (recommended)', body: 'The fee is held in "AMC Received in Advance" and moved to "AMC Income" one month at a time over the contract. This is what an auditor expects.' },
    { key: 'at_invoice' as const, title: 'Book it all when invoiced', body: 'The whole fee is "AMC Income" on the day the AMC invoice is issued. Simpler, but a 12-month contract shows as one month\'s income.' },
  ];
  return (
    <SectionCard title="AMC income" icon="refresh" className="mb-4">
      <div role="radiogroup" aria-label="How AMC income is booked" className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <button
            key={o.key} type="button" role="radio" aria-checked={value === o.key} disabled={!canEdit || pending}
            onClick={() => choose(o.key)}
            className={`rounded-lg border p-3 text-start transition disabled:cursor-default ${value === o.key ? 'border-brand bg-brand/[0.06]' : 'border-border hover:bg-muted'}`}
          >
            <p className="text-sm font-semibold">{o.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{o.body}</p>
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <p className="mt-2 text-xs text-muted-foreground">Applies to AMC invoices issued from now on. Earlier invoices keep the treatment they were posted with.</p>
    </SectionCard>
  );
}
