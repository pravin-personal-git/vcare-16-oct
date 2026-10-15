'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { addHoliday, removeHoliday } from '@/server/attendance';
import {
  PolicyError, saveAttendancePolicy, saveZone, removeZone, savePayrollCycleStartDay,
  type PolicyInput, type ZoneInput,
} from '@/server/attendance-policy';
import { toggleGovernmentHoliday } from '@/server/holidays';
import { friendlyError } from '@/lib/friendly-error';

/**
 * Attendance settings: the rules, and the calendar.
 *
 * `attendance.edit` gates both, and it is the same permission that corrects a
 * forgotten shift. Setting the grace period and setting somebody's finish time
 * are the same authority wearing different clothes - both decide what a person
 * is owed for a day.
 */

export interface SettingsState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function guard() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('attendance.edit')) {
    return { error: 'You do not have permission to change attendance settings.' as const };
  }
  if (ctx.scope.kind === 'all') {
    return {
      error:
        'Select a single branch first. Holidays and working hours differ between branches, and a company-wide setting would mark the wrong people absent.' as const,
    };
  }
  return { ctx, storeId: ctx.scope.storeId };
}

function fail(e: unknown): SettingsState {
  if (e instanceof PolicyError) return { error: e.message };
  console.error('[attendance-settings] action failed', e);
  return { error: friendlyError(e, true) };
}

function done(): void {
  revalidatePath('/settings/attendance');
  revalidatePath('/attendance/grid');
  revalidatePath('/employee/attendance');
}

export async function savePolicyAction(input: PolicyInput): Promise<SettingsState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await saveAttendancePolicy(g.ctx.scope, input, g.ctx.user.id);

    await db.activityLog
      .create({
        data: {
          storeId: g.storeId,
          userId: g.ctx.user.id,
          activityType: 'updated',
          entityType: 'AttendancePolicy',
          entityId: g.storeId,
          description:
            `Attendance rules set to ${input.shiftStart}-${input.shiftEnd}, ` +
            `${input.graceMinutes} min grace, full day ${input.fullDayMinutes} min`,
        },
      })
      .catch((e) => console.error('[attendance-settings] audit write failed (non-fatal)', e));

    done();
    return { ok: true, message: 'Rules saved. They apply from the next time the grid is drawn.' };
  } catch (e) {
    return fail(e);
  }
}

export async function savePayrollCycleAction(startDay: number): Promise<SettingsState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await savePayrollCycleStartDay(g.ctx.scope, startDay, g.ctx.user.id);

    await db.activityLog
      .create({
        data: {
          storeId: g.storeId,
          userId: g.ctx.user.id,
          activityType: 'updated',
          entityType: 'AttendancePolicy',
          entityId: g.storeId,
          description: `Payroll cycle set to start on day ${startDay} of each month`,
        },
      })
      .catch((e) => console.error('[attendance-settings] audit write failed (non-fatal)', e));

    done();
    return { ok: true, message: 'Payroll cycle saved.' };
  } catch (e) {
    return fail(e);
  }
}

export async function addHolidayAction(
  date: string,
  name: string,
  kind: string,
): Promise<SettingsState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await addHoliday(g.ctx.scope, date, name, kind, g.ctx.user.id);
    done();
    return { ok: true, message: `${name.trim()} added to the calendar.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeHolidayAction(id: string): Promise<SettingsState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await removeHoliday(g.ctx.scope, id);
    done();
    return { ok: true, message: 'Removed from the calendar.' };
  } catch (e) {
    return fail(e);
  }
}

export async function toggleGovernmentHolidayAction(
  governmentHolidayId: string,
  on: boolean,
): Promise<SettingsState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await toggleGovernmentHoliday(g.ctx.scope, governmentHolidayId, g.ctx.user.id, on);
    done();
    return { ok: true, message: on ? 'Added to the calendar.' : 'Removed from the calendar.' };
  } catch (e) {
    return fail(e);
  }
}

// ----------------------------------------------------------- geofence zones

export async function saveZoneAction(id: string | null, input: ZoneInput): Promise<SettingsState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await saveZone(g.ctx.scope, id, input);
    done();
    return { ok: true, message: id ? 'Location updated.' : `${input.label.trim()} added.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeZoneAction(id: string): Promise<SettingsState> {
  const g = await guard();
  if ('error' in g) return g;

  try {
    await removeZone(g.ctx.scope, id);
    done();
    return { ok: true, message: 'Location removed.' };
  } catch (e) {
    return fail(e);
  }
}
