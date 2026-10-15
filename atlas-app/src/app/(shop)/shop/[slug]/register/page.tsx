'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { registerAction } from './actions';

/**
 * A visitor making their own account.
 *
 * Decision 9: they set their own password, and location, mobile and email are
 * all mandatory.
 *
 * WHY THE ADDRESS IS NOT OPTIONAL, said on the page rather than enforced in
 * silence: a request from somebody whose location is unknown cannot be priced.
 * A camera fitted forty kilometres out is a different job from one fitted down
 * the road, and asking afterwards means a second phone call before anybody can
 * quote. People fill in a field they understand the reason for.
 */
export default function RegisterPage() {
  const { slug } = useParams<{ slug: string }>();
  const sp = useSearchParams();
  const back = sp.get('next')?.startsWith('/shop/') ? sp.get('next')! : `/shop/${slug}`;
  const signIn = `/portal/login?shop=${slug}&next=${encodeURIComponent(back)}`;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [f, setF] = useState({
    name: '', phone: '', email: '',
    addressLine1: '', city: '', state: '', password: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const ready = f.name.trim() && f.phone.trim() && f.email.trim()
    && f.addressLine1.trim() && f.city.trim() && f.state.trim() && f.password;

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await registerAction(slug, back, f);
      if (r.error) { setError(r.error); return; }
      // Signed in already: a full page load, so every header reads the new session.
      if (r.next) { window.location.assign(r.next); return; }
      setDone(true);
    });
  };

  if (done) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-lg font-bold">Account created</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with your mobile number and the password you just chose. Your list is waiting.
        </p>
        <Link
          href={signIn}
          className="mt-4 inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-brand-fg"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand';

  return (
    <div className="mx-auto max-w-md pb-8 pt-2">
      <h1 className="text-lg font-bold">Create an account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        So we know who to come back to when you ask for something.
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-on-tint-danger">
          {error}
        </p>
      )}

      <div className="mt-5 grid gap-3">
        <label className="grid gap-1 text-xs font-medium">
          Your name
          <input value={f.name} onChange={set('name')} className={field} autoComplete="name" />
        </label>

        <label className="grid gap-1 text-xs font-medium">
          Mobile number
          <input
            value={f.phone} onChange={set('phone')} className={field}
            inputMode="numeric" autoComplete="tel" placeholder="10 digits"
          />
        </label>

        <label className="grid gap-1 text-xs font-medium">
          Email
          <input value={f.email} onChange={set('email')} className={field} type="email" autoComplete="email" />
        </label>

        <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
          We ask for your address because a visit forty kilometres out costs
          differently from one down the road — without it nobody can give you a price.
        </div>

        <label className="grid gap-1 text-xs font-medium">
          Address
          <input value={f.addressLine1} onChange={set('addressLine1')} className={field} autoComplete="street-address" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-xs font-medium">
            Town or city
            <input value={f.city} onChange={set('city')} className={field} autoComplete="address-level2" />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            State
            <input value={f.state} onChange={set('state')} className={field} autoComplete="address-level1" />
          </label>
        </div>

        <label className="grid gap-1 text-xs font-medium">
          Choose a password
          <input
            value={f.password} onChange={set('password')} className={field}
            type="password" autoComplete="new-password"
          />
        </label>

        <button
          type="button"
          disabled={!ready || pending}
          onClick={submit}
          className="mt-1 rounded-xl bg-brand px-4 py-3 text-sm font-bold text-brand-fg transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create my account'}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          Already have one?{' '}
          <Link href={signIn} className="font-semibold text-brand hover:underline">Sign in</Link>
          {' · '}
          <Link href={back} className="font-semibold text-brand hover:underline">Back to the shop</Link>
        </p>
      </div>
    </div>
  );
}
