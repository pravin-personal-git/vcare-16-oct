import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, userInScope, type StoreScope } from './store-scope';
import { postJournalEntry, reverseJournalEntry } from './ledger';
import type { LedgerLineInput } from '@/lib/ledger';
import { allocateDocumentNumber } from './allocate-document-number';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * The Staff Balance / My Personal Account ledger.
 *
 * Spec: 10-accounts-purchase.md §1.5 ("User Account").
 *
 * Two independent things can be true about the same employee at once: the
 * company can be holding money they owe back (an advance) and the company
 * can separately owe them money (an unreimbursed expense). `StaffTransaction`
 * carries both directions with a `kind` tag rather than two tables, the same
 * reasoning as `SalesReturn`'s disposition column.
 *
 *   advance_given      - Dr 1400 Staff Advances / Cr Cash or Bank
 *   advance_repaid      - Dr Cash or Bank / Cr 1400 Staff Advances
 *   advance_written_off - Dr 5900 Other Operating Expenses / Cr 1400 Staff
 *                         Advances. Money the business has decided to stop
 *                         chasing - usually when somebody leaves owing it
 *                         (G-19). It goes through this ledger rather than a
 *                         bare journal entry so the Staff Balance screen,
 *                         which reads these rows, actually shows the debt
 *                         clearing. It is a COST, never a payment: no cash
 *                         moves, and it is counted separately from
 *                         `totalPayments` below for exactly that reason.
 *   expense_claimed     - Dr 5900 Other Operating Expenses / Cr 2300 Staff Payable
 *   expense_reimbursed  - Dr 2300 Staff Payable / Cr Cash or Bank
 *   incentive_paid      - Dr 5700 Sales Commission & Incentives / Cr Cash or
 *                         Bank. Paid straight out rather than accrued through
 *                         2300 first - unlike an expense claim, there is no
 *                         moment where the company owes it before deciding to
 *                         pay it; the quotation earning it already fixed the
 *                         amount, so recording it IS paying it.
 *
 * Cash-side account follows the same `method` vocabulary as
 * `SupplierPayment` - cash lands on 1010, everything else on 1020.
 */

const CASH_ACCOUNT_FOR_METHOD: Record<string, string> = {
  cash: '1010', bank: '1020', upi: '1020', cheque: '1020',
};

export type StaffTransactionKind =
  | 'advance_given' | 'advance_repaid' | 'expense_claimed' | 'expense_reimbursed'
  | 'incentive_paid' | 'advance_written_off';

export interface CreateStaffTransactionInput {
  userId: string;
  kind: StaffTransactionKind;
  amountPaise: number;
  txnDate: Date;
  method: string;
  note?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}

function linesFor(kind: StaffTransactionKind, amountPaise: number, cashAccount: string): LedgerLineInput[] {
  switch (kind) {
    case 'advance_given':
      return [
        { accountCode: '1400', debitPaise: amountPaise },
        { accountCode: cashAccount, creditPaise: amountPaise },
      ];
    case 'advance_repaid':
      return [
        { accountCode: cashAccount, debitPaise: amountPaise },
        { accountCode: '1400', creditPaise: amountPaise },
      ];
    case 'advance_written_off':
      // No cash side: the money is gone, so it becomes a cost.
      return [
        { accountCode: '5900', debitPaise: amountPaise },
        { accountCode: '1400', creditPaise: amountPaise },
      ];
    case 'expense_claimed':
      return [
        { accountCode: '5900', debitPaise: amountPaise },
        { accountCode: '2300', creditPaise: amountPaise },
      ];
    case 'expense_reimbursed':
      return [
        { accountCode: '2300', debitPaise: amountPaise },
        { accountCode: cashAccount, creditPaise: amountPaise },
      ];
    case 'incentive_paid':
      return [
        { accountCode: '5700', debitPaise: amountPaise },
        { accountCode: cashAccount, creditPaise: amountPaise },
      ];
  }
}

const KIND_LABEL: Record<StaffTransactionKind, string> = {
  advance_given: 'Advance given to',
  advance_repaid: 'Advance repaid by',
  expense_claimed: 'Expense claimed by',
  expense_reimbursed: 'Expense reimbursed to',
  incentive_paid: 'Incentive paid to',
  advance_written_off: 'Advance written off for',
};

export async function createStaffTransaction(
  scope: StoreScope,
  input: CreateStaffTransactionInput,
  userId: string,
): Promise<{ id: string }> {
  const storeId = scopeForWrite(scope);

  if (input.amountPaise <= 0) throw new Error('Enter an amount greater than zero.');

  const staff = await db.userStoreRole.findFirst({
    where: { storeId, userId: input.userId },
    select: { userId: true },
  });
  if (!staff) throw new Error('That person does not hold a role in this store.');

  const cashAccount = CASH_ACCOUNT_FOR_METHOD[input.method] ?? '1010';
  const staffName = (await db.user.findUniqueOrThrow({
    where: { id: input.userId }, select: { fullName: true },
  })).fullName;

  const txnNo = await allocateDocumentNumber(storeId, 'ST', input.txnDate);

  const created = await db.staffTransaction.create({
    data: {
      storeId,
      // Stored since 3 Oct 2026. This number had always been allocated and then
      // used only inside the GL description below, so every staff transaction
      // burned one - found while building the allocation ledger, which is
      // exactly the class of problem it exists to surface.
      txnNo,
      userId: input.userId,
      kind: input.kind,
      amountPaise: input.amountPaise,
      txnDate: input.txnDate,
      method: input.method,
      note: input.note ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      createdBy: userId,
    },
  });

  // The GL posting's own id doesn't exist until the transaction row does, so
  // it can't go first the way it does everywhere else in this ledger. If it
  // fails - an unknown account code, a locked period - the row created above
  // must not survive it: a StaffTransaction with no journal entry behind it
  // is exactly the kind of silent drift RULE 1 exists to prevent, and a
  // human retrying after the error would otherwise create a second one on
  // top of the orphan.
  try {
    await postJournalEntry(scope, {
      entryDate: input.txnDate,
      description: `${KIND_LABEL[input.kind]} ${staffName} (${txnNo})`,
      sourceType: 'staff_transaction',
      sourceId: created.id,
      lines: linesFor(input.kind, input.amountPaise, cashAccount),
    }, userId);
  } catch (e) {
    await db.staffTransaction.delete({ where: { id: created.id } });
    throw e;
  }

  return { id: created.id };
}

export async function reverseStaffTransaction(
  scope: StoreScope,
  id: string,
  reason: string,
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new Error('Say why this is being reversed.');

  const txn = await db.staffTransaction.findFirst({
    where: { id, storeId },
    select: { id: true, status: true },
  });
  if (!txn) throw new Error('Transaction not found in your scope.');
  if (txn.status === 'reversed') throw new Error('This has already been reversed.');

  const entry = await db.journalEntry.findFirst({
    where: { ...scopeWhere(scope), sourceType: 'staff_transaction', sourceId: id, reversalOfId: null },
    select: { id: true },
  });

  await db.$transaction(async (tx) => {
    await tx.staffTransaction.update({
      where: { id },
      data: { status: 'reversed', reversedAt: new Date(), reversalReason: reason.trim() },
    });
  });

  if (entry) {
    await reverseJournalEntry(scope, entry.id, userId, reason.trim());
  }
}

/**
 * Who still owes money on an advance with NO schedule behind it - raised
 * before advances lived on `StaffLoan`, or settled off-cycle.
 *
 * `recoverableAdvances` already answers "how much", per person. This adds the
 * names, so the Loans screen can offer to record the cash when somebody hands
 * it back: a scheduled loan or advance is repaid from its own row in that
 * list, and these have no row to press.
 */
export async function plainAdvanceHolders(
  scope: StoreScope,
): Promise<{ userId: string; fullName: string; outstandingPaise: number }[]> {
  const owed = await recoverableAdvances(scope);
  if (owed.size === 0) return [];
  const users = await db.user.findMany({
    where: { ...userInScope(scope), id: { in: [...owed.keys()] } },
    select: { id: true, fullName: true },
  });
  return users
    .map((u) => ({ userId: u.id, fullName: u.fullName, outstandingPaise: owed.get(u.id) ?? 0 }))
    .filter((r) => r.outstandingPaise > 0)
    .sort((a, b) => b.outstandingPaise - a.outstandingPaise);
}

export interface AdvanceRecoveryPolicy {
  enabled: boolean;
  /** The most to take in one month. 0 = whatever is outstanding. */
  maxPaise: number;
}

export async function getAdvanceRecovery(scope: StoreScope): Promise<AdvanceRecoveryPolicy> {
  const row = await db.payrollConfiguration.findUnique({
    where: { storeId: scopeForWrite(scope) },
    select: { advanceRecoveryEnabled: true, advanceRecoveryMaxPaise: true },
  });
  return { enabled: row?.advanceRecoveryEnabled ?? false, maxPaise: row?.advanceRecoveryMaxPaise ?? 0 };
}

export async function setAdvanceRecovery(
  scope: StoreScope, input: AdvanceRecoveryPolicy, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!Number.isFinite(input.maxPaise) || input.maxPaise < 0) {
    throw new Error('The monthly limit cannot be negative.');
  }
  // `PayrollConfiguration` is keyed by store and every other field has a
  // default, so a store that never opened the payroll settings still gets a
  // valid row from this.
  await db.payrollConfiguration.upsert({
    where: { storeId },
    create: {
      storeId, advanceRecoveryEnabled: input.enabled,
      advanceRecoveryMaxPaise: Math.round(input.maxPaise), updatedBy: userId,
    },
    update: {
      advanceRecoveryEnabled: input.enabled,
      advanceRecoveryMaxPaise: Math.round(input.maxPaise), updatedBy: userId,
    },
  });
}

/**
 * WHAT IS STILL OWED ON PLAIN (NON-LOAN) ADVANCES, PER PERSON.
 *
 * The one source for that figure, used by payroll (to decide this month's
 * recovery) and by the Staff Balance screen (to show what is left). Two
 * separate derivations of the same number is exactly how this module ended up
 * disagreeing with itself before - see the note at the top of the file.
 *
 * A LOAN IS NOT INCLUDED. `createLoan` disburses through `advance_given` and
 * `recordLoanRepayment` collects through `advance_repaid`, both tagged
 * `sourceType: 'staff_loan'`, and a loan already has its own `LOAN_EMI`
 * deduction. Counting it here too would collect the same principal twice.
 *
 * WHAT HAS ALREADY BEEN RECOVERED is read off the payslips themselves - the
 * `ADVANCE` deduction lines of runs that were actually processed. No separate
 * table and no stored total: the payslip line IS the record, so reverting a
 * run (which rebuilds its payslips) un-counts its recovery automatically.
 * A draft run's lines deliberately do not count - nothing has been collected
 * until the run is processed.
 */
export async function recoverableAdvances(
  scope: StoreScope, userIds?: string[],
): Promise<Map<string, number>> {
  const forUsers = userIds ? { userId: { in: userIds } } : {};

  const [txns, recovered] = await Promise.all([
    db.staffTransaction.findMany({
      where: {
        ...scopeWhere(scope), ...forUsers, status: 'active',
        kind: { in: ['advance_given', 'advance_repaid', 'advance_written_off'] },
        NOT: { sourceType: 'staff_loan' },
      },
      select: { userId: true, kind: true, amountPaise: true },
    }),
    db.payslipLine.findMany({
      where: {
        kind: 'deduction', code: 'ADVANCE',
        payslip: {
          ...scopeWhere(scope), ...forUsers,
          payrollRun: { status: { in: ['processed', 'paid'] } },
        },
      },
      select: { amountPaise: true, payslip: { select: { userId: true } } },
    }),
  ]);

  const out = new Map<string, number>();
  const add = (userId: string, paise: number) => out.set(userId, (out.get(userId) ?? 0) + paise);
  for (const t of txns) add(t.userId, t.kind === 'advance_given' ? t.amountPaise : -t.amountPaise);
  for (const r of recovered) add(r.payslip.userId, -r.amountPaise);

  // Nothing owed is not worth carrying, and a negative means more came back
  // than went out - a data problem for a human, not a payroll deduction.
  for (const [userId, paise] of [...out]) if (paise <= 0) out.delete(userId);
  return out;
}

/** Advance money already taken off payslips, per person - counted in the balance below. */
async function advanceRecoveredOnPayslips(scope: StoreScope): Promise<Map<string, number>> {
  const rows = await db.payslipLine.findMany({
    where: {
      kind: 'deduction', code: 'ADVANCE',
      payslip: { ...scopeWhere(scope), payrollRun: { status: { in: ['processed', 'paid'] } } },
    },
    select: { amountPaise: true, payslip: { select: { userId: true } } },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.payslip.userId, (out.get(r.payslip.userId) ?? 0) + r.amountPaise);
  }
  return out;
}

/**
 * ONE ROW PER EMPLOYEE, WITH EVERYTHING ON IT (9 Oct 2026).
 *
 * The Staff Account screen is a READ, like Customer Account and Supplier
 * Account beside it in the menu. Nothing is recorded there any more: a loan or
 * an advance is raised at HRM > Loans & Salary Advances, a claim at HRM >
 * Payroll > Claims, and office spending at Office Expenses. This assembles
 * what those three produce into the one line somebody actually wants to read.
 *
 * TWO DIRECTIONS, TWO COLUMNS, NEVER ONE SIGNED NUMBER.
 *
 * It used to show a single `netBalancePaise` where a minus meant the business
 * owed the employee. People read a minus as "less than expected", not as "the
 * arrow points the other way". So `owedByStaffPaise` and `owedToStaffPaise` are
 * separate, each never below zero, and a person can genuinely have both at once
 * - a loan running while an expense claim waits to be paid is not a
 * contradiction, and netting them off would hide both.
 *
 * SALARY IS SHOWN BESIDE THE EMI on purpose: "is this instalment too big for
 * this person" is the question a reader is really asking, and it cannot be
 * answered by the loan alone.
 */
export interface StaffAccountRow {
  userId: string;
  fullName: string;
  userCode: string;
  isActive: boolean;
  /** Contracted monthly gross. 0 when no salary structure is set up yet. */
  monthlySalaryPaise: number;
  /** Loans only - advances are counted separately below. */
  loanTakenPaise: number;
  loanEmiPaise: number;
  loanPaidCount: number;
  loanTenureMonths: number;
  loanLeftPaise: number;
  /** Advances raised at Loans & Salary Advances, plus anything older handed over as a plain advance. */
  advanceGivenPaise: number;
  advanceLeftPaise: number;
  /** What this person owes the business: loans + advances left. Never negative. */
  owedByStaffPaise: number;
  /** What the business owes this person: approved claims not yet reimbursed. Never negative. */
  owedToStaffPaise: number;
  /** Loan and advance numbers, for the line under the name. */
  openDocs: string[];
}

export interface StaffAccountCards {
  people: number;
  owedByStaffPaise: number;
  owedToStaffPaise: number;
  openLoans: number;
  openAdvances: number;
}

export async function listStaffAccounts(scope: StoreScope): Promise<{
  rows: StaffAccountRow[]; cards: StaffAccountCards;
}> {
  const [assignments, loans, txns, payslipRepayments, advanceRecovered, salaries] = await Promise.all([
    db.userStoreRole.findMany({
      where: scopeWhere(scope),
      select: { userId: true, user: { select: { id: true, fullName: true, userCode: true, isActive: true } } },
      distinct: ['userId'],
    }),
    db.staffLoan.findMany({
      where: { ...scopeWhere(scope), status: 'active' },
      select: {
        id: true, userId: true, kind: true, loanNo: true,
        principalPaise: true, emiPaise: true, tenureMonths: true,
        repayments: { where: { deletedAt: null }, select: { amountPaise: true } },
      },
      orderBy: [{ startPeriod: 'asc' }, { createdAt: 'asc' }],
    }),
    db.staffTransaction.findMany({
      where: { ...scopeWhere(scope), status: 'active' },
      select: { userId: true, kind: true, amountPaise: true, sourceType: true },
    }),
    db.staffLoanRepayment.findMany({
      where: { payslipId: { not: null }, loan: scopeWhere(scope) },
      select: { amountPaise: true, loan: { select: { userId: true } } },
    }),
    advanceRecoveredOnPayslips(scope),
    /**
     * Contracted monthly gross, from the LIVE salary contract - the same place
     * payroll reads it, not the older `EmployeeSalary` table it superseded.
     *
     * Queried here rather than through `server/payroll.ts`, which already
     * imports this file: one more import the other way would be a cycle, and
     * this is one query.
     *
     * Only `fixed` components carry a monthly figure. A commission or
     * per-day component has no single monthly number until a run computes it,
     * so it adds nothing here - which is right for a column that exists to
     * answer "is this EMI too big for this person".
     */
    db.salaryContract.findMany({
      where: { ...scopeWhere(scope), isActive: true, effectiveTo: null },
      select: { userId: true, components: { select: { monthlyPaise: true } } },
    }),
  ]);

  const salaryByUser = new Map(salaries.map((c) => [
    c.userId, c.components.reduce((n, x) => n + (x.monthlyPaise ?? 0), 0),
  ]));

  const blank = (): Omit<StaffAccountRow, 'userId' | 'fullName' | 'userCode' | 'isActive' | 'monthlySalaryPaise'> => ({
    loanTakenPaise: 0, loanEmiPaise: 0, loanPaidCount: 0, loanTenureMonths: 0, loanLeftPaise: 0,
    advanceGivenPaise: 0, advanceLeftPaise: 0,
    owedByStaffPaise: 0, owedToStaffPaise: 0, openDocs: [],
  });
  const acc = new Map<string, ReturnType<typeof blank>>();
  const of = (userId: string) => {
    const row = acc.get(userId) ?? blank();
    acc.set(userId, row);
    return row;
  };

  for (const loan of loans) {
    const row = of(loan.userId);
    const repaid = loan.repayments.reduce((n, r) => n + r.amountPaise, 0);
    const left = Math.max(0, loan.principalPaise - repaid);
    if (loan.loanNo) row.openDocs.push(loan.loanNo);

    if (loan.kind === 'advance') {
      row.advanceGivenPaise += loan.principalPaise;
      row.advanceLeftPaise += left;
    } else {
      row.loanTakenPaise += loan.principalPaise;
      row.loanEmiPaise += loan.emiPaise;
      row.loanLeftPaise += left;
      row.loanTenureMonths += loan.tenureMonths;
      row.loanPaidCount += loan.emiPaise > 0
        ? Math.min(loan.tenureMonths, Math.floor(repaid / loan.emiPaise))
        : 0;
    }
  }

  // Anything handed over as a plain advance - including everything raised
  // before advances lived on StaffLoan - still counts, or an old balance would
  // vanish from this screen the day it was rebuilt.
  for (const t of txns) {
    const row = of(t.userId);
    const isLoanLinked = t.sourceType === 'staff_loan';
    if (t.kind === 'advance_given' && !isLoanLinked) {
      row.advanceGivenPaise += t.amountPaise;
      row.advanceLeftPaise += t.amountPaise;
    } else if ((t.kind === 'advance_repaid' || t.kind === 'advance_written_off') && !isLoanLinked) {
      row.advanceLeftPaise -= t.amountPaise;
    } else if (t.kind === 'expense_claimed') {
      row.owedToStaffPaise += t.amountPaise;
    } else if (t.kind === 'expense_reimbursed') {
      row.owedToStaffPaise -= t.amountPaise;
    }
  }

  for (const r of payslipRepayments) of(r.loan.userId);
  for (const [userId, paise] of advanceRecovered) {
    of(userId).advanceLeftPaise -= paise;
  }

  const rows: StaffAccountRow[] = assignments.map((a) => {
    const t = acc.get(a.userId) ?? blank();
    const advanceLeftPaise = Math.max(0, t.advanceLeftPaise);
    return {
      userId: a.user.id,
      fullName: a.user.fullName,
      userCode: a.user.userCode,
      isActive: a.user.isActive,
      monthlySalaryPaise: salaryByUser.get(a.userId) ?? 0,
      ...t,
      advanceLeftPaise,
      owedByStaffPaise: t.loanLeftPaise + advanceLeftPaise,
      owedToStaffPaise: Math.max(0, t.owedToStaffPaise),
    };
  }).sort((x, y) =>
    (y.owedByStaffPaise + y.owedToStaffPaise) - (x.owedByStaffPaise + x.owedToStaffPaise)
    || x.fullName.localeCompare(y.fullName));

  return {
    rows,
    cards: {
      people: rows.length,
      owedByStaffPaise: rows.reduce((n, r) => n + r.owedByStaffPaise, 0),
      owedToStaffPaise: rows.reduce((n, r) => n + r.owedToStaffPaise, 0),
      openLoans: loans.filter((l) => l.kind !== 'advance').length,
      openAdvances: loans.filter((l) => l.kind === 'advance').length,
    },
  };
}

// ------------------------------------------------------------- the account list

export interface UserAccountRow {
  id: string;
  fullName: string;
  userCode: string;
  isActive: boolean;
  advanceOutstandingPaise: number;
  payableOutstandingPaise: number;
  netBalancePaise: number;
  totalExpensePaise: number;
  totalAdvancePaise: number;
  totalPaymentsPaise: number;
}

export interface UserAccountCards {
  totalUsers: number;
  opBalancePaise: number;
  totalExpensePaise: number;
  totalPaymentsPaise: number;
  outstandingPaise: number;
  totalAdvancePaise: number;
  activeAdvances: number;
}

export interface UserAccountsResult {
  rows: UserAccountRow[];
  cards: UserAccountCards;
}

export async function listUserAccounts(scope: StoreScope): Promise<UserAccountsResult> {
  const [assignments, txns, payslipRepayments, advanceRecovered] = await Promise.all([
    db.userStoreRole.findMany({
      where: scopeWhere(scope),
      select: { userId: true, user: { select: { id: true, fullName: true, userCode: true, isActive: true } } },
      distinct: ['userId'],
    }),
    db.staffTransaction.findMany({
      where: { ...scopeWhere(scope), status: 'active' },
      select: { userId: true, kind: true, amountPaise: true },
    }),
    // A loan EMI taken off a payslip is a repayment with no cash movement,
    // so it has no `StaffTransaction` of its own - see
    // `resolvePayslipLoanRepayments` in payroll-run.ts for why posting one
    // would credit Staff Advances twice. It still reduces what the employee
    // owes, so it is counted here. Leaving it out is what would let payroll
    // and this screen disagree about who owes what.
    db.staffLoanRepayment.findMany({
      where: { payslipId: { not: null }, loan: scopeWhere(scope) },
      select: { amountPaise: true, loan: { select: { userId: true } } },
    }),
    // The same for a plain advance recovered on a payslip (G-19). Also no
    // `StaffTransaction`, for the same reason: no cash moved, and the payroll
    // entry already credited 1400.
    advanceRecoveredOnPayslips(scope),
  ]);

  const byUser = new Map<string, {
    advance: number; advanceRepaid: number; expense: number; expenseReimbursed: number;
    advanceWrittenOff: number;
  }>();
  const blank = () => ({
    advance: 0, advanceRepaid: 0, expense: 0, expenseReimbursed: 0, advanceWrittenOff: 0,
  });

  for (const t of txns) {
    const row = byUser.get(t.userId) ?? blank();
    if (t.kind === 'advance_given') row.advance += t.amountPaise;
    else if (t.kind === 'advance_repaid') row.advanceRepaid += t.amountPaise;
    else if (t.kind === 'expense_claimed') row.expense += t.amountPaise;
    else if (t.kind === 'expense_reimbursed') row.expenseReimbursed += t.amountPaise;
    // Clears the debt but is NOT a payment - see the note on `linesFor`.
    else if (t.kind === 'advance_written_off') row.advanceWrittenOff += t.amountPaise;
    byUser.set(t.userId, row);
  }

  for (const r of payslipRepayments) {
    const row = byUser.get(r.loan.userId) ?? blank();
    row.advanceRepaid += r.amountPaise;
    byUser.set(r.loan.userId, row);
  }

  for (const [userId, paise] of advanceRecovered) {
    const row = byUser.get(userId) ?? blank();
    row.advanceRepaid += paise;
    byUser.set(userId, row);
  }

  const rows: UserAccountRow[] = assignments.map((a) => {
    const t = byUser.get(a.userId) ?? blank();
    const advanceOutstandingPaise = t.advance - t.advanceRepaid - t.advanceWrittenOff;
    const payableOutstandingPaise = t.expense - t.expenseReimbursed;
    return {
      id: a.user.id,
      fullName: a.user.fullName,
      userCode: a.user.userCode,
      isActive: a.user.isActive,
      advanceOutstandingPaise,
      payableOutstandingPaise,
      // Positive: the employee owes the company (net advance). Negative: the
      // company owes the employee (net unreimbursed expense).
      netBalancePaise: advanceOutstandingPaise - payableOutstandingPaise,
      totalExpensePaise: t.expense,
      totalAdvancePaise: t.advance,
      totalPaymentsPaise: t.advanceRepaid + t.expenseReimbursed,
    };
  });

  const cards: UserAccountCards = {
    totalUsers: rows.length,
    opBalancePaise: rows.reduce((n, r) => n + r.netBalancePaise, 0),
    totalExpensePaise: rows.reduce((n, r) => n + r.totalExpensePaise, 0),
    totalPaymentsPaise: rows.reduce((n, r) => n + r.totalPaymentsPaise, 0),
    outstandingPaise: rows.reduce((n, r) => n + Math.max(0, r.payableOutstandingPaise), 0),
    totalAdvancePaise: rows.reduce((n, r) => n + r.totalAdvancePaise, 0),
    activeAdvances: rows.filter((r) => r.advanceOutstandingPaise > 0).length,
  };

  return { rows, cards };
}

export interface StaffTransactionRow {
  id: string;
  kind: StaffTransactionKind;
  amountPaise: number;
  txnDate: Date;
  method: string;
  note: string | null;
  /// `active` | `reversed` | `payroll`. `payroll` is a loan EMI deducted on a
  /// payslip: real, part of the balance, and not reversible from this screen -
  /// undoing it means undoing the payroll run that collected it.
  status: string;
  reversalReason: string | null;
}

export async function listStaffTransactionsForUser(
  scope: StoreScope, userId: string,
): Promise<StaffTransactionRow[]> {
  const [rows, loanRepayments, advanceLines] = await Promise.all([
    db.staffTransaction.findMany({
      where: { ...scopeWhere(scope), userId },
      select: {
        id: true, kind: true, amountPaise: true, txnDate: true, method: true,
        note: true, status: true, reversalReason: true,
      },
      orderBy: { txnDate: 'desc' },
      take: LIST_MAX_ROWS,
    }),
    // The payslip-deducted EMIs `listUserAccounts` counts in the balance.
    // They belong in the history for the same reason: a balance that moved
    // with nothing on the list to explain it is a balance nobody trusts.
    db.staffLoanRepayment.findMany({
      where: { payslipId: { not: null }, loan: { ...scopeWhere(scope), userId } },
      select: { id: true, amountPaise: true, paidAt: true, payslipId: true },
      orderBy: { paidAt: 'desc' },
      take: LIST_MAX_ROWS,
    }),
    // Advance recovered on a payslip (G-19), the same way.
    db.payslipLine.findMany({
      where: {
        kind: 'deduction', code: 'ADVANCE',
        payslip: {
          ...scopeWhere(scope), userId,
          payrollRun: { status: { in: ['processed', 'paid'] } },
        },
      },
      select: {
        id: true, amountPaise: true,
        payslip: { select: { payrollRun: { select: { label: true, periodEnd: true } } } },
      },
      take: LIST_MAX_ROWS,
    }),
  ]);

  const runLabelByPayslip = new Map<string, string>();
  if (loanRepayments.length > 0) {
    const payslips = await db.payslip.findMany({
      where: { id: { in: [...new Set(loanRepayments.map((r) => r.payslipId!))] } },
      select: { id: true, payrollRun: { select: { label: true } } },
    });
    for (const p of payslips) runLabelByPayslip.set(p.id, p.payrollRun.label);
  }

  const merged: StaffTransactionRow[] = [
    ...(rows as StaffTransactionRow[]),
    ...advanceLines.map((l) => ({
      id: l.id,
      kind: 'advance_repaid' as StaffTransactionKind,
      amountPaise: l.amountPaise,
      txnDate: l.payslip.payrollRun.periodEnd,
      method: 'salary deduction',
      note: `Advance recovered on the ${l.payslip.payrollRun.label} payslip`,
      status: 'payroll',
      reversalReason: null,
    })),
    ...loanRepayments.map((r) => ({
      id: r.id,
      kind: 'advance_repaid' as StaffTransactionKind,
      amountPaise: r.amountPaise,
      txnDate: r.paidAt,
      method: 'salary deduction',
      note: `Loan EMI on the ${runLabelByPayslip.get(r.payslipId!) ?? 'payroll'} payslip`,
      status: 'payroll',
      reversalReason: null,
    })),
  ];

  return merged
    .sort((a, b) => b.txnDate.getTime() - a.txnDate.getTime())
    .slice(0, LIST_MAX_ROWS);
}
