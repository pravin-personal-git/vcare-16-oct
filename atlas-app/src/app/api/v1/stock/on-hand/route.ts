import { field } from '@/server/auth/v1-staff';
import { stockReport } from '@/server/stock-report';

/**
 * Stock on hand on the phone (13 Oct 2026, native admin app part 4): the
 * website's Stock on Hand (server/stock-report) - every product's quantity,
 * what is out of stock and what needs reordering. Value and cost only for
 * people who may see prices (hidden by `field` otherwise).
 */
export async function GET(req: Request) {
  return field(req, ['stock.view', 'purchase.view', 'purchase.edit'], 'stock', async (ctx) => {
    const r = await stockReport(ctx.scope);
    return {
      rows: r.rows.map((s) => ({
        productId: s.productId, code: s.productCode, name: s.productName, unit: s.unit, qty: s.qty,
        valuePaise: s.valuePaise, category: s.categoryName, brand: s.brandName, barcode: s.barcode,
        negative: s.negative, reorderLevel: s.reorderLevel, needsReorder: s.needsReorder,
      })),
      totalValuePaise: r.totalValuePaise, outOfStockCount: r.outOfStockCount, reorderCount: r.reorderCount, negativeCount: r.negativeCount,
    };
  });
}
