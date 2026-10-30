import { redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { teamToday } from '@/server/team-today';
import { inPeopleReach, peopleReach } from '@/server/people-reach';
import { checkPhoneHealth } from '@/server/phone-health';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { TeamTodayClient } from './TeamTodayClient';
import { distanceForUsers } from '@/server/distance';
import { istDay } from '@/lib/scorecard/period';

/** Team Today - who is working right now, and whether their phone is reporting. */
export default async function TeamTodayPage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('attendance.view')) redirect('/dashboard');
  // Records phones that went quiet or came back (CALL-5) before reading.
  await checkPhoneHealth(ctx.scope).catch(() => null);
  const [allRows, views, roles, reach] = await Promise.all([teamToday(ctx.scope), listSavedViews(ctx, '/attendance/team-today'), shareableRoles(ctx), peopleReach(ctx)]);
  // Whose attendance this person sees (B4 step 4).
  const reached = inPeopleReach(allRows, reach);
  // Distance today for everyone who clocked in (Vcare, 30 Oct 2026: "none of the people distance is shown").
  const clocked = reached.filter((r) => r.status !== 'not_marked').map((r) => r.userId);
  const storeIds = ctx.scope.kind === 'single' ? [ctx.scope.storeId] : ctx.stores.map((s) => s.id);
  const km = ctx.permissions.has('attendance.locate') && clocked.length
    ? await distanceForUsers(ctx.scope, clocked, storeIds, new Date(`${istDay(new Date())}T00:00:00+05:30`), new Date()).catch(() => new Map())
    : new Map();
  const rows = reached.map((r) => {
    const d = km.get(r.userId);
    return { ...r, distanceKm: d ? Math.round(d.metres / 100) / 10 : d === null ? null : undefined };
  });
  return (
    <TeamTodayClient rows={rows} canLocate={ctx.permissions.has('attendance.locate')}
      canExport={canExportLists(ctx.permissions)} views={{ initial: views, roles }} />
  );
}
