/**
 * Bank Statement - spec 10-accounts-purchase.md §1.9 ("Bank Statement").
 *
 * Pure logic only - no `db` import - so statement parsing and match-window
 * scoring can be unit-tested without a database, the same split as
 * costing.ts/product-cost.ts and sales-order-status.ts/sales-orders.ts.
 */

export interface ParsedStatementLine {
  txnDate: Date;
  description: string;
  debitPaise: number;
  creditPaise: number;
  reference: string | null;
}

export interface StatementRowError {
  error: string;
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v.trim() !== '') return v;
  }
  return '';
}

// Column headers a bank actually prints, normalised (lowercase, single-spaced)
// by lib/csv.ts::normaliseHeader before we ever see them.
const DATE_KEYS = ['date', 'txn date', 'transaction date', 'value date'];
const DESCRIPTION_KEYS = ['description', 'narration', 'particulars'];
const DEBIT_KEYS = ['debit', 'debit amt', 'debit amount', 'withdrawal', 'withdrawal amt', 'withdrawal amount'];
const CREDIT_KEYS = ['credit', 'credit amt', 'credit amount', 'deposit', 'deposit amt', 'deposit amount'];
const REFERENCE_KEYS = ['reference', 'ref no', 'chq no', 'chq/ref no', 'cheque no', 'utr'];

/**
 * Accepts the three date shapes an Indian bank statement actually uses:
 * ISO (`2026-09-17`) and day-first with either separator (`17/09/2026`,
 * `17-09-2026`). Never month-first - a bank statement is never MM/DD/YYYY,
 * and guessing between "17/09" (unambiguous, day > 12) and "09/09" (which a
 * US-style parser would silently misread) is exactly the class of bug a
 * dedicated parser exists to avoid.
 */
export function parseStatementDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const [, y, mo, d] = m;
    return validDate(+y, +mo, +d);
  }

  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) {
    const [, d, mo, y] = m;
    return validDate(+y, +mo, +d);
  }

  // "17-Sep-26", "17-Sep-2026", "17 Sep 2026" - a three-letter month name
  // rather than a number. Found live against a real Punjab National Bank
  // export, which uses exactly this shape; not a hypothetical format.
  m = /^(\d{1,2})[\s/-]([A-Za-z]{3,9})[\s/-](\d{2,4})$/.exec(s);
  if (m) {
    const [, d, monthName, yearRaw] = m;
    const month = MONTH_INDEX[monthName.toLowerCase().slice(0, 3)];
    if (!month) return null;
    // A 2-digit year on a bank statement is this century - Atlas has no
    // customer whose statement predates 2000. The 1900 branch below only
    // guards against an impossible date rather than a real ambiguity.
    const year = yearRaw.length <= 2
      ? 2000 + Number(yearRaw)
      : Number(yearRaw);
    return validDate(year, month, +d);
  }

  return null;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function validDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Catches "31/02/2026" - UTC arithmetic rolls it into March rather than
  // throwing, so the only way to notice is checking the month came back out
  // the way it went in.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

/**
 * A statement's Debit/Credit cell to paise. Blank, `-` and `0` all mean "not
 * this side of the line" and return 0, never `null` - `null` is reserved for
 * "this is not a number at all," which is a row-rejecting error one level up.
 */
export function parseAmountToPaise(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '');
  if (s === '' || s === '-') return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // A statement's Debit/Credit columns are magnitudes; a negative number here
  // means the wrong column was mapped, not a genuine reversal.
  if (n < 0) return null;
  return Math.round(n * 100);
}

/**
 * One imported CSV row (already header-normalised by
 * `lib/csv.ts::rowsToObjects`) to a statement line, or the reason it was
 * rejected. Rejection never throws - a 400-row import with three bad dates
 * should report three errors and import the other 397, not abort the batch.
 */
export function parseStatementRow(row: Record<string, string>): ParsedStatementLine | StatementRowError {
  const dateRaw = pick(row, DATE_KEYS);
  const txnDate = parseStatementDate(dateRaw);
  if (!txnDate) return { error: dateRaw ? `Unrecognised date "${dateRaw}"` : 'Missing date' };

  const description = pick(row, DESCRIPTION_KEYS).trim();
  if (!description) return { error: 'Missing description' };

  const debitPaise = parseAmountToPaise(pick(row, DEBIT_KEYS));
  const creditPaise = parseAmountToPaise(pick(row, CREDIT_KEYS));
  if (debitPaise === null || creditPaise === null) return { error: 'Debit/credit amount is not a number' };
  if (debitPaise > 0 && creditPaise > 0) return { error: 'A line cannot be both a debit and a credit' };
  if (debitPaise === 0 && creditPaise === 0) return { error: 'Line has no debit or credit amount' };

  const reference = pick(row, REFERENCE_KEYS).trim() || null;

  return { txnDate, description, debitPaise, creditPaise, reference };
}

export function isStatementRowError(x: ParsedStatementLine | StatementRowError): x is StatementRowError {
  return 'error' in x;
}

/**
 * Running balance after each line, in the order given.
 *
 * Callers must sort by `txnDate` (then insertion order for same-day lines)
 * first - this function trusts the order it is given rather than sorting
 * internally, so a caller who wants "balance as of a filtered range" can pass
 * the full history and slice the *result*, keeping every kept row's balance
 * correct regardless of which rows are hidden afterward.
 */
export function runningBalances(
  openingPaise: number,
  lines: { debitPaise: number; creditPaise: number }[],
): number[] {
  let balance = openingPaise;
  return lines.map((l) => {
    balance = balance + l.creditPaise - l.debitPaise;
    return balance;
  });
}

/**
 * Whether two dates are close enough to be the same real-world payment.
 *
 * A cheque or NEFT commonly clears one to three bank-business-days after the
 * document date; `days` defaults to a working five-day window rather than
 * "same day," which would reject almost every genuine match.
 */
export function withinMatchWindow(a: Date, b: Date, days = 5): boolean {
  const ms = Math.abs(a.getTime() - b.getTime());
  return ms <= days * 24 * 60 * 60 * 1000;
}
