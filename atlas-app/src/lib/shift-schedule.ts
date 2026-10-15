/**
 * Resolves which start/end time and "full day" threshold actually apply to
 * ONE employee on ONE day - their own assigned `EmployeeShift`'s schedule
 * for that weekday if they have one, the store's own `AttendancePolicy`
 * otherwise. The single place both attendance classification
 * (`attendanceMonth` in `server/attendance.ts`) and payroll
 * (`server/payroll-run.ts`) resolve this fact, so a shift assignment
 * changes what both agree on, never just one of them - exactly the
 * "two reports disagree about the same number" bug this codebase has a
 * documented history of avoiding elsewhere (`REVENUE_ORDER_WHERE`,
 * `incentivePaise`).
 *
 * This is the follow-up the Work Schedules slice (roadmap §4.2)
 * deliberately deferred: `EmployeeShift`/`EmployeeShiftSchedule` shipped
 * as configuration and assignment only, with dayStatus()/payroll reading
 * only the store default. This function is what makes an assignment
 * actually mean something.
 */

export interface ShiftDaySchedule {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  minWorkingMinutes: number;
}

export interface StoreDefaultPolicy {
  shiftStart: string;
  shiftEnd: string;
  fullDayMinutes: number;
  /** The store's own `isWeeklyOff` result for this date, for an employee with no shift assigned. */
  isWeeklyOffByDefault: boolean;
}

export interface EffectiveDayPolicy {
  /**
   * True when this employee has an assigned shift and that shift has no
   * schedule row for this weekday - their own personal day off, distinct
   * from (and overriding) the store's own weekly-off days.
   */
  isScheduledOff: boolean;
  shiftStart: string;
  shiftEnd: string;
  fullDayMinutes: number;
}

/** `shiftSchedule` is null for an employee with no shift assigned - falls back to the store default entirely. */
export function effectiveDayPolicy(
  shiftSchedule: ShiftDaySchedule[] | null,
  dayOfWeek: number,
  storeDefault: StoreDefaultPolicy,
): EffectiveDayPolicy {
  if (!shiftSchedule) {
    return {
      isScheduledOff: storeDefault.isWeeklyOffByDefault,
      shiftStart: storeDefault.shiftStart, shiftEnd: storeDefault.shiftEnd, fullDayMinutes: storeDefault.fullDayMinutes,
    };
  }

  const day = shiftSchedule.find((d) => d.dayOfWeek === dayOfWeek);
  if (!day) {
    return {
      isScheduledOff: true,
      shiftStart: storeDefault.shiftStart, shiftEnd: storeDefault.shiftEnd, fullDayMinutes: storeDefault.fullDayMinutes,
    };
  }

  return { isScheduledOff: false, shiftStart: day.startTime, shiftEnd: day.endTime, fullDayMinutes: day.minWorkingMinutes };
}
