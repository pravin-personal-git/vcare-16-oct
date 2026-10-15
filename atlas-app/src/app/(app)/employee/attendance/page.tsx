import { requireContext } from '@/server/context';
import { istYearMonth } from '@/lib/attendance-day';
import { myMonth } from '@/server/my-attendance';
import { MyAttendanceClient } from './MyAttendanceClient';

/**
 * MY ATTENDANCE - one person's own record.
 *
 * Distinct from the manager's grid at /attendance/grid, which answers "who is
 * in today" across a store and lists only people with a paired phone. This
 * answers "what does my record say", for anybody.
 *
 * It needs a single store: attendance policy, holidays and week-offs all differ
 * per branch, and merging three branches' calendars would produce a month that
 * is nobody's. In All Company it falls back to the person's first store rather
 * than refusing, because somebody looking at their own attendance has one
 * answer regardless of which view they happened to leave the app in.
 */
export default async function MyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; y?: string }>;
}) {
  const ctx = await requireContext();
  const { m, y } = await searchParams;

  // This month in India - the server runs in UTC.
  const now = istYearMonth(new Date());
  const year = Number(y) || now.year;
  const month = m !== undefined && Number.isInteger(Number(m)) ? Number(m) : now.month;

  const storeId = ctx.activeStoreId ?? ctx.stores[0]?.id ?? null;
  if (!storeId) {
    return <MyAttendanceClient month={null} userName={ctx.user.fullName} storeName="" />;
  }

  const data = await myMonth(ctx.user.id, storeId, year, Math.min(11, Math.max(0, month)));
  const storeName = ctx.stores.find((s) => s.id === storeId)?.name ?? '';

  return <MyAttendanceClient month={data} userName={ctx.user.fullName} storeName={storeName} />;
}
