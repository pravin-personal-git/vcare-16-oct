/**
 * WHAT TAX AN AMC IS BILLED AT - TYPED IN BY A PERSON, NEVER ASSUMED.
 *
 * This was a `const AMC_DEFAULT_TAX_RATE_PCT = 18` in server/amc.ts. 18 is the
 * usual GST rate for a maintenance service in India today, and it is still the
 * wrong KIND of thing to write in source: a rate is policy, the GST Council
 * revises it, it differs by what is actually being supplied, and a tenant
 * outside India has no use for it. CLAUDE.md decision 4 - wrong tax on an
 * invoice is a legal problem rather than a bug.
 *
 * A first attempt moved the 18 into a store setting with a per-contract
 * override. The client's instruction (24 Sep 2026) was plainer: the GST on an
 * AMC is an honest input field, filled in manually. So there is no default
 * anywhere in this chain - not in source, not on the store, not as a fallback.
 * The rate lives on the contract, a person typed it, and a contract that has
 * no rate cannot be invoiced until somebody types one. A blank that stops the
 * invoice is honest; a silent 18 that nobody chose is not.
 *
 * Pure, so the rules are testable without a database. The Decimal column
 * arrives already narrowed to `number | null` by the caller.
 */

/** A GST rate above this is a typo - there is no such tax. */
export const MAX_TAX_RATE_PCT = 100;

/**
 * Read a rate out of a form field, where blank means "not entered".
 *
 * Returns `null` for blank rather than throwing, because not every contract
 * has a fee to tax - an AMC included in the purchase price bills nothing - and
 * the caller decides whether blank is acceptable. See `requireAmcTaxRate`.
 *
 * Two decimal places, matching `Decimal(5, 2)` in the schema: 2.5 and 7.5 are
 * real Indian rates, 18.005 is a typo the database would round silently.
 * Zero is a real answer - an exempt or nil-rated supply - not a missing one.
 */
export function parseTaxRatePct(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim();
  if (s === '') return null;

  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`"${s}" is not a tax rate.`);
  if (n < 0) throw new Error('A tax rate cannot be negative.');
  if (n > MAX_TAX_RATE_PCT) throw new Error(`A tax rate cannot be above ${MAX_TAX_RATE_PCT}%.`);
  if (Math.round(n * 100) !== n * 100) {
    throw new Error('A tax rate can have at most two decimal places.');
  }
  return n;
}

/**
 * Whether a contract needs a rate before it can be saved.
 *
 * Only when it carries a fee. A contract with no fee - cover that came inside
 * the purchase price - never produces a tax document, and demanding a GST
 * rate for a zero amount would teach people to type any number to get past
 * the box, which is the exact habit this file exists to prevent.
 */
export function contractNeedsTaxRate(amountPaise: number): boolean {
  return amountPaise > 0;
}

/**
 * The rate to put on the AMC's invoice, or the reason there is not one.
 *
 * Tests for null rather than falsiness: a zero rate is a deliberate answer,
 * and `rate || ...` would treat it as missing.
 */
export function requireAmcTaxRate(
  contractNo: string,
  taxRatePct: number | null | undefined,
): number {
  if (taxRatePct === null || taxRatePct === undefined) {
    throw new Error(
      `${contractNo} has no GST rate. Edit the contract, enter the rate it is billed at `
      + '(0 if it is exempt), then raise the invoice.',
    );
  }
  if (taxRatePct < 0 || taxRatePct > MAX_TAX_RATE_PCT) {
    throw new Error(`${contractNo} carries a GST rate of ${taxRatePct}%, which cannot be right.`);
  }
  return taxRatePct;
}

/**
 * A SAC code out of a form field. Kept next to the rate because the two are
 * entered together.
 *
 * No fallback and no invented default: a blank SAC gets queried, a wrong one
 * gets filed. Indian SACs are six digits, but this only refuses the absurd
 * rather than enforcing a pattern - the tenant's accountant knows their code
 * better than this function does, and a rejected correct code is worse than
 * an odd one.
 */
export function parseSacCode(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (s === '') return null;
  if (s.length > 20) throw new Error('That SAC code is too long to be a SAC code.');
  return s;
}
