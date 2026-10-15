import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';

/**
 * The checklist engine shared by Onboarding and Offboarding.
 *
 * Both are the same shape underneath - an admin-defined list of steps,
 * walked once per employee, each one marked done by whoever handles it -
 * so one engine backs both rather than two near-identical systems that
 * could quietly drift apart. `phase` ('onboarding' | 'offboarding') is the
 * only thing that tells them apart.
 */

export class LifecycleError extends Error {}

export type LifecyclePhase = 'onboarding' | 'offboarding';

// ------------------------------------------------------------ templates

export interface ChecklistItemRow {
  id: string;
  phase: LifecyclePhase;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

export async function listChecklistItems(
  scope: StoreScope, phase: LifecyclePhase, opts: { activeOnly?: boolean } = {},
): Promise<ChecklistItemRow[]> {
  const rows = await db.lifecycleChecklistItem.findMany({
    where: { ...scopeWhere(scope), phase, ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, phase: r.phase as LifecyclePhase, label: r.label, sortOrder: r.sortOrder, isActive: r.isActive }));
}

export async function createChecklistItem(scope: StoreScope, phase: LifecyclePhase, label: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!label.trim()) throw new LifecycleError('Step name is required.');

  const maxSort = await db.lifecycleChecklistItem.aggregate({ where: { storeId, phase }, _max: { sortOrder: true } });
  await db.lifecycleChecklistItem.create({
    data: { storeId, phase, label: label.trim(), sortOrder: (maxSort._max.sortOrder ?? 0) + 1 },
  });
}

export async function removeChecklistItem(scope: StoreScope, id: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const found = await db.lifecycleChecklistItem.findFirst({ where: { id, storeId } });
  if (!found) throw new LifecycleError('That step is not in your scope.');
  // Soft-remove, same as Helpdesk categories - a task already created from
  // this template keeps its own copied label regardless.
  await db.lifecycleChecklistItem.update({ where: { id }, data: { isActive: false } });
}

// ------------------------------------------------------------------ tasks

export interface LifecycleTaskRow {
  id: string;
  userId: string;
  userName: string;
  phase: LifecyclePhase;
  label: string;
  status: 'pending' | 'done' | 'skipped';
  completedBy: string | null;
  completedAt: Date | null;
  note: string | null;
  createdAt: Date;
}

function toTaskRow(r: {
  id: string; userId: string; user: { fullName: string }; phase: string; label: string; status: string;
  completedBy: string | null; completedAt: Date | null; note: string | null; createdAt: Date;
}): LifecycleTaskRow {
  return {
    id: r.id, userId: r.userId, userName: r.user.fullName, phase: r.phase as LifecyclePhase,
    label: r.label, status: r.status as LifecycleTaskRow['status'],
    completedBy: r.completedBy, completedAt: r.completedAt, note: r.note, createdAt: r.createdAt,
  };
}

export async function listTasksForUser(scope: StoreScope, userId: string, phase: LifecyclePhase): Promise<LifecycleTaskRow[]> {
  const rows = await db.lifecycleTask.findMany({
    where: { ...scopeWhere(scope), userId, phase },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { fullName: true } } },
  });
  return rows.map(toTaskRow);
}

/**
 * Instantiate one task per active checklist template for this phase - the
 * same "batch creates real rows" shape as `createAssetBatch`. Safe to call
 * more than once: only templates that don't already have a task for this
 * user/phase get one, so re-running after adding a template mid-process
 * fills the gap instead of duplicating everything.
 */
export async function generateTasksForUser(
  scope: StoreScope, userId: string, phase: LifecyclePhase,
): Promise<{ created: number }> {
  const storeId = scopeForWrite(scope);
  const [templates, existing] = await Promise.all([
    db.lifecycleChecklistItem.findMany({ where: { storeId, phase, isActive: true } }),
    db.lifecycleTask.findMany({ where: { storeId, userId, phase }, select: { checklistItemId: true } }),
  ]);
  const covered = new Set(existing.map((t) => t.checklistItemId).filter(Boolean));
  const missing = templates.filter((t) => !covered.has(t.id));
  if (missing.length === 0) return { created: 0 };

  await db.lifecycleTask.createMany({
    data: missing.map((t) => ({ storeId, userId, phase, checklistItemId: t.id, label: t.label })),
  });
  return { created: missing.length };
}

export async function setTaskStatus(
  scope: StoreScope, taskId: string, status: 'done' | 'skipped' | 'pending', byUserId: string, note: string | null,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const task = await db.lifecycleTask.findFirst({ where: { id: taskId, storeId } });
  if (!task) throw new LifecycleError('That step is not in your scope.');

  await db.lifecycleTask.update({
    where: { id: taskId },
    data: {
      status,
      completedBy: status === 'pending' ? null : byUserId,
      completedAt: status === 'pending' ? null : new Date(),
      note: note?.trim() || task.note,
    },
  });
}

export interface PhaseProgress {
  total: number;
  done: number;
  skipped: number;
  pending: number;
}

export function summarizeProgress(tasks: LifecycleTaskRow[]): PhaseProgress {
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.status === 'done').length,
    skipped: tasks.filter((t) => t.status === 'skipped').length,
    pending: tasks.filter((t) => t.status === 'pending').length,
  };
}
