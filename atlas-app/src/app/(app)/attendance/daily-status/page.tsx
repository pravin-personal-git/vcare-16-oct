import { requireContext } from '@/server/context';
import { dailyWorkStatus } from '@/server/attendance-reports';
import { inPeopleReach, peopleReach } from '@/server/people-reach';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { isDayKey, istToday } from '@/lib/attendance-day';
import { DailyStatusClient } from './DailyStatusClient';

/** Daily Work Status (roadmap §4.3) - every employee's status for one chosen day. */
export default async function DailyStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const { d } = await searchParams;
  const ctx = await requireContext();

  // Today in India by default - the server's (UTC) today is yesterday until 05:30.
  const now = new Date();
  const day = isDayKey(d) ? d : istToday(now);
  const [rows, views, roles] = await Promise.all([
    // Whose attendance this person sees (B4 step 4).
    ctx.scope.kind === 'all' ? [] : Promise.all([dailyWorkStatus(ctx.scope, day, now), peopleReach(ctx)]).then(([rows, reach]) => inPeopleReach(rows, reach)),
    listSavedViews(ctx, '/attendance/daily-status'),
    shareableRoles(ctx),
  ]);

  return (
    <DailyStatusClient
      date={day} rows={rows} scopeIsAll={ctx.scope.kind === 'all'}
      views={{ initial: views, roles }}
    />
  );
}
