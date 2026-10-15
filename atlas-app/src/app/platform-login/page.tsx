import { redirect } from 'next/navigation';
import { getPlatformContext } from '@/server/platform-context';
import { LoginForm } from '../login/LoginForm';

/**
 * The PLATFORM team's sign-in (5 Oct 2026) - N.A.I.R. and resellers, not a
 * business's staff. It used to be the same /login every employee sees, which
 * made it impossible to tell at a glance which side of the product you were
 * entering. Deliberately different: dark, N.A.I.R.'s own name, "Platform
 * Control", and no link to it from any business page. The action turns away
 * business accounts here, and platform accounts on /login.
 */
export const metadata = { title: 'Platform Control - N.A.I.R.', robots: { index: false, follow: false } };

export default async function PlatformLoginPage() {
  if (await getPlatformContext()) redirect('/platform');

  return (
    <main className="dark grid min-h-screen place-items-center bg-[#0b1020] p-6 text-slate-100">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-base font-black text-white shadow-lg">
            N
          </span>
          <div>
            <p className="text-lg font-extrabold leading-tight">N.A.I.R. Platform Control</p>
            <p className="text-xs uppercase tracking-widest text-slate-400">Restricted - platform team only</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
          <h1 className="text-xl font-bold">Sign in to the control panel</h1>
          <p className="mt-1 text-sm text-slate-400">
            Tenants, plans, modules and suspensions for every business on Atlas.
          </p>
          <div className="mt-6 [&_.field-label]:text-slate-300">
            <LoginForm surface="platform" />
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Every sign-in here is recorded. Business staff sign in on their own company page.
        </p>
      </div>
    </main>
  );
}
