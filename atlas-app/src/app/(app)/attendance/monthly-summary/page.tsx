import { requireContext } from '@/server/context';
import { istYearMonth, monthDays } from '@/lib/attendance-day';
import { istDayStart } from '@/lib/date-ranges';
import { monthlySummary } from '@/server/attendance-reports';
import { peopleReach } from '@/server/people-reach';
import { distanceForUsers } from '@/server/distance';
import type { DistanceResult } from '@/lib/distance';
import { MonthlySummaryClient } from './MonthlySummaryClient';

/** Monthly Summary (roadmap §4.3) - each employee's totals for one month, read from the same `attendanceMonth()` the grid uses. */
export default async function MonthlySummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const ctx = await requireContext();

  // This month in India - the server runs in UTC, where the 1st starts at 05:30.
  let { year, month } = istYearMonth(new Date());
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    const [y, mo] = m.split('-').map(Number);
    if (mo >= 1 && mo <= 12) { year = y; month = mo - 1; }
  }

  // Whose attendance this person sees (B4 step 4).
  const rows = ctx.scope.kind === 'all' ? [] : await monthlySummary(ctx.scope, year, month, await peopleReach(ctx));

  /**
   * Kilometres for the month (F1c), only for people who may be located.
   *
   * Gated on `attendance.locate` for the same reason the shift trail is:
   * seeing that somebody worked a full month and seeing how far they travelled
   * are different authorities. Without the permission the column is absent
   * rather than blank, so nobody wonders what they are missing.
   */
  const storeIds = ctx.scope.kind === 'single' ? [ctx.scope.storeId] : ctx.stores.map((s) => s.id);
  const canLocate = ctx.permissions.has('attendance.locate');
  const distances = canLocate && ctx.scope.kind !== 'all'
    ? await distanceForUsers(
      ctx.scope,
      rows.map((r) => r.userId),
      storeIds,
      // The month's first and next month's first instant, in India time.
      istDayStart(monthDays(year, month)[0])!,
      istDayStart(monthDays(month === 11 ? year + 1 : year, (month + 1) % 12)[0])!,
    )
    : new Map<string, DistanceResult | null>();

  return (
    <MonthlySummaryClient
      year={year} month={month} rows={rows} scopeIsAll={ctx.scope.kind === 'all'}
      canLocate={canLocate}
      distances={Object.fromEntries(
        [...distances].map(([id, d]) => [id, d ? { metres: d.metres, usedPoints: d.usedPoints, mocked: d.droppedMocked } : null]),
      )}
    />
  );
}
