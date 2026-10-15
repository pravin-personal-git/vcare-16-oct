/**
 * Double-entry validation - pure, no database.
 *
 * D011's RULE 1: every financial transaction ends as balanced double-entry
 * journal lines. This is where "balanced" gets checked, the same way GST
 * math lives in one place (`gst.ts`) so no two documents can compute a
 * different tax on the same numbers - here, no two callers can post an
 * entry that doesn't actually balance.
 */

export interface LedgerLineInput {
  accountCode: string;
  debitPaise?: number;
  creditPaise?: number;
  partyId?: string | null;
  costCentre?: string | null;
  gstin?: string | null;
  description?: string | null;
}

export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerValidationError';
  }
}

/**
 * Throws with a specific reason if the lines are not a valid, balanced
 * entry. Returns the entry's total (debits, which must equal credits) on
 * success.
 */
export function validateBalanced(lines: LedgerLineInput[]): number {
  if (lines.length < 2) {
    throw new LedgerValidationError('A journal entry needs at least two lines.');
  }

  let debitTotal = 0;
  let creditTotal = 0;

  lines.forEach((line, i) => {
    const debit = Math.trunc(line.debitPaise ?? 0);
    const credit = Math.trunc(line.creditPaise ?? 0);

    if (debit < 0 || credit < 0) {
      throw new LedgerValidationError(`Line ${i + 1}: amounts cannot be negative.`);
    }
    if (debit > 0 && credit > 0) {
      throw new LedgerValidationError(`Line ${i + 1}: a line is either a debit or a credit, not both.`);
    }
    if (debit === 0 && credit === 0) {
      throw new LedgerValidationError(`Line ${i + 1}: every line needs an amount.`);
    }

    debitTotal += debit;
    creditTotal += credit;
  });

  if (debitTotal !== creditTotal) {
    throw new LedgerValidationError(
      `Debits (${debitTotal}) and credits (${creditTotal}) do not balance.`,
    );
  }

  return debitTotal;
}

/**
 * The lines for a reversal - every debit and credit swapped, same accounts
 * and dimensions. Swapping rather than negating: a negative `debitPaise`
 * would be a silent way to lie about which side of the ledger a line sits
 * on, and every report downstream reads that column as "this is a debit".
 */
export function reverseLines<T extends { debitPaise: number; creditPaise: number }>(
  lines: T[],
): T[] {
  return lines.map((l) => ({ ...l, debitPaise: l.creditPaise, creditPaise: l.debitPaise }));
}
