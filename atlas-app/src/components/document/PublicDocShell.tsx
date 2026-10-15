import { Icon } from '@/components/ui/Icon';

/**
 * The frame of a no-login customer link (A2, 11 Oct 2026): the business's
 * logo and name, what the document is, the steps it has been through, and
 * whatever the page puts below. Shared by /o (sales order) and /c
 * (installation). Server-safe: no hooks, nothing from a 'use client' file.
 */
export function PublicDocShell({ business, kind, number, sub, steps, exception, actions, children }: {
  business: { name: string; logoUrl: string | null; mobile: string | null; branch: string };
  kind: string;
  number: string;
  sub?: React.ReactNode;
  steps: { label: string; done: boolean; current: boolean }[];
  /** Said beside the steps when the document is off the normal path (on hold, sent back…). */
  exception?: string | null;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-3 py-6 sm:px-6">
      <header className="mb-4 flex items-center gap-3">
        {business.logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={business.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-contain" />
          : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-on-tint-brand"><Icon name="building" className="h-5 w-5" /></span>}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{business.name}</p>
          <p className="truncate text-xs text-muted-foreground">{business.branch}{business.mobile ? <> · <a href={`tel:${business.mobile}`} className="hover:text-brand">{business.mobile}</a></> : null}</p>
        </div>
        <div className="no-print shrink-0">{actions}</div>
      </header>

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{kind}</p>
        <h1 className="mt-0.5 font-mono text-lg font-bold text-brand">{number}</h1>
        {sub && <div className="mt-1 text-sm text-muted-foreground">{sub}</div>}

        <ol className="mt-4 grid gap-2 sm:flex sm:flex-wrap sm:gap-x-1 sm:gap-y-2">
          {steps.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2 text-sm sm:gap-1">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${s.current ? 'bg-brand text-brand-fg' : s.done ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
                {s.done && !s.current ? <Icon name="check" className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={s.current ? 'font-semibold' : s.done ? '' : 'text-muted-foreground'}>{s.label}</span>
              {i < steps.length - 1 && <span aria-hidden className="mx-1 hidden h-px w-4 bg-border sm:inline-block" />}
            </li>
          ))}
        </ol>
        {exception && <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-sm text-on-tint-warning">{exception}</p>}
      </section>

      <div className="mt-4 grid gap-4">{children}</div>
    </main>
  );
}

/** "12 Oct 2026" in India time. */
export const publicDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
