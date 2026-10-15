/**
 * Does the van add up at the end of the shift?
 *
 * Pure, and separate from the database for the same reason the billing rules
 * are: this decides whether somebody is asked to account for missing stock, and
 * that should be provable without a server.
 *
 * Pravin's decisions 6 and 7, in his words: stock handed to a technician sits
 * in the van, "we dont mark it as left stock, because its still with the
 * technicians", and "they do return things at the end of shift so it should
 * match what was given to them during the start".
 *
 * ---------------------------------------------------------------------------
 * THE ARITHMETIC, AND WHY IT IS NOT A SUBTRACTION
 *
 * The obvious formula is issued − used − returned = missing. It is wrong on the
 * second day. A van is not emptied every evening: two cameras that came back on
 * Tuesday are still on board on Wednesday morning, and a figure that starts
 * from "issued today" calls them a surplus.
 *
 * So the question asked here is the one the warehouse actually asks:
 *
 *     what the van is HOLDING, versus what it should be holding
 *
 * and what it should be holding is its opening balance plus everything issued,
 * less everything used on site and everything handed back. Anything else is
 * unaccounted for, and it stays against the van until a person resolves it.
 */

export interface VanLine {
  productId: string;
  productName: string;
  unit: string | null;
  /** On the van when the shift started. */
  openingQty: number;
  /** Loaded during the shift. */
  issuedQty: number;
  /** Fitted at a customer's site. */
  usedQty: number;
  /** Handed back to the branch. */
  returnedQty: number;
  /** What the stock ledger says is on the van right now. */
  onVanQty: number;
}

export interface ReconciledLine extends VanLine {
  /** opening + issued − used − returned. What the van ought to be holding. */
  expectedQty: number;
  /**
   * Signed. Negative means the van cannot account for stock; positive means it
   * is holding more than anybody issued it.
   */
  varianceQty: number;
  state: 'balanced' | 'short' | 'over';
}

export interface VanReconciliation {
  lines: ReconciledLine[];
  shortLines: number;
  overLines: number;
  /** True when every line balances, so the shift can be closed without a note. */
  settled: boolean;
}

export function reconcileVan(lines: VanLine[]): VanReconciliation {
  const out: ReconciledLine[] = lines.map((l) => {
    const expectedQty = l.openingQty + l.issuedQty - l.usedQty - l.returnedQty;
    const varianceQty = l.onVanQty - expectedQty;
    return {
      ...l,
      expectedQty,
      varianceQty,
      state: varianceQty === 0 ? 'balanced' : varianceQty < 0 ? 'short' : 'over',
    };
  });

  return {
    lines: out,
    shortLines: out.filter((l) => l.state === 'short').length,
    overLines: out.filter((l) => l.state === 'over').length,
    settled: out.every((l) => l.state === 'balanced'),
  };
}

/**
 * What the technician should hand back if the van is to be emptied.
 *
 * Not the same question as the one above. Reconciliation asks whether the books
 * are right; this asks what is physically still on board. A van that balances
 * perfectly can still be carrying eighty metres of cable.
 */
export function stillOnVan(r: VanReconciliation): ReconciledLine[] {
  return r.lines.filter((l) => l.onVanQty > 0);
}

/**
 * One line of plain English per problem.
 *
 * Written here rather than in the component so the wording is tested, and
 * because the difference between "three connectors" and "three cameras" is a
 * difference of tone a person has to read, not a number a screen can colour in.
 */
export function describeVariance(l: ReconciledLine): string | null {
  if (l.state === 'balanced') return null;
  const n = Math.abs(l.varianceQty);
  const unit = l.unit?.trim() ? ` ${l.unit.trim()}` : '';
  return l.state === 'short'
    ? `${n}${unit} of ${l.productName} cannot be accounted for.`
    : `${n}${unit} of ${l.productName} more than anybody issued. Check it was not loaded off the books.`;
}
