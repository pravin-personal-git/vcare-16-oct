/**
 * The arithmetic behind the balance sheet (area K, 11 Oct 2026) - pure, so the
 * server and the tests share it.
 *
 * WHY "AS AT" NEEDED THIS
 *
 * Until now only cash and GST respected the "As at" date. Receivables, payables
 * and stock were always today's figures, so "as at 31 March" mixed March's cash
 * with October's debtors. A chart of net worth by month would have been a line
 * of guesses. Everything below works out a figure at a past instant from what
 * is stored today, by rolling back what happened after it.
 */

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

export interface DocAt {
  id: string;
  /** The document's own date - an invoice dated after D did not exist at D. */
  date: Date;
  totalPaise: number;
  /** Settled today (the cached column: receipts + credit notes, or payments). */
  paidPaise: number;
}

export interface SettlementAt {
  docId: string;
  /** When the money (or the credit) actually arrived. */
  at: Date;
  paise: number;
}

/**
 * What was still owed on each document at instant `at`.
 *
 * Starts from today's settled figure and takes back every settlement dated
 * after `at`. Rolling back, rather than re-adding settlements from zero, keeps
 * today's answer exactly equal to the cached column - including documents whose
 * paid figure arrived through a migration rather than a receipt row.
 */
export function owedAt(docs: DocAt[], later: SettlementAt[], at: Date): Map<string, number> {
  const after = new Map<string, number>();
  for (const s of later) {
    if (s.at.getTime() > at.getTime()) after.set(s.docId, (after.get(s.docId) ?? 0) + s.paise);
  }
  const out = new Map<string, number>();
  for (const d of docs) {
    if (d.date.getTime() > at.getTime()) continue;
    const paid = Math.max(0, d.paidPaise - (after.get(d.id) ?? 0));
    const owed = Math.max(0, d.totalPaise - paid);
    if (owed > 0) out.set(d.id, owed);
  }
  return out;
}

export type AgeBucket = 'not_due' | 'd1_30' | 'd31_90' | 'd90_plus';

export const AGE_LABEL: Record<AgeBucket, string> = {
  not_due: 'Not yet due',
  d1_30: '1-30 days overdue',
  d31_90: '31-90 days overdue',
  d90_plus: 'Over 90 days overdue',
};

/** India calendar days between the due date and `at` (0 = due that day). */
export function daysOverdue(dueDate: Date, at: Date): number {
  const day = (d: Date) => Math.floor((d.getTime() + IST_MS) / DAY_MS);
  return day(at) - day(dueDate);
}

export function ageBucket(dueDate: Date, at: Date): AgeBucket {
  const d = daysOverdue(dueDate, at);
  if (d <= 0) return 'not_due';
  if (d <= 30) return 'd1_30';
  if (d <= 90) return 'd31_90';
  return 'd90_plus';
}

/**
 * The month-ends to draw: every month-end of the financial year up to (not
 * including) the month `asOf` falls in, then `asOf` itself. Plus the month-end
 * before `asOf` for the "vs last month" figure, which in April belongs to the
 * previous year. All instants are the last millisecond of an India day.
 */
export function monthEndsFor(asOf: Date): { points: { label: string; at: Date }[]; previous: Date } {
  const ist = new Date(asOf.getTime() + IST_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth(); // 0-11
  const fyStartYear = m >= 3 ? y : y - 1;
  const endOfMonth = (yy: number, mm: number) => new Date(Date.UTC(yy, mm + 1, 1) - IST_MS - 1);

  const points: { label: string; at: Date }[] = [];
  for (let idx = 3; ; idx++) {
    const yy = fyStartYear + Math.floor(idx / 12);
    const mm = idx % 12;
    if (yy === y && mm === m) break;
    points.push({ label: MONTH_SHORT[mm], at: endOfMonth(yy, mm) });
  }
  points.push({ label: MONTH_SHORT[m], at: asOf });
  return { points, previous: endOfMonth(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1) };
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface RatioInput {
  currentAssetsPaise: number;
  currentLiabilitiesPaise: number;
  loansPaise: number;
  netWorthPaise: number;
  cashPaise: number;
  /** Money paid out over the last 90 days, the pace "days of cash" divides by. */
  outflow90Paise: number;
}

export interface Ratios {
  workingCapitalPaise: number;
  /** Null when nothing is owed short-term - a ratio over zero means nothing. */
  currentRatio: number | null;
  /** Null when net worth is zero or negative - the ratio stops meaning anything. */
  debtToEquity: number | null;
  /** Null when nothing was paid out in 90 days. */
  daysOfCash: number | null;
}

export function ratios(r: RatioInput): Ratios {
  const perDay = r.outflow90Paise / 90;
  return {
    workingCapitalPaise: r.currentAssetsPaise - r.currentLiabilitiesPaise,
    currentRatio: r.currentLiabilitiesPaise > 0
      ? Math.round((r.currentAssetsPaise / r.currentLiabilitiesPaise) * 10) / 10
      : null,
    debtToEquity: r.netWorthPaise > 0 ? Math.round((r.loansPaise / r.netWorthPaise) * 100) / 100 : null,
    daysOfCash: perDay > 0 ? Math.max(0, Math.floor(r.cashPaise / perDay)) : null,
  };
}

/**
 * Keep the biggest `keep` parts and fold the rest into one "Other" row, so a
 * store with 60 categories still shows a readable "Made of".
 */
export function topParts<T extends { label: string; paise: number }>(
  parts: T[], keep: number, otherLabel: string,
): (T | { label: string; paise: number })[] {
  const sorted = [...parts].filter((p) => p.paise !== 0).sort((a, b) => b.paise - a.paise);
  if (sorted.length <= keep + 1) return sorted;
  const rest = sorted.slice(keep).reduce((n, p) => n + p.paise, 0);
  return [...sorted.slice(0, keep), { label: `${otherLabel} (${sorted.length - keep})`, paise: rest }];
}
