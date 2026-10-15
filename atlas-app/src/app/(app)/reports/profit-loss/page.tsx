import { requireContext } from '@/server/context';
import { profitAndLoss } from '@/server/reports';
import { recognizeAmcRevenue } from '@/server/amc-revenue';
import { ProfitLossClient } from './ProfitLossClient';
import { istDayEnd, istDayStart, presetRange } from '@/lib/date-ranges';

/**
 * Did last month make money?
 *
 * Until 7 Sep 2026 this screen was four hardcoded numbers. It could not be
 * anything else: a profit and loss statement needs purchases, and purchases did
 * not exist in the product. Building the Purchase module is what unblocked it.
 *
 * What it shows is *indicative* and says so, loudly. See the note at the top of
 * `src/server/reports.ts` for exactly what is missing and why.
 */
export default async function ProfitLossPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  // AMC income earned up to today is moved into the books first (ACC-1).
  await recognizeAmcRevenue(ctx.scope, new Date(), ctx.user.id).catch((e) => console.error('[p&l] AMC release failed', e));

  // Default to this calendar month, which is the period a shopkeeper means when
  // they ask how the month is going.
  const now = new Date();
  // India days, not the server's UTC ones (9 Oct 2026): the month starts at
  // midnight India time, and ?to= runs to the end of that India day.
  const defaultFrom = presetRange('this_month', now).from!;

  const from = istDayStart(sp.from) ?? defaultFrom;
  const to = istDayEnd(sp.to) ?? now;

  const pnl = await profitAndLoss(ctx.scope, from, to);

  return (
    <ProfitLossClient
      pnl={{ ...pnl, from: pnl.from.toISOString(), to: pnl.to.toISOString() }}
    />
  );
}
