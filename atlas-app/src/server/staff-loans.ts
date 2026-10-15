import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { createStaffTransaction } from './staff-accounts';
import { allocateDocumentNumber } from './allocate-document-number';

/**
 * Loans & Salary Advances (roadmap §4.5) - the screen `StaffLoan` never had.
 * Disbursing and repaying both post to the same Staff Advances ledger
 * (`1400`) `createStaffTransaction` already maintains for the Staff
 * Account screen - a loan is just an advance with a repayment schedule
 * attached, not a second ledger.
 */
export class StaffLoanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaffLoanError';
  }
}

/** `loan` or `advance` - the same arithmetic, different defaults and different word. */
export type LoanKind = 'loan' | 'advance';

/** `LN` for a loan, `ADV` for a salary advance - so the two read apart in a list. */
const NUMBER_PREFIX = { loan: 'LN', advance: 'ADV' } as const;

export interface LoanRow {
  id: string;
  loanNo: string | null;
  kind: LoanKind;
  userId: string;
  userName: string;
  principalPaise: number;
  emiPaise: number;
  tenureMonths: number;
  startPeriod: Date;
  reason: string | null;
  status: string;
  repaidPaise: number;
  createdAt: Date;
  /** Instalments collected so far, and how many there are in all. */
  paidCount: number;
  /** Still owed. */
  outstandingPaise: number;
}

export async function listLoans(scope: StoreScope): Promise<LoanRow[]> {
  const loans = await db.staffLoan.findMany({
    where: scopeWhere(scope),
    // Tombstoned repayments - given back by a reverted payroll run - do not
    // count. A relation read is not covered by the soft-delete filter.
    include: {
      user: { select: { fullName: true } },
      repayments: { where: { deletedAt: null }, select: { amountPaise: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return loans.map((l) => {
    const repaidPaise = l.repayments.reduce((sum, r) => sum + r.amountPaise, 0);
    return {
    id: l.id,
    loanNo: l.loanNo,
    kind: l.kind === 'advance' ? 'advance' as const : 'loan' as const,
    userId: l.userId,
    userName: l.user.fullName,
    principalPaise: l.principalPaise,
    emiPaise: l.emiPaise,
    tenureMonths: l.tenureMonths,
    startPeriod: l.startPeriod,
    reason: l.reason,
    status: l.status,
    repaidPaise,
    createdAt: l.createdAt,
    // Counted from the money, not from a stored instalment number: a
    // repayment can be partial or early, so "how many EMIs has this
    // covered" is the only honest reading of it.
    paidCount: l.emiPaise > 0 ? Math.min(l.tenureMonths, Math.floor(repaidPaise / l.emiPaise)) : 0,
    outstandingPaise: Math.max(0, l.principalPaise - repaidPaise),
    };
  });
}

/** Everyone holding a role in this store - the pool a loan can be raised against. */
export async function listLoanEligibleUsers(scope: StoreScope) {
  const storeId = scopeForWrite(scope);
  const roles = await db.userStoreRole.findMany({
    where: { storeId },
    distinct: ['userId'],
    select: { user: { select: { id: true, fullName: true } } },
  });
  return roles.map((r) => r.user).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function createLoan(
  scope: StoreScope,
  input: {
    userId: string; principalPaise: number; emiPaise: number; tenureMonths: number;
    startPeriod: Date; reason: string | null; method: string;
    /** Defaults to a loan, for callers written before advances lived here. */
    kind?: LoanKind;
  },
  userId: string,
): Promise<{ id: string }> {
  const storeId = scopeForWrite(scope);
  if (input.principalPaise <= 0) throw new StaffLoanError('Enter a principal amount greater than zero.');
  if (input.emiPaise <= 0) throw new StaffLoanError('Enter an EMI amount greater than zero.');
  if (input.emiPaise > input.principalPaise) throw new StaffLoanError('The EMI cannot be larger than the principal.');
  // Guards the one mistake the advance form can make: a tenure that cannot
  // clear the amount, leaving a stub nobody notices for months.
  if (input.emiPaise * input.tenureMonths < input.principalPaise) {
    throw new StaffLoanError('These instalments will not cover the whole amount - raise the EMI or the number of months.');
  }
  if (input.tenureMonths <= 0) throw new StaffLoanError('Tenure must be at least one month.');

  const staff = await db.userStoreRole.findFirst({ where: { storeId, userId: input.userId } });
  if (!staff) throw new StaffLoanError('That person does not hold a role in this store.');

  const kind: LoanKind = input.kind === 'advance' ? 'advance' : 'loan';
  const loanNo = await allocateDocumentNumber(storeId, NUMBER_PREFIX[kind], new Date());

  const loan = await db.staffLoan.create({
    data: {
      storeId, kind, loanNo,
      userId: input.userId, principalPaise: input.principalPaise, emiPaise: input.emiPaise,
      tenureMonths: input.tenureMonths, startPeriod: input.startPeriod,
      reason: input.reason?.trim() || null, approvedBy: userId, createdBy: userId,
    },
  });

  // Disbursal posts to the ledger immediately, same as any other advance -
  // a loan somebody approved and nobody paid out is not a real loan yet.
  const txn = await createStaffTransaction(scope, {
    userId: input.userId, kind: 'advance_given', amountPaise: input.principalPaise,
    txnDate: new Date(), method: input.method, sourceType: 'staff_loan', sourceId: loan.id,
  }, userId);

  await db.staffLoan.update({ where: { id: loan.id }, data: { disbursalTransactionId: txn.id } });

  return { id: loan.id };
}

/** A single repayment, whether it's one EMI, a partial catch-up, or a full early settlement. */
export async function recordLoanRepayment(
  scope: StoreScope, loanId: string, input: { amountPaise: number; method: string }, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (input.amountPaise <= 0) throw new StaffLoanError('Enter an amount greater than zero.');

  const loan = await db.staffLoan.findFirst({
    where: { id: loanId, storeId },
    include: { repayments: { where: { deletedAt: null }, select: { amountPaise: true } } },
  });
  if (!loan) throw new StaffLoanError('Loan not found in your scope.');
  if (loan.status !== 'active') throw new StaffLoanError(`This loan is already ${loan.status}.`);

  const alreadyRepaid = loan.repayments.reduce((sum, r) => sum + r.amountPaise, 0);
  const remaining = loan.principalPaise - alreadyRepaid;
  if (input.amountPaise > remaining) {
    throw new StaffLoanError(`Only ₹${(remaining / 100).toFixed(2)} is outstanding on this loan.`);
  }

  const txn = await createStaffTransaction(scope, {
    userId: loan.userId, kind: 'advance_repaid', amountPaise: input.amountPaise,
    txnDate: new Date(), method: input.method, sourceType: 'staff_loan', sourceId: loan.id,
  }, userId);

  await db.staffLoanRepayment.create({
    data: { loanId: loan.id, amountPaise: input.amountPaise, transactionId: txn.id },
  });

  if (alreadyRepaid + input.amountPaise >= loan.principalPaise) {
    await db.staffLoan.update({ where: { id: loan.id }, data: { status: 'closed' } });
  }
}
