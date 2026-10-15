import { addDays, addMonths, startOfDay } from './expiry';

/**
 * TURNING A SALE INTO COVER.
 *
 * The journey has three steps and they are easy to run together, so to be
 * explicit about which one this file owns:
 *
 *   1. The product says "I can have an AMC, on these terms"  <- the OFFER
 *   2. Somebody sells it, and the customer takes it or not    <- the CHOICE
 *   3. A contract exists and covers them                      <- lib/amc-coverage
 *
 * This file is steps 1 and 2: reading the offer off a product, deciding whether
 * a line carries AMC, working out the period, and saying whether a fee is still
 * owed. Step 3 - who pays for a given repair - is lib/amc-coverage.
 *
 * Pure, because these are date and money rules and per CLAUDE.md those are the
 * ones to test hardest. Nothing here touches Prisma.
 */

export const AMC_PRICING_MODES = ['included', 'extra'] as const;
export type AmcPricingMode = (typeof AMC_PRICING_MODES)[number];

export const AMC_PRICING_LABEL: Record<string, string> = {
  included: 'Included in the price',
  extra: 'Charged separately, yearly',
};

/** The AMC offer as it sits on a product. */
export interface AmcOffer {
  amcAvailable: boolean;
  amcPricingMode: string | null;
  amcDurationMonths: number | null;
  amcAnnualPricePaise: number | null;
  amcTerms: string | null;
}

/** The default term when a product says AMC is available but not for how long. */
export const DEFAULT_AMC_MONTHS = 12;

/**
 * Is this offer actually usable.
 *
 * `amcAvailable` alone is not enough - a product ticked as AMC-capable but with
 * no pricing mode is half-configured, and treating that as a live offer would
 * put an "Add AMC" box on an invoice with no price and no period behind it.
 */
export function offerIsUsable(o: AmcOffer): boolean {
  if (!o.amcAvailable) return false;
  if (o.amcPricingMode !== 'included' && o.amcPricingMode !== 'extra') return false;
  // An extra-cost AMC with no price is not an offer, it is an unfinished form.
  if (o.amcPricingMode === 'extra' && !o.amcAnnualPricePaise) return false;
  return true;
}

/** Months in one term. Falls back to 12 rather than to zero-length cover. */
export function termMonths(o: AmcOffer): number {
  return o.amcDurationMonths && o.amcDurationMonths > 0
    ? o.amcDurationMonths
    : DEFAULT_AMC_MONTHS;
}

/**
 * Does an AMC come with this product automatically.
 *
 * True only for `included`. This is the difference between cover the customer
 * already owns and cover somebody has to sell them: an `included` AMC is
 * ticked for them, an `extra` one is a choice they can decline, which is why
 * `InvoiceItem.amcOpted` is a stored answer rather than something derived.
 */
export function isAutomatic(o: AmcOffer): boolean {
  return offerIsUsable(o) && o.amcPricingMode === 'included';
}

/** The fee for one term, in paise. Zero when the AMC is included in the price. */
export function termPricePaise(o: AmcOffer): number {
  if (!offerIsUsable(o)) return 0;
  if (o.amcPricingMode === 'included') return 0;
  const annual = o.amcAnnualPricePaise ?? 0;
  // Priced per YEAR, so a term that is not twelve months is pro-rated. An
  // 18-month contract at 6,000/year is 9,000 - charging 6,000 would give six
  // months away, and charging 6,000 x 18 would be absurd.
  return Math.round((annual * termMonths(o)) / 12);
}

export interface AmcPeriod {
  startDate: Date;
  /** Inclusive - see `coveredBy` in lib/amc-coverage. */
  endDate: Date;
  months: number;
}

/**
 * The cover period for a term starting on `from`.
 *
 * END DATE IS A DAY SHORT OF THE ANNIVERSARY, ON PURPOSE.
 *
 * Twelve months from 1 April 2026 is 1 April 2027, but a one-year contract
 * running 1 Apr 2026 to 1 Apr 2027 covers 366 days and overlaps the next term
 * by a day. So it ends 31 March 2027: `coveredBy` treats the end date as
 * inclusive, which makes the period exactly a year and lets the renewal start
 * on 1 April with no gap and no overlap.
 */
export function amcPeriod(from: Date, months: number): AmcPeriod {
  // India days (9 Oct 2026): `setHours` / `setDate` used the server's
  // calendar, which is UTC on Vercel - see lib/expiry.
  const startDate = startOfDay(from);
  const anniversary = addMonths(startDate, months);
  const endDate = addDays(anniversary, -1);
  return { startDate, endDate, months };
}

/** An invoice line, as much of it as these rules read. */
export interface SoldLine {
  productId: string | null;
  productName: string;
  qty: number;
  amcOpted: boolean;
  amcMonths: number | null;
  amcPricePaise: number | null;
}

export interface PlannedContract {
  productId: string | null;
  productName: string;
  qty: number;
  period: AmcPeriod;
  amountPaise: number;
  coverageNote: string | null;
}

/**
 * What contracts an issued invoice should produce.
 *
 * One per line that carries AMC - see the note on `InvoiceItem.amcOpted` for
 * why per-line rather than per-unit or one bundled contract.
 *
 * Reads the SNAPSHOT on the line (`amcMonths`, `amcPricePaise`) and not the
 * product's current offer. The line recorded what was agreed on the day; the
 * product may have been repriced since, and re-reading it here would create a
 * contract on terms the customer never saw. The offer is passed in only to
 * recover the terms wording and to fill gaps where the snapshot is missing.
 */
export function planContractsForInvoice(
  lines: SoldLine[],
  offers: Map<string, AmcOffer>,
  invoiceDate: Date,
): PlannedContract[] {
  const out: PlannedContract[] = [];

  for (const line of lines) {
    if (!line.amcOpted) continue;

    const offer = line.productId ? offers.get(line.productId) : undefined;
    const months = line.amcMonths && line.amcMonths > 0
      ? line.amcMonths
      : offer ? termMonths(offer) : DEFAULT_AMC_MONTHS;

    out.push({
      productId: line.productId,
      productName: line.productName,
      qty: line.qty,
      period: amcPeriod(invoiceDate, months),
      // `?? 0` and not `|| 0`: an included AMC has a price of exactly 0, which
      // is a real answer, and `||` would send it down the fallback branch.
      amountPaise: line.amcPricePaise ?? 0,
      coverageNote: offer?.amcTerms ?? null,
    });
  }

  return out;
}

export interface VisitAllowance {
  /** Completed visits drawn from this contract. */
  used: number;
  /** What the contract promised. Null means unlimited. */
  included: number | null;
  /** Visits left. Null when unlimited. Never negative - see `exceededBy`. */
  remaining: number | null;
  /** True once the allowance is gone and further visits are chargeable. */
  exhausted: boolean;
  /**
   * How many visits have been made BEYOND the allowance.
   *
   * Separate from `remaining` because they answer different questions and
   * clamping one to zero would destroy the other. "0 left" and "3 over" are
   * both worth saying, and a business that has over-served a customer needs to
   * know by how much.
   */
  exceededBy: number;
  /** Unlimited contracts are never exhausted and have nothing to report. */
  unlimited: boolean;
}

/**
 * How much of a contract's visit allowance is left.
 *
 * DERIVED FROM A COUNT, never a stored tally. `visitsIncluded` recorded the
 * promise - "four services a year" - and until now nothing kept it: the number
 * could be typed, displayed, and quietly ignored forever. The count comes from
 * `ServiceVisit.amcContractId`, so cancelling a visit returns the allowance by
 * itself and no code has to remember to decrement anything.
 *
 * NULL MEANS UNLIMITED, WHICH IS NOT THE SAME AS ZERO. A contract promising
 * unlimited visits and one promising none are opposite ends of the scale, and
 * treating a blank field as zero would turn the most generous contract into the
 * meanest one.
 */
export function visitAllowance(input: {
  visitsIncluded: number | null;
  visitsUsed: number;
}): VisitAllowance {
  const used = Math.max(0, input.visitsUsed);

  if (input.visitsIncluded === null) {
    return {
      used, included: null, remaining: null,
      exhausted: false, exceededBy: 0, unlimited: true,
    };
  }

  const included = Math.max(0, input.visitsIncluded);
  return {
    used,
    included,
    remaining: Math.max(0, included - used),
    // `>=`, not `>`: having used exactly the allowance means it is spent, and
    // the NEXT visit is the chargeable one. Off by one here would give every
    // customer a free extra call.
    exhausted: used >= included,
    exceededBy: Math.max(0, used - included),
    unlimited: false,
  };
}

/** One line a person can read, for a badge or a dispatch screen. */
export function describeAllowance(a: VisitAllowance): string {
  if (a.unlimited) return `${a.used} visits used, unlimited included`;
  if (a.exceededBy > 0) {
    return `${a.used} of ${a.included} visits used - ${a.exceededBy} over the contract`;
  }
  if (a.exhausted) return `All ${a.included} included visits used`;
  return `${a.used} of ${a.included} visits used, ${a.remaining} left`;
}

export type BillingState = 'no_fee' | 'awaiting_invoice' | 'invoiced';

export const BILLING_LABEL: Record<BillingState, string> = {
  no_fee: 'Included in the sale',
  awaiting_invoice: 'Needs an invoice',
  invoiced: 'Invoiced',
};

/**
 * Whether this contract's fee still needs billing.
 *
 * DERIVED, not stored. A stored billing status is a promise to update it from
 * every place that could change it - and the schema comment on
 * `Party.currentBalancePaise` records what happened the last time this codebase
 * made that promise: it drifted negative by exactly the total every customer
 * had ever paid. Two facts already answer the question, so a third column
 * would only be able to disagree with them.
 */
export function billingState(c: { amountPaise: number; invoiceId: string | null }): BillingState {
  if (c.invoiceId) return 'invoiced';
  // No fee to bill. An AMC included in the purchase price is the normal case
  // here, not an error - the money arrived with the product.
  if (c.amountPaise <= 0) return 'no_fee';
  return 'awaiting_invoice';
}

/**
 * How many months a period built by `amcPeriod` runs - the inverse, so a
 * contract can be moved to a new start without changing its length.
 * Null when the dates were typed by hand and fit no whole number of months.
 */
export function periodMonths(startDate: Date, endDate: Date): number | null {
  for (let m = 1; m <= 120; m++) {
    if (amcPeriod(startDate, m).endDate.getTime() === startOfDay(endDate).getTime()) return m;
  }
  return null;
}

/**
 * Move a sale-born AMC to the installation date (10 Oct 2026, Pravin: "AMC
 * installation date se shuru hota hai"). The contract is created when the
 * invoice is issued, before anybody has installed anything; on the day the
 * installation is approved its period slides to start then, same length.
 *
 * Only forward, and only when the contract still starts on its invoice date -
 * a contract someone has already re-dated by hand is left alone.
 */
export function alignToInstall(input: { startDate: Date; endDate: Date; invoiceDate: Date; installDate: Date }): AmcPeriod | null {
  const start = startOfDay(input.startDate).getTime();
  if (start !== startOfDay(input.invoiceDate).getTime()) return null;
  if (startOfDay(input.installDate).getTime() <= start) return null;
  const months = periodMonths(input.startDate, input.endDate);
  return months ? amcPeriod(input.installDate, months) : null;
}
