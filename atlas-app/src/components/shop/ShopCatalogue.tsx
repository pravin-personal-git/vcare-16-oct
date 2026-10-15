'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { ShopItem } from '@/server/catalogue';
import type { CartView } from '@/server/shop';
import type { ShopRef } from '@/server/shop-context';
import { addAction } from '@/app/(shop)/shop/actions';
import { KitCard, Notice, ProductCard } from './parts';

/**
 * The shop's main screen. Redesigned in the UI refresh (4 Oct 2026) as a
 * showroom: a hero in the business's own colours with the search in it, a
 * sticky row of sections, ready-made kits first, then every section as its own
 * shelf, and a floating bar to the list once something is in it.
 *
 * THREE THINGS IT NEVER DOES, and each is a decision rather than an omission:
 *   - It never says "out of stock". A camera being out today says nothing about
 *     Thursday, and a shop that turns people away on that basis loses enquiries
 *     the branch could have filled.
 *   - It never shows a total to pay. Decision 11: the price is the product, and
 *     installation is quoted separately.
 *   - It never takes money. The list becomes a request; a person quotes.
 */
type Sort = 'featured' | 'low' | 'high' | 'name';

const KITS = 'Combos';
const SHELF = 8;

export function ShopCatalogue({ shopRef, base, items, categories, cart, signedIn, orgName, customerName = null, stickyTop = '4.25rem' }: {
  shopRef: ShopRef;
  base: string;
  items: ShopItem[];
  categories: string[];
  cart: CartView | null;
  signedIn: boolean;
  orgName: string;
  /** The signed-in customer, for "Welcome back". */
  customerName?: string | null;
  /** Height of the bar above, so the sections row sticks just under it. */
  stickyTop?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('featured');
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // Adds counted here the moment the server says yes, so the button answers
  // at once; cleared when the refreshed list arrives and counts them itself.
  const [justAdded, setJustAdded] = useState<Record<string, number>>({});
  useEffect(() => { setJustAdded({}); }, [cart]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3500);
    return () => clearTimeout(t);
  }, [note]);

  const inList = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart?.lines ?? []) m.set(l.refId, l.qty);
    for (const [id, n] of Object.entries(justAdded)) m.set(id, (m.get(id) ?? 0) + n);
    return m;
  }, [cart, justAdded]);
  const listCount = [...inList.values()].reduce((a, b) => a + b, 0);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if (i.categoryName) m.set(i.categoryName, (m.get(i.categoryName) ?? 0) + 1);
    return m;
  }, [items]);

  const sorted = useMemo(() => {
    const list = [...items];
    if (sort === 'low') list.sort((a, b) => a.pricePaise - b.pricePaise);
    else if (sort === 'high') list.sort((a, b) => b.pricePaise - a.pricePaise);
    else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [items, sort]);

  const q = search.trim().toLowerCase();
  const filtering = !!q || !!category;
  const shown = useMemo(() => sorted.filter((i) => {
    if (category && i.categoryName !== category) return false;
    if (!q) return true;
    return `${i.name} ${i.brandName ?? ''} ${i.blurb ?? ''} ${i.categoryName ?? ''} ${i.contains.join(' ')}`.toLowerCase().includes(q);
  }), [sorted, category, q]);

  const kits = sorted.filter((i) => i.kind === 'combo');
  const shelves = categories.filter((c) => c !== KITS).map((c) => ({
    name: c,
    items: sorted.filter((i) => i.kind !== 'combo' && i.categoryName === c),
  })).filter((s) => s.items.length > 0);
  const loose = sorted.filter((i) => i.kind !== 'combo' && !i.categoryName);
  const showcase = items.filter((i) => i.imageUrls[0]).slice(0, 3);

  const add = (i: ShopItem) => {
    setNote(null);
    start(async () => {
      const r = await addAction(shopRef, i.kind, i.id);
      if (!r.error) setJustAdded((p) => ({ ...p, [i.id]: (p[i.id] ?? 0) + 1 }));
      setNote(r.error ? { tone: 'error', text: r.error } : { tone: 'ok', text: `${i.name} added to your list.` });
      router.refresh();
    });
  };

  const card = (i: ShopItem, n: number) => (
    <ProductCard key={i.id} item={i} index={n} href={`${base}/p/${i.id}`} inList={inList.get(i.id) ?? 0} pending={pending} onAdd={() => add(i)} />
  );
  const grid = 'grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4';
  const first = customerName?.trim().split(/\s+/)[0];
  const promises: [IconName, string][] = [
    ['phone', 'A real person quotes you'],
    ['wrench', 'Fitting priced after a site look'],
    ['lock', 'Nothing is paid online'],
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 pb-24 sm:gap-8">
      {/* ---------- hero ---------- */}
      <section className="shop-hero relative overflow-hidden rounded-[1.75rem] px-5 py-8 sm:px-10 sm:py-12">
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold">
              <span className="shop-live h-2 w-2 rounded-full bg-emerald-300" />
              Taking enquiries today
            </span>
            <h1 className="mt-4 text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
              {first ? <>Welcome back, {first}.</> : orgName}
            </h1>
            <p className="mt-3 max-w-xl text-base text-white/85 sm:text-lg">
              {signedIn
                ? `Add what you need to your list and send it to ${orgName}. They ring you with a quote.`
                : 'Browse what we sell and fit, put together a list, and we ring you back with a quote.'}
            </p>

            <label className="relative mt-6 block max-w-xl" htmlFor="shop-search">
              <span className="sr-only">Search the shop</span>
              <Icon name="search" className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <input
                id="shop-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${items.length} products - cameras, recorders, panels…`}
                className="h-14 w-full rounded-2xl border-0 bg-card ps-12 pe-4 text-base text-foreground shadow-overlay outline-none ring-4 ring-white/15 placeholder:text-muted-foreground focus:ring-white/40"
              />
            </label>

            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-white/90">
              {promises.map(([icon, text]) => (
                <li key={text} className="inline-flex items-center gap-1.5">
                  <Icon name={icon} className="h-4 w-4 text-white/70" />
                  {text}
                </li>
              ))}
            </ul>
          </div>

          {/* A fanned stack of real product photos, when there are any. */}
          {showcase.length > 0 && (
            <div className="relative hidden h-72 lg:block" aria-hidden="true">
              {showcase.map((i, n) => (
                <div
                  key={i.id}
                  className="absolute w-48 overflow-hidden rounded-3xl border border-white/25 bg-card p-3 shadow-overlay"
                  style={{
                    insetInlineStart: `${12 + n * 26}%`,
                    top: `${n === 1 ? 0 : 14}%`,
                    transform: `rotate(${[-8, 3, 10][n]}deg)`,
                    zIndex: n === 1 ? 3 : 2 - n,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted product image */}
                  <img src={i.imageUrls[0]} alt="" className="aspect-square w-full rounded-2xl object-contain" />
                  <p className="mt-2 truncate px-1 text-xs font-bold text-foreground">{i.name}</p>
                </div>
              ))}
            </div>
          )}
          {showcase.length === 0 && (
            <div className="hidden gap-3 lg:grid lg:grid-cols-2" aria-hidden="true">
              {categories.slice(0, 4).map((c) => (
                <div key={c} className="rounded-2xl border border-white/15 bg-white/10 p-4">
                  <p className="text-3xl font-extrabold tabular-nums">{counts.get(c) ?? 0}</p>
                  <p className="mt-1 line-clamp-2 text-sm font-semibold text-white/85">{c}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---------- sections, sticky ---------- */}
      <div style={{ top: stickyTop }} className="sticky z-30 -mx-4 border-y border-border/60 bg-background/95 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="scrollbar-none -my-1 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1" role="group" aria-label="Sections">
            {['', ...categories].map((c) => {
              const on = category === c;
              return (
                <button
                  key={c || 'all'}
                  type="button"
                  aria-pressed={on}
                  onClick={() => { setCategory(c); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-bold transition ${
                    on ? 'btn-depth border-transparent bg-brand text-brand-fg' : 'border-border bg-card text-foreground hover:border-brand/40 hover:text-brand'
                  }`}
                >
                  {c || 'Everything'}
                  <span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? 'bg-white/20' : 'bg-muted text-muted-foreground'}`}>
                    {c ? counts.get(c) ?? 0 : items.length}
                  </span>
                </button>
              );
            })}
          </div>
          <label className="shrink-0" htmlFor="shop-sort">
            <span className="sr-only">Sort</span>
            <select
              id="shop-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="h-10 w-[6.75rem] rounded-full border border-border bg-card px-3 text-sm font-semibold outline-none focus:border-brand sm:w-auto"
            >
              <option value="featured">Featured</option>
              <option value="low">Price: low to high</option>
              <option value="high">Price: high to low</option>
              <option value="name">Name A-Z</option>
            </select>
          </label>
        </div>
      </div>

      {note && (
        <div className="fixed inset-x-0 top-20 z-50 mx-auto w-fit max-w-[calc(100%-2rem)] shadow-overlay">
          <Notice tone={note.tone}>{note.text}</Notice>
        </div>
      )}

      {/* ---------- the goods ---------- */}
      {items.length === 0 ? (
        <Empty title="Nothing on the shop yet" hint={`Please ring ${orgName} - they will know what is available.`} />
      ) : filtering ? (
        <section className="grid gap-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-h2 font-extrabold tracking-tight">
              {category || 'Results'}
              {q && <span className="font-semibold text-muted-foreground"> for &ldquo;{search.trim()}&rdquo;</span>}
            </h2>
            <span className="text-sm font-semibold text-muted-foreground">{shown.length} found</span>
          </div>
          {shown.length === 0
            ? <Empty title="Nothing matches" hint="Try another word, or tap Everything." />
            : <div className={grid}>{shown.map(card)}</div>}
        </section>
      ) : (
        <>
          {kits.length > 0 && (
            <section className="grid gap-4">
              <ShelfHead title="Ready-made kits" hint="Everything for one job, in one go." count={kits.length}
                onAll={kits.length > 4 ? () => setCategory(KITS) : undefined} />
              <div className="grid gap-4 lg:grid-cols-2">
                {kits.slice(0, 4).map((i) => (
                  <KitCard key={i.id} item={i} href={`${base}/p/${i.id}`} inList={inList.get(i.id) ?? 0} pending={pending} onAdd={() => add(i)} />
                ))}
              </div>
            </section>
          )}
          {shelves.map((s) => (
            <section key={s.name} className="grid gap-4">
              <ShelfHead title={s.name} count={s.items.length} onAll={s.items.length > SHELF ? () => setCategory(s.name) : undefined} />
              <div className={grid}>{s.items.slice(0, SHELF).map(card)}</div>
            </section>
          ))}
          {loose.length > 0 && (
            <section className="grid gap-4">
              <ShelfHead title="More" count={loose.length} />
              <div className={grid}>{loose.map(card)}</div>
            </section>
          )}
        </>
      )}

      {/* ---------- service ---------- */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-5 sm:p-7">
        <div className="pointer-events-none absolute -end-16 -top-16 h-56 w-56 rounded-full bg-brand/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand/10 text-on-tint-brand">
            <Icon name="wrench" className="h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-extrabold">Something already fitted not working?</h3>
            <p className="text-sm text-muted-foreground">Tell {orgName} what is wrong and where - they ring you to arrange a visit.</p>
          </div>
          <Link
            href={`${base}/list?want=visit`}
            className="btn-depth inline-flex items-center gap-2 rounded-full bg-brand px-5 py-3 text-sm font-extrabold text-brand-fg hover:bg-brand-hover"
          >
            Ask for a service visit <Icon name="arrow-right" className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ---------- floating list bar ---------- */}
      {listCount > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 px-4" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <Link
            href={`${base}/list`}
            className="shop-rise mx-auto flex w-full max-w-md items-center gap-3 rounded-full bg-foreground py-2 pe-2 ps-5 text-background shadow-overlay transition hover:scale-[1.01]"
          >
            <Icon name="bag" className="h-5 w-5" />
            <span className="min-w-0 flex-1 truncate text-sm font-bold">
              {listCount} {listCount === 1 ? 'item' : 'items'} in your list
            </span>
            <span className="btn-depth inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-extrabold text-brand-fg">
              Review &amp; send <Icon name="arrow-right" className="h-4 w-4" />
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}

function ShelfHead({ title, hint, count, onAll }: { title: string; hint?: string; count: number; onAll?: () => void }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-h2 font-extrabold tracking-tight">
          {title} <span className="text-base font-bold text-muted-foreground tabular-nums">{count}</span>
        </h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {onAll && (
        <button
          type="button"
          onClick={() => { onAll(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-bold text-brand transition hover:bg-brand/10"
        >
          See all <Icon name="arrow-right" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="grid place-items-center gap-2 rounded-3xl border border-dashed border-border bg-card px-4 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-brand/10 text-on-tint-brand"><Icon name="search" className="h-6 w-6" /></span>
      <p className="text-lg font-bold">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
