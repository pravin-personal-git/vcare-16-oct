/**
 * Product cost, margin, and stock valuation.
 *
 * WHY THIS FILE EXISTS
 *
 * Until now Atlas had no product cost. `ProductPrice.costPaise` was a column
 * nothing filled, so there was no COGS, no stock valuation, and the "profit" on
 * a quotation was a figure someone typed. The first question any client asks -
 * *"is mahine kitna profit hua?"* - had no answer.
 *
 * The roadmap treated that as blocked on building a Purchase module. Walking
 * the reference app showed it is not: that app keeps a rolling history of the
 * last few purchase prices and lets you pick the valuation basis. Recording
 * what you paid is a far smaller thing than a purchase order, and it is all the
 * cost figure actually needs.
 *
 * Pure - no database, no `server-only`. The browser and the server both import
 * this, and the tests run it without a database.
 *
 * Spec: 07-products-suppliers.md, and the reference app's System Configuration
 * card 9 ("Product cost / price").
 */

/**
 * How a product's cost is decided.
 *
 * Named to match the reference app so a migrating client recognises the words.
 */
export type CostMethod = 'standard' | 'last_purchase' | 'average_3';

export const COST_METHODS: { value: CostMethod; label: string; hint: string }[] = [
  {
    value: 'standard',
    label: 'Standard cost',
    hint: 'The cost typed on the product. Stable and predictable, and wrong the moment prices move.',
  },
  {
    value: 'last_purchase',
    label: 'Last purchase price',
    hint: 'What you paid most recently. Tracks the market closely; jumps on a single odd purchase.',
  },
  {
    value: 'average_3',
    label: 'Average of last 3 purchases',
    hint: 'Smooths out one unusual bill. The safest default for a trading business.',
  },
];

/** How many purchases the rolling average considers. */
export const AVERAGE_WINDOW = 3;

export interface PurchasePrice {
  unitCostPaise: number;
  purchasedAt: Date;
}

export interface CostResult {
  /** Paise per unit. Zero means genuinely unknown, not free. */
  unitCostPaise: number;
  /** How it was arrived at, so a screen can say so rather than assert a number. */
  basis: CostMethod | 'none';
  /** Purchases actually used. Lets the UI say "average of 2" when only 2 exist. */
  samples: number;
}

/**
 * Resolve a product's unit cost.
 *
 * `history` need not be sorted - this sorts it, because a caller passing rows
 * straight from a query in some other order would otherwise silently get the
 * wrong "last" price, and nothing about the result would look wrong.
 *
 * Returns `basis: 'none'` rather than 0 when there is nothing to go on. Those
 * are different facts: a product nobody has priced is not a product that costs
 * nothing, and a margin computed against an unknown cost is a lie with a
 * decimal point in it.
 */
export function resolveUnitCost(
  method: CostMethod,
  history: PurchasePrice[],
  standardCostPaise = 0,
): CostResult {
  if (method === 'standard') {
    return standardCostPaise > 0
      ? { unitCostPaise: standardCostPaise, basis: 'standard', samples: 0 }
      : { unitCostPaise: 0, basis: 'none', samples: 0 };
  }

  const sorted = [...history]
    .filter((h) => h.unitCostPaise > 0)
    .sort((a, b) => b.purchasedAt.getTime() - a.purchasedAt.getTime());

  if (sorted.length === 0) {
    // Fall back to the standard cost rather than reporting nothing - a typed
    // cost is a weak answer, but it beats leaving every margin blank while the
    // purchase history fills up.
    return standardCostPaise > 0
      ? { unitCostPaise: standardCostPaise, basis: 'standard', samples: 0 }
      : { unitCostPaise: 0, basis: 'none', samples: 0 };
  }

  if (method === 'last_purchase') {
    return { unitCostPaise: sorted[0].unitCostPaise, basis: 'last_purchase', samples: 1 };
  }

  const window = sorted.slice(0, AVERAGE_WINDOW);
  const total = window.reduce((sum, h) => sum + h.unitCostPaise, 0);

  return {
    // Rounded to whole paise. Money is integers here as everywhere else.
    unitCostPaise: Math.round(total / window.length),
    basis: 'average_3',
    samples: window.length,
  };
}

export interface Margin {
  /** Selling price less cost, per unit. Negative when selling below cost. */
  marginPaise: number;
  /** Margin as a percentage OF THE SELLING PRICE. Null when unknowable. */
  marginPct: number | null;
  /** Margin as a percentage of cost - the mark-up. Null when unknowable. */
  markupPct: number | null;
  /** True when cost is unknown, so the caller shows "-" rather than "100%". */
  unknown: boolean;
}

/**
 * Margin on one unit.
 *
 * TWO PERCENTAGES, DELIBERATELY
 *
 * Buy at ₹80, sell at ₹100. The margin is 20% of the selling price and a 25%
 * mark-up on cost. Both are correct and people mean different ones - a
 * salesperson usually means mark-up, an accountant usually means margin. Naming
 * only one "profit %" is how two people read the same screen and disagree about
 * whether a deal is good, so both are returned and the UI labels them.
 *
 * `unknown` is not the same as zero. A product with no purchase history has no
 * margin, and showing "100%" because cost is 0 would flatter every unpriced
 * product on the list.
 */
export function computeMargin(sellingPaise: number, costPaise: number): Margin {
  if (costPaise <= 0) {
    return { marginPaise: 0, marginPct: null, markupPct: null, unknown: true };
  }

  const marginPaise = sellingPaise - costPaise;

  return {
    marginPaise,
    marginPct: sellingPaise > 0 ? round2((marginPaise / sellingPaise) * 100) : null,
    markupPct: round2((marginPaise / costPaise) * 100),
    unknown: false,
  };
}

export interface ValuationLine {
  qty: number;
  unitCostPaise: number;
  costKnown: boolean;
}

export interface Valuation {
  /** Total value of stock whose cost is known. */
  valuePaise: number;
  /** Units counted in that figure. */
  unitsValued: number;
  /** Units held whose cost is unknown, and therefore NOT in valuePaise. */
  unitsUnvalued: number;
  /** Products contributing nothing because their cost is unknown. */
  productsUnvalued: number;
}

/**
 * Value the stock on hand.
 *
 * Unknown-cost lines are counted and reported **separately** rather than valued
 * at zero. A valuation that quietly treats unpriced stock as worthless
 * understates the balance sheet and gives no hint that it has done so - the
 * screen needs to be able to say "₹29.4 L, plus 412 units we cannot value yet".
 *
 * Negative quantities are included as-is. Stock can genuinely go negative when
 * goods are handed over before the paperwork catches up, and hiding that from
 * the valuation would make the number disagree with the stock screen.
 */
export function valueStock(lines: ValuationLine[]): Valuation {
  let valuePaise = 0;
  let unitsValued = 0;
  let unitsUnvalued = 0;
  let productsUnvalued = 0;

  for (const line of lines) {
    if (!line.costKnown || line.unitCostPaise <= 0) {
      if (line.qty !== 0) unitsUnvalued += line.qty;
      productsUnvalued += 1;
      continue;
    }
    valuePaise += line.qty * line.unitCostPaise;
    unitsValued += line.qty;
  }

  return { valuePaise, unitsValued, unitsUnvalued, productsUnvalued };
}

/**
 * Does this product carry stock?
 *
 * A service does not: no movement, no balance, no valuation, no reorder level.
 * Every place that assumed every product has stock has to ask this first.
 */
export function holdsStock(kind: string): boolean {
  return kind !== 'service';
}

/** Goods declare an HSN code; services declare a SAC. */
export function taxCodeLabel(kind: string): 'HSN' | 'SAC' {
  return kind === 'service' ? 'SAC' : 'HSN';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
