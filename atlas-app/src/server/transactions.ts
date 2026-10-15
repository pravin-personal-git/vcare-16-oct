import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { postJournalEntry, reverseJournalEntry } from './ledger';
import type { LedgerLineInput } from '@/lib/ledger';
import { allocateDocumentNumber } from './allocate-document-number';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * The Transactions / Expenses ledger - spec 10-accounts-purchase.md §1.2.
 *
 * Three kinds, one posting rule each:
 *
 *   expense  - Dr category (5xxx) / Cr cash-or-bank. Starts `pending`; posts
 *              only once approved. Spec: "Pending = expenses awaiting
 *              approval" - nothing else in this screen waits.
 *   income   - Dr cash-or-bank / Cr category (4900). Posts immediately.
 *   transfer - Dr toAccount / Cr fromAccount. Posts immediately. Cash ↔ bank
 *              only today - a transfer to a staff member is
 *              `StaffTransaction`'s advance_given, not this.
 */

const CASH_ACCOUNT_FOR_METHOD: Record<string, string> = {
  cash: '1010', bank: '1020', upi: '1020', cheque: '1020',
  // The tin on the desk (8 Oct 2026) - see `1030 Petty Cash` in the chart of
  // accounts. Spending from the float credits the float, not the main cash
  // box, so the two can be counted separately.
  petty_cash: '1030',
};

export type TxnType = 'expense' | 'income' | 'transfer';

export interface CreateTransactionInput {
  txnType: TxnType;
  amountPaise: number;
  txnDate: Date;
  categoryAccountCode?: string | null;
  method?: string | null;
  fromAccountCode?: string | null;
  toAccountCode?: string | null;
  description?: string | null;
  /** Who the cash was handed to. Informational - no ledger effect. See the schema note. */
  paidToUserId?: string | null;
  /** The branch's own extra fields for an expense, already read and checked by the caller. */
  customFields?: Record<string, unknown>;
}

function linesFor(input: CreateTransactionInput): LedgerLineInput[] {
  const { amountPaise } = input;
  if (input.txnType === 'expense') {
    return [
      { accountCode: input.categoryAccountCode as string, debitPaise: amountPaise },
      { accountCode: CASH_ACCOUNT_FOR_METHOD[input.method as string] ?? '1010', creditPaise: amountPaise },
    ];
  }
  if (input.txnType === 'income') {
    return [
      { accountCode: CASH_ACCOUNT_FOR_METHOD[input.method as string] ?? '1010', debitPaise: amountPaise },
      { accountCode: input.categoryAccountCode as string, creditPaise: amountPaise },
    ];
  }
  return [
    { accountCode: input.toAccountCode as string, debitPaise: amountPaise },
    { accountCode: input.fromAccountCode as string, creditPaise: amountPaise },
  ];
}

function describe(input: CreateTransactionInput, txnNo: string): string {
  if (input.txnType === 'transfer') return `Transfer ${txnNo}${input.description ? ` - ${input.description}` : ''}`;
  const label = input.txnType === 'expense' ? 'Expense' : 'Income';
  return `${label} ${txnNo}${input.description ? ` - ${input.description}` : ''}`;
}

function validate(input: CreateTransactionInput): void {
  if (input.amountPaise <= 0) throw new Error('Enter an amount greater than zero.');
  if (input.txnType === 'transfer') {
    if (!input.fromAccountCode || !input.toAccountCode) {
      throw new Error('Choose both accounts for a transfer.');
    }
    if (input.fromAccountCode === input.toAccountCode) {
      throw new Error('A transfer needs two different accounts.');
    }
  } else {
    if (!input.categoryAccountCode) throw new Error('Choose a category.');
    if (!input.method) throw new Error('Choose how the money moved.');
  }
}

export async function createTransaction(
  scope: StoreScope,
  input: CreateTransactionInput,
  userId: string,
): Promise<{ id: string }> {
  const storeId = scopeForWrite(scope);
  validate(input);

  const txnNo = await allocateDocumentNumber(storeId, 'TXN', input.txnDate);
  const startsApproved = input.txnType !== 'expense';

  const created = await db.transaction.create({
    data: {
      storeId,
      txnType: input.txnType,
      txnNo,
      txnDate: input.txnDate,
      amountPaise: input.amountPaise,
      categoryAccountCode: input.categoryAccountCode ?? null,
      method: input.method ?? null,
      fromAccountCode: input.fromAccountCode ?? null,
      toAccountCode: input.toAccountCode ?? null,
      description: input.description ?? null,
      paidToUserId: input.paidToUserId ?? null,
      customFields: (input.customFields ?? {}) as object,
      status: startsApproved ? 'approved' : 'pending',
      approvedBy: startsApproved ? userId : null,
      approvedAt: startsApproved ? new Date() : null,
      createdBy: userId,
    },
  });

  if (startsApproved) {
    // Same reasoning as `createStaffTransaction`: the posting needs this
    // row's own id, so it can't go first. If it fails, the row must not
    // survive it - an "approved" income or transfer with no journal entry
    // behind it is silent drift, and a retry would otherwise stack a second
    // row on top of the orphan.
    try {
      await postJournalEntry(scope, {
        entryDate: input.txnDate,
        description: describe(input, txnNo),
        sourceType: 'transaction',
        sourceId: created.id,
        lines: linesFor(input),
      }, userId);
    } catch (e) {
      await db.transaction.delete({ where: { id: created.id } });
      throw e;
    }
  }

  // A pending voucher waits for approval: the rules decide, the approvers are told (27 Sep 2026).
  if (!startsApproved) {
    const { onPending } = await import('./approval-hooks');
    await onPending(storeId, 'expense', created.id, userId);
  }
  return { id: created.id };
}

export async function approveTransaction(
  scope: StoreScope, id: string, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const txn = await db.transaction.findFirst({ where: { id, storeId } });
  if (!txn) throw new Error('Transaction not found in your scope.');
  if (txn.status !== 'pending') throw new Error(`Already ${txn.status}.`);
  const { screenDecision } = await import('./approval-hooks');
  await screenDecision(scope, 'expense', id, 'approved', userId, null);

  const input: CreateTransactionInput = {
    txnType: txn.txnType as TxnType,
    amountPaise: txn.amountPaise,
    txnDate: txn.txnDate,
    categoryAccountCode: txn.categoryAccountCode,
    method: txn.method,
    fromAccountCode: txn.fromAccountCode,
    toAccountCode: txn.toAccountCode,
    description: txn.description,
    paidToUserId: txn.paidToUserId,
    customFields: txn.customFields as Record<string, unknown>,
  };

  // Posted before the status flips to 'approved' - the riskiest step first,
  // same as everywhere else in this ledger. Unlike `createTransaction`, this
  // row already exists and has its own id, so there's no reason to risk
  // marking something "approved" that never actually posted.
  await postJournalEntry(scope, {
    entryDate: txn.txnDate,
    description: describe(input, txn.txnNo),
    sourceType: 'transaction',
    sourceId: txn.id,
    lines: linesFor(input),
  }, userId);

  await db.transaction.update({
    where: { id },
    data: { status: 'approved', approvedBy: userId, approvedAt: new Date() },
  });
}

export async function rejectTransaction(
  scope: StoreScope, id: string, reason: string, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new Error('Say why this is being rejected.');

  const txn = await db.transaction.findFirst({ where: { id, storeId }, select: { status: true } });
  if (!txn) throw new Error('Transaction not found in your scope.');
  if (txn.status !== 'pending') throw new Error(`Already ${txn.status}.`);
  const { screenDecision } = await import('./approval-hooks');
  await screenDecision(scope, 'expense', id, 'rejected', userId, reason.trim());

  await db.transaction.update({
    where: { id },
    data: { status: 'rejected', rejectedReason: reason.trim() },
  });
  void userId;
}

export async function reverseTransaction(
  scope: StoreScope, id: string, reason: string, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new Error('Say why this is being reversed.');

  const txn = await db.transaction.findFirst({ where: { id, storeId }, select: { status: true } });
  if (!txn) throw new Error('Transaction not found in your scope.');
  if (txn.status !== 'approved') throw new Error('Only a posted transaction can be reversed.');

  const entry = await db.journalEntry.findFirst({
    where: { ...scopeWhere(scope), sourceType: 'transaction', sourceId: id, reversalOfId: null },
    select: { id: true },
  });

  await db.transaction.update({
    where: { id },
    data: { status: 'reversed', reversedAt: new Date(), reversalReason: reason.trim() },
  });

  if (entry) await reverseJournalEntry(scope, entry.id, userId, reason.trim());
}

// ------------------------------------------------------------------- reads

export interface TransactionRow {
  id: string;
  txnNo: string;
  txnType: string;
  txnDate: Date;
  amountPaise: number;
  categoryAccountCode: string | null;
  method: string | null;
  fromAccountCode: string | null;
  toAccountCode: string | null;
  description: string | null;
  status: string;
  rejectedReason: string | null;
  reversalReason: string | null;
  paidToUserId: string | null;
  paidToName: string | null;
}

/** Everyone holding a role in this store - the "Handed to" list on a cash expense. */
export async function listStorePeople(scope: StoreScope): Promise<{ id: string; fullName: string }[]> {
  const roles = await db.userStoreRole.findMany({
    where: scopeWhere(scope),
    distinct: ['userId'],
    select: { user: { select: { id: true, fullName: true } } },
  });
  return roles.map((r) => r.user).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function listTransactions(scope: StoreScope): Promise<TransactionRow[]> {
  const rows = await db.transaction.findMany({
    where: scopeWhere(scope),
    select: {
      id: true, txnNo: true, txnType: true, txnDate: true, amountPaise: true,
      categoryAccountCode: true, method: true, fromAccountCode: true, toAccountCode: true,
      description: true, status: true, rejectedReason: true, reversalReason: true,
      paidToUserId: true,
    },
    orderBy: { txnDate: 'desc' },
    take: LIST_MAX_ROWS,
  });

  const ids = [...new Set(rows.map((r) => r.paidToUserId).filter((x): x is string => !!x))];
  const names = new Map((ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
    : []).map((u) => [u.id, u.fullName]));

  return rows.map((r) => ({ ...r, paidToName: r.paidToUserId ? names.get(r.paidToUserId) ?? null : null }));
}
