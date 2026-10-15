import { requireContext } from '@/server/context';
import { istYearMonth } from '@/lib/attendance-day';
import { lateEarlyReport } from '@/server/attendance-reports';
import { peopleReach } from '@/server/people-reach';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { LateEarlyClient } from './LateEarlyClient';

/** Late Arrival & Early Departure (roadmap §4.3) - genuinely new; see lib/late-early.ts. */
export default async function LateEarlyPage({
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

  const [rows, views, roles] = await Promise.all([
    // Whose attendance this person sees (B4 step 4).
    ctx.scope.kind === 'all' ? [] : peopleReach(ctx).then((reach) => lateEarlyReport(ctx.scope, year, month, reach)),
    listSavedViews(ctx, '/attendance/late-early'),
    shareableRoles(ctx),
  ]);

  return (
    <LateEarlyClient
      year={year} month={month}
      rows={rows.map((r) => ({ ...r, firstInAt: r.firstInAt?.toISOString() ?? null, lastOutAt: r.lastOutAt?.toISOString() ?? null }))}
      scopeIsAll={ctx.scope.kind === 'all'}
      views={{ initial: views, roles }}
    />
  );
}
