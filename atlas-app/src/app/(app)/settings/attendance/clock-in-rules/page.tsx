import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { ALLOW_MODES, OUTSIDE_MODES, type AllowMode, type OutsideMode } from '@/lib/attendance-rule';
import { RulesClient } from './RulesClient';

/**
 * CLOCK-IN RULES - where each employee may clock in from the Vcare app.
 * Per employee, per branch, set by the admin (roadmap decision, 24 Sep 2026).
 * Someone with no rule follows the branch's own geofence setting.
 */
export default async function ClockInRulesPage() {
  const ctx = await requireContext();
  const { scope } = ctx;
  if (scope.kind === 'all') {
    return <RulesClient scopeIsAll canEdit={false} geofencing={false} zones={[]} people={[]} />;
  }

  const [policy, zones, users, rules] = await Promise.all([
    db.attendancePolicy.findUnique({ where: { storeId: scope.storeId }, select: { geofencingEnabled: true } }),
    db.attendanceZone.findMany({
      where: { storeId: scope.storeId, isActive: true },
      select: { id: true, label: true, radiusMeters: true },
      orderBy: { label: 'asc' },
    }),
    db.user.findMany({
      where: { storeRoles: { some: { ...scopeWhere(scope) } }, isActive: true },
      select: { id: true, fullName: true, username: true },
      orderBy: { fullName: 'asc' },
    }),
    db.employeeAttendanceRule.findMany({ where: { storeId: scope.storeId } }),
  ]);
  const byUser = new Map(rules.map((r) => [r.userId, r]));

  return (
    <RulesClient
      scopeIsAll={false}
      canEdit={ctx.permissions.has('attendance.edit')}
      geofencing={!!policy?.geofencingEnabled}
      zones={zones}
      people={users.map((u) => {
        const r = byUser.get(u.id);
        return {
          userId: u.id, name: u.fullName, username: u.username,
          allow: r && (ALLOW_MODES as readonly string[]).includes(r.allow) ? (r.allow as AllowMode) : 'store_default',
          outside: r && (OUTSIDE_MODES as readonly string[]).includes(r.outside) ? (r.outside as OutsideMode) : 'flag',
          zoneIds: r?.zoneIds ?? [],
        };
      })}
    />
  );
}
