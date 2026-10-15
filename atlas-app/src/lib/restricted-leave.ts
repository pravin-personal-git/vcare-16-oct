/**
 * Is a leave request caught by a blackout period - mirrors atlas-hrns's
 * real restriction logic (`leave/models.py:1648-1678`), adapted to drop
 * job-position scoping (Atlas has no equivalent concept; department is the
 * only scope).
 */
export interface RestrictedPeriod {
  startDate: Date;
  endDate: Date;
  /** Null = every department in the store. */
  departmentId: string | null;
  includeAllLeaveTypes: boolean;
  specificLeaveTypeIds: string[];
  excludedLeaveTypeIds: string[];
}

export interface LeaveRequestCheck {
  /** Null for `wfh`/`half_day`, which draw from no typed quota. */
  leaveTypeId: string | null;
  fromDate: Date;
  toDate: Date;
  employeeDepartmentId: string | null;
}

export function isLeaveRequestRestricted(period: RestrictedPeriod, request: LeaveRequestCheck): boolean {
  if (period.departmentId !== null && period.departmentId !== request.employeeDepartmentId) return false;
  if (request.toDate < period.startDate || request.fromDate > period.endDate) return false;

  // wfh/half_day carry no leaveTypeId - only a blanket restriction (no
  // exclusions carved out) can catch them, the same way atlas-hrns's own
  // check has nothing typed to compare exclusions/specifics against.
  if (!request.leaveTypeId) return period.includeAllLeaveTypes && period.excludedLeaveTypeIds.length === 0;

  if (period.includeAllLeaveTypes && period.excludedLeaveTypeIds.length === 0) return true;
  if (period.excludedLeaveTypeIds.length > 0) return !period.excludedLeaveTypeIds.includes(request.leaveTypeId);
  return period.specificLeaveTypeIds.includes(request.leaveTypeId);
}
