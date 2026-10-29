import { redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { stockHealth } from '@/server/stock-health';
import { StockHealthClient } from './StockHealthClient';
import { StockTabs } from '@/components/stock/StockTabs';
import { serialStockGaps } from '@/server/stock-units';
import { serialChecks } from '@/server/serial-links';
import { SerialChecksPanel } from '@/components/stock/SerialChecksPanel';

/**
 * Stock checks (2 Oct 2026).
 *
 * The two standing questions about stock that nothing in Atlas was asking:
 * does the shelf count agree with the items we can actually name, and is
 * anything about to go out of date.
 *
 * Both were invisible rather than absent - the data for each was already being
 * written and simply never read. 91 products disagreed with themselves and no
 * screen said so; expiry dates were captured on every batch for a year and
 * nobody was ever warned.
 */
export default async function StockHealthPage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('stock.view')) redirect('/dashboard');

  const [health, gaps, serials] = await Promise.all([stockHealth(ctx.scope, ctx.features), serialStockGaps(ctx.scope), serialChecks(ctx.scope)]);

  return (
    <>
    <StockTabs active="checks" checks={gaps.length} />
    <StockHealthClient
      canFix={ctx.permissions.has('stock.adjust') && ctx.scope.kind === 'single'}
      health={{
        ...health,
        expiry: {
          ...health.expiry,
          expired: health.expiry.expired.map((r) => ({ ...r, expiryDate: r.expiryDate.toISOString() })),
          expiring: health.expiry.expiring.map((r) => ({ ...r, expiryDate: r.expiryDate.toISOString() })),
        },
      }}
    />
    <SerialChecksPanel {...serials} />
    </>
  );
}
