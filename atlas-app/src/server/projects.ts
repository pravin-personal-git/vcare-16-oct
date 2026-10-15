import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * Project (roadmap §4.8) - full build matching atlas-hrns's real
 * `project/models.py`. Four models: `Project`, `ProjectStage` (kanban
 * columns), `ProjectTask` (deliberately not `Task` - Atlas's existing Task
 * Manager already owns that name, the two stay permanently separate), and
 * `ProjectTimesheet`.
 */
export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

const DEFAULT_STAGE_TITLE = 'Todo';

/** `expired` is never stored - computed at read time from `endDate`, same as `dayStatus` never persists a day's status elsewhere in this codebase. */
function effectiveStatus(status: string, endDate: Date | null): string {
  if (status === 'completed' || status === 'cancelled' || status === 'expired') return status;
  if (endDate && endDate.getTime() < Date.now()) return 'expired';
  return status;
}

// ------------------------------------------------------------------ projects

export interface ProjectRow {
  id: string;
  title: string;
  description: string;
  status: string;
  startDate: Date;
  endDate: Date | null;
  managers: { id: string; fullName: string }[];
  taskCount: number;
  completedTaskCount: number;
  createdAt: Date;
}

export async function listProjects(scope: StoreScope): Promise<ProjectRow[]> {
  const rows = await db.project.findMany({
    where: scopeWhere(scope),
    orderBy: { createdAt: 'desc' },
    include: {
      managers: { include: { user: { select: { id: true, fullName: true } } } },
      tasks: { select: { status: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, title: r.title, description: r.description,
    status: effectiveStatus(r.status, r.endDate), startDate: r.startDate, endDate: r.endDate,
    managers: r.managers.map((m) => m.user),
    taskCount: r.tasks.length,
    completedTaskCount: r.tasks.filter((t) => t.status === 'completed').length,
    createdAt: r.createdAt,
  }));
}

export interface ProjectDetail {
  id: string;
  title: string;
  description: string;
  status: string;
  startDate: Date;
  endDate: Date | null;
  managers: { id: string; fullName: string }[];
  stages: {
    id: string;
    title: string;
    sortOrder: number;
    isEndStage: boolean;
    tasks: {
      id: string; title: string; description: string; status: string;
      startDate: Date | null; endDate: Date | null; sortOrder: number;
      managers: { id: string; fullName: string }[];
      members: { id: string; fullName: string }[];
    }[];
  }[];
}

export async function getProject(scope: StoreScope, id: string): Promise<ProjectDetail> {
  const storeId = scopeForWrite(scope);
  const project = await db.project.findFirst({
    where: { id, storeId },
    include: {
      managers: { include: { user: { select: { id: true, fullName: true } } } },
      stages: {
        orderBy: { sortOrder: 'asc' },
        include: {
          tasks: {
            orderBy: { sortOrder: 'asc' },
            include: {
              managers: { include: { user: { select: { id: true, fullName: true } } } },
              members: { include: { user: { select: { id: true, fullName: true } } } },
            },
          },
        },
      },
    },
  });
  if (!project) throw new ProjectError('Project not found in your scope.');

  return {
    id: project.id, title: project.title, description: project.description,
    status: effectiveStatus(project.status, project.endDate),
    startDate: project.startDate, endDate: project.endDate,
    managers: project.managers.map((m) => m.user),
    stages: project.stages.map((s) => ({
      id: s.id, title: s.title, sortOrder: s.sortOrder, isEndStage: s.isEndStage,
      tasks: s.tasks.map((t) => ({
        id: t.id, title: t.title, description: t.description, status: t.status,
        startDate: t.startDate, endDate: t.endDate, sortOrder: t.sortOrder,
        managers: t.managers.map((m) => m.user), members: t.members.map((m) => m.user),
      })),
    })),
  };
}

export interface CreateProjectInput {
  title: string;
  description: string;
  startDate: Date;
  endDate: Date | null;
  managerUserIds: string[];
}

export async function createProject(scope: StoreScope, input: CreateProjectInput): Promise<{ id: string }> {
  const storeId = scopeForWrite(scope);
  if (!input.title.trim()) throw new ProjectError('Project title is required.');
  if (input.endDate && input.endDate < input.startDate) {
    throw new ProjectError('End date cannot be before the start date.');
  }

  const project = await db.project.create({
    data: {
      storeId, title: input.title.trim(), description: input.description.trim(),
      startDate: input.startDate, endDate: input.endDate,
      managers: { create: input.managerUserIds.map((userId) => ({ userId })) },
      // A new project gets one "Todo" stage automatically, same as
      // atlas-hrns's own Project.save().
      stages: { create: { title: DEFAULT_STAGE_TITLE, sortOrder: 0 } },
    },
    select: { id: true },
  });
  return project;
}

/**
 * Edit a project's own details after it is created (health check SVC-3).
 * The audit trail keeps the before/after; managers are replaced as a set.
 */
export async function updateProject(scope: StoreScope, id: string, input: CreateProjectInput): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!input.title.trim()) throw new ProjectError('Project title is required.');
  if (input.endDate && input.endDate < input.startDate) throw new ProjectError('End date cannot be before the start date.');
  const project = await db.project.findFirst({ where: { id, storeId }, select: { id: true } });
  if (!project) throw new ProjectError('Project not found in your scope.');
  await db.$transaction([
    db.project.update({
      where: { id },
      data: { title: input.title.trim(), description: input.description.trim(), startDate: input.startDate, endDate: input.endDate },
    }),
    db.projectManager.deleteMany({ where: { projectId: id } }),
    db.projectManager.createMany({ data: input.managerUserIds.map((userId) => ({ projectId: id, userId })) }),
  ]);
}

export async function setProjectStatus(
  scope: StoreScope, id: string, status: 'new' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled',
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const project = await db.project.findFirst({ where: { id, storeId } });
  if (!project) throw new ProjectError('Project not found in your scope.');
  await db.project.update({ where: { id }, data: { status } });
}

// -------------------------------------------------------------------- stages

export async function createProjectStage(scope: StoreScope, projectId: string, title: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!title.trim()) throw new ProjectError('Stage name is required.');
  const project = await db.project.findFirst({ where: { id: projectId, storeId } });
  if (!project) throw new ProjectError('Project not found in your scope.');

  const last = await db.projectStage.findFirst({ where: { projectId }, orderBy: { sortOrder: 'desc' } });
  await db.projectStage.create({
    data: { projectId, title: title.trim(), sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
}

export async function setStageEndFlag(scope: StoreScope, stageId: string, isEndStage: boolean): Promise<void> {
  const storeId = scopeForWrite(scope);
  const stage = await db.projectStage.findFirst({ where: { id: stageId, project: { storeId } } });
  if (!stage) throw new ProjectError('Stage not found in your scope.');

  if (isEndStage) {
    // Only one stage per project may be the "done" column.
    await db.projectStage.updateMany({ where: { projectId: stage.projectId }, data: { isEndStage: false } });
  }
  await db.projectStage.update({ where: { id: stageId }, data: { isEndStage } });
}

// --------------------------------------------------------------------- tasks

export interface CreateProjectTaskInput {
  projectId: string;
  stageId: string;
  title: string;
  description: string;
  startDate: Date | null;
  endDate: Date | null;
  managerUserIds: string[];
  memberUserIds: string[];
}

export async function createProjectTask(scope: StoreScope, input: CreateProjectTaskInput): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!input.title.trim()) throw new ProjectError('Task title is required.');

  const stage = await db.projectStage.findFirst({
    where: { id: input.stageId, projectId: input.projectId, project: { storeId } },
  });
  if (!stage) throw new ProjectError('Stage not found in your scope.');

  const last = await db.projectTask.findFirst({ where: { stageId: input.stageId }, orderBy: { sortOrder: 'desc' } });

  await db.projectTask.create({
    data: {
      projectId: input.projectId, stageId: input.stageId,
      title: input.title.trim(), description: input.description.trim(),
      startDate: input.startDate, endDate: input.endDate,
      status: stage.isEndStage ? 'completed' : 'to_do',
      sortOrder: (last?.sortOrder ?? -1) + 1,
      managers: { create: input.managerUserIds.map((userId) => ({ userId })) },
      members: { create: input.memberUserIds.map((userId) => ({ userId })) },
    },
  });
}

export type UpdateProjectTaskInput = Omit<CreateProjectTaskInput, 'projectId' | 'stageId' | 'managerUserIds'>;

/** Edit a task's title, notes, dates and members (health check SVC-3). */
export async function updateProjectTask(scope: StoreScope, taskId: string, input: UpdateProjectTaskInput): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!input.title.trim()) throw new ProjectError('Task title is required.');
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw new ProjectError('Due date cannot be before the start date.');
  const task = await db.projectTask.findFirst({ where: { id: taskId, project: { storeId } }, select: { id: true } });
  if (!task) throw new ProjectError('Task not found in your scope.');
  await db.$transaction([
    db.projectTask.update({
      where: { id: taskId },
      data: { title: input.title.trim(), description: input.description.trim(), startDate: input.startDate, endDate: input.endDate },
    }),
    db.projectTaskMember.deleteMany({ where: { taskId } }),
    db.projectTaskMember.createMany({ data: input.memberUserIds.map((userId) => ({ taskId, userId })) }),
  ]);
}

/** Move a task to another stage - kanban drag-drop's server side. Landing on the end stage marks it completed; leaving it un-completes it. */
export async function moveProjectTask(scope: StoreScope, taskId: string, toStageId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const task = await db.projectTask.findFirst({ where: { id: taskId, project: { storeId } } });
  if (!task) throw new ProjectError('Task not found in your scope.');

  const toStage = await db.projectStage.findFirst({ where: { id: toStageId, projectId: task.projectId } });
  if (!toStage) throw new ProjectError('That stage does not belong to this project.');

  const last = await db.projectTask.findFirst({ where: { stageId: toStageId }, orderBy: { sortOrder: 'desc' } });

  await db.projectTask.update({
    where: { id: taskId },
    data: {
      stageId: toStageId,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      status: toStage.isEndStage ? 'completed' : (task.status === 'completed' ? 'in_progress' : task.status),
    },
  });
}

export interface CrossProjectTaskRow {
  id: string;
  projectId: string;
  projectTitle: string;
  stageId: string;
  stageTitle: string;
  title: string;
  status: string;
  endDate: Date | null;
  members: { id: string; fullName: string }[];
}

export async function listAllTasks(scope: StoreScope): Promise<CrossProjectTaskRow[]> {
  const rows = await db.projectTask.findMany({
    where: { project: scopeWhere(scope) },
    orderBy: { createdAt: 'desc' },
    include: {
      project: { select: { title: true } },
      stage: { select: { title: true } },
      members: { include: { user: { select: { id: true, fullName: true } } } },
    },
    take: LIST_MAX_ROWS,
  });
  return rows.map((t) => ({
    id: t.id, projectId: t.projectId, projectTitle: t.project.title,
    stageId: t.stageId, stageTitle: t.stage.title, title: t.title, status: t.status,
    endDate: t.endDate, members: t.members.map((m) => m.user),
  }));
}

// ---------------------------------------------------------------- timesheet

export interface TimesheetRow {
  id: string;
  projectId: string;
  projectTitle: string;
  taskId: string | null;
  taskTitle: string | null;
  userId: string;
  userName: string;
  date: Date;
  minutesSpent: number;
  status: string;
  description: string;
}

export async function listTimesheets(scope: StoreScope, opts: { projectId?: string } = {}): Promise<TimesheetRow[]> {
  const rows = await db.projectTimesheet.findMany({
    where: { project: scopeWhere(scope), ...(opts.projectId ? { projectId: opts.projectId } : {}) },
    orderBy: { date: 'desc' },
    include: {
      project: { select: { title: true } },
      task: { select: { title: true } },
      user: { select: { fullName: true } },
    },
    take: LIST_MAX_ROWS,
  });
  return rows.map((r) => ({
    id: r.id, projectId: r.projectId, projectTitle: r.project.title,
    taskId: r.taskId, taskTitle: r.task?.title ?? null,
    userId: r.userId, userName: r.user.fullName,
    date: r.date, minutesSpent: r.minutesSpent, status: r.status, description: r.description,
  }));
}

export interface LogTimesheetInput {
  projectId: string;
  taskId: string | null;
  date: Date;
  minutesSpent: number;
  description: string;
}

/** Validates the logging employee is actually a manager or member of whichever project/task they're logging against, and that the date isn't in the future - per atlas-hrns's TimeSheet.clean(). */
export async function logTimesheet(scope: StoreScope, input: LogTimesheetInput, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (input.minutesSpent <= 0) throw new ProjectError('Enter a duration greater than zero.');
  if (input.date.getTime() > Date.now()) throw new ProjectError('Cannot log time for a date in the future.');

  const project = await db.project.findFirst({
    where: { id: input.projectId, storeId },
    include: { managers: { select: { userId: true } } },
  });
  if (!project) throw new ProjectError('Project not found in your scope.');

  let allowed = project.managers.some((m) => m.userId === userId);

  if (input.taskId) {
    const task = await db.projectTask.findFirst({
      where: { id: input.taskId, projectId: input.projectId },
      include: { managers: { select: { userId: true } }, members: { select: { userId: true } } },
    });
    if (!task) throw new ProjectError('Task not found in this project.');
    allowed = allowed
      || task.managers.some((m) => m.userId === userId)
      || task.members.some((m) => m.userId === userId);
  }

  if (!allowed) throw new ProjectError('You are not a manager or member of this project or task.');

  await db.projectTimesheet.create({
    data: {
      projectId: input.projectId, taskId: input.taskId, userId: userId,
      date: input.date, minutesSpent: input.minutesSpent, description: input.description.trim(),
    },
  });
}

export async function setTimesheetStatus(scope: StoreScope, id: string, status: 'in_progress' | 'completed'): Promise<void> {
  const entry = await db.projectTimesheet.findFirst({ where: { id, project: scopeWhere(scope) } });
  if (!entry) throw new ProjectError('Timesheet entry not found in your scope.');
  await db.projectTimesheet.update({ where: { id }, data: { status } });
}

// -------------------------------------------------------------------- shared

/** Everyone holding a role in this store - who can manage/join a project or task. */
export async function listProjectAssignableUsers(scope: StoreScope) {
  const storeId = scopeForWrite(scope);
  const roles = await db.userStoreRole.findMany({
    where: { storeId },
    distinct: ['userId'],
    select: { user: { select: { id: true, fullName: true } } },
  });
  return roles.map((r) => r.user).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * F-04 (6 Oct 2026): Task Manager and HRM › Project were two task lists that
 * never met. Projects keep their own tasks; Task Manager now also shows a
 * person the project tasks they are on, so "my work" is one screen.
 */
export interface MyProjectTask {
  id: string; title: string; status: string; endDate: Date | null; projectId: string; projectTitle: string;
}

export async function myProjectTasks(scope: StoreScope, userId: string): Promise<MyProjectTask[]> {
  const rows = await db.projectTask.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['completed', 'expired'] },
      project: { ...scopeWhere(scope), deletedAt: null },
      OR: [{ members: { some: { userId, deletedAt: null } } }, { managers: { some: { userId, deletedAt: null } } }],
    },
    orderBy: [{ endDate: 'asc' }, { createdAt: 'asc' }],
    take: LIST_MAX_ROWS,
    select: { id: true, title: true, status: true, endDate: true, project: { select: { id: true, title: true } } },
  });
  return rows.map((t) => ({
    id: t.id, title: t.title, status: t.status, endDate: t.endDate, projectId: t.project.id, projectTitle: t.project.title,
  }));
}
