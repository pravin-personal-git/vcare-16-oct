import 'server-only';
import { istYearMonth } from '@/lib/attendance-day';
import type { StoreScope } from './store-scope';
import { listTasks, type TaskRow } from './tasks';
import { listNotices, type NoticeRow } from './notices';
import { myMonth, type MyDay } from './my-attendance';
import { businessDay } from './presence';

/**
 * The personal landing page for anyone who does NOT hold `dashboard.view` -
 * see `(app)/dashboard/page.tsx` for the branch that picks this over the
 * full company Admin Dashboard. Genuinely their own slice of the system
 * (their tasks, their attendance today, notices meant for everyone), not a
 * scaled-down copy of the admin view - a salesperson has no business seeing
 * company-wide P&L just because it was easier to build one dashboard.
 */
export interface MyDashboard {
  myTasks: TaskRow[];
  notices: NoticeRow[];
  today: MyDay | null;
}

export async function getMyDashboard(
  scope: StoreScope, userId: string, storeId: string | null,
): Promise<MyDashboard> {
  // Sequential, not Promise.all - see CLAUDE.md's connection_limit=1 rule.
  const allTasks = await listTasks(scope);
  const myTasks = allTasks
    .filter((t) => t.assignedToId === userId && t.status !== 'Completed' && t.status !== 'Cancelled')
    .slice(0, 8);

  const notices = await listNotices(scope);

  let today: MyDay | null = null;
  if (storeId) {
    const now = new Date();
    const { year, month: m } = istYearMonth(now);
    const month = await myMonth(userId, storeId, year, m, now);
    const todayKey = businessDay(now);
    today = month.days.find((d) => d.date === todayKey) ?? null;
  }

  return { myTasks, notices: notices.slice(0, 5), today };
}
