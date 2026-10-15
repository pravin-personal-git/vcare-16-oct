'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createProject, updateProject, updateProjectTask, setProjectStatus, createProjectStage, setStageEndFlag,
  createProjectTask, moveProjectTask, logTimesheet, setTimesheetStatus,
  ProjectError, type CreateProjectInput, type CreateProjectTaskInput, type LogTimesheetInput, type UpdateProjectTaskInput,
} from '@/server/projects';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function guardEdit(run: () => Promise<void>, path: string): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('hrm.edit')) return { error: 'You do not have permission to manage projects.' };
    await run();
    revalidatePath(path);
    return { ok: true };
  } catch (err) {
    if (err instanceof ProjectError) return { error: err.message };
    console.error('[projects] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function createProjectAction(
  input: Omit<CreateProjectInput, 'startDate' | 'endDate'> & { startDate: string; endDate: string | null },
): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await createProject(ctx.scope, {
      ...input, startDate: new Date(input.startDate), endDate: input.endDate ? new Date(input.endDate) : null,
    });
  }, '/hrm/project');
}

export async function updateProjectAction(
  id: string, input: Omit<CreateProjectInput, 'startDate' | 'endDate'> & { startDate: string; endDate: string | null },
): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await updateProject(ctx.scope, id, {
      ...input, startDate: new Date(input.startDate), endDate: input.endDate ? new Date(input.endDate) : null,
    });
  }, `/hrm/project/${id}`);
}

export async function updateProjectTaskAction(
  projectId: string, taskId: string,
  input: Omit<UpdateProjectTaskInput, 'startDate' | 'endDate'> & { startDate: string | null; endDate: string | null },
): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await updateProjectTask(ctx.scope, taskId, {
      ...input,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
    });
  }, `/hrm/project/${projectId}`);
}

export async function setProjectStatusAction(
  id: string, status: 'new' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled',
): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await setProjectStatus(ctx.scope, id, status);
  }, `/hrm/project/${id}`);
}

export async function createProjectStageAction(projectId: string, title: string): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await createProjectStage(ctx.scope, projectId, title);
  }, `/hrm/project/${projectId}`);
}

export async function setStageEndFlagAction(projectId: string, stageId: string, isEndStage: boolean): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await setStageEndFlag(ctx.scope, stageId, isEndStage);
  }, `/hrm/project/${projectId}`);
}

export async function createProjectTaskAction(
  input: Omit<CreateProjectTaskInput, 'startDate' | 'endDate'> & { startDate: string | null; endDate: string | null },
): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await createProjectTask(ctx.scope, {
      ...input,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
    });
  }, `/hrm/project/${input.projectId}`);
}

export async function moveProjectTaskAction(projectId: string, taskId: string, toStageId: string): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await moveProjectTask(ctx.scope, taskId, toStageId);
  }, `/hrm/project/${projectId}`);
}

// Self-service - logging your own hours needs no admin permission, the same
// as raising a leave request.
export async function logTimesheetAction(input: Omit<LogTimesheetInput, 'date'> & { date: string }): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await logTimesheet(ctx.scope, { ...input, date: new Date(input.date) }, ctx.user.id);
    revalidatePath('/hrm/project');
    return { ok: true };
  } catch (err) {
    if (err instanceof ProjectError) return { error: err.message };
    console.error('[projects] timesheet log failed', err);
    return { error: friendlyError(err) };
  }
}

export async function setTimesheetStatusAction(id: string, status: 'in_progress' | 'completed'): Promise<ActionState> {
  return guardEdit(async () => {
    const ctx = await requireContext();
    await setTimesheetStatus(ctx.scope, id, status);
  }, '/hrm/project');
}
