import 'server-only';
import { db } from './db';
import { scopeForWrite, scopeWhere, type StoreScope } from './store-scope';
import { allocateDocumentNumber } from './allocate-document-number';
import { STANDARD_CHART_OF_ACCOUNTS } from '@/lib/chart-of-accounts';
import {
  validateBalanced, reverseLines, LedgerValidationError, type LedgerLineInput,
} from '@/lib/ledger';

/**
 * The general ledger - the spine every financial module posts to.
 *
 * RULE 1 (D011): every financial transaction ends as balanced double-entry
 * journal lines. Nothing else in this codebase keeps a competing financial
 * total from here on; a module's own cached column (like
 * `PurchaseBill.amountPaidPaise`) is a read-through convenience at most,
 * never a second truth.
 *
 * A posted entry is never edited and never deleted - `reverseJournalEntry`
 * is the only way to undo one, and it does that by posting a new entry with
 * every line swapped, not by touching the original.
 */

export { LedgerValidationError };

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export type JournalSourceType =
  | 'invoice' | 'receipt' | 'purchase_bill' | 'supplier_payment' | 'credit_note'
  | 'sales_return' | 'refund' | 'opening_balance' | 'reversal' | 'manual'
  // Cost of Goods Sold - always its own entry, never merged into the
  // revenue-side one, so the two can be found and reversed independently.
  // 'out' when stock leaves (a dispatch, a counter-sale invoice), 'in' when
  // it comes back (a sales return).
  | 'cogs'
  // An advance given to or repaid by staff, or an expense they claimed or
  // were reimbursed for. See `server/staff-accounts.ts`.
  | 'staff_transaction'
  // An expense, a non-sale income, or a cash/bank transfer entered directly
  // on the Transactions screen. See `server/transactions.ts`.
  | 'transaction'
  // A supplier debit note - the financial half of a purchase return, the
  // mirror of 'credit_note' on the purchase side. See
  // `server/purchase-returns.ts`.
  | 'debit_note'
  // AMC income moved from AMC Received in Advance as it is earned, and the
  // cost of parts sent on a repair challan (health check ACC-1).
  | 'amc_recognition'
  | 'repair_challan'
  // Parts issued to a field job on a GDN, and unused parts brought back
  // (workflow spec §4.4, server/job-challans.ts).
  | 'job_material_issue' | 'job_material_return'
  // 28 Sep 2026: a job's old unit back into stock (cost recovered), and a
  // supplier's credit note for one (their account, less warranty cost).
  | 'rma_recovery' | 'rma_credit'
  // 10 Oct 2026: the courier for a box of repairs sent to a supplier, and the
  // return courier when it comes back on an RMA receipt.
  | 'supplier_dispatch'
  | 'rma_receipt'
  // Processing a PayrollRun - the accrual entry (wages expensed, statutory
  // liabilities and any loan EMI recovery created, net pay owed to staff),
  // and separately, marking it paid (that net pay liability cleared against
  // cash/bank) - the same 'invoice' / 'receipt' pairing, one entity raising
  // the liability and a second one clearing it. See `server/payroll-run.ts`.
  | 'payroll_run'
  | 'payroll_payment';

// ------------------------------------------------------- chart of accounts

/**
 * Idempotent - creates whatever standard account is missing for this
 * organisation and leaves everything else alone. Never touches an account
 * that already exists, so a tenant who renamed or deactivated one keeps
 * that choice across every future run.
 *
 * Two passes because a child account's `parentId` must point at a row that
 * already exists - the standard chart is exactly two levels deep, so two
 * passes is enough; this is not a general topological sort.
 */
export async function ensureChartOfAccounts(organizationId: string): Promise<number> {
  const existing = await db.account.findMany({
    where: { organizationId }, select: { code: true },
  });
  const have = new Set(existing.map((a) => a.code));
  const missing = STANDARD_CHART_OF_ACCOUNTS.filter((a) => !have.has(a.code));
  if (missing.length === 0) return 0;

  for (const a of missing.filter((x) => !x.parentCode)) {
    await db.account.create({
      data: { organizationId, code: a.code, name: a.name, type: a.type, subType: a.subType ?? null },
    });
  }
  for (const a of missing.filter((x) => x.parentCode)) {
    const parent = await db.account.findUnique({
      where: { organizationId_code: { organizationId, code: a.parentCode! } },
      select: { id: true },
    });
    await db.account.create({
      data: {
        organizationId, code: a.code, name: a.name, type: a.type, subType: a.subType ?? null,
        parentId: parent?.id ?? null,
      },
    });
  }

  return missing.length;
}

async function resolveAccounts(
  organizationId: string,
  codes: string[],
): Promise<Map<string, string>> {
  const rows = await db.account.findMany({
    where: { organizationId, code: { in: codes }, isActive: true },
    select: { id: true, code: true },
  });
  const map = new Map(rows.map((r) => [r.code, r.id]));
  const missing = codes.filter((c) => !map.has(c));
  if (missing.length > 0) {
    throw new LedgerError(`Unknown or inactive account code(s): ${missing.join(', ')}`);
  }
  return map;
}

// ------------------------------------------------------------- posting

async function assertPeriodOpen(storeId: string, date: Date): Promise<void> {
  const locked = await db.accountingPeriod.findFirst({
    where: { storeId, isLocked: true, startDate: { lte: date }, endDate: { gte: date } },
    select: { id: true },
  });
  if (locked) {
    throw new LedgerError('This period is locked. Post a reversal in the current period instead.');
  }
}

export interface PostJournalEntryInput {
  entryDate: Date;
  description: string;
  sourceType: JournalSourceType;
  sourceId?: string | null;
  lines: LedgerLineInput[];
}

/**
 * Post a balanced entry. Throws `LedgerValidationError` if the lines do not
 * balance, `LedgerError` for anything else (unknown account, locked period).
 *
 * Every caller passes account CODES, never ids - a code is stable across a
 * chart that gets renamed or reorganised, an id is an implementation detail
 * the caller should never have to know.
 */
export async function postJournalEntry(
  scope: StoreScope,
  input: PostJournalEntryInput,
  userId: string,
): Promise<{ id: string; entryNo: string }> {
  const storeId = scopeForWrite(scope);

  validateBalanced(input.lines);
  if (!input.description.trim()) throw new LedgerError('A journal entry needs a description.');

  await assertPeriodOpen(storeId, input.entryDate);

  const store = await db.store.findUniqueOrThrow({
    where: { id: storeId }, select: { organizationId: true },
  });
  const codes = [...new Set(input.lines.map((l) => l.accountCode))];
  const accountIdByCode = await resolveAccounts(store.organizationId, codes);

  const entryNo = await allocateDocumentNumber(storeId, 'JE', input.entryDate);

  const entry = await db.$transaction(async (tx) => {
    const created = await tx.journalEntry.create({
      data: {
        storeId,
        entryNo,
        entryDate: input.entryDate,
        description: input.description.trim(),
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        postedBy: userId,
      },
    });

    await tx.journalLine.createMany({
      data: input.lines.map((l) => ({
        journalEntryId: created.id,
        accountId: accountIdByCode.get(l.accountCode)!,
        debitPaise: Math.trunc(l.debitPaise ?? 0),
        creditPaise: Math.trunc(l.creditPaise ?? 0),
        partyId: l.partyId ?? null,
        costCentre: l.costCentre ?? null,
        gstin: l.gstin ?? null,
        description: l.description ?? null,
      })),
    });

    return created;
  });

  return { id: entry.id, entryNo };
}

/**
 * Reverse a posted entry: a new entry, same lines, debit and credit
 * swapped, dated today. The original is never touched - `reversedBy` on it
 * is a computed relation, not a write.
 */
export async function reverseJournalEntry(
  scope: StoreScope,
  entryId: string,
  userId: string,
  reason: string,
): Promise<{ id: string; entryNo: string }> {
  const storeId = scopeForWrite(scope);

  if (!reason.trim()) throw new LedgerError('A reason is required to reverse a posting.');

  const original = await db.journalEntry.findFirst({
    where: { id: entryId, ...scopeWhere(scope) },
    include: { lines: true },
  });
  if (!original) throw new LedgerError('Journal entry not found in your scope.');
  if (original.reversalOfId) {
    throw new LedgerError('A reversal cannot itself be reversed - post a new correction instead.');
  }

  // Caught by the unique index on `reversalOfId` either way; checked first so
  // a duplicate reversal attempt reads as a sentence naming the entry that
  // already did it, not a database constraint error.
  const existingReversal = await db.journalEntry.findFirst({
    where: { reversalOfId: original.id }, select: { entryNo: true },
  });
  if (existingReversal) {
    throw new LedgerError(`Already reversed by ${existingReversal.entryNo}.`);
  }

  const now = new Date();
  await assertPeriodOpen(storeId, now);

  const reversedLines = reverseLines(original.lines.map((l) => ({
    accountId: l.accountId,
    debitPaise: l.debitPaise,
    creditPaise: l.creditPaise,
    partyId: l.partyId,
    costCentre: l.costCentre,
    gstin: l.gstin,
    description: l.description,
  })));

  const entryNo = await allocateDocumentNumber(storeId, 'JE', now);

  const reversal = await db.$transaction(async (tx) => {
    const created = await tx.journalEntry.create({
      data: {
        storeId,
        entryNo,
        entryDate: now,
        description: `Reversal of ${original.entryNo}: ${reason.trim()}`,
        sourceType: 'reversal',
        sourceId: original.id,
        reversalOfId: original.id,
        postedBy: userId,
      },
    });

    await tx.journalLine.createMany({
      data: reversedLines.map((l) => ({
        journalEntryId: created.id,
        accountId: l.accountId,
        debitPaise: l.debitPaise,
        creditPaise: l.creditPaise,
        partyId: l.partyId,
        costCentre: l.costCentre,
        gstin: l.gstin,
        description: l.description,
      })),
    });

    return created;
  });

  return { id: reversal.id, entryNo };
}
