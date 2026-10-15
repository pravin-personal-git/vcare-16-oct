/**
 * The monthly cap on AI reads.
 *
 * Each read costs real money on the Anthropic bill, so every business has a
 * limit it sets itself. The month is the calendar month in India time - a
 * business in Bhilai expects its allowance back on the 1st at midnight IST,
 * not at 05:30 when UTC ticks over.
 */

export const DEFAULT_MONTHLY_LIMIT = 500;
export const MAX_MONTHLY_LIMIT = 20_000;

const IST_OFFSET_MS = 330 * 60_000;

/** Start (inclusive) and end (exclusive) of the IST calendar month containing `now`, as UTC instants. */
export function istMonthWindow(now: Date): { start: Date; end: Date } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS),
    end: new Date(Date.UTC(y, m + 1, 1) - IST_OFFSET_MS),
  };
}

export function quotaState(used: number, limit: number): { remaining: number; blocked: boolean } {
  const remaining = Math.max(0, limit - used);
  return { remaining, blocked: remaining === 0 };
}

/** The limit as typed in Settings. Whole number, 1 to MAX_MONTHLY_LIMIT. */
export function parseMonthlyLimit(input: string | number): number {
  const n = typeof input === 'number' ? input : Number(String(input).replace(/,/g, '').trim());
  if (!Number.isInteger(n) || n < 1) throw new Error('The monthly limit must be a whole number of at least 1.');
  if (n > MAX_MONTHLY_LIMIT) throw new Error(`The monthly limit cannot be above ${MAX_MONTHLY_LIMIT.toLocaleString('en-IN')}.`);
  return n;
}
