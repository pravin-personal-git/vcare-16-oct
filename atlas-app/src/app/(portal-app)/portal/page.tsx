import Link from 'next/link';
import { requirePortalContext } from '@/server/portal-context';
import { getPortalHome } from '@/server/portal';
import { Card, PageHeader } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { publicShop } from '@/server/catalogue';
import { rupees } from '@/lib/shop-format';

export default async function PortalHomePage() {
  const ctx = await requirePortalContext();
  const summary = await getPortalHome(ctx.party.id, ctx.party.storeId);
  // A taste of the shop on the home page (3 Oct 2026): existing customers
  // were never shown the catalogue at all.
  const showcase = summary.showShop ? (await publicShop(ctx.party.storeId)).slice(0, 8) : [];

  return (
    <div>
      <PageHeader
        badge={ctx.party.displayName.slice(0, 2).toUpperCase()}
        title={`Welcome, ${ctx.party.displayName}`}
        subtitle={ctx.store.name}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon name="alert-circle" className="h-4 w-4" />
            <p className="text-xs font-medium uppercase">Open complaints</p>
          </div>
          <p className="mt-2 text-2xl font-bold">{summary.openComplaints}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon name="shopping-cart" className="h-4 w-4" />
            <p className="text-xs font-medium uppercase">Purchases on file</p>
          </div>
          <p className="mt-2 text-2xl font-bold">{summary.totalPurchases}</p>
        </Card>
        {/* Amounts are hidden entirely where the client chose that (portal.amounts,
            F1a) - the card goes, rather than showing a reassuring zero. */}
        {summary.totalDuePaise !== null && (
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Icon name="credit-card" className="h-4 w-4" />
              <p className="text-xs font-medium uppercase">Balance due</p>
            </div>
            <p className={`mt-2 text-2xl font-bold ${summary.totalDuePaise > 0 ? 'text-warning' : ''}`}>
              {formatCurrency(summary.totalDuePaise)}
            </p>
            {!!summary.overduePaise && (
              <p className="mt-1 text-xs font-medium text-danger">
                {formatCurrency(summary.overduePaise)} overdue
              </p>
            )}
          </Card>
        )}
      </div>

      {showcase.length > 0 && (
        <section className="mt-6 grid gap-3 rounded-2xl bg-navy p-4 text-navy-fg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold">Shop {ctx.organization.name}</h2>
              <p className="text-sm opacity-85">Make a list and send it - they ring you with a quote.</p>
            </div>
            <Link href="/portal/shop" className="rounded-full bg-white px-4 py-2 text-sm font-bold text-navy">
              Open the shop
            </Link>
          </div>
          <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
            {showcase.map((i) => (
              <Link
                key={i.id}
                href={`/portal/shop/p/${i.id}`}
                className="w-40 shrink-0 overflow-hidden rounded-xl bg-card text-foreground shadow-sm"
              >
                {i.imageUrls[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted product image
                  <img src={i.imageUrls[0]} alt="" className="aspect-[4/3] w-full bg-white object-contain" />
                ) : (
                  <div className="grid aspect-[4/3] w-full place-items-center bg-navy/[0.06] text-navy/50">
                    <Icon name="camera" className="h-7 w-7" />
                  </div>
                )}
                <div className="p-2">
                  <p className="line-clamp-2 text-xs font-semibold leading-snug">{i.name}</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums">{rupees(i.pricePaise)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link href="/portal/purchases" className="group block">
          <Card className="flex items-center gap-3 p-4 transition group-hover:border-brand/40 group-hover:shadow-md">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-on-tint-brand">
              <Icon name="receipt" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold">My Purchases</p>
              <p className="text-xs text-muted-foreground">Invoices and what you bought</p>
            </div>
            <Icon name="chevron-right" className="ms-auto h-4 w-4 text-muted-foreground" />
          </Card>
        </Link>
        <Link href="/portal/complaints" className="group block">
          <Card className="flex items-center gap-3 p-4 transition group-hover:border-brand/40 group-hover:shadow-md">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-on-tint-brand">
              <Icon name="alert-circle" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold">My Complaints</p>
              <p className="text-xs text-muted-foreground">Raise one, or track an existing one</p>
            </div>
            <Icon name="chevron-right" className="ms-auto h-4 w-4 text-muted-foreground" />
          </Card>
        </Link>
      </div>
    </div>
  );
}
