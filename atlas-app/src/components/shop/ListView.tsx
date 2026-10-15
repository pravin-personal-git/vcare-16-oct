'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CartView } from '@/server/shop';
import type { ShopRef } from '@/server/shop-context';
import { requestAction, setQtyAction } from '@/app/(shop)/shop/actions';
import { LocationCapture, type CapturedLocation } from '@/components/ui/LocationCapture';
import { Icon } from '@/components/ui/Icon';
import { Notice, rupees } from './parts';

/**
 * My list - the basket, renamed, because nothing is bought here.
 *
 * Two ways out, routed rather than left to whoever reads it (decision 10):
 * "buy these" becomes a LEAD for the sales team, "I need a visit" becomes a
 * COMPLAINT for the service desk. The figure shown is "goods only", never a
 * total: fitting is quoted by a person.
 */
export function ListView({ shopRef, base, cart, signedIn, orgName, signInHref, registerHref, initialWant }: {
  shopRef: ShopRef;
  base: string;
  cart: CartView | null;
  signedIn: boolean;
  orgName: string;
  signInHref: string;
  registerHref: string | null;
  initialWant: 'buy' | 'visit';
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [want, setWant] = useState<'buy' | 'visit'>(initialWant);
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState<CapturedLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const lines = cart?.lines ?? [];

  const qty = (id: string, n: number) => {
    setError(null);
    start(async () => {
      const r = await setQtyAction(shopRef, id, n);
      if (r.error) setError(r.error);
      router.refresh();
    });
  };

  /**
   * What is still missing, in words (13 Oct 2026). The button used to stay
   * greyed out with no reason given - a customer with the location captured
   * but the box empty pressed Send and nothing happened, so no visit request
   * ever reached the branch. Now it always answers, and says what to do.
   */
  const missing = want === 'buy'
    ? (lines.length === 0 ? 'Add something to your list first - or choose "I need a visit".' : null)
    : !message.trim() ? 'Tell us what is wrong, and where - in the box above.'
      : !location ? 'Share where the visit is - this phone’s location, or a Google Maps link.' : null;

  const send = () => {
    setError(null);
    if (missing) { setError(missing); return; }
    start(async () => {
      const r = await requestAction(shopRef, want === 'buy' ? 'product' : 'service', message, want === 'visit' ? location : null);
      if (r.error) { setError(r.error); return; }
      setSent(r.message ?? 'Sent.');
      setMessage('');
      router.refresh();
    });
  };

  if (sent) {
    return (
      <div className="mx-auto grid max-w-xl place-items-center gap-4 py-12 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-full bg-success/15 text-on-tint-success ring-8 ring-success/5">
          <Icon name="check" className="h-10 w-10" strokeWidth={3} />
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight">Sent. Thank you.</h1>
        <p className="text-base text-muted-foreground">{sent}</p>
        <Link href={base} className="btn-depth inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-extrabold text-brand-fg">
          Back to the shop <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-5 pb-10">
      <Link href={base} className="inline-flex w-fit items-center gap-1 text-sm font-bold text-brand hover:underline">
        <Icon name="arrow-left" className="h-4 w-4" /> Back to the shop
      </Link>
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">My list</h1>
        <p className="mt-1 text-sm text-muted-foreground">Check it, say what you need, and send it to {orgName}. Nothing is paid online.</p>
      </div>

      {lines.length === 0 && want === 'buy' && (
        <div className="grid place-items-center gap-2 rounded-3xl border border-dashed border-border bg-card px-4 py-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-brand/10 text-on-tint-brand"><Icon name="bag" className="h-6 w-6" /></span>
          <p className="text-base font-bold">Your list is empty.</p>
          <p className="mt-1 text-sm text-muted-foreground">Add things from the shop, or ask for a visit below if something is not working.</p>
        </div>
      )}

      {lines.length > 0 && (
        <div className="grid gap-2 rounded-3xl border border-border bg-card p-3 shadow-card sm:p-4">
          {lines.map((l) => (
            <div key={l.id} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl p-1.5 transition hover:bg-muted/50">
              {l.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted product image
                <img src={l.imageUrl} alt="" className="shop-photo h-16 w-16 rounded-xl border border-border object-contain p-1" />
              ) : (
                <span className="shop-ph grid h-16 w-16 place-items-center rounded-xl text-xs font-extrabold text-brand">
                  {l.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-sm font-bold leading-snug">{l.name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{rupees(l.pricePaise)} each</p>
              </div>
              <div className="flex items-center gap-1 rounded-full border border-border bg-background p-1">
                <button type="button" disabled={pending} onClick={() => qty(l.id, l.qty - 1)} aria-label={`One fewer ${l.name}`}
                  className="grid h-8 w-8 place-items-center rounded-full text-base font-bold transition hover:bg-muted disabled:opacity-50"><Icon name="minus" className="h-4 w-4" /></button>
                <span className="min-w-6 text-center text-sm font-bold tabular-nums">{l.qty}</span>
                <button type="button" disabled={pending} onClick={() => qty(l.id, l.qty + 1)} aria-label={`One more ${l.name}`}
                  className="grid h-8 w-8 place-items-center rounded-full bg-brand text-brand-fg transition hover:bg-brand-hover disabled:opacity-50"><Icon name="plus" className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-dashed border-border px-1.5 pt-3 text-lg font-extrabold">
            <span>Goods only</span>
            <span className="tabular-nums">{rupees(cart?.goodsPaise ?? 0)}</span>
          </div>
          <p className="px-1.5 text-xs text-muted-foreground">Not a bill. Fitting, cable and travel are added in {orgName}&rsquo;s quote.</p>
        </div>
      )}

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-lg font-extrabold">What do you need?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ['buy', 'I want to buy these', `${orgName} sends you a quote.`, 'bag'],
            ['visit', 'I need a visit', 'Somebody comes to look at the site, or to fix something.', 'wrench'],
          ] as const).map(([k, title, hint, icon]) => (
            <button
              key={k}
              type="button"
              aria-pressed={want === k}
              onClick={() => setWant(k)}
              className={`flex items-start gap-3 rounded-2xl border-2 p-4 text-start transition ${want === k ? 'border-brand bg-brand/[0.06] ring-4 ring-brand/10' : 'border-border bg-card hover:border-brand/30'}`}
            >
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${want === k ? 'bg-brand text-brand-fg' : 'bg-muted text-foreground'}`}>
                <Icon name={icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
              <span className="block text-base font-bold">{title}</span>
              <span className="block text-sm text-muted-foreground">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <label className="grid gap-1 text-sm font-semibold" htmlFor="list-message">
        {want === 'visit' ? 'What is wrong, and where?' : 'Anything they should know? (optional)'}
        <textarea
          id="list-message"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={want === 'visit' ? 'e.g. Two cameras at the gate show nothing since Tuesday' : 'Where it is going, when you need it'}
          className="rounded-2xl border border-border bg-card px-4 py-3 text-base font-normal outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/15"
        />
      </label>

      {want === 'visit' && signedIn && (
        <div className="grid gap-1">
          <p className="text-sm font-semibold">Where is the visit?</p>
          <p className="text-xs text-muted-foreground">
            Share this phone&rsquo;s location if you are there now, or paste a Google Maps link to the site.
          </p>
          <LocationCapture value={location} onChange={setLocation} />
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {signedIn ? (
        <button
          type="button"
          disabled={pending}
          onClick={send}
          className="btn-depth inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand px-8 text-base font-extrabold text-brand-fg transition hover:bg-brand-hover disabled:opacity-50 sm:w-fit"
        >
          <Icon name="send" className="h-5 w-5" />
          {pending ? 'Sending…' : `Send to ${orgName}`}
        </button>
      ) : (
        <div className="grid gap-3 rounded-3xl border border-border bg-card p-5">
          <p className="text-sm">
            To send it, sign in - or create an account with your mobile number, email and location. Your list is kept while you do.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={signInHref} className="btn-depth rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-brand-fg">Sign in</Link>
            {registerHref && (
              <Link href={registerHref} className="rounded-full border-2 border-brand px-5 py-2.5 text-sm font-extrabold text-brand hover:bg-brand/10">Create an account</Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
