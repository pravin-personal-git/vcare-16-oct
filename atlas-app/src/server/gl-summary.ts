import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';

/**
 * Revenue, expenses and profit straight from the general ledger
 * (workstream G, 1 Oct 2026).
 *
 * WHY THIS REPLACES THE "INDICATIVE" FIGURE.
 *
 * The Admin dashboard showed a profit derived from sales minus a partial view
 * of costs, under the note "Needs the Accounts module" - while a full
 * double-entry general ledger sat beside it, posted to from fourteen modules
 * and nineteen call sites. The dashboard was apologising for something that
 * had already been built.
 *
 * D011 says it plainly: Trial Balance, P&L and Balance Sheet are all GENERATED
 * FROM GL and none of them gets its own stored total ever again. This module
 * is that rule applied to the dashboard.
 *
 * THE SIGN CONVENTION, SINCE IT IS THE EASY THING TO GET WRONG.
 *
 * Revenue accounts are credit-natured: a sale credits them, so revenue is
 * (credit - debit) and a return or a credit note reduces it by debiting.
 * Expense accounts are debit-natured, so expenses are (debit - credit) and a
 * refund of an expense reduces it. Taking the absolute value of either would
 * make returns INCREASE revenue, which is the kind of bug that looks like a
 * good month.
 */

export interface GlSummary {
  revenuePaise: number;
  expensesPaise: number;
  /** Revenue minus expenses. Can be negative, and is shown negative. */
  profitPaise: number;
  /** How many journal lines went into this - 0 means nothing is posted yet. */
  lineCount: number;
  /**
   * True when the ledger has nothing for this period.
   *
   * The caller needs to tell "we measured zero profit" apart from "nothing has
   * been posted". Showing a confident 0 for an empty ledger is worse than
   * saying nothing, because a reader takes it as a measurement.
   */
  empty: boolean;
}

const EMPTY: GlSummary = {
  revenuePaise: 0, expensesPaise: 0, profitPaise: 0, lineCount: 0, empty: true,
};

/**
 * One period, one scope.
 *
 * Grouped in the database rather than by pulling lines into memory: a busy
 * branch's financial year is tens of thousands of lines, and this runs on the
 * first screen after sign-in.
 */
export async function glSummary(
  scope: StoreScope, from: Date, to: Date,
): Promise<GlSummary> {
  const accounts = await db.account.findMany({
    where: { type: { in: ['revenue', 'expense'] } },
    select: { id: true, type: true },
  });
  if (accounts.length === 0) return { ...EMPTY };

  const typeById = new Map(accounts.map((a) => [a.id, a.type]));

  const grouped = await db.journalLine.groupBy({
    by: ['accountId'],
    where: {
      accountId: { in: accounts.map((a) => a.id) },
      journalEntry: {
        ...scopeWhere(scope),
        entryDate: { gte: from, lt: to },
      },
    },
    _sum: { debitPaise: true, creditPaise: true },
    _count: { _all: true },
  });

  let revenuePaise = 0;
  let expensesPaise = 0;
  let lineCount = 0;

  for (const g of grouped) {
    const debit = g._sum.debitPaise ?? 0;
    const credit = g._sum.creditPaise ?? 0;
    lineCount += g._count._all;

    if (typeById.get(g.accountId) === 'revenue') {
      revenuePaise += credit - debit;
    } else {
      expensesPaise += debit - credit;
    }
  }

  return {
    revenuePaise,
    expensesPaise,
    profitPaise: revenuePaise - expensesPaise,
    lineCount,
    empty: lineCount === 0,
  };
}
