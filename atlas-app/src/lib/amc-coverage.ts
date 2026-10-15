import { addMonths, daysBetween, startOfDay } from './expiry';

/**
 * WHO PAYS FOR THIS SERVICE CALL.
 *
 * The question a CCTV business answers dozens of times a day, currently by
 * somebody remembering. Getting it wrong costs money in both directions: bill
 * a customer who holds a contract and you have an argument; attend free for a
 * customer who does not and you have given away a day's labour.
 *
 * Three answers, in strict priority order:
 *
 *   1. AMC        - an active maintenance contract covers it.
 *   2. Warranty   - no contract, but the equipment was sold recently enough
 *                   that its warranty has not run out.
 *   3. Chargeable - neither. Quote for it.
 *
 * AMC OUTRANKS WARRANTY, DELIBERATELY
 *
 * Both can be true at once - a customer who bought cameras six months ago and
 * also took a contract. AMC is the answer because it is the wider cover: a
 * warranty covers a manufacturing fault in one product, a contract covers
 * attending the site. Reporting "warranty" there would send a technician
 * expecting to replace a unit when the job is a service visit, and would let
 * the contract the customer paid for go unrecorded against the work it bought.
 *
 * WHY THIS IS A PURE FUNCTION
 *
 * It is a rule about dates and money, and per CLAUDE.md those are the things
 * to test hardest. Kept free of Prisma so the tests state the rule directly
 * rather than through a mocked database, and so the same rule can answer both
 * "who pays" on a complaint and "what is covered" on a contract screen without
 * two implementations drifting apart.
 */

export type CoverageKind = 'amc' | 'warranty' | 'chargeable';

export const COVERAGE_LABEL: Record<CoverageKind, string> = {
  amc: 'Under AMC',
  warranty: 'Under warranty',
  chargeable: 'Chargeable',
};

/** What an AMC contract has to look like for this rule to read it. */
export interface CoverageContract {
  id: string;
  contractNo: string;
  startDate: Date;
  endDate: Date;
  /** Only `active` contracts cover anything - see `coveredBy`. */
  status: string;
  /**
   * Product ids this contract is itemised to.
   *
   * EMPTY MEANS THE WHOLE SITE, NOT NOTHING.
   *
   * Both are real ways this trade sells a contract: "we maintain your eight
   * cameras" (itemised) and "we maintain your premises" (not). An empty list
   * has to mean site-wide, because the alternative - a contract that covers no
   * equipment - is not a thing anybody sells, and reading it as "nothing"
   * would silently make every site-wide contract useless.
   */
  productIds: string[];
  /**
   * What the contract pays for: `labour_only` (the default, and what a free
   * sale-born AMC is) or `parts_and_labour`. Read only by `resolveSplitCover`;
   * the older single-answer `resolveCoverage` ignores it.
   */
  terms?: string;
}

/** What the equipment side has to look like. */
export interface CoverageEquipment {
  /** Null when staff have not matched the complaint to a catalogue row yet. */
  productId: string | null;
  /**
   * When this customer bought this product - the most recent issued invoice
   * line for it. Null if they never did, or if it is not matched yet.
   */
  soldOn: Date | null;
  /** The product's warranty length. Null means the product carries no warranty. */
  warrantyMonths: number | null;
}

export interface Coverage {
  kind: CoverageKind;
  /** Plain-language reason, shown to whoever is about to dispatch. */
  reason: string;
  /** When the cover runs out. Null when chargeable. */
  until: Date | null;
  /** The contract that answered, when one did. */
  contractId: string | null;
  contractNo: string | null;
  /**
   * True when the answer rests on something nobody has filled in yet, so the
   * screen can say "probably chargeable, but check" rather than stating it
   * flatly. An unmatched product is the common case: 3,548 migrated complaints
   * arrived with no product link, and claiming those are chargeable with
   * confidence would be asserting something this rule cannot know.
   */
  uncertain: boolean;
}

/**
 * Does this contract cover this equipment on this date.
 *
 * Inclusive of both endpoints: a contract running 1 Apr to 31 Mar covers work
 * done on 31 March. Anything else means a customer who paid for a year gets
 * 364 days.
 */
export function coveredBy(
  contract: CoverageContract,
  productId: string | null,
  onDate: Date,
): boolean {
  if (contract.status !== 'active') return false;

  const day = startOfDay(onDate).getTime();
  if (day < startOfDay(contract.startDate).getTime()) return false;
  if (day > startOfDay(contract.endDate).getTime()) return false;

  // Site-wide - covers whatever is there, including equipment nobody has
  // matched to a catalogue row yet.
  if (contract.productIds.length === 0) return true;

  // Itemised, but we do not know what broke. Cannot claim cover; the caller
  // surfaces this as uncertain rather than as a flat no.
  if (!productId) return false;

  return contract.productIds.includes(productId);
}

/** When the warranty on this equipment runs out, or null if it has none. */
export function warrantyUntil(equipment: CoverageEquipment): Date | null {
  if (!equipment.soldOn) return null;
  if (equipment.warrantyMonths === null || equipment.warrantyMonths <= 0) return null;
  return addMonths(equipment.soldOn, equipment.warrantyMonths);
}

export function resolveCoverage(
  input: {
    contracts: CoverageContract[];
    equipment: CoverageEquipment;
    /** The day the work happens. Usually the complaint date, not today. */
    onDate: Date;
  },
): Coverage {
  const { contracts, equipment, onDate } = input;

  const hit = contracts.filter((c) => coveredBy(c, equipment.productId, onDate));
  if (hit.length > 0) {
    // Longest remaining cover first, so a customer holding a one-month
    // stopgap and a three-year contract is reported under the three-year one.
    const best = hit.reduce((a, b) => (b.endDate > a.endDate ? b : a));
    const left = daysBetween(onDate, best.endDate);
    return {
      kind: 'amc',
      reason: `${best.contractNo} runs to ${fmt(best.endDate)}`
        + (left <= 30 ? ` - ${left === 0 ? 'expires today' : `only ${left} days left`}` : ''),
      until: best.endDate,
      contractId: best.id,
      contractNo: best.contractNo,
      uncertain: false,
    };
  }

  const wUntil = warrantyUntil(equipment);
  if (wUntil && startOfDay(onDate).getTime() <= startOfDay(wUntil).getTime()) {
    return {
      kind: 'warranty',
      reason: `Sold ${fmt(equipment.soldOn!)}, ${equipment.warrantyMonths}-month warranty to ${fmt(wUntil)}`,
      until: wUntil,
      contractId: null,
      contractNo: null,
      uncertain: false,
    };
  }

  /**
   * Chargeable - but say how confident that is.
   *
   * An itemised contract exists for this customer and we do not know what
   * broke: that is the case most likely to be wrong, so it is called out
   * specifically rather than lumped in with "no cover of any kind".
   */
  const itemisedInForce = contracts.some(
    (c) => c.productIds.length > 0 && coveredBy(
      { ...c, productIds: [] }, null, onDate,
    ),
  );

  if (!equipment.productId && itemisedInForce) {
    return {
      kind: 'chargeable',
      reason: 'This customer holds a contract on specific equipment. '
        + 'Match the complaint to a product to see whether this is covered.',
      until: null,
      contractId: null,
      contractNo: null,
      uncertain: true,
    };
  }

  if (!equipment.productId) {
    return {
      kind: 'chargeable',
      reason: 'No contract on file. Equipment not identified, so warranty cannot be checked.',
      until: null,
      contractId: null,
      contractNo: null,
      uncertain: true,
    };
  }

  if (wUntil) {
    return {
      kind: 'chargeable',
      reason: `Warranty ran out ${fmt(wUntil)} and no contract covers this.`,
      until: null,
      contractId: null,
      contractNo: null,
      uncertain: false,
    };
  }

  return {
    kind: 'chargeable',
    reason: equipment.soldOn
      ? 'No contract, and this product carries no warranty.'
      : 'No contract, and no record of this customer buying this product.',
    until: null,
    contractId: null,
    contractNo: null,
    // No purchase record is not proof there was none - it could predate the
    // migration. Worth a second look before quoting.
    uncertain: !equipment.soldOn,
  };
}

/**
 * WHO PAYS, SPLIT IN TWO (10 Oct 2026, Pravin's rules).
 *
 * The single answer above treats an active AMC as "everything covered". Vcare
 * does not work that way: the AMC pays for the TECHNICIAN, the product
 * warranty pays for the PART (repair or replacement), and the two run on
 * separate clocks. So:
 *
 *   labour free  - an active contract covers this equipment
 *   parts free   - a `parts_and_labour` contract covers it, or the warranty is
 *                  running and has not been voided (lightning, water, damage)
 *
 *   AMC on,  warranty on   -> nothing to pay
 *   AMC off, warranty on   -> technician charged, part free
 *   AMC off, warranty off  -> everything charged
 *   AMC on,  warranty void -> technician free, part charged
 *
 * Kept beside `resolveCoverage` rather than replacing it: lists and old
 * callers still read the single kind, and it is still right as a summary.
 */
export interface SplitCover {
  labour: { free: boolean; reason: string; until: Date | null; contractId: string | null; contractNo: string | null };
  parts: { free: boolean; reason: string; until: Date | null; voided: boolean };
  uncertain: boolean;
}

export function resolveSplitCover(input: {
  contracts: CoverageContract[];
  equipment: CoverageEquipment;
  onDate: Date;
  /** Set when a manager has voided the warranty on this item. */
  warrantyVoid?: { reason: string } | null;
}): SplitCover {
  const { contracts, equipment, onDate, warrantyVoid } = input;
  const single = resolveCoverage({ contracts, equipment, onDate });

  const hit = contracts.filter((c) => coveredBy(c, equipment.productId, onDate));
  const best = hit.length ? hit.reduce((a, b) => (b.endDate > a.endDate ? b : a)) : null;
  const labour = best
    ? { free: true, reason: `AMC ${best.contractNo} to ${fmt(best.endDate)}`, until: best.endDate, contractId: best.id, contractNo: best.contractNo }
    : { free: false, reason: 'No AMC in force - every visit is charged.', until: null, contractId: null, contractNo: null };

  const comprehensive = hit.find((c) => c.terms === 'parts_and_labour') ?? null;
  const wUntil = warrantyUntil(equipment);
  const warrantyOn = !!wUntil && startOfDay(onDate).getTime() <= startOfDay(wUntil).getTime();

  let parts: SplitCover['parts'];
  if (comprehensive) {
    parts = { free: true, reason: `AMC ${comprehensive.contractNo} covers parts too`, until: comprehensive.endDate, voided: false };
  } else if (warrantyOn && warrantyVoid) {
    parts = { free: false, reason: `Warranty void - ${warrantyVoid.reason}`, until: wUntil, voided: true };
  } else if (warrantyOn) {
    parts = { free: true, reason: `Warranty to ${fmt(wUntil!)}`, until: wUntil, voided: false };
  } else {
    parts = {
      free: false,
      reason: wUntil ? `Warranty ran out ${fmt(wUntil)}.` : equipment.soldOn ? 'This product carries no warranty.' : 'No sale on record, so no warranty.',
      until: null,
      voided: false,
    };
  }
  return { labour, parts, uncertain: single.uncertain };
}

const fmt = (d: Date) =>
  d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
