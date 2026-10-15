'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { setPortalPassword, type ResetPasswordState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded bg-brand text-sm font-semibold text-brand-fg shadow-card transition hover:bg-brand-hover disabled:opacity-60"
    >
      {pending && <Icon name="refresh" className="h-4 w-4 animate-spin" />}
      {pending ? 'Saving…' : 'Set password and continue'}
    </button>
  );
}

export function ResetPasswordForm() {
  const [state, formAction] = useActionState<ResetPasswordState, FormData>(setPortalPassword, {});

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="password" className="field-label uppercase tracking-wide">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} autoFocus
          className="field-input" placeholder="At least 8 characters" />
      </div>
      <div>
        <label htmlFor="confirm" className="field-label uppercase tracking-wide">Confirm password</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8}
          className="field-input" placeholder="Type it again" />
      </div>

      {state.error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
