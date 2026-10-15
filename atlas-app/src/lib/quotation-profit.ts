/**
 * What a quotation actually earns.
 *
 * `Quotation.costPricePaise`, `transportPaise` and `incentivePaise` have been
 * in the schema since day one and **nothing has ever read or written them**.
 * The reference app has a Profit Analysis panel on this form; Atlas had the
 * columns and no calculation, so the margin a salesperson saw was whatever they
 * typed - a hope, not a number.
 *
 * This is that calculation.
 *
 * WHAT COUNTS AS COST
 *
 * Three things come off the revenue, and they are not the same kind of thing:
 *
 *  - **Goods cost** - what the items cost to buy, from the purchase history.
 *    Resolved server-side per line, never sent by the browser.
 *  - **Transport** - freight paid to get the goods to the customer. A real cost
 *    even when delivery is charged separately, and often more than the margin.
 *  - **Incentive** - commission owed to the salesperson or agent on this deal.
 *    Money that leaves on the back of this sale, so it belongs here.
 *
 * WHAT DOES NOT
 *
 * **GST is not revenue and not a cost.** It is collected on behalf of the
 * government and paid straight out again. Including it would inflate every
 * margin by the tax rate, which is the single most common way a profit figure
 * on an Indian quotation ends up wrong. Profit is computed on the taxable base.
 *
 * **Delivery charged to the customer is revenue**, and it is added - otherwise
 * a quotation that recovers its freight looks identical to one that eats it.
 *
 * Pure - no database, no `server-only`. Tested without a database.
 *
 * Spec: 04-quotation.md §2.9 (Profit Analysis)
 */

export interface ProfitLineInput {
  qty: number;
  /** After the line discount, before the order discount and before tax. */
  netPaise: number;
  /** The order-level discount apportioned to this line. */
  apportionedDiscountPaise: number;
  /** Unit cost from the purchase history. Null when genuinely unknown. */
  unitCostPaise: number | null;
}

export interface ProfitLine {
  revenuePaise: number;
  costPaise: number;
  profitPaise: number;
  /** True when this line's cost is unknown and so contributes nothing. */
  costUnknown: boolean;
}

export interface ProfitAnalysis {
  lines: ProfitLine[];

  /** Taxable base - what the customer pays for goods, after every discount. */
  revenuePaise: number;
  /** Delivery recovered from the customer. Revenue, not a discount. */
  deliveryRevenuePaise: number;

  goodsCostPaise: number;
  transportPaise: number;
  incentivePaise: number;
  totalCostPaise: number;

  profitPaise: number;
  /** Of revenue. Null when nothing was sold or nothing is known. */
  marginPct: number | null;

  /**
   * How much of the revenue sits on lines whose cost is unknown.
   *
   * The profit figure is only as good as this is small. A quotation where half
   * the value has no cost behind it has a margin that means very little, and
   * the panel has to be able to say so rather than print a confident number.
   */
  revenueWithoutCostPaise: number;
  linesWithoutCost: number;
  /** True when NOTHING has a cost - the figure is not worth showing at all. */
  unknown: boolean;
}

export interface ProfitOpts {
  /** Delivery charged to the customer. Zero when exempt. */
  deliveryRevenuePaise: number;
  /** Freight actually paid. Entered by the person quoting. */
  transportPaise: number;
  /** Commission owed on this deal. */
  incentivePaise: number;
}

export function computeProfit(
  lines: ProfitLineInput[],
  opts: ProfitOpts,
): ProfitAnalysis {
  const out: ProfitLine[] = lines.map((l) => {
    // Revenue for this line is its net value less the share of the order
    // discount it carried. Matches exactly what GST was charged on, so profit
    // and tax are computed off the same base and cannot drift apart.
    const revenuePaise = l.netPaise - l.apportionedDiscountPaise;

    if (l.unitCostPaise === null || l.unitCostPaise <= 0) {
      return { revenuePaise, costPaise: 0, profitPaise: 0, costUnknown: true };
    }

    const costPaise = Math.round(l.qty * l.unitCostPaise);
    return { revenuePaise, costPaise, profitPaise: revenuePaise - costPaise, costUnknown: false };
  });

  const revenuePaise = out.reduce((s, l) => s + l.revenuePaise, 0);
  const goodsCostPaise = out.reduce((s, l) => s + l.costPaise, 0);

  const revenueWithoutCostPaise = out
    .filter((l) => l.costUnknown)
    .reduce((s, l) => s + l.revenuePaise, 0);
  const linesWithoutCost = out.filter((l) => l.costUnknown).length;

  const totalCostPaise = goodsCostPaise + opts.transportPaise + opts.incentivePaise;

  // Delivery recovered from the customer is revenue. Freight paid out is a
  // cost. They are separate numbers and frequently different.
  const totalRevenuePaise = revenuePaise + opts.deliveryRevenuePaise;
  const profitPaise = totalRevenuePaise - totalCostPaise;

  const unknown = out.length > 0 && out.every((l) => l.costUnknown);

  return {
    lines: out,
    revenuePaise,
    deliveryRevenuePaise: opts.deliveryRevenuePaise,
    goodsCostPaise,
    transportPaise: opts.transportPaise,
    incentivePaise: opts.incentivePaise,
    totalCostPaise,
    profitPaise,
    marginPct:
      totalRevenuePaise > 0 && !unknown
        ? Math.round(((profitPaise / totalRevenuePaise) * 100) * 100) / 100
        : null,
    revenueWithoutCostPaise,
    linesWithoutCost,
    unknown,
  };
}

/**
 * How much the margin can be trusted, as a share of revenue with known cost.
 *
 * Exposed separately because it is the number that decides whether the panel
 * shows a figure confidently or with a caveat. 100 means every line is priced;
 * 0 means the margin is fiction.
 */
export function confidencePct(a: ProfitAnalysis): number {
  const total = a.revenuePaise;
  if (total <= 0) return 0;
  return Math.round(((total - a.revenueWithoutCostPaise) / total) * 100);
}
