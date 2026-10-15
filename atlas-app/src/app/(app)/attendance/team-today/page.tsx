import { redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { teamToday } from '@/server/team-today';
import { inPeopleReach, peopleReach } from '@/server/people-reach';
import { checkPhoneHealth } from '@/server/phone-health';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { TeamTodayClient } from './TeamTodayClient';

/** Team Today - who is working right now, and whether their phone is reporting. */
export default async function TeamTodayPage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('attendance.view')) redirect('/dashboard');
  // Records phones that went quiet or came back (CALL-5) before reading.
  await checkPhoneHealth(ctx.scope).catch(() => null);
  const [allRows, views, roles, reach] = await Promise.all([teamToday(ctx.scope), listSavedViews(ctx, '/attendance/team-today'), shareableRoles(ctx), peopleReach(ctx)]);
  // Whose attendance this person sees (B4 step 4).
  const rows = inPeopleReach(allRows, reach);
  return (
    <TeamTodayClient rows={rows} canLocate={ctx.permissions.has('attendance.locate')}
      canExport={canExportLists(ctx.permissions)} views={{ initial: views, roles }} />
  );
}
