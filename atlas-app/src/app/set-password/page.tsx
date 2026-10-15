import { redirect } from 'next/navigation';
import { getContext } from '@/server/context';
import { Icon } from '@/components/ui/Icon';
import { MIN_PASSWORD_LENGTH } from '@/lib/password-policy';
import { SetPasswordForm } from './SetPasswordForm';

/**
 * "Choose your own password" (3 Oct 2026).
 *
 * Where somebody lands after an administrator reset their password. The one
 * they were given works to get in here and nowhere else - the app layout sends
 * them back until they have chosen their own.
 *
 * OUTSIDE `(app)` deliberately. Inside it, the layout's own redirect would send
 * this page to itself forever.
 *
 * Reachable voluntarily too: anyone who wants to change their password can come
 * here, which is why the page does not assume a reset is pending.
 */
export default async function SetPasswordPage() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');

  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand text-brand-fg">
            <Icon name="lock" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-base font-bold leading-tight text-navy">
              {ctx.mustChangePassword ? 'Choose your own password' : 'Change your password'}
            </p>
            <p className="truncate text-micro uppercase text-muted-foreground">{ctx.user.fullName}</p>
          </div>
        </div>

        {ctx.mustChangePassword ? (
          <p className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-sm leading-relaxed">
            Your administrator reset your password, so somebody else has seen the one you just used.
            Pick a new one now &mdash; nobody, including your administrator, can see it.
          </p>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Your other devices will be signed out. This one stays signed in.
          </p>
        )}

        <div className="mt-5">
          <SetPasswordForm minLength={MIN_PASSWORD_LENGTH} forced={ctx.mustChangePassword} />
        </div>

        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Use at least {MIN_PASSWORD_LENGTH} characters. A phrase you can remember is stronger than
          a short password with symbols in it, and far easier to type on a phone.
        </p>
      </div>
    </main>
  );
}
