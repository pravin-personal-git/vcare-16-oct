/**
 * The per-day rate an encashment pays out, snapshot from the employee's
 * contracted annual CTC at request time (roadmap §4.5's LeaveEncashment -
 * "not yet raised from anywhere" until this).
 *
 * 26 working days a month, not 30 or the calendar month's actual length -
 * the same divisor Indian statutory calculations (PF, gratuity) already use
 * for a "per day of service" figure, and the one atlas-hrns's own encashment
 * math is built on.
 */
const WORKING_DAYS_PER_MONTH = 26;

export function encashmentRatePaise(ctcAnnualPaise: number): number {
  return Math.round(ctcAnnualPaise / 12 / WORKING_DAYS_PER_MONTH);
}

export function encashmentAmountPaise(ratePaise: number, days: number): number {
  return Math.round(ratePaise * days);
}
