/**
 * Why stock came in with no supplier (Scan-to-Stock G6, 12 Oct 2026). Shared
 * by the Stock in by scan screen and server/stock-in. `opening` moves stock as
 * an opening balance; the rest as a counted adjustment, with this reason on
 * every movement and unit.
 */
export const STOCK_IN_REASONS = {
  opening: 'Opening stock',
  found: 'Found in a stock count',
  transfer_in: 'Transfer in from another branch',
  other: 'Other (say where from)',
} as const;
export type StockInReason = keyof typeof STOCK_IN_REASONS;
