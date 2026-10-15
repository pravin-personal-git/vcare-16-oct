'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { login, type PortalLoginState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-depth inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand text-base font-extrabold text-brand-fg transition hover:bg-brand-hover disabled:opacity-60"
    >
      {pending && <Icon name="refresh" className="h-4 w-4 animate-spin" />}
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}

/**
 * The number and password are kept in state, not left to the form: React
 * resets a form after its action runs, and the business picker below sends
 * them again with the chosen account.
 */
export function LoginForm({ next, shop, registerHref }: {
  next?: string | null;
  shop?: string | null;
  /** Where "create an account" goes - only when signing in from a shop. */
  registerHref?: string | null;
}) {
  const [state, formAction] = useActionState<PortalLoginState, FormData>(login, {});
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form action={formAction} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      {shop && <input type="hidden" name="shop" value={shop} />}

      <div>
        <label htmlFor="phone" className="field-label uppercase tracking-wide">
          Phone number
        </label>
        <input
          id="phone" name="phone" type="tel" inputMode="numeric" autoComplete="username" autoFocus required
          className="field-input"
          placeholder="10-digit mobile number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="password" className="field-label uppercase tracking-wide">
          Password
        </label>
        <input
          id="password" name="password" type="password" autoComplete="current-password" required
          className="field-input"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {state.notHere && (
        <div role="alert" className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm">
          <p className="flex items-start gap-2 font-semibold">
            <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            This number has no account with {state.notHere.businessName}.
          </p>
          <p className="text-muted-foreground">
            Your password is right, but the account it opens belongs to another business. Create an account with{' '}
            {state.notHere.businessName} - it takes a minute and your list is kept.
          </p>
          <div className="flex flex-wrap gap-2">
            {registerHref && (
              <a href={registerHref} className="rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-fg hover:bg-brand-hover">
                Create an account with {state.notHere.businessName}
              </a>
            )}
            <a href="/portal/login" className="rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">
              Sign in to my other account
            </a>
          </div>
        </div>
      )}

      {state.error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </p>
      )}

      {state.choices ? (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">This number has an account with more than one business. Which one?</legend>
          {state.choices.map((c) => (
            <button
              key={c.partyId}
              type="submit"
              name="partyId"
              value={c.partyId}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-start transition hover:border-brand"
            >
              <span>
                <span className="block text-sm font-semibold">{c.businessName}</span>
                <span className="block text-xs text-muted-foreground">{c.branchName}</span>
              </span>
              <Icon name="chevron-right" className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </fieldset>
      ) : (
        <SubmitButton />
      )}

      <p className="text-center text-xs text-muted-foreground">
        {registerHref ? (
          <>New here? <a href={registerHref} className="font-semibold text-brand hover:underline">Create an account</a></>
        ) : (
          'No account yet? Ask the store you purchased from to enable portal access.'
        )}
      </p>
    </form>
  );
}
