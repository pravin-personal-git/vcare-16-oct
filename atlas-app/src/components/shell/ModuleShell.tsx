import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Badge, Card, PageHeader } from '@/components/ui/Layout';

/**
 * A screen that is designed but not built.
 *
 * Seventeen menu groups exist and seven screens are real. Clicking the other
 * fifty and getting a blank page teaches people the product is broken - which
 * is a worse lie than the gap itself.
 *
 * So each one renders: what it will do, the controls it will carry, what it is
 * waiting on, and where the nearest working thing lives. That last part matters
 * most - someone who came here wanting to raise a quotation should leave with
 * the quotation, not with a shrug.
 */

export interface ModuleSpec {
  badge: string;
  title: string;
  subtitle: string;
  icon: IconName;
  /** What the screen is for, in one or two plain sentences. */
  purpose: string;
  /** The controls the reference app carries, so the shape is settled early. */
  controls?: string[];
  /** KPI cards the spec calls for. */
  cards?: string[];
  /** Backlog ids or dependencies. */
  blockedBy?: string[];
  /** Working screens a user might actually have wanted. */
  insteadTry?: { label: string; href: string; icon: IconName }[];
  /** Spec file that describes it. */
  spec?: string;
}

export function ModuleShell({ spec }: { spec: ModuleSpec }) {
  return (
    <div>
      <PageHeader
        badge={spec.badge}
        title={spec.title}
        subtitle={spec.subtitle}
        actions={<Badge tone="neutral" icon="clock">Not built yet</Badge>}
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-navy/10 text-on-tint-navy">
              <Icon name={spec.icon} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">What this screen will do</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {spec.purpose}
              </p>
            </div>
          </div>

          {spec.controls && spec.controls.length > 0 && (
            <div className="mt-5">
              <p className="text-micro font-bold uppercase tracking-widest text-muted-foreground">
                Controls it will carry
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {spec.controls.map((c) => (
                  <span
                    key={c}
                    className="rounded border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {spec.cards && spec.cards.length > 0 && (
            <div className="mt-5">
              <p className="text-micro font-bold uppercase tracking-widest text-muted-foreground">
                Summary cards
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {spec.cards.map((c) => (
                  <div
                    key={c}
                    className="rounded-lg border border-dashed border-border bg-muted/30 p-2.5"
                  >
                    <p className="truncate text-micro font-semibold uppercase text-muted-foreground">
                      {c}
                    </p>
                    <p className="mt-1 text-lg font-bold text-muted-foreground/40">-</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-3">
          {spec.blockedBy && spec.blockedBy.length > 0 && (
            <Card className="p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Icon name="lock" className="h-4 w-4 text-warning" />
                Waiting on
              </h2>
              <ul className="mt-2 space-y-1.5">
                {spec.blockedBy.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Icon name="chevron-right" className="mt-0.5 h-3 w-3 shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {spec.insteadTry && spec.insteadTry.length > 0 && (
            <Card className="p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Icon name="arrow-up-right" className="h-4 w-4 text-brand" />
                Working today
              </h2>
              <div className="mt-2 space-y-1">
                {spec.insteadTry.map((t) => (
                  <Link
                    key={t.href}
                    href={t.href}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition hover:bg-muted"
                  >
                    <Icon name={t.icon} className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1">{t.label}</span>
                    <Icon name="chevron-right" className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {spec.spec && (
            <Card className="p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Icon name="file-text" className="h-4 w-4 text-muted-foreground" />
                Specification
              </h2>
              <p className="mt-1.5 font-mono text-xs leading-relaxed text-muted-foreground">
                {spec.spec}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
