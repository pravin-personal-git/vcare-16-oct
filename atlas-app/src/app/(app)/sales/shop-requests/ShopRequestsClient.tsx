'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ShopRequestRow } from '@/server/shop-requests';
import { Badge, EmptyState, PageHeader, Segmented } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { pickUpAction } from './actions';

/**
 * The shop requests list (13 Oct 2026). One card per request: who, buy or
 * visit, what was in their list, what they wrote, and where it stands - New
 * (nobody has it), Picked up (by whom), Closed. A buy request is picked up
 * here ("I'll take it" - its lead becomes yours); a visit is assigned from
 * the job, like any complaint.
 */
type Filter = 'new' | 'all' | 'buy' | 'visit';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });

export function ShopRequestsClient({ rows, me, canPickUp }: { rows: ShopRequestRow[]; me: string; canPickUp: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<Filter>(rows.some((r) => r.state === 'new') ? 'new' : 'all');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const shown = useMemo(() => rows.filter((r) => filter === 'all' || (filter === 'new' ? r.state === 'new' : r.kind === filter)), [rows, filter]);
  const count = (f: Filter) => rows.filter((r) => f === 'all' || (f === 'new' ? r.state === 'new' : r.kind === f)).length;

  const pickUp = (r: ShopRequestRow) => start(async () => {
    setMsg(null);
    const res = await pickUpAction(r.id);
    if (res.error) { setMsg({ tone: 'danger', text: res.error }); return; }
    setMsg({ tone: 'success', text: `${r.customer.name}'s request is yours, ${me.split(' ')[0]}. Ring them with a quote.` });
    router.refresh();
  });

  return (
    <div className="grid gap-4">
      <PageHeader badge="bag" title="Shop requests" subtitle="What customers asked for in the online shop - to buy, or for a visit. New ones ring the bell." />
      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'new', label: `New ${count('new')}` },
          { value: 'buy', label: `Want to buy ${count('buy')}` },
          { value: 'visit', label: `Need a visit ${count('visit')}` },
          { value: 'all', label: `All ${count('all')}` },
        ]}
      />
      {msg && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${msg.tone === 'success' ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'}`}>{msg.text}</p>
      )}
      {shown.length === 0 ? (
        <EmptyState icon="bag" title={filter === 'new' ? 'Nothing new' : 'No shop requests yet'} hint="When a customer sends their list from the online shop, it appears here and the bell rings." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {shown.map((r) => (
            <article key={r.id} className={`grid gap-2 rounded-xl border bg-card p-4 shadow-card ${r.state === 'new' ? 'border-brand/40' : 'border-border'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`grid h-9 w-9 place-items-center rounded-lg ${r.kind === 'buy' ? 'bg-brand/10 text-brand' : 'bg-warning/10 text-warning'}`}>
                  <Icon name={r.kind === 'buy' ? 'bag' : 'wrench'} className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{r.customer.name}</p>
                  <p className="text-xs text-muted-foreground">{r.kind === 'buy' ? 'Wants to buy' : 'Needs a visit'} · {when(r.at)}{r.customer.phone ? ` · ${r.customer.phone}` : ''}</p>
                </div>
                {r.state === 'new' ? <Badge tone="brand">New</Badge> : r.state === 'closed' ? <Badge tone="neutral">Closed</Badge> : <Badge tone="success">{r.ownerName ? `With ${r.ownerName}` : 'Picked up'}</Badge>}
              </div>
              {r.items.length > 0 && (
                <ul className="grid gap-0.5 text-sm">
                  {r.items.map((i, k) => <li key={k}>{i.qty} × {i.name}</li>)}
                  {r.goodsPaise > 0 && <li className="text-xs text-muted-foreground">Goods only {formatCurrency(r.goodsPaise)}</li>}
                </ul>
              )}
              {r.message && <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">&ldquo;{r.message}&rdquo;</p>}
              <div className="flex flex-wrap items-center gap-2">
                {r.lead && <Link href={`/crm/leads?open=${r.lead.id}`} className="text-xs font-semibold text-brand hover:underline">Lead {r.lead.code}</Link>}
                {r.complaint && <Link href={`/services/complaints/${r.complaint.id}`} className="text-xs font-semibold text-brand hover:underline">Job {r.complaint.no}</Link>}
                {r.customer.id && <Link href={`/customers/${r.customer.id}`} className="text-xs font-semibold text-brand hover:underline">Customer</Link>}
                <span className="flex-1" />
                {r.kind === 'buy' && r.state === 'new' && canPickUp && (
                  <Button size="sm" variant="primary" loading={pending} onClick={() => pickUp(r)}>I&rsquo;ll take it</Button>
                )}
                {r.kind === 'visit' && r.state === 'new' && r.complaint && (
                  <Link href={`/services/complaints/${r.complaint.id}`} className="rounded-md border border-brand px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10">Assign a technician</Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
