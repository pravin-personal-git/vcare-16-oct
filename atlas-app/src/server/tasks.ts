import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import type { TaskStatus, TaskPriority } from '@/lib/tasks';

export type { TaskStatus, TaskPriority } from '@/lib/tasks';

/**
 * Task Manager. Five statuses, matching the reference app's own board exactly
 * rather than reinventing a workflow the client has already seen. The status
 * and priority constants live in `lib/tasks.ts`, not here - see that file for why.
 */

export class TaskError extends Error {}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  assignedToId: string | null;
  assignedToName: string | null;
  createdByName: string | null;
  createdAt: Date;
  completedAt: Date | null;
  isOverdue: boolean;
}

export async function listTasks(scope: StoreScope): Promise<TaskRow[]> {
  const rows = await db.task.findMany({
    where: scopeWhere(scope),
    orderBy: [{ createdAt: 'desc' }],
    include: { assignedTo: { select: { fullName: true } } },
  });

  const creatorIds = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))];
  const creators = creatorIds.length
    ? await db.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, fullName: true } })
    : [];
  const creatorName = new Map(creators.map((u) => [u.id, u.fullName]));

  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status as TaskStatus,
    priority: r.priority as TaskPriority,
    dueDate: r.dueDate,
    assignedToId: r.assignedToId,
    assignedToName: r.assignedTo?.fullName ?? null,
    createdByName: r.createdBy ? creatorName.get(r.createdBy) ?? null : null,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    isOverdue: r.dueDate != null && r.dueDate < now && r.status !== 'Completed' && r.status !== 'Cancelled',
  }));
}

/** The dashboard's Task Status pipeline band - a small, cheap aggregate rather than pulling every row. */
export async function taskPipelineCounts(scope: StoreScope) {
  const now = new Date();
  const rows = await db.task.groupBy({
    by: ['status'],
    where: scopeWhere(scope),
    _count: { _all: true },
  });
  const byStatus = new Map(rows.map((r) => [r.status, r._count._all]));
  const total = [...byStatus.values()].reduce((n, c) => n + c, 0);

  const overdue = await db.task.count({
    where: { ...scopeWhere(scope), dueDate: { lt: now }, status: { notIn: ['Completed', 'Cancelled'] } },
  });
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  const dueToday = await db.task.count({
    where: {
      ...scopeWhere(scope), dueDate: { gte: startOfDay, lte: endOfDay }, status: { notIn: ['Completed', 'Cancelled'] },
    },
  });

  return {
    total,
    pending: byStatus.get('Pending') ?? 0,
    inProgress: byStatus.get('In Progress') ?? 0,
    overdue,
    dueToday,
  };
}

export interface TaskInput {
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueDate: Date | null;
  assignedToId: string | null;
}

function validate(input: TaskInput) {
  if (!input.title.trim()) throw new TaskError('Title is required.');
}

export async function createTask(scope: StoreScope, input: TaskInput, userId: string) {
  const storeId = scopeForWrite(scope);
  validate(input);

  return db.task.create({
    data: {
      storeId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      priority: input.priority,
      dueDate: input.dueDate,
      assignedToId: input.assignedToId,
      createdBy: userId,
    },
  });
}

export async function updateTask(scope: StoreScope, id: string, input: TaskInput) {
  const storeId = scopeForWrite(scope);
  validate(input);

  const found = await db.task.findFirst({ where: { id, storeId } });
  if (!found) throw new TaskError('That task is not in your scope.');

  return db.task.update({
    where: { id },
    data: {
      title: input.title.trim(),
      description: input.description?.trim() || null,
      priority: input.priority,
      dueDate: input.dueDate,
      assignedToId: input.assignedToId,
    },
  });
}

export async function setTaskStatus(scope: StoreScope, id: string, status: TaskStatus) {
  const storeId = scopeForWrite(scope);
  const found = await db.task.findFirst({ where: { id, storeId } });
  if (!found) throw new TaskError('That task is not in your scope.');

  return db.task.update({
    where: { id },
    data: {
      status,
      completedAt: status === 'Completed' ? new Date() : null,
    },
  });
}

export async function deleteTask(
  scope: StoreScope, id: string, userId: string | null = null,
) {
  const storeId = scopeForWrite(scope);
  const found = await db.task.findFirst({ where: { id, storeId } });
  if (!found) throw new TaskError('That task is not in your scope.');
  // Tombstoned, not removed (3 Oct 2026). A task reappearing in somebody's list
  // after it was deleted is a sync bug they will report as the app being broken.
  await db.task.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: userId } });
}
