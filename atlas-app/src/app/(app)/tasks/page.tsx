import { requireContext } from '@/server/context';
import { tasksList } from '@/server/tasks-list';
import { listAssignableUsers } from '@/server/assets';
import { listSavedViews, shareableRoles } from '@/server/saved-views';
import { canExportLists } from '@/lib/levels';
import { parseGridQuery, slicePage } from '@/lib/server-grid';
import { myProjectTasks } from '@/server/projects';
import { TasksClient } from './TasksClient';

/**
 * Task Manager on the F1 list standard (26 Sep 2026): search, created date,
 * "Assigned to me" / a person (staff default to their own, managers to
 * everyone), status cards, saved views, export, board or list.
 */
export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const canEdit = ctx.permissions.has('tasks.edit');

  const [list, people, views, roles, projectTasks] = await Promise.all([
    tasksList(ctx, sp),
    ctx.scope.kind === 'single' ? listAssignableUsers(ctx.scope) : Promise.resolve(null),
    listSavedViews(ctx, '/tasks'),
    shareableRoles(ctx),
    // F-04: the person's own tasks inside HRM › Project, when the business has HRM.
    ctx.excludedModules.has('HRM') ? Promise.resolve([]) : myProjectTasks(ctx.scope, ctx.user.id).catch(() => []),
  ]);

  // The list layout sends one page (F1b server paging, 6 Oct 2026); the board
  // needs every task in its columns, so it keeps the whole set.
  const isList = sp.layout === 'list';
  const page = isList ? slicePage(list.rows, parseGridQuery(sp)) : null;

  return (
    <TasksClient
      paging={page?.paging}
      total={list.rows.length}
      tasks={(page ? page.rows : list.rows).map((t) => ({
        ...t,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
        createdAt: t.createdAt.toISOString(),
        completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      }))}
      counts={list.counts}
      card={list.card}
      rangeLabel={list.filters.range.label}
      people={people ? people.map((u) => ({ id: u.id, fullName: u.fullName })) : list.assignees}
      layout={sp.layout === 'list' ? 'list' : 'board'}
      canEdit={canEdit}
      canExport={canExportLists(ctx.permissions)}
      views={{ initial: views, roles }}
      isSingleStore={ctx.scope.kind === 'single'}
      projectTasks={projectTasks.map((t) => ({ ...t, endDate: t.endDate ? t.endDate.toISOString() : null }))}
      openTask={list.openTask ? { ...list.openTask, dueDate: list.openTask.dueDate?.toISOString() ?? null, createdAt: list.openTask.createdAt.toISOString(), completedAt: list.openTask.completedAt?.toISOString() ?? null } : null}
    />
  );
}
