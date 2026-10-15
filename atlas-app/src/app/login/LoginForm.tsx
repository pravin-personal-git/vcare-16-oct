'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { login, type LoginState } from './actions';

function SubmitButton({ label = 'Sign in' }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-depth inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand text-base font-extrabold text-brand-fg transition hover:bg-brand-hover disabled:opacity-60"
    >
      {pending && <Icon name="refresh" className="h-4 w-4 animate-spin" />}
      {pending ? 'Signing in…' : label}
    </button>
  );
}

export function LoginForm({ surface = 'business' }: { surface?: 'business' | 'platform' }) {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});
  // Kept in state: React resets a form after its action, and the platform
  // sign-in sends the same username and password again with the code.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const codeStep = !!state.otpSentTo;

  return (
    <form action={formAction} className="space-y-4">
      {/* Which door this is - the action turns away the other door's accounts. */}
      <input type="hidden" name="surface" value={surface} />
      <div>
        <label htmlFor="username" className="field-label uppercase tracking-wide">
          Username
        </label>
        <input
          id="username" name="username" type="text" autoComplete="username" autoFocus required
          value={username} onChange={(e) => setUsername(e.target.value)} readOnly={codeStep}
          className="field-input"
          placeholder="Enter your username"
        />
      </div>

      <div>
        <label htmlFor="password" className="field-label uppercase tracking-wide">
          Password
        </label>
        <input
          id="password" name="password" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} readOnly={codeStep}
          className="field-input"
          placeholder="Enter your password"
        />
      </div>

      {codeStep && (
        <div>
          <label htmlFor="otp" className="field-label uppercase tracking-wide">
            Code sent to {state.otpSentTo}
          </label>
          <input
            id="otp" name="otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            required autoFocus className="field-input tracking-[0.4em]" placeholder="6-digit code"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Check your email. The code works for 5 minutes.
            {state.devCode && <> Test code (not shown on the live site): <span className="font-mono">{state.devCode}</span></>}
          </p>
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox" name="rememberMe" checked={remember} onChange={(e) => setRemember(e.target.checked)}
          className="h-3.5 w-3.5 accent-[hsl(var(--brand-primary))]"
        />
        Remember me
      </label>

      {state.error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </p>
      )}

      <SubmitButton label={codeStep ? 'Verify and sign in' : 'Sign in'} />
    </form>
  );
}
