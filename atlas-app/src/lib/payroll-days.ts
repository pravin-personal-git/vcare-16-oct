/**
 * Working, paid and loss-of-pay days for one employee over one payroll
 * period - pure arithmetic, no database.
 *
 * DELIBERATELY NOT `dayStatus`/`payableDays` FROM `attendance.ts`
 *
 * Those already classify a day for the attendance grid, and `payableDays`
 * already sums "days treated as worked" - but neither knows whether an
 * approved LEAVE day was PAID or unpaid, because the grid never needed to
 * ask: "on leave" is enough to show there. Payroll cannot skip that
 * question - an unpaid leave type is exactly a loss-of-pay day, and a paid
 * one is not. Reshaping `dayStatus` to carry that distinction would ripple
 * into every screen that already renders `DayStatus`, for a fact only
 * payroll needs. This module answers the payroll-specific question on its
 * own, using the same `AttendancePolicy` thresholds for consistency.
 */

export interface PayrollDayInput {
  /** `2026-09-18` - a calendar-day label, the same shape `AttendanceDay.workDate` already uses. */
  workDate: string;
  isWeeklyOff: boolean;
  isHoliday: boolean;
  /**
   * Overrides the period-wide `fullDayMinutes` for this one day - set when
   * the employee has an assigned `EmployeeShift` with its own schedule for
   * this weekday (`lib/shift-schedule.ts`'s `effectiveDayPolicy`).
   * Undefined falls back to the store-wide figure every caller already
   * passes, so a store where nobody has a shift assigned behaves exactly
   * as before this field existed.
   */
  fullDayMinutes?: number;
  /** Minutes worked that day, from `AttendanceDay.workedMinutes`. Null = no shift at all. */
  workedMinutes: number | null;
  /**
   * An approved leave/WFH/half-day request covering this day, if any.
   *
   * `paidPercentage` (0-100, `LeaveType.paidPercentage`) is undefined for
   * `wfh` (always effectively paid - the person worked) and for `half_day`
   * (see the note on `HALF_DAY_LEAVE_PAID_FRACTION` below -
   * `LeaveRequest.kind = 'half_day'` carries no `leaveTypeId`, so there is
   * no configured pay percentage to read).
   */
  leave: { kind: 'leave' | 'wfh' | 'half_day'; paidPercentage?: number } | null;
}

export interface PayrollDaysResult {
  /** Calendar days in the period, minus weekly offs. The denominator for a per-day rate. */
  workingDays: number;
  /** Of `workingDays`, how many are paid - present, WFH, holiday, or paid leave. Half days count 0.5. */
  paidDays: number;
  /** `workingDays - paidDays`. Unpaid absence and unpaid leave, half-day aware. */
  lopDays: number;
}

/**
 * A half-day LEAVE REQUEST (`kind = 'half_day'`) has no `LeaveType` to read
 * a paid/unpaid flag from - the schema comment on `LeaveRequest.leaveTypeId`
 * says as much ("wfh/half_day never draw from a typed quota"). Treated as
 * paid at 0.5, unpaid at 0.5 - the same split `CLAUDE.md`'s own leave-balance
 * formula gives a half day (`- (Half Days × 0.5)`), rather than assumed
 * fully paid or fully unpaid. A store that disagrees can only be un-blocked
 * by giving half-day requests their own paid/unpaid flag - real backlog, not
 * a decision this module should quietly make more confident than it is.
 */
const HALF_DAY_LEAVE_PAID_FRACTION = 0.5;

/** A worked day below this many minutes counts as a half day, at or above `fullDayMinutes` a full day, below `halfDayMinutes` unpaid entirely. */
export function classifyPayrollDay(
  day: PayrollDayInput,
  fullDayMinutes: number,
  halfDayMinutes: number,
): { isWorkingDay: boolean; paidFraction: number } {
  if (day.isWeeklyOff) return { isWorkingDay: false, paidFraction: 0 };

  if (day.isHoliday) return { isWorkingDay: true, paidFraction: 1 };

  if (day.leave) {
    if (day.leave.kind === 'wfh') return { isWorkingDay: true, paidFraction: 1 };
    if (day.leave.kind === 'half_day') {
      return { isWorkingDay: true, paidFraction: HALF_DAY_LEAVE_PAID_FRACTION };
    }
    // kind === 'leave'
    return { isWorkingDay: true, paidFraction: (day.leave.paidPercentage ?? 100) / 100 };
  }

  const effectiveFullDayMinutes = day.fullDayMinutes ?? fullDayMinutes;
  if (day.workedMinutes !== null && day.workedMinutes >= effectiveFullDayMinutes) {
    return { isWorkingDay: true, paidFraction: 1 };
  }
  if (day.workedMinutes !== null && day.workedMinutes >= halfDayMinutes) {
    return { isWorkingDay: true, paidFraction: 0.5 };
  }

  // No shift, or a shift too short to count, and no leave covering it - an
  // unmarked day is loss-of-pay, not a benefit of the doubt. HR corrects
  // attendance before running payroll, not after.
  return { isWorkingDay: true, paidFraction: 0 };
}

/**
 * Days the employee actually showed up, regardless of whether the day was
 * ultimately paid or unpaid - the basis for a `per_attendance_day` salary
 * component (atlas-hrns's own "Attendance" `based_on` type). Deliberately
 * NOT the same figure as `paidDays` above: paid leave counts toward
 * `paidDays` without the person having worked at all, and a component
 * that pays "per day attended" should not pay out for a day spent on
 * leave, however generously that leave is compensated elsewhere.
 */
export function countPresentDays(days: PayrollDayInput[]): number {
  return days.filter((d) => d.workedMinutes !== null && d.workedMinutes > 0).length;
}

export interface OvertimeMinutesByKind {
  regular: number;
  weekOff: number;
  holiday: number;
}

/**
 * Overtime minutes for the period, split the same three ways atlas-hrns's
 * own engine does - a `per_overtime_hour` salary component picks one
 * bucket via its `overtimeKind`.
 *
 * A scheduled day off (weekly off or holiday) has no "normal day length"
 * to exceed - nobody was expected to work at all, so every minute worked
 * counts as overtime. A regular working day only counts the excess past
 * `fullDayMinutes`, and only once that excess clears `overtimeMinMinutes` -
 * the same "minutes required before the excess counts AT ALL" gate
 * `AttendancePolicy.overtimeMinMinutes` already documents.
 *
 * `overtimeMinMinutes === null` means this store has not turned overtime
 * tracking on at all (see that field's own doc comment) - every bucket is
 * zero, not just the regular one, so a store that never configured this
 * cannot accidentally start paying week-off/holiday overtime components
 * either.
 */
export function summarizeOvertimeMinutes(
  days: PayrollDayInput[], fullDayMinutes: number, overtimeMinMinutes: number | null,
): OvertimeMinutesByKind {
  const result: OvertimeMinutesByKind = { regular: 0, weekOff: 0, holiday: 0 };
  if (overtimeMinMinutes === null) return result;

  for (const day of days) {
    if (day.workedMinutes === null || day.workedMinutes <= 0) continue;

    if (day.isHoliday) {
      result.holiday += day.workedMinutes;
      continue;
    }
    if (day.isWeeklyOff) {
      result.weekOff += day.workedMinutes;
      continue;
    }
    const effectiveFullDayMinutes = day.fullDayMinutes ?? fullDayMinutes;
    if (day.workedMinutes > effectiveFullDayMinutes + overtimeMinMinutes) {
      result.regular += day.workedMinutes - effectiveFullDayMinutes;
    }
  }

  return result;
}

export function summarizePayrollDays(days: PayrollDayInput[], fullDayMinutes: number, halfDayMinutes: number): PayrollDaysResult {
  let workingDays = 0;
  let paidDays = 0;

  for (const day of days) {
    const { isWorkingDay, paidFraction } = classifyPayrollDay(day, fullDayMinutes, halfDayMinutes);
    if (!isWorkingDay) continue;
    workingDays += 1;
    paidDays += paidFraction;
  }

  // Rounded to the nearest half-day - the finest unit anything here produces
  // (a half-day leave, a half-day attendance shortfall) - so float drift from
  // summing many 0.5s can never leave a payslip showing 21.500000000000004.
  paidDays = Math.round(paidDays * 2) / 2;

  return { workingDays, paidDays, lopDays: workingDays - paidDays };
}
