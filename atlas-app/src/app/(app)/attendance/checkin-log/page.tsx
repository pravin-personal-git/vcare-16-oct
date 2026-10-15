import { requireContext } from '@/server/context';
import { listCheckInOutLog } from '@/server/attendance-reports';
import { inPeopleReach, peopleReach } from '@/server/people-reach';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { isDayKey, istToday } from '@/lib/attendance-day';
import { istDayEnd, istDayStart } from '@/lib/date-ranges';
import { CheckInLogClient } from './CheckInLogClient';

/** Check-in/Check-out Log (roadmap §4.3) - the raw AttendanceEvent stream, one row per punch. */
export default async function CheckInLogPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const { d } = await searchParams;
  const ctx = await requireContext();

  // The India day, midnight to midnight India time - not the server's (UTC)
  // day, which ran 05:30 to 05:29 and put a 00:30 check-in on the day before.
  const day = isDayKey(d) ? d : istToday(new Date());
  const from = istDayStart(day)!;
  const to = istDayEnd(day)!;

  const [events, views, roles] = await Promise.all([
    // Whose attendance this person sees (B4 step 4).
    ctx.scope.kind === 'all' ? [] : Promise.all([listCheckInOutLog(ctx.scope, { from, to }), peopleReach(ctx)]).then(([rows, reach]) => inPeopleReach(rows, reach)),
    listSavedViews(ctx, '/attendance/checkin-log'),
    shareableRoles(ctx),
  ]);

  return (
    <CheckInLogClient
      date={day}
      events={events.map((e) => ({ ...e, recordedAt: e.recordedAt.toISOString() }))}
      scopeIsAll={ctx.scope.kind === 'all'}
      views={{ initial: views, roles }}
    />
  );
}
