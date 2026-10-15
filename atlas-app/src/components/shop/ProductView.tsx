'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { ShopItem } from '@/server/catalogue';
import type { ShopRef } from '@/server/shop-context';
import { addAction, reviewAction, viewedAction, wishlistAction } from '@/app/(shop)/shop/actions';
import type { ReviewSummary } from '@/server/shop-extras';
import { AddButton, Notice, PicturePlaceholder, ProductCard, readyText, rupees, warrantyText } from './parts';

/**
 * One product on its own page: a large photo stage, a buy panel that stays in
 * view, plain facts, and more from the same section (UI refresh, 4 Oct 2026).
 */
export function ProductView({
  shopRef, base, item, inList, related = [], listed = {},
  alsoViewed = [], reviews = { average: null, count: 0, reviews: [] }, myReview = null, canReview = false, saved = false, registerHref = null,
}: {
  shopRef: ShopRef;
  base: string;
  item: ShopItem;
  inList: number;
  /** A few more from the same section. */
  related?: ShopItem[];
  /** What is already in the list, by item id, for the related cards. */
  listed?: Record<string, number>;
  /** Viewed in the same visits by other customers (5 Oct 2026). */
  alsoViewed?: ShopItem[];
  /** Approved reviews only. */
  reviews?: ReviewSummary;
  /** The signed-in customer's own review, any status. */
  myReview?: { rating: number; body: string | null; status: string } | null;
  /** A signed-in customer may write one. */
  canReview?: boolean;
  /** Saved for later (the heart). */
  saved?: boolean;
  /** Where a visitor registers, to be able to review. */
  registerHref?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pic, setPic] = useState(0);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // A page view is the one thing the shop counts about looking. Fire and
  // forget, once per product: adding to the list refreshes the page, and that
  // is not a second look.
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (counted.current === item.id) return;
    counted.current = item.id;
    void viewedAction(shopRef, item.kind, item.id);
  }, [shopRef, item.kind, item.id]);

  const add = (target: ShopItem) => {
    setNote(null);
    start(async () => {
      const r = await addAction(shopRef, target.kind, target.id);
      setNote(r.error ? { tone: 'error', text: r.error } : { tone: 'ok', text: `${target.name} added to your list.` });
      router.refresh();
    });
  };

  const [isSaved, setSaved] = useState(saved);
  const toggleSave = () => {
    start(async () => {
      const r = await wishlistAction(shopRef, item.id);
      if (r.error) setNote({ tone: 'error', text: r.error });
      else setSaved(!!r.saved);
    });
  };

  const facts: [IconName, string, string][] = [];
  const w = warrantyText(item.warrantyMonths);
  if (w) facts.push(['shield-check', 'Warranty', w.replace(/ warranty$/, '')]);
  const ready = readyText(item);
  if (ready) facts.push(['clock', 'Ready', ready.replace(/^Usually ready in |^Delivery: /, '')]);
  if (item.brandName) facts.push(['tag', 'Brand', item.brandName]);
  if (item.categoryName) facts.push(['grid', 'Section', item.categoryName]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 pb-28 lg:pb-10">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground" aria-label="Where you are">
        <Link href={base} className="font-semibold text-brand hover:underline">Shop</Link>
        {item.categoryName && (<><Icon name="chevron-right" className="h-3.5 w-3.5" /><span>{item.categoryName}</span></>)}
        <Icon name="chevron-right" className="h-3.5 w-3.5" />
        <span className="truncate font-semibold text-foreground">{item.name}</span>
      </nav>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
        <div className="grid content-start gap-3">
          <div className="relative overflow-hidden rounded-[1.75rem] border border-border">
            {item.imageUrls[pic] ? (
              <div className="shop-photo">
                {/* eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted product image */}
                <img src={item.imageUrls[pic]} alt={item.name} className="aspect-square w-full object-contain p-8" />
              </div>
            ) : (
              <PicturePlaceholder item={item} className="aspect-square w-full" />
            )}
            {item.offerLabel && (
              <span className="absolute start-4 top-4 rounded-full bg-brand px-3 py-1 text-sm font-extrabold text-brand-fg shadow-brand">
                {item.offerLabel}
              </span>
            )}
          </div>
          {item.imageUrls.length > 1 && (
            <div className="scrollbar-none flex gap-2 overflow-x-auto">
              {item.imageUrls.map((u, i) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setPic(i)}
                  aria-label={`Photo ${i + 1}`}
                  aria-pressed={pic === i}
                  className={`shop-photo h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2 transition ${pic === i ? 'border-brand' : 'border-border hover:border-brand/40'}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted product image */}
                  <img src={u} alt="" className="h-full w-full object-contain p-1.5" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="grid gap-4 rounded-[1.75rem] border border-border bg-card p-5 shadow-card sm:p-7">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {item.brandName && <span className="text-micro font-extrabold uppercase text-brand">{item.brandName}</span>}
                <h1 className="text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">{item.name}</h1>
                {reviews.count > 0 && (
                  <a href="#reviews" className="mt-1 inline-flex items-center gap-1.5 text-sm hover:underline">
                    <Stars value={reviews.average ?? 0} /> <span className="font-bold">{reviews.average}</span>
                    <span className="text-muted-foreground">({reviews.count} review{reviews.count === 1 ? '' : 's'})</span>
                  </a>
                )}
              </div>
              {item.kind === 'product' && (
                <button type="button" onClick={toggleSave} disabled={pending} aria-pressed={isSaved}
                  aria-label={isSaved ? 'Remove from saved' : 'Save for later'} title={isSaved ? 'Saved' : 'Save for later'}
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 text-xl transition ${isSaved ? 'border-danger bg-danger/10 text-danger' : 'border-border text-muted-foreground hover:border-danger/50 hover:text-danger'}`}>
                  <span aria-hidden>{isSaved ? '\u2665' : '\u2661'}</span>
                </button>
              )}
            </div>
            <div>
              <p className="text-4xl font-extrabold tabular-nums tracking-tight">{rupees(item.pricePaise)}</p>
              <p className="mt-1 text-sm text-muted-foreground">Product only</p>
            </div>

            <p className="flex gap-2.5 rounded-2xl bg-warning/10 px-4 py-3 text-sm">
              <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span><strong>Fitting is quoted separately.</strong> Cable, fitting and travel are priced after a look at your site.</span>
            </p>

            {note && <Notice tone={note.tone}>{note.text}</Notice>}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => add(item)}
                className="btn-depth inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-brand px-6 text-base font-extrabold text-brand-fg transition hover:bg-brand-hover active:scale-[0.99] disabled:opacity-60"
              >
                <Icon name={inList ? 'check' : 'plus'} className="h-5 w-5" strokeWidth={2.75} />
                {inList ? `In my list (${inList}) · add one more` : 'Add to my list'}
              </button>
              {inList > 0 && (
                <Link href={`${base}/list`} className="inline-flex h-12 items-center gap-2 rounded-full border-2 border-brand px-5 text-base font-extrabold text-brand hover:bg-brand/10">
                  <Icon name="bag" className="h-5 w-5" /> My list
                </Link>
              )}
            </div>

            {facts.length > 0 && (
              <dl className="grid grid-cols-2 gap-2">
                {facts.map(([icon, k, v]) => (
                  <div key={k} className="rounded-2xl border border-border bg-background px-3.5 py-3">
                    <dt className="flex items-center gap-1.5 text-micro font-extrabold uppercase text-muted-foreground">
                      <Icon name={icon} className="h-3.5 w-3.5" /> {k}
                    </dt>
                    <dd className="mt-1 truncate text-sm font-bold">{v}</dd>
                  </div>
                ))}
              </dl>
            )}

            {item.blurb && <p className="text-base leading-relaxed text-foreground/90">{item.blurb}</p>}
            {item.contains.length > 0 && (
              <div>
                <p className="eyebrow mb-2">In this kit</p>
                <ul className="grid gap-1.5">
                  {item.contains.map((c) => (
                    <li key={c} className="flex items-center gap-2 text-sm font-medium">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-success/15 text-on-tint-success"><Icon name="check" className="h-3 w-3" strokeWidth={3} /></span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {item.kind === 'product' && (
        <Reviews shopRef={shopRef} listingId={item.id} reviews={reviews} mine={myReview} canReview={canReview} registerHref={registerHref} />
      )}

      {related.length > 0 && (
        <section className="grid gap-4">
          <h2 className="text-h2 font-extrabold tracking-tight">Similar {item.categoryName ? `in ${item.categoryName}` : 'products'}</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {related.map((r, n) => (
              <ProductCard
                key={r.id}
                item={r}
                index={n}
                href={`${base}/p/${r.id}`}
                inList={listed[r.id] ?? 0}
                pending={pending}
                onAdd={() => add(r)}
              />
            ))}
          </div>
        </section>
      )}

      {alsoViewed.length > 0 && (
        <section className="grid gap-4">
          <h2 className="text-h2 font-extrabold tracking-tight">People who looked at this also looked at</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {alsoViewed.map((r, n) => (
              <ProductCard key={r.id} item={r} index={n} href={`${base}/p/${r.id}`} inList={listed[r.id] ?? 0} pending={pending} onAdd={() => add(r)} />
            ))}
          </div>
        </section>
      )}

      {/* On a phone the add button follows you down the page. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 lg:hidden" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{item.name}</p>
            <p className="text-lg font-extrabold tabular-nums">{rupees(item.pricePaise)}</p>
          </div>
          <AddButton inList={inList} pending={pending} onAdd={() => add(item)} name={item.name} size="lg" />
        </div>
      </div>
    </div>
  );
}

/** Five stars, filled to the nearest half. */
function Stars({ value, size = 'text-base' }: { value: number; size?: string }) {
  return (
    <span className={`inline-flex ${size} leading-none text-warning`} aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => <span key={n} aria-hidden>{value >= n - 0.25 ? '\u2605' : '\u2606'}</span>)}
    </span>
  );
}

/**
 * Reviews (5 Oct 2026): approved ones for everybody, a form for a signed-in
 * customer. A new or changed review shows only after the shop approves it.
 */
function Reviews({ shopRef, listingId, reviews, mine, canReview, registerHref }: {
  shopRef: ShopRef; listingId: string; reviews: ReviewSummary;
  mine: { rating: number; body: string | null; status: string } | null; canReview: boolean; registerHref: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [body, setBody] = useState(mine?.body ?? '');
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const send = () => start(async () => {
    const r = await reviewAction(shopRef, listingId, rating, body);
    setNote(r.error ? { tone: 'error', text: r.error } : { tone: 'ok', text: r.message ?? 'Thank you.' });
    if (!r.error) router.refresh();
  });
  const when = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <section id="reviews" className="grid scroll-mt-24 gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-h2 font-extrabold tracking-tight">Reviews</h2>
        {reviews.count > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm"><Stars value={reviews.average ?? 0} /> <strong>{reviews.average}</strong> from {reviews.count}</span>
        )}
      </div>

      {reviews.count === 0 && <p className="text-sm text-muted-foreground">No reviews yet.</p>}
      <ul className="grid gap-3">
        {reviews.reviews.map((r) => (
          <li key={r.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Stars value={r.rating} /> <strong>{r.authorName}</strong>
              <span className="text-muted-foreground">{when(r.createdAt)}</span>
            </div>
            {r.body && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{r.body}</p>}
            {r.reply && (
              <p className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-sm"><strong>Reply from the shop:</strong> {r.reply}</p>
            )}
          </li>
        ))}
      </ul>

      {canReview ? (
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-bold">{mine ? 'Your review' : 'Write a review'}</p>
          {mine?.status === 'pending' && <p className="text-xs text-muted-foreground">Waiting for the shop to approve it.</p>}
          {mine?.status === 'hidden' && <p className="text-xs text-muted-foreground">The shop has not published this one. You can change it and send it again.</p>}
          <div className="flex gap-1 text-3xl" role="radiogroup" aria-label="Your rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`}
                onClick={() => setRating(n)} className={rating >= n ? 'text-warning' : 'text-muted-foreground/40 hover:text-warning/60'}>
                {rating >= n ? '\u2605' : '\u2606'}
              </button>
            ))}
          </div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000}
            placeholder="What did you like or not? (optional)" className="field-input" />
          {note && <Notice tone={note.tone}>{note.text}</Notice>}
          <button type="button" disabled={pending || rating === 0} onClick={send}
            className="btn-depth inline-flex h-11 w-fit items-center rounded-full bg-brand px-6 text-sm font-extrabold text-brand-fg disabled:opacity-60">
            {mine ? 'Update review' : 'Send review'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Bought this?{' '}
          {registerHref ? <Link href={registerHref} className="font-bold text-brand hover:underline">Register or sign in</Link> : 'Sign in'}
          {' '}to write a review.
        </p>
      )}
    </section>
  );
}
