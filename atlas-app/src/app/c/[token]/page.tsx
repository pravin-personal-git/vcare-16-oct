import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getInstallationByToken } from '@/server/customer-links';
import { CustomerFileList } from '@/components/document/CustomerFileList';
import { PublicDocShell, publicDate } from '@/components/document/PublicDocShell';
import { PrintButton } from '@/components/services/PrintButton';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';

/** Metadata and the page read the same installation once per request. */
const load = cache((token: string) => getInstallationByToken(token));

/** The preview WhatsApp draws under the link - name, logo, stage. Never indexed. */
export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const c = await load((await params).token);
  if (!c) return { title: 'Installation', robots: { index: false, follow: false } };
  const title = `Installation ${c.challanNo} from ${c.business.name}`;
  const description = `${c.items.length} item${c.items.length === 1 ? '' : 's'} · ${c.steps.find((s) => s.current)?.label ?? ''}`;
  return {
    title, description, robots: { index: false, follow: false },
    openGraph: {
      title, description, type: 'website', siteName: c.business.name,
      ...(c.business.logoUrl ? { images: [{ url: c.business.logoUrl, alt: c.business.name }] } : {}),
    },
  };
}

/**
 * A customer's installation, without a login (A2, 11 Oct 2026): the items
 * and where each is going, what is fitted, the stage, the next visit, the
 * handover and the warranty counted from it. No prices (Pravin, W2).
 */
export default async function PublicInstallation({ params }: { params: Promise<{ token: string }> }) {
  const c = await load((await params).token);
  if (!c) notFound();

  return (
    <PublicDocShell
      business={c.business}
      kind="Installation"
      number={c.challanNo}
      sub={<>{c.customerName ? <>For {c.customerName}</> : null}{c.orderNo ? <> · order <span className="font-mono">{c.orderNo}</span></> : null}</>}
      steps={c.steps}
      exception={c.sentBack ? 'We are re-checking part of the work before we finish. We will be in touch.' : null}
      actions={<PrintButton />}
    >
      {(c.site || c.nextVisit || c.handover) && (
        <section className="grid gap-2 rounded-xl border border-border bg-card p-4 text-sm">
          {c.site && <p className="flex items-start gap-2"><Icon name="map-pin" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />{c.site}</p>}
          {c.nextVisit && !c.handover && <p className="flex items-center gap-2"><Icon name="calendar" className="h-4 w-4 text-muted-foreground" />Next visit {publicDate(c.nextVisit)}</p>}
          {c.handover && <p className="flex items-center gap-2"><Icon name="shield-check" className="h-4 w-4 text-success" />Handed over {publicDate(c.handover.at)}{c.handover.to ? <> to {c.handover.to}</> : null} - warranty runs from this date</p>}
        </section>
      )}

      <section className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-micro font-semibold uppercase text-muted-foreground">Items</p>
        <ul className="divide-y divide-border">
          {c.items.map((i, n) => (
            <li key={n} className="grid gap-0.5 py-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">{i.name}{i.qty > 1 ? <span className="text-muted-foreground"> × {i.qty}</span> : null}</span>
                <span className={`shrink-0 text-xs ${i.fit === 'To be fitted' ? 'text-muted-foreground' : 'text-success'}`}>{i.fit}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {[i.placement, i.serialNo ? `Serial ${i.serialNo}` : null, i.warrantyUntil ? `Warranty until ${publicDate(i.warrantyUntil)}` : null].filter(Boolean).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <CustomerFileList files={c.files} />
    </PublicDocShell>
  );
}
