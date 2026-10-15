import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import {
  parseStatementRow, isStatementRowError, runningBalances, withinMatchWindow,
} from '@/lib/bank-reconcile';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * Bank Statement - spec 10-accounts-purchase.md §1.9. "Import statement,
 * reconcile against receipts/payments already recorded" - not a live bank
 * feed. `BankAccount.currentBalancePaise` is never stored; it is always
 * openingBalancePaise plus the sum of that account's BankTransaction rows,
 * computed here on read, the same discipline the rest of this codebase uses
 * for every other balance.
 */

export class BankSummaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BankSummaryError';
  }
}

// Same rule as goods-receipt.ts::partyDisplayName - Party has no single
// `name` column, only companyName plus title/first/last.
function partyDisplayName(p: { title?: string | null; firstName: string; lastName?: string | null; companyName?: string | null }): string {
  if (p.companyName?.trim()) return p.companyName.trim();
  return [p.title, p.firstName, p.lastName].filter(Boolean).join(' ').trim();
}

export type MatchedType = 'Receipt' | 'SupplierPayment' | 'Transaction';

async function requireOwnedAccount(scope: StoreScope, bankAccountId: string) {
  const account = await db.bankAccount.findFirst({
    where: { id: bankAccountId, ...scopeWhere(scope) },
    select: { id: true, bankName: true, accountNumber: true, accountHolderName: true, openingBalancePaise: true },
  });
  if (!account) throw new BankSummaryError('Bank account not found in your scope.');
  return account;
}

// ------------------------------------------------------------------ summary

export interface BankSummaryTotals {
  totalAccounts: number;
  activeAccounts: number;
  openingBalancePaise: number;
  currentBalancePaise: number;
}

export interface BankAccountSummaryRow {
  id: string;
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
  isActive: boolean;
  isDefault: boolean;
  openingBalancePaise: number;
  currentBalancePaise: number;
  lastTxnAt: Date | null;
  unmatchedCount: number;
}

export async function getBankSummary(
  scope: StoreScope,
): Promise<{ totals: BankSummaryTotals; accounts: BankAccountSummaryRow[] }> {
  const accounts = await db.bankAccount.findMany({
    where: scopeWhere(scope),
    select: {
      id: true, bankName: true, accountNumber: true, accountHolderName: true,
      isActive: true, isDefault: true, openingBalancePaise: true,
    },
    orderBy: [{ isDefault: 'desc' }, { bankName: 'asc' }],
  });

  const [movement, unmatched] = await Promise.all([
    db.bankTransaction.groupBy({
      by: ['bankAccountId'],
      where: { bankAccount: { ...scopeWhere(scope) } },
      _sum: { debitPaise: true, creditPaise: true },
      _max: { txnDate: true },
    }),
    db.bankTransaction.groupBy({
      by: ['bankAccountId'],
      where: { bankAccount: { ...scopeWhere(scope) }, matchedType: null },
      _count: { _all: true },
    }),
  ]);
  const movementByAccount = new Map(movement.map((m) => [m.bankAccountId, m]));
  const unmatchedByAccount = new Map(unmatched.map((u) => [u.bankAccountId, u._count._all]));

  const rows: BankAccountSummaryRow[] = accounts.map((a) => {
    const m = movementByAccount.get(a.id);
    const net = (m?._sum.creditPaise ?? 0) - (m?._sum.debitPaise ?? 0);
    return {
      id: a.id,
      bankName: a.bankName,
      accountNumber: a.accountNumber,
      accountHolderName: a.accountHolderName,
      isActive: a.isActive,
      isDefault: a.isDefault,
      openingBalancePaise: a.openingBalancePaise,
      currentBalancePaise: a.openingBalancePaise + net,
      lastTxnAt: m?._max.txnDate ?? null,
      unmatchedCount: unmatchedByAccount.get(a.id) ?? 0,
    };
  });

  const totals: BankSummaryTotals = {
    totalAccounts: rows.length,
    activeAccounts: rows.filter((r) => r.isActive).length,
    openingBalancePaise: rows.reduce((n, r) => n + r.openingBalancePaise, 0),
    currentBalancePaise: rows.reduce((n, r) => n + r.currentBalancePaise, 0),
  };

  return { totals, accounts: rows };
}

// -------------------------------------------------------------- statement

export interface StatementLineRow {
  id: string;
  txnDate: Date;
  description: string;
  debitPaise: number;
  creditPaise: number;
  reference: string | null;
  balancePaise: number;
  matchedType: MatchedType | null;
  matchedId: string | null;
  matchedLabel: string | null;
  matchedAt: Date | null;
}

/**
 * The full statement for one account, with a running balance computed over
 * the account's ENTIRE history and only then filtered to `from`/`to` - so a
 * filtered view still shows the real balance at each kept row, not a balance
 * that resets to the opening figure at the start of the filter window.
 */
export async function listStatementLines(
  scope: StoreScope,
  bankAccountId: string,
  from?: Date,
  to?: Date,
): Promise<{ account: Awaited<ReturnType<typeof requireOwnedAccount>>; lines: StatementLineRow[] }> {
  const account = await requireOwnedAccount(scope, bankAccountId);

  const all = await db.bankTransaction.findMany({
    where: { bankAccountId, bankAccount: { ...scopeWhere(scope) } },
    orderBy: [{ txnDate: 'asc' }, { createdAt: 'asc' }],
    take: LIST_MAX_ROWS,
  });

  const balances = runningBalances(account.openingBalancePaise, all);

  const withBalance = all.map((line, i) => ({ line, balancePaise: balances[i] }));
  const inRange = withBalance.filter(({ line }) =>
    (!from || line.txnDate >= from) && (!to || line.txnDate <= to));

  const labels = await resolveMatchLabels(scope, inRange.map(({ line }) => ({
    matchedType: line.matchedType as MatchedType | null, matchedId: line.matchedId,
  })));

  const lines: StatementLineRow[] = inRange.map(({ line, balancePaise }, i) => ({
    id: line.id,
    txnDate: line.txnDate,
    description: line.description,
    debitPaise: line.debitPaise,
    creditPaise: line.creditPaise,
    reference: line.reference,
    balancePaise,
    matchedType: line.matchedType as MatchedType | null,
    matchedId: line.matchedId,
    matchedLabel: labels[i],
    matchedAt: line.matchedAt,
  }));

  return { account, lines };
}

async function resolveMatchLabels(
  scope: StoreScope,
  refs: { matchedType: MatchedType | null; matchedId: string | null }[],
): Promise<(string | null)[]> {
  const idsByType: Record<MatchedType, string[]> = { Receipt: [], SupplierPayment: [], Transaction: [] };
  for (const r of refs) if (r.matchedType && r.matchedId) idsByType[r.matchedType].push(r.matchedId);

  const [receipts, payments, txns] = await Promise.all([
    idsByType.Receipt.length
      ? db.receipt.findMany({ where: { id: { in: idsByType.Receipt }, ...scopeWhere(scope) }, select: { id: true, receiptNo: true } })
      : [],
    idsByType.SupplierPayment.length
      ? db.supplierPayment.findMany({ where: { id: { in: idsByType.SupplierPayment }, ...scopeWhere(scope) }, select: { id: true, paymentNo: true } })
      : [],
    idsByType.Transaction.length
      ? db.transaction.findMany({ where: { id: { in: idsByType.Transaction }, ...scopeWhere(scope) }, select: { id: true, txnNo: true } })
      : [],
  ]);
  const labelById = new Map<string, string>([
    ...receipts.map((r) => [r.id, r.receiptNo] as const),
    ...payments.map((p) => [p.id, p.paymentNo] as const),
    ...txns.map((t) => [t.id, t.txnNo] as const),
  ]);

  return refs.map((r) => (r.matchedId ? labelById.get(r.matchedId) ?? null : null));
}

// --------------------------------------------------------------------- import

export interface ImportResult {
  importedCount: number;
  duplicateCount: number;
  errors: string[];
}

/**
 * `rows` are already parsed and header-normalised on the client, the same
 * `parseCsv`/`rowsToObjects` pipeline `/import` uses - this function never
 * sees the raw file. There is no upload/storage step: a statement line
 * becomes a `BankTransaction` row directly and nothing needs the original
 * file kept afterward.
 *
 * Re-importing the same file is safe: the database unique constraint on
 * (account, date, description, debit, credit) makes an identical row a
 * duplicate, silently skipped via `skipDuplicates`. Two genuinely different
 * transactions that happen to share all four fields on the same day - two
 * identical ATM withdrawals, say - would also collide and the second would
 * be silently dropped. This is a known, accepted limitation of a light
 * reconciliation tool, not a data-loss bug: the bank's own statement still
 * has the row, only Atlas's copy of it does not.
 */
export async function importStatement(
  scope: StoreScope,
  bankAccountId: string,
  rows: Record<string, string>[],
  _userId: string,
): Promise<ImportResult> {
  scopeForWrite(scope);
  await requireOwnedAccount(scope, bankAccountId);

  if (rows.length === 0) throw new BankSummaryError('That file has no data rows.');
  if (rows.length > 5000) throw new BankSummaryError('That file has more than 5,000 rows. Split it and import in batches.');

  const errors: string[] = [];
  const parsed: ReturnType<typeof parseStatementRow>[] = rows.map(parseStatementRow);
  const good: { txnDate: Date; description: string; debitPaise: number; creditPaise: number; reference: string | null }[] = [];

  parsed.forEach((result, i) => {
    if (isStatementRowError(result)) errors.push(`Row ${i + 2}: ${result.error}`);
    else good.push(result);
  });

  if (good.length === 0) {
    throw new BankSummaryError(`No row could be imported.${errors.length ? ` First problem: ${errors[0]}` : ''}`);
  }

  const { count } = await db.bankTransaction.createMany({
    data: good.map((l) => ({ bankAccountId, ...l })),
    skipDuplicates: true,
  });

  return { importedCount: count, duplicateCount: good.length - count, errors };
}

// --------------------------------------------------------------- reconcile

export interface MatchCandidate {
  type: MatchedType;
  id: string;
  label: string;
  amountPaise: number;
  date: Date;
  partyName: string | null;
}

/** Bank lines already claimed by some other statement row, per side. */
async function alreadyMatchedIds(scope: StoreScope, type: MatchedType): Promise<Set<string>> {
  const rows = await db.bankTransaction.findMany({
    where: { matchedType: type, bankAccount: { ...scopeWhere(scope) } },
    select: { matchedId: true },
  });
  return new Set(rows.map((r) => r.matchedId).filter((id): id is string => id !== null));
}

async function candidatesFor(
  scope: StoreScope,
  line: { txnDate: Date; debitPaise: number; creditPaise: number },
): Promise<MatchCandidate[]> {
  const candidates: MatchCandidate[] = [];

  if (line.creditPaise > 0) {
    const taken = await alreadyMatchedIds(scope, 'Receipt');
    const receipts = await db.receipt.findMany({
      where: {
        ...scopeWhere(scope),
        amountPaise: line.creditPaise,
        status: 'received',
        method: { not: 'cash' },
        id: { notIn: [...taken] },
      },
      select: {
        id: true, receiptNo: true, amountPaise: true, receivedAt: true,
        party: { select: { title: true, firstName: true, lastName: true, companyName: true } },
      },
      take: 20,
    });
    for (const r of receipts) {
      if (withinMatchWindow(r.receivedAt, line.txnDate)) {
        candidates.push({ type: 'Receipt', id: r.id, label: r.receiptNo, amountPaise: r.amountPaise, date: r.receivedAt, partyName: partyDisplayName(r.party) });
      }
    }
  }

  if (line.debitPaise > 0) {
    const [takenPayments, takenTxns] = await Promise.all([
      alreadyMatchedIds(scope, 'SupplierPayment'),
      alreadyMatchedIds(scope, 'Transaction'),
    ]);
    const [payments, txns] = await Promise.all([
      db.supplierPayment.findMany({
        where: {
          ...scopeWhere(scope),
          amountPaise: line.debitPaise,
          status: 'paid',
          method: { not: 'cash' },
          id: { notIn: [...takenPayments] },
        },
        select: {
          id: true, paymentNo: true, amountPaise: true, paidAt: true,
          party: { select: { title: true, firstName: true, lastName: true, companyName: true } },
        },
        take: 20,
      }),
      db.transaction.findMany({
        where: {
          ...scopeWhere(scope),
          amountPaise: line.debitPaise,
          status: 'approved',
          method: { not: 'cash' },
          txnType: { in: ['expense', 'transfer'] },
          id: { notIn: [...takenTxns] },
        },
        select: { id: true, txnNo: true, amountPaise: true, txnDate: true, description: true },
        take: 20,
      }),
    ]);
    for (const p of payments) {
      if (withinMatchWindow(p.paidAt, line.txnDate)) {
        candidates.push({ type: 'SupplierPayment', id: p.id, label: p.paymentNo, amountPaise: p.amountPaise, date: p.paidAt, partyName: partyDisplayName(p.party) });
      }
    }
    for (const t of txns) {
      if (withinMatchWindow(t.txnDate, line.txnDate)) {
        candidates.push({ type: 'Transaction', id: t.id, label: t.txnNo, amountPaise: t.amountPaise, date: t.txnDate, partyName: t.description });
      }
    }
  }

  return candidates.sort((a, b) => Math.abs(a.date.getTime() - line.txnDate.getTime()) - Math.abs(b.date.getTime() - line.txnDate.getTime()));
}

export async function suggestMatches(scope: StoreScope, bankTransactionId: string): Promise<MatchCandidate[]> {
  const line = await db.bankTransaction.findFirst({
    where: { id: bankTransactionId, bankAccount: { ...scopeWhere(scope) } },
    select: { txnDate: true, debitPaise: true, creditPaise: true },
  });
  if (!line) throw new BankSummaryError('Statement line not found in your scope.');
  return candidatesFor(scope, line);
}

export async function confirmMatch(
  scope: StoreScope,
  bankTransactionId: string,
  matchedType: MatchedType,
  matchedId: string,
  userId: string,
): Promise<void> {
  scopeForWrite(scope);
  const line = await db.bankTransaction.findFirst({
    where: { id: bankTransactionId, bankAccount: { ...scopeWhere(scope) } },
    select: { id: true },
  });
  if (!line) throw new BankSummaryError('Statement line not found in your scope.');

  const targetExists = matchedType === 'Receipt'
    ? await db.receipt.findFirst({ where: { id: matchedId, ...scopeWhere(scope) }, select: { id: true } })
    : matchedType === 'SupplierPayment'
      ? await db.supplierPayment.findFirst({ where: { id: matchedId, ...scopeWhere(scope) }, select: { id: true } })
      : await db.transaction.findFirst({ where: { id: matchedId, ...scopeWhere(scope) }, select: { id: true } });
  if (!targetExists) throw new BankSummaryError('That record was not found in your scope.');

  await db.bankTransaction.updateMany({
    where: { id: bankTransactionId, bankAccount: { ...scopeWhere(scope) } },
    data: { matchedType, matchedId, matchedAt: new Date(), matchedBy: userId },
  });
}

export async function clearMatch(scope: StoreScope, bankTransactionId: string): Promise<void> {
  scopeForWrite(scope);
  await db.bankTransaction.updateMany({
    where: { id: bankTransactionId, bankAccount: { ...scopeWhere(scope) } },
    data: { matchedType: null, matchedId: null, matchedAt: null, matchedBy: null },
  });
}

export interface ReconcileResult {
  autoMatched: number;
  ambiguous: number;
  stillUnmatched: number;
}

/**
 * Auto-matches only the unambiguous case: exactly one candidate. Two or more
 * equally-plausible candidates are left for a human to pick via
 * `suggestMatches`/`confirmMatch` - guessing between them risks crediting the
 * wrong customer's payment against the wrong receipt, which is worse than
 * leaving the line unmatched.
 *
 * Runs candidate lookup per line, not batched - a handful of queries per
 * unmatched row, up to the 2,000-row cap below. Fine for a monthly statement
 * (tens to low hundreds of lines); a tenant that imports thousands of lines
 * at once will feel this run for several seconds. Batch it if that becomes
 * the common case rather than the exception.
 */
export async function autoReconcile(scope: StoreScope, bankAccountId: string, userId: string): Promise<ReconcileResult> {
  scopeForWrite(scope);
  await requireOwnedAccount(scope, bankAccountId);

  const unmatched = await db.bankTransaction.findMany({
    where: { bankAccountId, bankAccount: { ...scopeWhere(scope) }, matchedType: null },
    select: { id: true, txnDate: true, debitPaise: true, creditPaise: true },
    take: LIST_MAX_ROWS,
  });

  let autoMatched = 0;
  let ambiguous = 0;

  for (const line of unmatched) {
    const candidates = await candidatesFor(scope, line);
    if (candidates.length === 1) {
      await confirmMatch(scope, line.id, candidates[0].type, candidates[0].id, userId);
      autoMatched += 1;
    } else if (candidates.length > 1) {
      ambiguous += 1;
    }
  }

  return { autoMatched, ambiguous, stillUnmatched: unmatched.length - autoMatched };
}
