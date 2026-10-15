'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import type { ShopItem } from '@/server/catalogue';
import { readyText, rupees, warrantyText } from '@/lib/shop-format';

/**
 * Shared pieces of the shop. First built 3 Oct 2026 from the mock-up Pravin
 * approved; redesigned in the UI refresh (4 Oct 2026) - a showroom look:
 * square photo stages, cards that lift, a round add button that turns into the
 * count once something is in the list.
 *
 * Coloured from the business's own theme tokens - `navy` is its deep brand
 * colour, `brand` its primary - so Vcare's shop is Vcare's colours and
 * N.A.I.R.'s is N.A.I.R.'s, with nothing per-client in this code.
 */

export { rupees, readyText, warrantyText } from '@/lib/shop-format';

/**
 * Where a photo will be. Not "No picture" in grey: until a business's photos
 * arrive most cards are this, so it has to look intended - the brand tint, an
 * icon and the product's initials.
 */
export function PicturePlaceholder({ item, className = '' }: { item: ShopItem; className?: string }) {
  const initials = (item.brandName ?? item.name).split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div className={`shop-ph grid place-items-center ${className}`} aria-hidden="true">
      <div className="grid place-items-center gap-2 text-brand">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-card/80 shadow-card">
          <Icon name={item.kind === 'combo' ? 'package' : 'camera'} className="h-7 w-7" />
        </span>
        <span className="text-xs font-extrabold tracking-[0.2em] opacity-70">{initials}</span>
      </div>
    </div>
  );
}

/** The photo, on a soft stage; zooms a little when the card is hovered. */
function Photo({ item, className = '' }: { item: ShopItem; className?: string }) {
  return item.imageUrls[0] ? (
    <div className={`shop-photo overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted product image */}
      <img
        src={item.imageUrls[0]}
        alt={item.name}
        loading="lazy"
        className="h-full w-full object-contain p-5 transition duration-500 group-hover:scale-[1.06]"
      />
    </div>
  ) : (
    <PicturePlaceholder item={item} className={className} />
  );
}

/** The round add button: a plus, then the count with a tick once added. */
export function AddButton({ inList, pending, onAdd, name, size = 'md' }: {
  inList: number;
  pending: boolean;
  onAdd: () => void;
  name: string;
  size?: 'md' | 'lg';
}) {
  const big = size === 'lg';
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onAdd}
      aria-label={inList ? `${name}: ${inList} in your list. Add one more` : `Add ${name} to your list`}
      title={inList ? 'In your list - add one more' : 'Add to my list'}
      className={`btn-depth inline-flex shrink-0 items-center justify-center gap-1 rounded-full bg-brand font-extrabold text-brand-fg transition hover:bg-brand-hover active:scale-95 disabled:opacity-60 ${
        inList ? (big ? 'h-12 px-5 text-base' : 'h-10 px-3.5 text-sm') : big ? 'h-12 w-12' : 'h-10 w-10'
      }`}
    >
      {inList ? (
        <>
          <Icon name="check" className="h-4 w-4" strokeWidth={3} />
          <span className="tabular-nums">{inList}</span>
          <Icon name="plus" className="h-3.5 w-3.5 opacity-80" strokeWidth={3} />
        </>
      ) : (
        <Icon name="plus" className={big ? 'h-5 w-5' : 'h-[18px] w-[18px]'} strokeWidth={2.75} />
      )}
    </button>
  );
}

export function ProductCard({ item, href, inList, pending, onAdd, compact, index = 0 }: {
  item: ShopItem;
  href: string;
  inList: number;
  pending: boolean;
  onAdd: () => void;
  compact?: boolean;
  /** Position in the grid, for a short staggered entrance. */
  index?: number;
}) {
  const ready = readyText(item);
  const warranty = warrantyText(item.warrantyMonths);
  return (
    <article
      className="shop-rise group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card transition duration-300 hover:-translate-y-1 hover:border-brand/30 hover:shadow-raised"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <Link href={href} className="relative block" aria-label={item.name}>
        <Photo item={item} className="aspect-square w-full" />
        {item.offerLabel && !compact && (
          <span className="absolute start-3 top-3 rounded-full bg-brand px-2.5 py-1 text-xs font-extrabold text-brand-fg shadow-brand">
            {item.offerLabel}
          </span>
        )}
        {warranty && !compact && (
          <span className="absolute bottom-3 start-3 inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/95 px-2 py-0.5 text-xs font-bold text-foreground">
            <Icon name="shield-check" className="h-3.5 w-3.5 text-success" />
            {warranty}
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3.5 sm:p-4">
        {item.brandName && (
          <span className="text-micro font-extrabold uppercase text-brand">{item.brandName}</span>
        )}
        <Link href={href} className="line-clamp-2 text-sm font-bold leading-snug text-foreground hover:text-brand sm:text-base">
          {item.name}
        </Link>
        {item.kind === 'combo' && item.contains.length > 0 && !compact && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{item.contains.join(' · ')}</p>
        )}
        {ready && !compact && (
          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Icon name="clock" className="h-3.5 w-3.5" />
            {ready}
          </p>
        )}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold tabular-nums text-foreground sm:text-xl">{rupees(item.pricePaise)}</p>
            <p className="text-xs text-muted-foreground">product only</p>
          </div>
          <AddButton inList={inList} pending={pending} onAdd={onAdd} name={item.name} />
        </div>
      </div>
    </article>
  );
}

/**
 * A ready-made kit (a combo), wide: photo on one side, what is in it as chips
 * on the other. Kits are what most first-time buyers want, so they lead.
 */
export function KitCard({ item, href, inList, pending, onAdd }: {
  item: ShopItem;
  href: string;
  inList: number;
  pending: boolean;
  onAdd: () => void;
}) {
  return (
    <article className="shop-rise group grid min-w-0 overflow-hidden rounded-2xl border border-border bg-card transition duration-300 hover:-translate-y-1 hover:border-brand/30 hover:shadow-raised sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Link href={href} className="relative block" aria-label={item.name}>
        <Photo item={item} className="aspect-[4/3] h-full w-full sm:aspect-auto sm:min-h-[15rem]" />
        <span className="absolute start-3 top-3 inline-flex items-center gap-1 rounded-full bg-navy px-2.5 py-1 text-xs font-extrabold text-navy-fg shadow-card">
          <Icon name="package" className="h-3.5 w-3.5" /> Kit
        </span>
      </Link>
      <div className="flex min-w-0 flex-col gap-2 p-4 sm:p-5">
        {item.offerLabel && <span className="text-micro font-extrabold uppercase text-brand">{item.offerLabel}</span>}
        <Link href={href} className="text-lg font-extrabold leading-snug text-foreground hover:text-brand">{item.name}</Link>
        {item.blurb && <p className="line-clamp-2 text-sm text-muted-foreground">{item.blurb}</p>}
        {item.contains.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="In this kit">
            {item.contains.slice(0, 6).map((c) => (
              <li key={c} className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold">{c}</li>
            ))}
            {item.contains.length > 6 && (
              <li className="rounded-full px-1 py-1 text-xs font-semibold text-muted-foreground">+{item.contains.length - 6} more</li>
            )}
          </ul>
        )}
        <div className="mt-auto flex items-end justify-between gap-3 pt-2">
          <div>
            <p className="text-2xl font-extrabold tabular-nums">{rupees(item.pricePaise)}</p>
            <p className="text-xs text-muted-foreground">the kit, product only · fitting quoted after a site look</p>
          </div>
          <AddButton inList={inList} pending={pending} onAdd={onAdd} name={item.name} />
        </div>
      </div>
    </article>
  );
}

export function Notice({ tone, children }: { tone: 'ok' | 'error'; children: React.ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium ${
        tone === 'error' ? 'border-danger/25 bg-danger/10 text-on-tint-danger' : 'border-success/25 bg-success/10 text-on-tint-success'
      }`}
    >
      <Icon name={tone === 'error' ? 'alert-circle' : 'check-circle'} className="h-4 w-4 shrink-0" />
      {children}
    </p>
  );
}
