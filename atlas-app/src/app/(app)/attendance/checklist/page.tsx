import { requireContext } from '@/server/context';
import { checklistDay, checklistMonth, listItems } from '@/server/staff-checklist';
import { peopleReach } from '@/server/people-reach';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { istToday } from '@/lib/attendance-day';
import { ChecklistClient } from './ChecklistClient';

/**
 * Daily Checklist - the points each person is checked on every day. A sheet
 * rather than a record list, so F1 gives it the parts that fit: a person
 * search (?q=), views and export (the same rows as the Daily Checklist
 * report), with the day/month pickers it already had.
 */
export default async function ChecklistPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const today = istToday(new Date());
  const day = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) && sp.d <= today ? sp.d : today;
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : day.slice(0, 7);
  const tab = sp.tab === 'month' || sp.tab === 'points' ? sp.tab : 'day';
  const canEdit = ctx.permissions.has('attendance.edit') || ctx.permissions.has('hrm.edit');
  const q = (sp.q ?? '').trim().toLowerCase();
  // Whose checklist rows this person sees (B4 step 4), then the search.
  const reach = await peopleReach(ctx);
  const who = (r: { userId: string; fullName: string; department?: string | null }) => (!reach || reach.has(r.userId)) && (!q || r.fullName.toLowerCase().includes(q) || (r.department ?? '').toLowerCase().includes(q));
  const [views, roles] = await Promise.all([listSavedViews(ctx, '/attendance/checklist'), shareableRoles(ctx)]);
  const bar = { canExport: canExportLists(ctx.permissions), views: { initial: views, roles } };

  if (ctx.scope.kind !== 'single') {
    return <ChecklistClient scopeIsAll day={day} month={month} tab={tab} items={[]} rows={[]} monthRows={[]} canEdit={false} today={today} {...bar} />;
  }
  const storeId = ctx.scope.storeId;
  const [items, rows, monthRows] = await Promise.all([
    listItems(storeId, tab === 'points'),
    tab === 'day' ? checklistDay(ctx.scope, day) : Promise.resolve([]),
    tab === 'month' ? checklistMonth(ctx.scope, Number(month.slice(0, 4)), Number(month.slice(5, 7))) : Promise.resolve([]),
  ]);
  return <ChecklistClient scopeIsAll={false} day={day} month={month} tab={tab} items={items} rows={rows.filter(who)} monthRows={monthRows.filter(who)} canEdit={canEdit} today={today} {...bar} />;
}
