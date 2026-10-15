import { redirect } from 'next/navigation';
import { getPortalContext } from '@/server/portal-context';
import { ResetPasswordForm } from './ResetPasswordForm';

export default async function PortalResetPasswordPage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect('/portal/login');
  if (!ctx.party.portalMustReset) redirect('/portal');

  return (
    <main className="grid min-h-screen place-items-center bg-background p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-card sm:p-8">
        <h1 className="text-xl font-bold">Set your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You signed in with a temporary password. Choose your own before continuing.
        </p>
        <div className="mt-6">
          <ResetPasswordForm />
        </div>
      </div>
    </main>
  );
}
