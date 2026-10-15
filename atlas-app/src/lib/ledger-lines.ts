/**
 * Turning documents into ledger lines with a running balance.
 *
 * Pure, and in lib/ rather than server/, because the running balance is the
 * part that goes wrong and it should be testable without a database.
 *
 * The two things that break a ledger:
 *
 *  1. **Ordering.** A payment sorted before the invoice it settles makes the
 *     balance go negative and then recover, which reads as the customer having
 *     paid in advance. Same-instant ties must put the debit first.
 *
 *  2. **The opening balance.** Filtering to a date window and then summing only
 *     the visible lines silently drops everything before it. The opening figure
 *     has to come from the full history, not the window.
 */

export interface RawLine {
  id: string;
  at: Date;
  kind: 'invoice' | 'payment';
  debitPaise: number;
  creditPaise: number;
}

export interface BalancedLine<T extends RawLine> {
  line: T;
  balancePaise: number;
}

/**
 * Chronological, with the debit first when two land on the same instant.
 *
 * Not a stable sort by accident - stated, because an invoice and its payment
 * frequently share a timestamp when both are recorded in one sitting.
 */
export function sortLedger<T extends RawLine>(lines: T[]): T[] {
  return [...lines].sort((a, b) => {
    const d = a.at.getTime() - b.at.getTime();
    if (d !== 0) return d;
    if (a.kind === b.kind) return 0;
    return a.kind === 'invoice' ? -1 : 1;
  });
}

/**
 * Running balance over a window, with everything before it folded into an
 * opening figure.
 *
 * `from`/`to` are inclusive of the boundary instants.
 */
export function runBalance<T extends RawLine>(
  lines: T[],
  from?: Date | null,
  to?: Date | null,
): { openingPaise: number; rows: BalancedLine<T>[]; closingPaise: number } {
  let running = 0;
  let openingPaise = 0;
  const rows: BalancedLine<T>[] = [];

  for (const l of sortLedger(lines)) {
    // Stop before anything after the window. The closing figure means "what
    // was owed as at `to`" - a statement that folded a future invoice into it
    // would tell a customer they owe money for goods not yet billed, and that
    // statement gets emailed.
    if (to && l.at > to) break;

    running += l.debitPaise - l.creditPaise;

    if (from && l.at < from) {
      openingPaise = running;
      continue;
    }

    rows.push({ line: l, balancePaise: running });
  }

  return { openingPaise, rows, closingPaise: running };
}
