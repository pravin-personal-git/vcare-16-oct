'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, EmptyState, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { whatsappLink } from '@/lib/revenue';
import { decideReviewAction } from './actions';

export interface ReviewVM {
  id: string; productName: string; authorName: string; customerPhone: string | null;
  rating: number; body: string | null; status: string; reply: string | null; createdAt: string;
}
export interface InterestedVM {
  partyId: string; name: string; phone: string | null; looked: string[]; added: string[]; saved: string[]; lastSeen: string;
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });

/**
 * The shop's people side (5 Oct 2026): reviews waiting for approval, the
 * customers who showed interest and did not ask, and what is saved most.
 */
export function ShopInsights({ reviews, interested, wishlisted, canEdit }: {
  reviews: ReviewVM[];
  interested: InterestedVM[];
  wishlisted: { listingId: string; productName: string; saves: number }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const pendingCount = reviews.filter((r) => r.status === 'pending').length;

  const act = (id: string, input: { status?: 'approved' | 'hidden'; reply?: string | null }) => start(async () => {
    const r = await decideReviewAction(id, input);
    setMsg(r.error ?? r.message ?? null);
    if (!r.error) { setReplying(null); setReply(''); router.refresh(); }
  });

  return (
    <div className="mt-4 grid gap-4">
      {msg && <p role="status" className="text-sm text-muted-foreground">{msg}</p>}

      <SectionCard title={`Reviews${pendingCount ? ` - ${pendingCount} waiting` : ''}`} icon="check-circle" bodyClassName="p-0">
        <p className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          Customers who registered on the shop can review a product. A review shows on the shop only after you publish it; you can also reply in public.
        </p>
        {reviews.length === 0 ? (
          <EmptyState icon="check-circle" title="No reviews yet" hint="They appear here as customers write them." />
        ) : (
          <ul>
            {reviews.map((r) => (
              <li key={r.id} className="border-b border-border px-4 py-3 last:border-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-warning" aria-label={`${r.rating} out of 5`}>{stars(r.rating)}</span>
                  <strong>{r.productName}</strong>
                  <span className="text-muted-foreground">by {r.authorName}{r.customerPhone ? ` · ${r.customerPhone}` : ''} · {day(r.createdAt)}</span>
                  <Badge tone={r.status === 'approved' ? 'success' : r.status === 'hidden' ? 'neutral' : 'warning'}>
                    {r.status === 'approved' ? 'Published' : r.status === 'hidden' ? 'Hidden' : 'Waiting'}
                  </Badge>
                </div>
                {r.body && <p className="mt-1.5 whitespace-pre-line text-sm">{r.body}</p>}
                {r.reply && <p className="mt-1.5 rounded bg-muted/50 px-2 py-1 text-xs"><strong>Your reply:</strong> {r.reply}</p>}
                {canEdit && (
                  replying === r.id ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1000} placeholder="Public reply"
                        className="field-input h-9 min-w-[16rem] flex-1" />
                      <Button size="sm" variant="primary" disabled={pending} onClick={() => act(r.id, { reply })}>Save reply</Button>
                      <Button size="sm" onClick={() => setReplying(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.status !== 'approved' && <Button size="sm" variant="primary" disabled={pending} onClick={() => act(r.id, { status: 'approved' })}>Publish</Button>}
                      {r.status !== 'hidden' && <Button size="sm" disabled={pending} onClick={() => act(r.id, { status: 'hidden' })}>Hide</Button>}
                      <Button size="sm" disabled={pending} onClick={() => { setReplying(r.id); setReply(r.reply ?? ''); }}>{r.reply ? 'Edit reply' : 'Reply'}</Button>
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={`Interested, but did not ask (${interested.length})`} icon="users" bodyClassName="p-0">
        <p className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          Registered customers who looked at, added or saved products in the last 30 days and sent no enquiry after. Visitors who never registered are only counted, never named.
        </p>
        {interested.length === 0 ? (
          <EmptyState icon="users" title="Nobody to follow up" hint="Customers who show interest without asking appear here." />
        ) : (
          <ul>
            {interested.map((p) => (
              <li key={p.partyId} className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3 last:border-0">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">{p.name} <span className="font-normal text-muted-foreground">· last seen {day(p.lastSeen)}</span></p>
                  {p.added.length > 0 && <p className="text-xs"><strong>Added to list:</strong> {p.added.join(', ')}</p>}
                  {p.saved.length > 0 && <p className="text-xs"><strong>Saved:</strong> {p.saved.join(', ')}</p>}
                  {p.looked.length > 0 && <p className="text-xs text-muted-foreground"><strong>Looked at:</strong> {p.looked.slice(0, 6).join(', ')}{p.looked.length > 6 ? ` +${p.looked.length - 6}` : ''}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {p.phone && (
                    <a className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted" target="_blank" rel="noreferrer"
                      href={whatsappLink(p.phone, `Hello ${p.name.split(' ')[0]}, thank you for looking at ${[...p.added, ...p.saved, ...p.looked][0] ?? 'our products'} on our shop. Can we help you with a price or a visit?`)}>
                      WhatsApp
                    </a>
                  )}
                  {p.phone && <a className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted" href={`tel:${p.phone}`}>Call</a>}
                  <a className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted" href={`/customers/${p.partyId}`}>Customer</a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {wishlisted.length > 0 && (
        <SectionCard title="Saved most (wishlist)" icon="tag" bodyClassName="p-0">
          <ul>
            {wishlisted.map((w) => (
              <li key={w.listingId} className="flex items-center justify-between border-b border-border px-4 py-2 text-sm last:border-0">
                <span>{w.productName}</span><span className="tabular-nums text-muted-foreground">{w.saves} saved</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
