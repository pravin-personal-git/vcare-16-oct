'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { ALLOW_MODES, OUTSIDE_MODES } from '@/lib/attendance-rule';

export interface ClockInRuleInput { userId: string; allow: string; outside: string; zoneIds: string[] }

/** `attendance.edit` - the same authority that sets the branch's geofence. */
export async function saveClockInRuleAction(input: ClockInRuleInput): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('attendance.edit')) return { error: 'You do not have permission to change attendance settings.' };
  if (ctx.scope.kind === 'all') return { error: 'Select a single branch first - zones belong to a branch.' };
  const storeId = ctx.scope.storeId;
  if (!(ALLOW_MODES as readonly string[]).includes(input.allow)) return { error: 'Choose where they may clock in.' };
  if (!(OUTSIDE_MODES as readonly string[]).includes(input.outside)) return { error: 'Choose what happens outside.' };

  const member = await db.user.findFirst({
    where: { id: input.userId, storeRoles: { some: { ...scopeWhere(ctx.scope) } } },
    select: { id: true },
  });
  if (!member) return { error: 'That person is not in this branch.' };

  const usesZones = input.allow === 'zones' || input.allow === 'zones_or_sites';
  const validZones = usesZones && input.zoneIds.length
    ? await db.attendanceZone.findMany({ where: { storeId, id: { in: input.zoneIds.slice(0, 100) } }, select: { id: true } })
    : [];
  const zoneIds = validZones.map((z) => z.id);

  await db.employeeAttendanceRule.upsert({
    where: { storeId_userId: { storeId, userId: member.id } },
    create: { storeId, userId: member.id, allow: input.allow, outside: input.outside, zoneIds, updatedBy: ctx.user.id },
    update: { allow: input.allow, outside: input.outside, zoneIds, updatedBy: ctx.user.id },
  });
  revalidatePath('/settings/attendance/clock-in-rules');
  return { ok: true };
}
