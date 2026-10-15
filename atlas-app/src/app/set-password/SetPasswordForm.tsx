'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { setOwnPassword, type SetPasswordState } from './actions';

function SubmitButton({ forced }: { forced: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded bg-brand text-sm font-semibold text-brand-fg shadow-card transition hover:bg-brand-hover disabled:opacity-60"
    >
      {pending && <Icon name="refresh" className="h-4 w-4 animate-spin" />}
      {pending ? 'Saving…' : forced ? 'Save and continue' : 'Change my password'}
    </button>
  );
}

export function SetPasswordForm({ minLength, forced }: { minLength: number; forced: boolean }) {
  const [state, formAction] = useActionState<SetPasswordState, FormData>(setOwnPassword, {});

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="currentPassword" className="field-label uppercase tracking-wide">
          {/*
            Named for what it is from the person's point of view. "Current
            password" after an admin reset reads as a trick question; they are
            holding a temporary one somebody read out to them.
          */}
          {forced ? 'The password you were given' : 'Your current password'}
        </label>
        <input
          id="currentPassword" name="currentPassword" type="password"
          autoComplete="current-password" autoFocus required
          className="field-input"
          placeholder={forced ? 'Paste or type it exactly' : 'Enter your current password'}
        />
      </div>

      <div>
        <label htmlFor="newPassword" className="field-label uppercase tracking-wide">
          Your new password
        </label>
        <input
          id="newPassword" name="newPassword" type="password"
          autoComplete="new-password" required minLength={minLength}
          className="field-input"
          placeholder={`At least ${minLength} characters`}
        />
      </div>

      <div>
        <label htmlFor="confirmPassword" className="field-label uppercase tracking-wide">
          Type it again
        </label>
        <input
          id="confirmPassword" name="confirmPassword" type="password"
          autoComplete="new-password" required minLength={minLength}
          className="field-input"
          placeholder="The same new password"
        />
      </div>

      {/*
        Said before they type it (Vcare, 9 Oct 2026): their administrator
        can look this password up (server/password-copy.ts). People reuse
        passwords, and they should not find out about this after the fact.
      */}
      <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-xs leading-relaxed">
        <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        Your administrator can see this password. Do not use one you use for your bank, Gmail or
        anything else.
      </p>

      {state.error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </p>
      )}

      <SubmitButton forced={forced} />
    </form>
  );
}
