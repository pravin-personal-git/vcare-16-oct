/**
 * Where service money goes in the books (health check ACC-1, 25 Sep 2026).
 * Pure, so the rules are tested without a database.
 */

export const ACCOUNT = {
  receivable: '1100',
  inventory: '1200',
  amcAdvance: '2500',
  sales: '4010',
  serviceIncome: '4030',
  amcIncome: '4040',
  warrantyCost: '5020',
  partsConsumed: '5030',
} as const;

export const AMC_REVENUE_MODES = ['spread', 'at_invoice'] as const;
export type AmcRevenueMode = (typeof AMC_REVENUE_MODES)[number];

/**
 * Share an invoice's taxable base between income accounts in proportion to
 * each line's value. The shares always add up to exactly `totalPaise` - the
 * rounding remainder goes to the largest share - so the journal balances.
 */
export function splitRevenue(
  lines: { account: string; weightPaise: number }[],
  totalPaise: number,
  fallbackAccount: string = ACCOUNT.sales,
): Map<string, number> {
  const weights = new Map<string, number>();
  for (const l of lines) if (l.weightPaise > 0) weights.set(l.account, (weights.get(l.account) ?? 0) + l.weightPaise);
  const sum = [...weights.values()].reduce((a, b) => a + b, 0);
  if (sum <= 0 || totalPaise === 0) return new Map([[fallbackAccount, totalPaise]]);
  const out = new Map<string, number>();
  let given = 0;
  for (const [acc, w] of weights) {
    const share = Math.floor((totalPaise * w) / sum);
    out.set(acc, share);
    given += share;
  }
  const largest = [...weights.entries()].sort((a, b) => b[1] - a[1])[0][0];
  out.set(largest, (out.get(largest) ?? 0) + (totalPaise - given));
  return out;
}

/** Whole months from `start` up to `asOf` - a month counts once its anniversary has passed. */
export function monthsElapsed(start: Date, asOf: Date): number {
  if (asOf < start) return 0;
  let m = (asOf.getFullYear() - start.getFullYear()) * 12 + (asOf.getMonth() - start.getMonth());
  if (asOf.getDate() < start.getDate()) m -= 1;
  return Math.max(0, m);
}

/**
 * How much of an AMC fee is earned by `asOf`, spread month by month over the
 * contract: one equal part per month that has fully passed, and the whole fee
 * once the contract has ended (so rounding never leaves a paisa behind).
 */
export function amcEarnedPaise(amountPaise: number, start: Date, end: Date, asOf: Date): number {
  if (amountPaise <= 0 || asOf < start) return 0;
  if (asOf >= end) return amountPaise;
  const total = Math.max(1, monthsElapsed(start, end) + 1);
  const done = Math.min(total, monthsElapsed(start, asOf));
  return Math.floor((amountPaise * done) / total);
}

/** Expense account for parts sent on a repair challan, by who pays for the repair. */
export function repairCostAccount(coverage: 'amc' | 'warranty' | 'chargeable'): string {
  return coverage === 'chargeable' ? ACCOUNT.partsConsumed : ACCOUNT.warrantyCost;
}
