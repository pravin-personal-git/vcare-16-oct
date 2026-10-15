import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getOrderByToken } from '@/server/customer-links';
import { CustomerFileList } from '@/components/document/CustomerFileList';
import { PublicDocShell, publicDate } from '@/components/document/PublicDocShell';
import { PrintButton } from '@/components/services/PrintButton';
import { Icon } from '@/components/ui/Icon';

export const dynamic = 'force-dynamic';

/** Metadata and the page read the same order once per request. */
const load = cache((token: string) => getOrderByToken(token));

/**
 * The preview WhatsApp draws under the link: the business's name and logo
 * and where the order is - never a price (W2). Never indexed.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const o = await load((await params).token);
  if (!o) return { title: 'Sales order', robots: { index: false, follow: false } };
  const title = `Sales order ${o.orderNo} from ${o.business.name}`;
  const now = o.exception ?? o.steps.find((s) => s.current)?.label ?? '';
  const description = `${o.items.length} item${o.items.length === 1 ? '' : 's'}${now ? ` · ${now}` : ''}`;
  return {
    title, description, robots: { index: false, follow: false },
    openGraph: {
      title, description, type: 'website', siteName: o.business.name,
      ...(o.business.logoUrl ? { images: [{ url: o.business.logoUrl, alt: o.business.name }] } : {}),
    },
  };
}

/**
 * A customer's sales order, without a login (A2, 11 Oct 2026). What the
 * order's WhatsApp button now sends: the items and how far the order has
 * got, in the business's own stage names. No prices - those go out on the
 * quotation and the invoice (Pravin, W2).
 */
export default async function PublicOrder({ params }: { params: Promise<{ token: string }> }) {
  const o = await load((await params).token);
  if (!o) notFound();

  return (
    <PublicDocShell
      business={o.business}
      kind="Sales order"
      number={o.orderNo}
      sub={<>For {o.customerName} · ordered {publicDate(o.orderDate)}{o.expectedDeliveryDate ? <> · expected by {publicDate(o.expectedDeliveryDate)}</> : null}</>}
      steps={o.steps}
      exception={o.exception ? `This order is now: ${o.exception}` : null}
      actions={<PrintButton />}
    >
      <section className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-micro font-semibold uppercase text-muted-foreground">Items</p>
        <ul className="divide-y divide-border">
          {o.items.map((i, n) => (
            <li key={n} className="flex items-start justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">{i.name}</span>
              <span className="shrink-0 text-end tabular-nums text-muted-foreground">
                {i.qty}
                {i.dispatched > 0 && <span className="block text-xs">{i.dispatched >= i.qty ? 'sent' : `${i.dispatched} sent`}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {(o.courier || o.installations.length > 0) && (
        <section className="grid gap-2 rounded-xl border border-border bg-card p-4 text-sm">
          {o.courier?.awbNo && (
            <p className="flex items-center gap-2"><Icon name="truck" className="h-4 w-4 text-muted-foreground" />Courier tracking number <span className="font-mono">{o.courier.awbNo}</span></p>
          )}
          {o.installations.map((c) => (
            <p key={c.no} className="flex items-center gap-2"><Icon name="wrench" className="h-4 w-4 text-muted-foreground" />Installation <span className="font-mono">{c.no}</span> · {c.stage}</p>
          ))}
        </section>
      )}

      <CustomerFileList files={o.files} />
    </PublicDocShell>
  );
}
