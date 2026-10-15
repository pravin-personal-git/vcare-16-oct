import { requireContext } from '@/server/context';
import { stockReport } from '@/server/stock-report';
import { StockClient } from './StockClient';
import { StockTabs } from '@/components/stock/StockTabs';
import { serialStockGaps } from '@/server/stock-units';

/**
 * What is on the shelf, what it is worth, and what is about to run out.
 *
 * Real as of 9 Sep 2026. It could not have been before: valuing stock needs to
 * know what the stock cost, and nothing knew that until purchase bills existed.
 */
export default async function ProductStockPage() {
  const ctx = await requireContext();
  const [report, gaps] = await Promise.all([stockReport(ctx.scope), serialStockGaps(ctx.scope)]);

  return (
    <>
      <StockTabs active="qty" checks={gaps.length} />
      <StockClient report={report} />
    </>
  );
}
