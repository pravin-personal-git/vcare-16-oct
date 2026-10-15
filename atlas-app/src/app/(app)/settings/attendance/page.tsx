import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { listHolidays } from '@/server/attendance';
import { attendancePolicy, listZones, POLICY_DEFAULTS } from '@/server/attendance-policy';
import { listGovernmentHolidays } from '@/server/holidays';
import { SettingsClient } from './SettingsClient';
import { istDate } from '@/lib/date-ranges';
import { istYearMonth } from '@/lib/attendance-day';

/**
 * ATTENDANCE SETTINGS - what counts as late, and which days are off.
 *
 * Per branch, always. A showroom closes on Sunday and a workshop on Tuesday; a
 * single company-wide calendar would mark half the staff absent on the wrong
 * day, and the mistake would only surface in somebody's pay.
 */
export default async function AttendanceSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string }>;
}) {
  const ctx = await requireContext();
  const { y } = await searchParams;
  const year = Number(y) || istYearMonth(new Date()).year;

  /*
    Destructured, and tested inline rather than through `scopeIsAll`.
    TypeScript will not carry a narrowing through a property access; see the
    same note on the hierarchy page.
  */
  const { scope } = ctx;
  const scopeIsAll = scope.kind === 'all';

  const policy = scope.kind === 'all'
    ? { ...POLICY_DEFAULTS, isConfigured: false, updatedAt: null }
    : await attendancePolicy(scope.storeId);

  const holidays = scope.kind === 'all' ? [] : await listHolidays(scope, year);
  const zones = scope.kind === 'all' ? [] : await listZones(scope.storeId);

  const storeStateId = scope.kind === 'all' ? null
    : (await db.store.findUnique({ where: { id: scope.storeId }, select: { stateId: true } }))?.stateId ?? null;
  const governmentHolidays = scope.kind === 'all' ? [] : await listGovernmentHolidays(year, storeStateId, scope);

  const storeName = scope.kind === 'single'
    ? ctx.stores.find((s) => s.id === scope.storeId)?.name ?? ''
    : '';

  return (
    <SettingsClient
      policy={policy}
      holidays={holidays.map((h) => ({
        id: h.id,
        date: istDate(h.date),
        name: h.name,
        kind: h.kind,
      }))}
      zones={zones}
      governmentHolidays={governmentHolidays.map((g) => ({
        id: g.id,
        date: istDate(g.date),
        name: g.name,
        state: g.state,
        appliedHolidayId: g.appliedHolidayId,
      }))}
      year={year}
      storeName={storeName}
      scopeIsAll={scopeIsAll}
      canEdit={ctx.permissions.has('attendance.edit')}
    />
  );
}
