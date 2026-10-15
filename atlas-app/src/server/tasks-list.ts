import 'server-only';
import { visibleAssigneeFilter } from './complaint-visibility';
import type { AppContext } from './context';
import { listTasks, type TaskRow } from './tasks';
import { inRange } from '@/lib/date-ranges';
import { parseListFilters } from '@/lib/list-filters';
import { searchAndSort, type PageOptions } from '@/lib/server-grid';
import type { TaskStatus } from '@/lib/tasks';

/**
 * Task Manager, filtered - shared by the screen and its export (F1).
 *
 * A work queue, so the created-date range defaults to all time. Whose tasks:
 * people who hand out work (tasks.edit) open on everyone's; everyone else on
 * their own ("Assigned to me") - the Paramjeet case from the Vcare move.
 */

type Sp = Record<string, string | undefined>;

/** Address-safe keys for the status cards, e.g. ?card=in_progress. */
export const TASK_CARDS: Record<string, (t: TaskRow) => boolean> = {
  pending: (t) => t.status === 'Pending',
  in_progress: (t) => t.status === 'In Progress',
  on_hold: (t) => t.status === 'On Hold',
  overdue: (t) => t.isOverdue,
  completed: (t) => t.status === 'Completed',
  cancelled: (t) => t.status === 'Cancelled',
};

export const TASK_GRID: PageOptions<TaskRow> = {
  search: (t) => [t.title, t.description, t.assignedToName, t.createdByName, t.status, t.priority],
  sort: {
    title: (t) => t.title, status: (t) => t.status, priority: (t) => ({ High: 0, Normal: 1, Low: 2 }[t.priority] ?? 1),
    assignee: (t) => t.assignedToName, due: (t) => t.dueDate, createdBy: (t) => t.createdByName, createdAt: (t) => t.createdAt,
  },
};

export async function tasksList(ctx: AppContext, sp: Sp) {
  const filters = parseListFilters(sp, {
    defaultRange: 'all', meId: ctx.user.id, defaultMine: !ctx.permissions.has('tasks.edit'),
  });
  const card = sp.card && TASK_CARDS[sp.card] ? sp.card : null;

  // "Tasks they see" (Roles > Phone app) applies on the website too - G-08.
  const visible = await visibleAssigneeFilter(ctx, 'tasks');
  const all = (await listTasks(ctx.scope)).filter((t) => !visible || visible(t.assignedToId));
  const inScope = all.filter((t) =>
    inRange(t.createdAt, filters.range) && (!filters.personId || t.assignedToId === filters.personId));
  const counts = Object.fromEntries(Object.entries(TASK_CARDS).map(([k, fn]) => [k, inScope.filter(fn).length]));

  const q = (sp.q ?? '').trim().slice(0, 100);
  const sortKey = sp.sort;
  const rows = searchAndSort(
    card ? inScope.filter(TASK_CARDS[card]) : inScope,
    { q, sort: sortKey ? { key: sortKey, dir: sp.dir === 'desc' ? 'desc' : 'asc' } : null },
    TASK_GRID,
  );
  // ?open= (a global-search hit) opens that task even when the filters hide it.
  const openTask = sp.open ? all.find((t) => t.id === sp.open) ?? null : null;
  // Everyone holding a task, for the person filter in All Company mode (the
  // assignable-users list is per branch and refuses All Company).
  const assignees = [...new Map(all.filter((t) => t.assignedToId).map((t) => [t.assignedToId!, { id: t.assignedToId!, fullName: t.assignedToName ?? 'Unknown' }])).values()]
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { rows, counts, card, filters, openTask, assignees };
}

export type { TaskStatus };
