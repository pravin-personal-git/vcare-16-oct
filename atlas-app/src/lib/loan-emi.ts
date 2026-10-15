import { formatCurrency } from './format';

/**
 * WHAT A PAYROLL PERIOD ACTUALLY COLLECTS ON SOMEBODY'S LOANS.
 *
 * `loan-schedule.ts` reconstructs the *plan* - which installment is paid,
 * due or upcoming. This answers the narrower question payroll asks once a
 * month: given what is still outstanding right now, how much comes off this
 * payslip, and against which loan.
 *
 * Three rules, all of them money:
 *
 *   1. An EMI is capped at what is left. The last installment collects the
 *      remainder, not a full EMI.
 *   2. A loan with nothing left contributes nothing - this is what stopped
 *      a fully repaid loan from being deducted forever (G-03).
 *   3. Every active loan is collected, not just the first one. Two loans at
 *      once is unusual but it is not a reason to silently skip one.
 *
 * The caller decides the order (payroll uses oldest `startPeriod` first) and
 * the same order is used at generate time and at process time, so the
 * payslip's deduction and the repayments written against it agree.
 */

export interface LoanForEmi {
  id: string;
  emiPaise: number;
  principalPaise: number;
  /** Everything already collected on this loan, by payslip or by hand. */
  repaidPaise: number;
}

export interface LoanEmiShare {
  loanId: string;
  duePaise: number;
  /** What is still owed on this loan once `duePaise` is collected. 0 = it closes. */
  balanceAfterPaise: number;
}

export interface LoanEmiDue {
  /** The single `LOAN_EMI` deduction line's amount. 0 = no line at all. */
  totalPaise: number;
  /** The payslip label, so the employee can see where the loan now stands. `''` when nothing is due. */
  label: string;
  shares: LoanEmiShare[];
}

export function dueLoanEmi(loans: LoanForEmi[]): LoanEmiDue {
  const shares: LoanEmiShare[] = [];
  let totalPaise = 0;
  let balanceAfterPaise = 0;

  for (const loan of loans) {
    const remaining = loan.principalPaise - loan.repaidPaise;
    if (remaining <= 0) continue;

    const duePaise = Math.min(loan.emiPaise, remaining);
    if (duePaise <= 0) continue;

    shares.push({ loanId: loan.id, duePaise, balanceAfterPaise: remaining - duePaise });
    totalPaise += duePaise;
    balanceAfterPaise += remaining - duePaise;
  }

  return { totalPaise, label: labelFor(shares.length, balanceAfterPaise), shares };
}

function labelFor(loanCount: number, balanceAfterPaise: number): string {
  if (loanCount === 0) return '';
  const base = loanCount === 1 ? 'Loan EMI' : `Loan EMI (${loanCount} loans)`;
  return balanceAfterPaise === 0
    ? `${base} - nothing left after this month`
    : `${base} - ${formatCurrency(balanceAfterPaise)} left after this month`;
}
