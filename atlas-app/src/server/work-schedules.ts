import 'server-only';
import { db } from './db';
import { type StoreScope, scopeForWrite, scopeWhere } from './store-scope';
import { listAssignableUsers } from './assets';
import { WEEKDAY_LABELS } from '@/lib/weekdays';

/**
 * Work Schedules (roadmap §4.2, Employee submenu) - `WorkType` and
 * `EmployeeShift`/`EmployeeShiftSchedule`, modeled on atlas-hrns's real
 * `base/models.py` (`WorkType`, `EmployeeShift`, `EmployeeShiftSchedule`).
 *
 * Configuration and assignment (defining shifts/work types, assigning
 * employees to one) live here. `getShiftScheduleByUser` at the bottom is
 * the bridge to the follow-up that closes the gap this file originally
 * deferred: `attendanceMonth` (server/attendance.ts), `lateEarlyReport`
 * (server/attendance-reports.ts) and payroll generation
 * (server/payroll-run.ts) all call it and feed the result through
 * `lib/shift-schedule.ts`'s `effectiveDayPolicy`, so an employee's shift
 * assignment now means the same thing everywhere it's read, not just on
 * this page.
 */

export class WorkScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkScheduleError';
  }
}

// ------------------------------------------------------------------ work types

export interface WorkTypeRow {
  id: string;
  label: string;
  isActive: boolean;
}

export async function listWorkTypes(scope: StoreScope, opts: { activeOnly?: boolean } = {}): Promise<WorkTypeRow[]> {
  const rows = await db.workType.findMany({
    where: { ...scopeWhere(scope), ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: [{ sort: 'asc' }, { label: 'asc' }],
  });
  return rows.map((r) => ({ id: r.id, label: r.label, isActive: r.isActive }));
}

export async function saveWorkType(scope: StoreScope, id: string | null, label: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const trimmed = label.trim();
  if (!trimmed) throw new WorkScheduleError('Give this work type a label.');

  if (id) {
    const existing = await db.workType.findFirst({ where: { id, storeId } });
    if (!existing) throw new WorkScheduleError('That work type is not in your scope.');
    await db.workType.update({ where: { id }, data: { label: trimmed } });
    return;
  }

  const last = await db.workType.findFirst({ where: { storeId }, orderBy: { sort: 'desc' }, select: { sort: true } });
  await db.workType.create({ data: { storeId, label: trimmed, sort: (last?.sort ?? 0) + 1 } });
}

export async function removeWorkType(scope: StoreScope, id: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const existing = await db.workType.findFirst({ where: { id, storeId } });
  if (!existing) throw new WorkScheduleError('That work type is not in your scope.');
  await db.workType.update({ where: { id }, data: { isActive: false } });
}

// ---------------------------------------------------------------------- shifts

export interface ShiftDayRow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  minWorkingMinutes: number;
  isNightShift: boolean;
  autoPunchOutEnabled: boolean;
  autoPunchOutTime: string | null;
}

export interface ShiftRow {
  id: string;
  label: string;
  isActive: boolean;
  schedule: ShiftDayRow[];
}

export async function listShifts(scope: StoreScope, opts: { activeOnly?: boolean } = {}): Promise<ShiftRow[]> {
  const rows = await db.employeeShift.findMany({
    where: { ...scopeWhere(scope), ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: [{ sort: 'asc' }, { label: 'asc' }],
    include: { schedule: { orderBy: { dayOfWeek: 'asc' } } },
  });
  return rows.map((r) => ({
    id: r.id, label: r.label, isActive: r.isActive,
    schedule: r.schedule.map((d) => ({
      dayOfWeek: d.dayOfWeek, startTime: d.startTime, endTime: d.endTime,
      minWorkingMinutes: d.minWorkingMinutes, isNightShift: d.isNightShift,
      autoPunchOutEnabled: d.autoPunchOutEnabled, autoPunchOutTime: d.autoPunchOutTime,
    })),
  }));
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateDaySchedule(day: ShiftDayRow): void {
  if (day.dayOfWeek < 0 || day.dayOfWeek > 6) throw new WorkScheduleError('Invalid day of week.');
  if (!TIME_RE.test(day.startTime) || !TIME_RE.test(day.endTime)) {
    throw new WorkScheduleError('Start and end time must be in HH:MM (24-hour) format.');
  }
  if (day.autoPunchOutEnabled && (!day.autoPunchOutTime || !TIME_RE.test(day.autoPunchOutTime))) {
    throw new WorkScheduleError('Set an automatic check-out time, or turn that toggle off.');
  }
  if (!Number.isFinite(day.minWorkingMinutes) || day.minWorkingMinutes < 0 || day.minWorkingMinutes > 1440) {
    throw new WorkScheduleError('Minimum working minutes must be between 0 and 1440.');
  }
}

/** Replaces the whole schedule every save - at most 7 rows, simpler and safer than diffing which day changed. */
export async function saveShift(
  scope: StoreScope, id: string | null, input: { label: string; schedule: ShiftDayRow[] },
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const label = input.label.trim();
  if (!label) throw new WorkScheduleError('Give this shift a label.');

  const days = new Set<number>();
  for (const day of input.schedule) {
    validateDaySchedule(day);
    if (days.has(day.dayOfWeek)) throw new WorkScheduleError(`${WEEKDAY_LABELS[day.dayOfWeek]} is listed more than once.`);
    days.add(day.dayOfWeek);
  }

  await db.$transaction(async (tx) => {
    let shift: { id: string };
    if (id) {
      const existing = await tx.employeeShift.findFirst({ where: { id, storeId } });
      if (!existing) throw new WorkScheduleError('That shift is not in your scope.');
      shift = await tx.employeeShift.update({ where: { id }, data: { label }, select: { id: true } });
      await tx.employeeShiftSchedule.deleteMany({ where: { shiftId: id } });
    } else {
      const last = await tx.employeeShift.findFirst({ where: { storeId }, orderBy: { sort: 'desc' }, select: { sort: true } });
      shift = await tx.employeeShift.create({
        data: { storeId, label, sort: (last?.sort ?? 0) + 1 }, select: { id: true },
      });
    }

    if (input.schedule.length > 0) {
      await tx.employeeShiftSchedule.createMany({
        data: input.schedule.map((d) => ({
          shiftId: shift.id, dayOfWeek: d.dayOfWeek, startTime: d.startTime, endTime: d.endTime,
          minWorkingMinutes: d.minWorkingMinutes, isNightShift: d.isNightShift,
          autoPunchOutEnabled: d.autoPunchOutEnabled, autoPunchOutTime: d.autoPunchOutEnabled ? d.autoPunchOutTime : null,
        })),
      });
    }
  });
}

export async function removeShift(scope: StoreScope, id: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const existing = await db.employeeShift.findFirst({ where: { id, storeId } });
  if (!existing) throw new WorkScheduleError('That shift is not in your scope.');
  await db.employeeShift.update({ where: { id }, data: { isActive: false } });
}

// -------------------------------------------------------------- employee assignment

export interface EmployeeAssignmentRow {
  userId: string;
  userName: string;
  shiftId: string | null;
  shiftLabel: string | null;
  workTypeId: string | null;
  workTypeLabel: string | null;
}

export async function listEmployeeAssignments(scope: StoreScope): Promise<EmployeeAssignmentRow[]> {
  const employees = await listAssignableUsers(scope);
  const profiles = await db.employeeProfile.findMany({
    where: { userId: { in: employees.map((e) => e.id) } },
    select: { userId: true, shift: { select: { id: true, label: true } }, workType: { select: { id: true, label: true } } },
  });
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

  return employees.map((e) => {
    const p = profileByUser.get(e.id);
    return {
      userId: e.id, userName: e.fullName,
      shiftId: p?.shift?.id ?? null, shiftLabel: p?.shift?.label ?? null,
      workTypeId: p?.workType?.id ?? null, workTypeLabel: p?.workType?.label ?? null,
    };
  });
}

export async function assignEmployeeSchedule(
  scope: StoreScope, userId: string, input: { shiftId: string | null; workTypeId: string | null },
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const holdsRole = await db.userStoreRole.findFirst({ where: { storeId, userId } });
  if (!holdsRole) throw new WorkScheduleError('That person does not have access to this store.');

  if (input.shiftId) {
    const shift = await db.employeeShift.findFirst({ where: { id: input.shiftId, storeId } });
    if (!shift) throw new WorkScheduleError('That shift is not in your scope.');
  }
  if (input.workTypeId) {
    const workType = await db.workType.findFirst({ where: { id: input.workTypeId, storeId } });
    if (!workType) throw new WorkScheduleError('That work type is not in your scope.');
  }

  await db.employeeProfile.upsert({
    where: { userId },
    create: { userId, shiftId: input.shiftId, workTypeId: input.workTypeId },
    update: { shiftId: input.shiftId, workTypeId: input.workTypeId },
  });
}

// ------------------------------------------------------- attendance/payroll bridge

/**
 * Each of `userIds`' assigned shift schedule, or `null` for someone with no
 * shift assigned - straight into `lib/shift-schedule.ts`'s
 * `effectiveDayPolicy`. One query, shared by every caller that needs this
 * (`attendanceMonth`, `lateEarlyReport`, payroll generation) so they all
 * resolve the same fact the same way.
 */
export async function getShiftScheduleByUser(
  userIds: string[],
): Promise<Map<string, { dayOfWeek: number; startTime: string; endTime: string; minWorkingMinutes: number }[] | null>> {
  const profiles = await db.employeeProfile.findMany({
    where: { userId: { in: userIds }, shiftId: { not: null } },
    select: { userId: true, shift: { select: { schedule: true } } },
  });

  const byUser = new Map<string, { dayOfWeek: number; startTime: string; endTime: string; minWorkingMinutes: number }[] | null>();
  for (const userId of userIds) byUser.set(userId, null);
  for (const p of profiles) {
    if (p.shift) {
      byUser.set(p.userId, p.shift.schedule.map((d) => ({
        dayOfWeek: d.dayOfWeek, startTime: d.startTime, endTime: d.endTime, minWorkingMinutes: d.minWorkingMinutes,
      })));
    }
  }
  return byUser;
}
