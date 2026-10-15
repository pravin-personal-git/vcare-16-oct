import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { catalogueAdmin, listCombos } from '@/server/catalogue';
import { abandonedCarts, shopActivity } from '@/server/shop';
import { CatalogueClient } from './CatalogueClient';
import { ShopInsights } from './ShopInsights';
import { interestedNoEnquiry, mostWishlisted, reviewsForAdmin } from '@/server/shop-extras';

/**
 * What the shop shows, and what people did there.
 *
 * One screen rather than three, because the three questions are asked in the
 * same five minutes: what is on the shop, what did people look at, and who
 * nearly bought something and did not.
 */
export default async function CataloguePage() {
  const ctx = await requireContext();
  const storeId = ctx.scope.kind === 'single' ? ctx.scope.storeId : null;

  const [rows, combos, activity, abandoned, org] = await Promise.all([
    catalogueAdmin(ctx.scope),
    listCombos(ctx.scope),
    storeId ? shopActivity(storeId) : Promise.resolve(null),
    storeId ? abandonedCarts(storeId) : Promise.resolve([]),
    db.organization.findUnique({ where: { id: ctx.organization.id }, select: { shopSlug: true } }),
  ]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://atlas.nairsolutions.org';
  // Reviews, follow-ups and saves (5 Oct 2026, server/shop-extras).
  const [reviews, interested, wishlisted] = storeId
    ? await Promise.all([reviewsForAdmin(ctx.scope), interestedNoEnquiry(storeId), mostWishlisted(storeId)])
    : [[], [], []];

  return (
    <>
    <CatalogueClient
      rows={rows}
      combos={combos}
      activity={activity}
      abandoned={abandoned}
      canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('products.edit')}
      scopeIsAll={ctx.scope.kind === 'all'}
      shopUrl={org?.shopSlug ? `${appUrl}/shop/${org.shopSlug}` : null}
    />
    <ShopInsights
      reviews={reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
      interested={interested.map((p) => ({ ...p, lastSeen: p.lastSeen.toISOString() }))}
      wishlisted={wishlisted}
      canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('products.edit')}
    />
    </>
  );
}
