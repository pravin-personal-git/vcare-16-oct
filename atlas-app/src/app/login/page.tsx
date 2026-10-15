import { redirect } from 'next/navigation';
import { getContext } from '@/server/context';
import { Icon, type IconName } from '@/components/ui/Icon';
import { LoginForm } from './LoginForm';
import { db } from '@/server/db';
import { publicBrandUrl } from '@/server/storage';

const PILLARS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'building', title: 'Multi-store', body: 'One login, every branch. Switch scope without switching accounts.' },
  { icon: 'user', title: 'Multi-role', body: 'A person can be a manager in one store and a salesperson in another.' },
  { icon: 'receipt', title: 'GST-ready', body: 'CGST/SGST and IGST resolved from the buyer’s state, not by hand.' },
  { icon: 'sparkles', title: 'White-label', body: 'Every colour is a token. A rebrand is configuration, not a release.' },
];

export default async function LoginPage() {
  if (await getContext()) redirect('/dashboard');

  // Each client has its own deployment, so the business signing in here is
  // known: say its name, show its logo (5 Oct 2026). With several businesses
  // on one database the page stays generic rather than guess.
  const orgs = await db.organization.findMany({ select: { name: true, logoPath: true }, take: 2 }).catch(() => []);
  const org = orgs.length === 1 ? orgs[0] : null;
  const logo = org ? publicBrandUrl(org.logoPath) : null;

  return (
    <main className="grid min-h-screen bg-card lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* form */}
      <div className="flex items-center justify-center bg-card p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2.5">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- the tenant's own logo
              <img src={logo} alt="" className="h-11 w-11 rounded-xl object-contain" />
            ) : (
              <span className="btn-depth grid h-11 w-11 place-items-center rounded-xl bg-brand text-lg font-black text-brand-fg">
                {(org?.name ?? 'Atlas').charAt(0).toUpperCase()}
              </span>
            )}
            <div>
              <p className="text-lg font-extrabold leading-tight text-navy">{org?.name ?? 'Atlas'}</p>
              <p className="text-micro uppercase text-muted-foreground">
                {org ? 'Staff sign-in' : 'Business Operating System'}
              </p>
            </div>
          </div>

          <h1 className="mt-10 text-h1 font-extrabold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {org ? `Sign in to ${org.name} with the username your admin gave you.` : 'Sign in to continue where you left off.'}
          </p>

          <div className="mt-6">
            <LoginForm />
          </div>

          {process.env.NODE_ENV === 'development' && (
            <div className="mt-8 rounded-lg border border-border bg-background p-3">
              <p className="mb-1.5 text-micro font-semibold uppercase text-muted-foreground">
                Development only
              </p>
              <p className="text-xs text-muted-foreground">
                <code className="rounded bg-card px-1 py-0.5 font-mono text-foreground">admin</code>
                {', '}
                <code className="rounded bg-card px-1 py-0.5 font-mono text-foreground">sales</code>
                {' or '}
                <code className="rounded bg-card px-1 py-0.5 font-mono text-foreground">platform_owner</code>
                {', password '}
                <code className="rounded bg-card px-1 py-0.5 font-mono text-foreground">Atlas@2026</code>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* brand panel */}
      <div className="shop-hero relative m-3 hidden items-center justify-center overflow-hidden rounded-[1.75rem] p-12 lg:flex">
        {/* Two soft washes rather than an image - nothing to re-license per tenant. */}
        <div className="pointer-events-none absolute -top-32 -end-32 h-96 w-96 rounded-full bg-brand/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -start-24 h-96 w-96 rounded-full bg-accent/15 blur-3xl" />

        <div className="relative max-w-lg text-navy-fg">
          <h2 className="text-5xl font-extrabold leading-[1.05] tracking-tight">
            Run your entire business from one platform
          </h2>
          <p className="mt-4 text-navy-fg/70">
            Leads, quotations, orders, invoicing, inventory, service, people and
            accounts - in one place, in your own brand.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {PILLARS.map((p) => (
              <div key={p.title} className="rounded-2xl border border-white/15 bg-white/10 p-4">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/90 text-navy">
                  <Icon name={p.icon} className="h-4 w-4" />
                </span>
                <p className="mt-2.5 text-sm font-semibold">{p.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-navy-fg/60">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
