import 'server-only';
import { eachDay, istYearMonth, storedBounds, storedDay } from '@/lib/attendance-day';
import { db } from './db';
import { type StoreScope, scopeForWrite, scopeWhere } from './store-scope';
import { listAssignableUsers } from './assets';
import { raiseApproval, openApprovalRequest, decideApprovalStep, HierarchyError } from './hierarchy';
import { isLeaveRequestRestricted } from '@/lib/restricted-leave';

/**
 * Named leave categories (Casual, Sick, Earned...), each employee's annual
 * quota for one, and a compensatory-leave ledger.
 *
 * "TAKEN" IS NEVER STORED.
 *
 * It is computed at read time as the sum of an employee's APPROVED
 * LeaveRequest day-spans of a given type overlapping a given year - the same
 * "ledger, not a running total" rule this codebase already applies to stock
 * and the general ledger. A stored counter could drift from what a manager
 * actually approved; a computed one cannot.
 *
 * WHAT THIS DOES NOT DO YET, ON PURPOSE.
 *
 * No carry-forward from a prior year, no automatic earned-leave accrual, and
 * a half-day request never draws from a typed quota (it has no leaveTypeId -
 * see the LeaveRequest model). The full documented formula - "Balance =
 * Carry Fwd + This Year + Sal.Cut + Earned - Taken - (Half Days x 0.5)" - is
 * a bigger, separate feature; this is the quota-and-usage half of it.
 */

export class LeaveTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeaveTypeError';
  }
}

export interface LeaveTypeRow {
  id: string;
  code: string;
  name: string;
  paidPercentage: number;
  defaultDaysPerYear: number | null;
  isActive: boolean;
}

export async function listLeaveTypes(scope: StoreScope, opts: { activeOnly?: boolean } = {}): Promise<LeaveTypeRow[]> {
  const rows = await db.leaveType.findMany({
    where: { ...scopeWhere(scope), ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: [{ sort: 'asc' }, { code: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name, paidPercentage: r.paidPercentage,
    defaultDaysPerYear: r.defaultDaysPerYear, isActive: r.isActive,
  }));
}

export interface LeaveTypeInput {
  code: string;
  name: string;
  paidPercentage: number;
  defaultDaysPerYear: number | null;
}

function validateLeaveTypeInput(
  input: LeaveTypeInput,
): { code: string; name: string; paidPercentage: number; defaultDaysPerYear: number | null } {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) throw new LeaveTypeError('Give the leave type a short code, like CL.');
  if (code.length > 10) throw new LeaveTypeError('Keep the code to 10 characters or fewer.');
  if (!name) throw new LeaveTypeError('Give the leave type a name.');

  const paidPercentage = Math.trunc(input.paidPercentage);
  if (!Number.isFinite(paidPercentage) || paidPercentage < 0 || paidPercentage > 100) {
    throw new LeaveTypeError('Pay percentage must be between 0 and 100.');
  }

  let defaultDaysPerYear: number | null = null;
  if (input.defaultDaysPerYear !== null) {
    const days = Math.trunc(input.defaultDaysPerYear);
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      throw new LeaveTypeError('The default days per year must be between 0 and 365.');
    }
    defaultDaysPerYear = days;
  }

  return { code, name, paidPercentage, defaultDaysPerYear };
}

export async function saveLeaveType(scope: StoreScope, id: string | null, input: LeaveTypeInput, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const { code, name, paidPercentage, defaultDaysPerYear } = validateLeaveTypeInput(input);

  const clash = await db.leaveType.findFirst({
    where: { storeId, code, ...(id ? { id: { not: id } } : {}) },
  });
  if (clash) throw new LeaveTypeError(`${code} is already in use by another leave type.`);

  if (id) {
    const existing = await db.leaveType.findFirst({ where: { id, storeId } });
    if (!existing) throw new LeaveTypeError('That leave type is not in your scope.');
    await db.leaveType.update({
      where: { id }, data: { code, name, paidPercentage, defaultDaysPerYear, updatedBy: userId },
    });
    return;
  }

  const last = await db.leaveType.findFirst({ where: { storeId }, orderBy: { sort: 'desc' }, select: { sort: true } });
  await db.leaveType.create({
    data: {
      storeId, code, name, paidPercentage, defaultDaysPerYear,
      sort: (last?.sort ?? 0) + 1, updatedBy: userId,
    },
  });
}

/** Deactivated, not deleted - past allocations and requests keep meaning what they meant. */
export async function removeLeaveType(scope: StoreScope, id: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const existing = await db.leaveType.findFirst({ where: { id, storeId } });
  if (!existing) throw new LeaveTypeError('That leave type is not in your scope.');
  await db.leaveType.update({ where: { id }, data: { isActive: false } });
}

// ------------------------------------------------------------- allocations

export interface AllocationCell {
  leaveTypeId: string;
  allowedDays: number;
  takenDays: number;
  balanceDays: number;
}

export interface AllocationRow {
  userId: string;
  userName: string;
  cells: AllocationCell[];
  compOffAvailable: number;
}

export interface AllocationsView {
  leaveTypes: LeaveTypeRow[];
  rows: AllocationRow[];
}

/**
 * One row per employee holding a role in this store, one cell per active
 * leave type, for the given year. Employees and leave types are the outer
 * shape (always shown, even at zero); allocations, requests and comp-off
 * entries are sparse data filled into that shape.
 */
export async function listAllocations(scope: StoreScope, year: number): Promise<AllocationsView> {
  const storeId = scopeForWrite(scope);
  // India days (lib/attendance-day): a leave saved at midnight India time on
  // 1 Jan is 18:30 UTC on 31 Dec, and fell out of a server-zone year.
  const yearFirst = `${year}-01-01`;
  const yearLast = `${year}-12-31`;
  const yearBounds = storedBounds(yearFirst, yearLast);

  const [leaveTypes, staff, allocations, approvedLeaves, compOffEntries] = await Promise.all([
    listLeaveTypes(scope, { activeOnly: true }),
    listAssignableUsers(scope),
    db.leaveAllocation.findMany({ where: { storeId, year } }),
    db.leaveRequest.findMany({
      where: {
        storeId, status: 'approved', kind: 'leave', leaveTypeId: { not: null },
        fromDate: { lte: yearBounds.lte }, toDate: { gte: yearBounds.gte },
      },
      select: { userId: true, leaveTypeId: true, fromDate: true, toDate: true },
    }),
    db.compOffEntry.findMany({ where: { storeId, status: 'approved' }, select: { userId: true, days: true } }),
  ]);

  const allowedByUserType = new Map<string, number>();
  for (const a of allocations) allowedByUserType.set(`${a.userId}:${a.leaveTypeId}`, a.allowedDays);

  const takenByUserType = new Map<string, number>();
  for (const r of approvedLeaves) {
    const rFrom = storedDay(r.fromDate);
    const rTo = storedDay(r.toDate);
    const days = eachDay(rFrom < yearFirst ? yearFirst : rFrom, rTo > yearLast ? yearLast : rTo).length;
    const key = `${r.userId}:${r.leaveTypeId}`;
    takenByUserType.set(key, (takenByUserType.get(key) ?? 0) + days);
  }

  const compOffByUser = new Map<string, number>();
  for (const c of compOffEntries) compOffByUser.set(c.userId, (compOffByUser.get(c.userId) ?? 0) + c.days);

  const rows: AllocationRow[] = staff.map((u) => ({
    userId: u.id,
    userName: u.fullName,
    cells: leaveTypes.map((lt) => {
      const allowedDays = allowedByUserType.get(`${u.id}:${lt.id}`) ?? 0;
      const takenDays = takenByUserType.get(`${u.id}:${lt.id}`) ?? 0;
      return { leaveTypeId: lt.id, allowedDays, takenDays, balanceDays: allowedDays - takenDays };
    }),
    compOffAvailable: compOffByUser.get(u.id) ?? 0,
  }));

  return { leaveTypes, rows };
}

export async function saveAllocation(
  scope: StoreScope,
  input: { userId: string; leaveTypeId: string; year: number; allowedDays: number },
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const allowedDays = Math.trunc(input.allowedDays);
  if (!Number.isFinite(allowedDays) || allowedDays < 0 || allowedDays > 365) {
    throw new LeaveTypeError('Allowed days must be between 0 and 365.');
  }
  if (input.year < 2020 || input.year > 2100) {
    throw new LeaveTypeError('That year does not look right.');
  }

  const [leaveType, holdsRole] = await Promise.all([
    db.leaveType.findFirst({ where: { id: input.leaveTypeId, storeId } }),
    db.userStoreRole.findFirst({ where: { storeId, userId: input.userId } }),
  ]);
  if (!leaveType) throw new LeaveTypeError('That leave type is not in your scope.');
  if (!holdsRole) throw new LeaveTypeError('That person does not have access to this store.');

  await db.leaveAllocation.upsert({
    where: {
      storeId_userId_leaveTypeId_year: {
        storeId, userId: input.userId, leaveTypeId: input.leaveTypeId, year: input.year,
      },
    },
    create: { storeId, userId: input.userId, leaveTypeId: input.leaveTypeId, year: input.year, allowedDays, updatedBy: userId },
    update: { allowedDays, updatedBy: userId },
  });
}

// --------------------------------------------------- leave allocation requests

export interface LeaveAllocationRequestRow {
  id: string;
  userId: string;
  userName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  requestedDays: number;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
}

/** An employee asking for extra days beyond their normal quota - routed through their own reporting line, same shape as `requestCompOff`. */
export async function requestLeaveAllocation(
  scope: StoreScope,
  input: { leaveTypeId: string; requestedDays: number; description: string },
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const requestedDays = Math.trunc(input.requestedDays);
  if (!Number.isFinite(requestedDays) || requestedDays <= 0 || requestedDays > 365) {
    throw new LeaveTypeError('Requested days must be between 1 and 365.');
  }
  const description = input.description.trim();
  if (!description) throw new LeaveTypeError('Say why you need the extra days.');

  const leaveType = await db.leaveType.findFirst({ where: { id: input.leaveTypeId, storeId, isActive: true } });
  if (!leaveType) throw new LeaveTypeError('That leave type is not in your scope.');

  const request = await db.leaveAllocationRequest.create({
    data: { storeId, userId, leaveTypeId: input.leaveTypeId, requestedDays, description, status: 'pending' },
  });

  await raiseApproval(scope, 'leave_allocation', request.id, userId);
}

export async function listPendingLeaveAllocationRequests(scope: StoreScope): Promise<LeaveAllocationRequestRow[]> {
  const rows = await db.leaveAllocationRequest.findMany({
    where: { ...scopeWhere(scope), status: 'pending' },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { fullName: true } }, leaveType: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id, userId: r.userId, userName: r.user.fullName,
    leaveTypeId: r.leaveTypeId, leaveTypeName: r.leaveType.name,
    requestedDays: r.requestedDays, description: r.description,
    status: r.status as 'pending' | 'approved' | 'rejected', createdAt: r.createdAt,
  }));
}

/**
 * Approving one adds `requestedDays` onto the employee's `LeaveAllocation`
 * for the CURRENT year - never overwrites it, so a person who already had
 * an adjusted allocation keeps that base and simply gets more on top,
 * exactly the way a raise adds to a salary rather than replacing it.
 */
export async function decideLeaveAllocationRequest(
  scope: StoreScope,
  requestId: string,
  decision: 'approved' | 'rejected',
  deciderId: string,
  note?: string | null,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const existing = await db.leaveAllocationRequest.findFirst({ where: { id: requestId, storeId } });
  if (!existing) throw new LeaveTypeError('Request not found in your scope.');
  if (existing.status !== 'pending') {
    throw new LeaveTypeError(`That request was already ${existing.status}.`);
  }

  const openRequest = await openApprovalRequest(scope, 'leave_allocation', existing.id);
  let finalStatus: 'approved' | 'rejected' | null = null;

  if (openRequest) {
    let step;
    try {
      step = await decideApprovalStep(scope, openRequest.id, decision, deciderId, note?.trim() || null);
    } catch (e) {
      if (e instanceof HierarchyError) throw new LeaveTypeError(e.message);
      throw e;
    }
    if (step.final === null) return;
    finalStatus = step.final === 'APPROVED' ? 'approved' : 'rejected';
  } else {
    finalStatus = decision;
  }

  await db.leaveAllocationRequest.update({
    where: { id: existing.id },
    data: {
      status: finalStatus,
      decidedBy: deciderId, decidedAt: new Date(), decisionNote: note?.trim() || null,
    },
  });

  if (finalStatus === 'approved') {
    const year = istYearMonth(new Date()).year;
    const current = await db.leaveAllocation.findUnique({
      where: { storeId_userId_leaveTypeId_year: { storeId, userId: existing.userId, leaveTypeId: existing.leaveTypeId, year } },
      select: { allowedDays: true },
    });
    await db.leaveAllocation.upsert({
      where: { storeId_userId_leaveTypeId_year: { storeId, userId: existing.userId, leaveTypeId: existing.leaveTypeId, year } },
      create: { storeId, userId: existing.userId, leaveTypeId: existing.leaveTypeId, year, allowedDays: existing.requestedDays, updatedBy: deciderId },
      update: { allowedDays: (current?.allowedDays ?? 0) + existing.requestedDays, updatedBy: deciderId },
    });
  }
}

// ---------------------------------------------------------------- comp-off

export async function addCompOffEntry(
  scope: StoreScope,
  input: { userId: string; days: number; reason: string | null },
  createdBy: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const days = Math.trunc(input.days);
  if (!Number.isFinite(days) || days === 0) {
    throw new LeaveTypeError('Enter a non-zero number of days - positive to grant, negative to redeem or adjust.');
  }
  if (Math.abs(days) > 30) {
    throw new LeaveTypeError('That is more than 30 days in one entry. Check the number.');
  }

  const holdsRole = await db.userStoreRole.findFirst({ where: { storeId, userId: input.userId } });
  if (!holdsRole) throw new LeaveTypeError('That person does not have access to this store.');

  await db.compOffEntry.create({
    data: { storeId, userId: input.userId, days, reason: input.reason?.trim() || null, createdBy },
  });
}

/**
 * An employee asking to redeem comp-off days - as opposed to
 * `addCompOffEntry`, which is a manager acting directly. Starts `pending`;
 * routed through the approval chain for `'comp_off'` if this store has
 * configured one, otherwise sits `pending` until someone with
 * `attendance.edit` decides it directly via `decideCompOffRequest` - the
 * same "chain if configured, single step if not" shape as leave.
 *
 * `days` is always negative here: a request is always a redemption. A
 * manager crediting new comp-off days is `addCompOffEntry`, unchanged, and
 * stays a direct grant - it was never something the employee asked for.
 */
export async function requestCompOff(
  scope: StoreScope,
  input: { userId: string; days: number; reason: string | null },
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const days = -Math.abs(Math.trunc(input.days));
  if (days === 0) throw new LeaveTypeError('Enter how many days to redeem.');
  if (Math.abs(days) > 30) throw new LeaveTypeError('That is more than 30 days in one request. Check the number.');

  const entry = await db.compOffEntry.create({
    data: {
      storeId, userId: input.userId, days, reason: input.reason?.trim() || null,
      status: 'pending', requestedBy: input.userId, createdBy: input.userId,
    },
  });

  await raiseApproval(scope, 'comp_off', entry.id, input.userId);
}

export interface PendingCompOffRow {
  id: string;
  userId: string;
  userName: string;
  days: number;
  reason: string | null;
  createdAt: Date;
}

export async function listPendingCompOffRequests(scope: StoreScope): Promise<PendingCompOffRow[]> {
  const rows = await db.compOffEntry.findMany({
    where: { ...scopeWhere(scope), status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, userId: true, days: true, reason: true, createdAt: true, user: { select: { fullName: true } } },
  });
  return rows.map((r) => ({
    id: r.id, userId: r.userId, userName: r.user.fullName,
    days: r.days, reason: r.reason, createdAt: r.createdAt,
  }));
}

export async function decideCompOffRequest(
  scope: StoreScope,
  entryId: string,
  decision: 'approved' | 'rejected',
  userId: string,
  note?: string | null,
): Promise<void> {
  const existing = await db.compOffEntry.findFirst({
    where: { id: entryId, ...scopeWhere(scope) },
    select: { id: true, status: true },
  });
  if (!existing) throw new LeaveTypeError('Request not found in your scope.');
  if (existing.status !== 'pending') {
    throw new LeaveTypeError(`That request was already ${existing.status}.`);
  }

  const openRequest = await openApprovalRequest(scope, 'comp_off', existing.id);

  if (openRequest) {
    let step;
    try {
      step = await decideApprovalStep(scope, openRequest.id, decision, userId, note?.trim() || null);
    } catch (e) {
      if (e instanceof HierarchyError) throw new LeaveTypeError(e.message);
      throw e;
    }
    if (step.final === null) return;

    await db.compOffEntry.update({
      where: { id: existing.id },
      data: {
        status: step.final === 'APPROVED' ? 'approved' : 'rejected',
        decidedBy: userId, decidedAt: new Date(), decisionNote: note?.trim() || null,
      },
    });
    return;
  }

  await db.compOffEntry.update({
    where: { id: existing.id },
    data: {
      status: decision,
      decidedBy: userId, decidedAt: new Date(), decisionNote: note?.trim() || null,
    },
  });
}

// ------------------------------------------------------- restricted leave periods

export interface RestrictedPeriodRow {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  description: string | null;
  departmentId: string | null;
  departmentName: string | null;
  includeAllLeaveTypes: boolean;
  specificLeaveTypeIds: string[];
  excludedLeaveTypeIds: string[];
  isActive: boolean;
}

export async function listRestrictedPeriods(scope: StoreScope, opts: { activeOnly?: boolean } = {}): Promise<RestrictedPeriodRow[]> {
  const rows = await db.restrictedLeavePeriod.findMany({
    where: { ...scopeWhere(scope), ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: { startDate: 'desc' },
    include: {
      department: { select: { name: true } },
      specificLeaveTypes: { select: { id: true } },
      excludedLeaveTypes: { select: { id: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, title: r.title, startDate: r.startDate, endDate: r.endDate, description: r.description,
    departmentId: r.departmentId, departmentName: r.department?.name ?? null,
    includeAllLeaveTypes: r.includeAllLeaveTypes,
    specificLeaveTypeIds: r.specificLeaveTypes.map((t) => t.id),
    excludedLeaveTypeIds: r.excludedLeaveTypes.map((t) => t.id),
    isActive: r.isActive,
  }));
}

export interface RestrictedPeriodInput {
  title: string;
  startDate: Date;
  endDate: Date;
  description: string | null;
  departmentId: string | null;
  includeAllLeaveTypes: boolean;
  specificLeaveTypeIds: string[];
  excludedLeaveTypeIds: string[];
}

export async function saveRestrictedPeriod(scope: StoreScope, id: string | null, input: RestrictedPeriodInput, createdBy: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const title = input.title.trim();
  if (!title) throw new LeaveTypeError('Give this restricted period a title.');
  if (input.endDate < input.startDate) throw new LeaveTypeError('The end date cannot be before the start date.');

  if (input.departmentId) {
    const dept = await db.department.findFirst({ where: { id: input.departmentId, storeId } });
    if (!dept) throw new LeaveTypeError('That department is not in your scope.');
  }

  const base = {
    storeId, title, startDate: input.startDate, endDate: input.endDate,
    description: input.description?.trim() || null, departmentId: input.departmentId,
    includeAllLeaveTypes: input.includeAllLeaveTypes,
  };
  const specificIds = input.specificLeaveTypeIds.map((id) => ({ id }));
  const excludedIds = input.excludedLeaveTypeIds.map((id) => ({ id }));

  if (id) {
    const existing = await db.restrictedLeavePeriod.findFirst({ where: { id, storeId } });
    if (!existing) throw new LeaveTypeError('That restricted period is not in your scope.');
    await db.restrictedLeavePeriod.update({
      where: { id },
      data: { ...base, specificLeaveTypes: { set: specificIds }, excludedLeaveTypes: { set: excludedIds } },
    });
    return;
  }

  await db.restrictedLeavePeriod.create({
    data: {
      ...base, createdBy,
      specificLeaveTypes: { connect: specificIds }, excludedLeaveTypes: { connect: excludedIds },
    },
  });
}

export async function removeRestrictedPeriod(scope: StoreScope, id: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const existing = await db.restrictedLeavePeriod.findFirst({ where: { id, storeId } });
  if (!existing) throw new LeaveTypeError('That restricted period is not in your scope.');
  await db.restrictedLeavePeriod.update({ where: { id }, data: { isActive: false } });
}

/**
 * Called from `attendance.ts`'s `createLeaveRequest`, right before the row
 * is written - refuses up front rather than letting a restricted request
 * sit `pending` for a manager to notice and reject by hand.
 */
export async function assertLeaveNotRestricted(
  scope: StoreScope,
  input: { userId: string; leaveTypeId: string | null; fromDate: Date; toDate: Date },
): Promise<void> {
  const storeId = scopeForWrite(scope);

  const [user, periods] = await Promise.all([
    db.user.findUnique({ where: { id: input.userId }, select: { departmentId: true } }),
    db.restrictedLeavePeriod.findMany({
      where: {
        storeId, isActive: true,
        startDate: { lte: input.toDate }, endDate: { gte: input.fromDate },
      },
      select: {
        startDate: true, endDate: true, departmentId: true, includeAllLeaveTypes: true,
        specificLeaveTypes: { select: { id: true } }, excludedLeaveTypes: { select: { id: true } },
      },
    }),
  ]);

  for (const period of periods) {
    const restricted = isLeaveRequestRestricted(
      {
        startDate: period.startDate, endDate: period.endDate, departmentId: period.departmentId,
        includeAllLeaveTypes: period.includeAllLeaveTypes,
        specificLeaveTypeIds: period.specificLeaveTypes.map((t) => t.id),
        excludedLeaveTypeIds: period.excludedLeaveTypes.map((t) => t.id),
      },
      {
        leaveTypeId: input.leaveTypeId, fromDate: input.fromDate, toDate: input.toDate,
        employeeDepartmentId: user?.departmentId ?? null,
      },
    );
    if (restricted) {
      throw new LeaveTypeError('These dates fall in a restricted period. Contact your admin.');
    }
  }
}
