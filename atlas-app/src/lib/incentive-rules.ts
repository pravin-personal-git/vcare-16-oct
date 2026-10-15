/**
 * The sales incentive rule engine (workstream H, 1 Oct 2026).
 *
 * WHAT WAS THERE BEFORE: nothing. `Quotation.incentivePaise` was a number
 * somebody typed by hand on each quotation. No rule, no check, and it appeared
 * on no dashboard. The incentive screen only tracked whether that typed figure
 * had been paid.
 *
 * Pravin's decision: every scheme below must be available, and EACH BUSINESS
 * OWNER CHOOSES which to use. It is a setting, not a build-time choice.
 *
 * This module is deliberately pure - no database, no scope, no Prisma. An
 * incentive calculation is the kind of thing people argue about with a
 * calculator in hand, so it has to be testable to the rupee without a server.
 */

export type IncentiveBasis =
  /** A number typed on the deal. The override, kept because sometimes the owner just decides. */
  | 'manual'
  /**
   * The same amount on every deal, whatever it is worth (9 Oct 2026).
   *
   * The commonest scheme in a small business - "five hundred rupees a
   * sale" - and until now the only way to run it was to type the same
   * figure onto every quotation by hand. Nobody did, so the Sales
   * Incentive screen stayed empty and the scheme lived in somebody's
   * head instead of in the books.
   */
  | 'flat'
  /** Percentage of what the customer pays, before tax. */
  | 'value'
  /** Percentage of value minus cost. Needs cost to be reliable at the moment of sale. */
  | 'margin'
  /** Tiered by deal value. */
  | 'slab'
  /** A rate carried by each product or its category. */
  | 'per_item';

/**
 * When the incentive is considered earned.
 *
 * This is the setting that protects the owner's money. Paying on `accepted`
 * means paying for a deal that may never be delivered or paid for, and that is
 * money which does not come back on its own.
 */
export type IncentiveEarnedOn = 'accepted' | 'invoiced' | 'paid';

/**
 * How a slab applies - and this is the single likeliest thing to be argued
 * about, so it is an explicit choice rather than an assumption.
 *
 * `whole`      - the deal's whole value earns the rate of the tier it lands in.
 * `marginal`   - each portion earns its own tier's rate, like income tax.
 *
 * On a 6,00,000 deal with tiers 0-5L at 1% and 5L+ at 2%, `whole` pays 12,000
 * and `marginal` pays 7,000. Neither is wrong; silently picking one is.
 */
export type SlabMode = 'whole' | 'marginal';

export interface Slab {
  /** Inclusive floor, in paise. The first slab should start at 0. */
  fromPaise: number;
  /** Percentage earned, e.g. 1.5 for one and a half percent. */
  percent: number;
}

export interface IncentiveRule {
  basis: IncentiveBasis;
  earnedOn: IncentiveEarnedOn;
  /** For `value` and `margin`. */
  percent?: number;
  /** For `flat` - the same amount on every deal that qualifies. */
  flatPaise?: number;
  /** For `slab`. */
  slabs?: Slab[];
  slabMode?: SlabMode;
  /** Never pay more than this on one deal. 0 or absent means no cap. */
  capPaise?: number;
  /** Below this deal value, nothing is earned. Keeps tiny deals out of payroll. */
  minimumDealPaise?: number;
}

export const DEFAULT_RULE: IncentiveRule = {
  // Manual by default, which is exactly what the product did before this
  // existed. Switching a client onto a percentage must be a decision somebody
  // makes, not something that happens to them on deploy.
  basis: 'manual',
  earnedOn: 'accepted',
  slabMode: 'marginal',
};

export interface DealLine {
  /** Value of this line after discount, before tax. */
  lineTotalPaise: number;
  /** What it cost us. Null when unknown - see `marginKnown`. */
  costPaise: number | null;
  /** Rate carried by the product or its category, for `per_item`. */
  percent?: number | null;
}

export interface Deal {
  /** Deal value after discount, before tax. */
  valuePaise: number;
  /** What was typed on the quotation, used by `manual`. */
  manualPaise: number;
  lines: DealLine[];
}

export interface IncentiveResult {
  amountPaise: number;
  /** How it was worked out, in words, for the screen and for an argument. */
  workings: string;
  /**
   * True when the basis needed cost and every line had one.
   *
   * A margin scheme where half the products have no cost silently pays on a
   * margin that is wrong. The caller shows this rather than hiding it.
   */
  marginKnown: boolean;
  /** The cap bit, so the screen can say why the figure is lower than expected. */
  cappedFrom: number | null;
}

const pct = (amount: number, percent: number) => Math.round((amount * percent) / 100);
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

/** Slabs, lowest first, with anything malformed dropped rather than guessed at. */
function orderedSlabs(slabs: Slab[] | undefined): Slab[] {
  return [...(slabs ?? [])]
    .filter((s) => Number.isFinite(s.fromPaise) && Number.isFinite(s.percent) && s.fromPaise >= 0)
    .sort((a, b) => a.fromPaise - b.fromPaise);
}

function slabAmount(valuePaise: number, rule: IncentiveRule): { amount: number; workings: string } {
  const slabs = orderedSlabs(rule.slabs);
  if (slabs.length === 0) return { amount: 0, workings: 'No slabs set up.' };

  if ((rule.slabMode ?? 'marginal') === 'whole') {
    // The highest slab whose floor the deal reaches.
    let chosen = slabs[0]!;
    for (const s of slabs) if (valuePaise >= s.fromPaise) chosen = s;
    const amount = pct(valuePaise, chosen.percent);
    return {
      amount,
      workings: `${rupees(valuePaise)} falls in the ${chosen.percent}% slab (from ${rupees(chosen.fromPaise)}), whole value: ${rupees(amount)}`,
    };
  }

  // Marginal: each portion earns its own tier's rate.
  let amount = 0;
  const parts: string[] = [];
  for (let i = 0; i < slabs.length; i++) {
    const s = slabs[i]!;
    if (valuePaise <= s.fromPaise) break;
    const next = slabs[i + 1];
    const upper = next ? Math.min(next.fromPaise, valuePaise) : valuePaise;
    const portion = upper - s.fromPaise;
    if (portion <= 0) continue;
    const earned = pct(portion, s.percent);
    amount += earned;
    parts.push(`${rupees(portion)} at ${s.percent}% = ${rupees(earned)}`);
  }
  return { amount, workings: parts.join('; ') || 'Below the first slab.' };
}

/**
 * Work out what one deal earns.
 *
 * Returns 0 with an explanation rather than throwing: an incentive that cannot
 * be calculated must not stop a quotation being saved.
 */
export function calculateIncentive(deal: Deal, rule: IncentiveRule): IncentiveResult {
  const minimum = rule.minimumDealPaise ?? 0;
  if (minimum > 0 && deal.valuePaise < minimum) {
    return {
      amountPaise: 0,
      workings: `Deal is under the ${rupees(minimum)} minimum, so nothing is earned.`,
      marginKnown: true,
      cappedFrom: null,
    };
  }

  let raw = 0;
  let workings = '';
  let marginKnown = true;

  switch (rule.basis) {
    case 'manual':
      raw = Math.max(0, deal.manualPaise);
      workings = `Entered on the quotation: ${rupees(raw)}`;
      break;

    case 'flat':
      raw = Math.max(0, rule.flatPaise ?? 0);
      workings = `${rupees(raw)} a deal, whatever it is worth`;
      break;

    case 'value': {
      const p = rule.percent ?? 0;
      raw = pct(deal.valuePaise, p);
      workings = `${p}% of ${rupees(deal.valuePaise)} = ${rupees(raw)}`;
      break;
    }

    case 'margin': {
      const p = rule.percent ?? 0;
      // A line with no known cost contributes NO margin rather than being
      // treated as free, which would pay out on a profit nobody made.
      marginKnown = deal.lines.length > 0 && deal.lines.every((l) => l.costPaise !== null);
      const margin = deal.lines.reduce(
        (n, l) => n + (l.costPaise === null ? 0 : l.lineTotalPaise - l.costPaise),
        0,
      );
      raw = margin > 0 ? pct(margin, p) : 0;
      workings = `${p}% of margin ${rupees(margin)} = ${rupees(raw)}`
        + (marginKnown ? '' : ' (some items have no cost recorded, so the margin is understated)');
      break;
    }

    case 'slab': {
      const r = slabAmount(deal.valuePaise, rule);
      raw = r.amount;
      workings = r.workings;
      break;
    }

    case 'per_item': {
      const parts: string[] = [];
      for (const l of deal.lines) {
        const p = l.percent ?? 0;
        if (!p) continue;
        const earned = pct(l.lineTotalPaise, p);
        raw += earned;
        parts.push(`${rupees(l.lineTotalPaise)} at ${p}% = ${rupees(earned)}`);
      }
      workings = parts.join('; ') || 'No item carries an incentive rate.';
      break;
    }
  }

  raw = Math.max(0, raw);

  const cap = rule.capPaise ?? 0;
  if (cap > 0 && raw > cap) {
    return {
      amountPaise: cap,
      workings: `${workings} — capped at ${rupees(cap)}`,
      marginKnown,
      cappedFrom: raw,
    };
  }

  return { amountPaise: raw, workings, marginKnown, cappedFrom: null };
}

/** Plain-English labels for the settings screen. */
export const BASIS_LABEL: Record<IncentiveBasis, string> = {
  flat: 'Same amount every sale',
  manual: 'A figure typed on each deal',
  value: 'Percentage of deal value',
  margin: 'Percentage of margin',
  slab: 'Slabs by deal value',
  per_item: 'A rate per product or category',
};

export const EARNED_ON_LABEL: Record<IncentiveEarnedOn, string> = {
  accepted: 'When the quotation is accepted',
  invoiced: 'When the deal is invoiced',
  paid: 'When the customer has paid',
};

export const EARNED_ON_HINT: Record<IncentiveEarnedOn, string> = {
  accepted: 'Earliest, and the most generous. The deal may still fall through.',
  invoiced: 'The goods or service have gone out and the bill is raised.',
  paid: 'Safest for you - nothing is owed until the money is in.',
};

/**
 * Validate a rule arriving from the database or a form.
 *
 * Never throws and never returns a half-rule: anything unrecognised falls back
 * to the default. A malformed rule must not stop a quotation being saved, and
 * a rule that silently keeps one bad field is worse than one that is plainly
 * the default.
 */
export function parseIncentiveRule(v: unknown): IncentiveRule {
  const d = DEFAULT_RULE;
  if (!v || typeof v !== 'object') return { ...d };
  const o = v as Record<string, unknown>;

  const bases: IncentiveBasis[] = ['manual', 'flat', 'value', 'margin', 'slab', 'per_item'];
  const timings: IncentiveEarnedOn[] = ['accepted', 'invoiced', 'paid'];

  const num = (x: unknown, fallback = 0) => {
    const n = Number(x);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const slabs = Array.isArray(o.slabs)
    ? (o.slabs as unknown[])
        .map((raw) => {
          const r = (raw ?? {}) as Record<string, unknown>;
          return { fromPaise: num(r.fromPaise), percent: num(r.percent) };
        })
        .filter((sl) => sl.percent > 0 || sl.fromPaise > 0)
        .sort((a, b) => a.fromPaise - b.fromPaise)
    : undefined;

  return {
    basis: bases.includes(o.basis as IncentiveBasis) ? (o.basis as IncentiveBasis) : d.basis,
    earnedOn: timings.includes(o.earnedOn as IncentiveEarnedOn)
      ? (o.earnedOn as IncentiveEarnedOn)
      : d.earnedOn,
    percent: num(o.percent),
    flatPaise: Math.round(num(o.flatPaise)),
    slabs,
    slabMode: o.slabMode === 'whole' ? 'whole' : 'marginal',
    capPaise: Math.round(num(o.capPaise)),
    minimumDealPaise: Math.round(num(o.minimumDealPaise)),
  };
}
