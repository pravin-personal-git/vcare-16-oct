/**
 * The EMI schedule view for a StaffLoan (roadmap §4.5 - "list, create, EMI
 * schedule view, settle"). `StaffLoanRepayment` rows don't carry which
 * installment they satisfy - a repayment can be partial, early, or a full
 * settlement - so this reconstructs the schedule from cumulative totals
 * rather than trying to match individual payments to individual months.
 */
export interface LoanScheduleRow {
  index: number;
  period: Date;
  duePaise: number;
  cumulativeDuePaise: number;
  status: 'paid' | 'due' | 'upcoming';
}

export function buildLoanSchedule(
  loan: { principalPaise: number; emiPaise: number; tenureMonths: number; startPeriod: Date },
  repaidPaise: number,
  today: Date = new Date(),
): LoanScheduleRow[] {
  const rows: LoanScheduleRow[] = [];
  let cumulativeDue = 0;

  for (let i = 0; i < loan.tenureMonths; i += 1) {
    const period = new Date(loan.startPeriod);
    period.setMonth(period.getMonth() + i);

    // The last installment absorbs whatever rounding the EMI left behind,
    // rather than under- or over-collecting the principal.
    const isLast = i === loan.tenureMonths - 1;
    const due = isLast ? loan.principalPaise - loan.emiPaise * (loan.tenureMonths - 1) : loan.emiPaise;
    cumulativeDue += due;

    const status: LoanScheduleRow['status'] =
      repaidPaise >= cumulativeDue ? 'paid' : period <= today ? 'due' : 'upcoming';

    rows.push({ index: i + 1, period, duePaise: due, cumulativeDuePaise: cumulativeDue, status });
  }

  return rows;
}
