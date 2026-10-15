'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge, Field, type BadgeTone } from '@/components/ui/Layout';
import { DetailHeader } from '@/components/document/DetailHeader';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  createProjectStageAction, setStageEndFlagAction, createProjectTaskAction,
  moveProjectTaskAction, setProjectStatusAction, updateProjectAction, updateProjectTaskAction,
} from '../actions';

interface TaskVM {
  id: string; title: string; description: string; status: string;
  startDate: string | null; endDate: string | null; sortOrder: number;
  managers: { id: string; fullName: string }[]; members: { id: string; fullName: string }[];
}
interface StageVM {
  id: string; title: string; sortOrder: number; isEndStage: boolean; tasks: TaskVM[];
}
interface ProjectDetailVM {
  id: string; title: string; description: string; status: string;
  startDate: string; endDate: string | null;
  managers: { id: string; fullName: string }[];
  stages: StageVM[];
}

interface Props {
  project: ProjectDetailVM;
  employees: { id: string; fullName: string }[];
  canManage: boolean;
}

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

const STATUS_TONE: Record<string, BadgeTone> = {
  new: 'neutral', in_progress: 'info', completed: 'success', on_hold: 'warning', cancelled: 'danger', expired: 'danger',
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function ProjectDetailClient({ project, employees, canManage }: Props) {
  const [addingStage, setAddingStage] = useState(false);
  const [addingTaskInStage, setAddingTaskInStage] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<TaskVM | null>(null);
  const [editingProject, setEditingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const changeStatus = (status: string) => {
    setBusyId('status');
    startTransition(async () => {
      const res = await setProjectStatusAction(project.id, status as 'new' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled');
      setError(res.error ?? null);
      setBusyId(null);
    });
  };

  const moveTask = (taskId: string, toStageId: string) => {
    setBusyId(taskId);
    startTransition(async () => {
      const res = await moveProjectTaskAction(project.id, taskId, toStageId);
      setError(res.error ?? null);
      setBusyId(null);
    });
  };

  const toggleEndStage = (stageId: string, isEndStage: boolean) => {
    setBusyId(stageId);
    startTransition(async () => {
      const res = await setStageEndFlagAction(project.id, stageId, !isEndStage);
      setError(res.error ?? null);
      setBusyId(null);
    });
  };

  return (
    <div>
      <DetailHeader
        icon="grid"
        kind="Project"
        number={project.title}
        status={{ label: project.status.replace('_', ' '), tone: STATUS_TONE[project.status] ?? 'neutral' }}
        facts={[
          { label: 'Dates', value: `${fmtDate(project.startDate)}${project.endDate ? ` - ${fmtDate(project.endDate)}` : ''}` },
          { label: 'Managers', value: project.managers.map((m) => m.fullName).join(', ') || 'None assigned' },
        ]}
        backHref="/hrm/project"
        backLabel="All projects"
        actions={
          <div className="flex items-center gap-2">
            {canManage && (
              <select
                value={project.status === 'expired' ? '' : project.status}
                onChange={(e) => changeStatus(e.target.value)}
                disabled={pending && busyId === 'status'}
                className="h-9 rounded-lg border border-border bg-card px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <option value="" disabled>Change status…</option>
                <option value="new">New</option>
                <option value="in_progress">In Progress</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            )}
            {canManage && (
              <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditingProject(true)}>Edit</Button>
            )}
            {canManage && (
              <Button size="sm" variant="outline" icon="plus" onClick={() => setAddingStage(true)}>Add stage</Button>
            )}
          </div>
        }
      />

      {project.description && <p className="mb-4 text-sm text-muted-foreground">{project.description}</p>}

      {error && (
        <div className="mb-3 flex gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-flow-col auto-cols-[18rem] gap-3 overflow-x-auto pb-2">
        {project.stages.map((stage) => (
          <div key={stage.id} className="flex flex-col rounded-lg border border-border bg-muted/30">
            <div className="flex items-center justify-between rounded-t-lg border-b border-border bg-card px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold">{stage.title}</span>
                {canManage ? (
                  <button
                    type="button"
                    disabled={pending && busyId === stage.id}
                    onClick={() => toggleEndStage(stage.id, stage.isEndStage)}
                    title={stage.isEndStage ? 'Unmark as the "done" column' : 'Mark as the "done" column'}
                    className={stage.isEndStage ? 'text-success' : 'text-muted-foreground/40 hover:text-muted-foreground'}
                  >
                    <Icon name="check-circle" className="h-3.5 w-3.5" />
                  </button>
                ) : stage.isEndStage && <Icon name="check-circle" className="h-3.5 w-3.5 text-success" />}
              </div>
              <Badge tone="neutral">{stage.tasks.length}</Badge>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-2">
              {stage.tasks.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nothing here</p>
              ) : (
                stage.tasks.map((task) => (
                  <div key={task.id} className="rounded-lg border border-border bg-card p-2.5 shadow-card">
                    {canManage ? (
                      <button type="button" onClick={() => setEditingTask(task)} className="block w-full truncate text-start text-sm font-semibold hover:text-brand" title="Edit task">
                        {task.title}
                      </button>
                    ) : <p className="truncate text-sm font-semibold">{task.title}</p>}
                    {task.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>}
                    {task.members.length > 0 && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">{task.members.map((m) => m.fullName).join(', ')}</p>
                    )}
                    {task.endDate && <p className="mt-1 text-xs text-muted-foreground">Due {fmtDate(task.endDate)}</p>}
                    {canManage && project.stages.length > 1 && (
                      <select
                        value={stage.id}
                        disabled={pending && busyId === task.id}
                        onChange={(e) => moveTask(task.id, e.target.value)}
                        className="mt-2 h-7 w-full rounded border border-border bg-background px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                      >
                        {project.stages.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                      </select>
                    )}
                  </div>
                ))
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={() => setAddingTaskInStage(stage.id)}
                  className="flex h-8 items-center justify-center gap-1 rounded border border-dashed border-border text-xs text-muted-foreground transition hover:border-brand/40 hover:text-brand"
                >
                  <Icon name="plus" className="h-3 w-3" /> Add task
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {addingStage && (
        <AddStageModal
          onClose={() => setAddingStage(false)}
          onSaved={(res) => { setError(res.error ?? null); if (!res.error) setAddingStage(false); }}
          projectId={project.id}
        />
      )}
      {editingTask && (
        <AddTaskModal
          projectId={project.id}
          stageId=""
          task={editingTask}
          isEndStage={false}
          employees={employees}
          onClose={() => setEditingTask(null)}
          onSaved={(res) => { setError(res.error ?? null); if (!res.error) setEditingTask(null); }}
        />
      )}
      {editingProject && (
        <EditProjectModal
          project={project}
          employees={employees}
          onClose={() => setEditingProject(false)}
          onSaved={() => setEditingProject(false)}
        />
      )}
      {addingTaskInStage && (
        <AddTaskModal
          projectId={project.id}
          stageId={addingTaskInStage}
          isEndStage={project.stages.find((s) => s.id === addingTaskInStage)?.isEndStage ?? false}
          employees={employees}
          onClose={() => setAddingTaskInStage(null)}
          onSaved={(res) => { setError(res.error ?? null); if (!res.error) setAddingTaskInStage(null); }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------

function AddStageModal({
  projectId, onClose, onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: (res: { error?: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!title.trim()) { setError('Stage name is required.'); return; }
    setError(null);
    startTransition(async () => {
      const res = await createProjectStageAction(projectId, title.trim());
      onSaved(res);
    });
  };

  return (
    <Modal
      title="Add stage"
      icon="grid"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>Add</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <Field label="Stage name" htmlFor="st-title" hint='Mark it as the "done" column afterward, from the stage header on the board.'>
        <input id="st-title" value={title} onChange={(e) => setTitle(e.target.value)} className={input} placeholder="e.g. In Review" />
      </Field>
    </Modal>
  );
}

function AddTaskModal({
  projectId, stageId, task, isEndStage, employees, onClose, onSaved,
}: {
  projectId: string;
  stageId: string;
  /** Given when editing an existing task. */
  task?: TaskVM;
  isEndStage: boolean;
  employees: { id: string; fullName: string }[];
  onClose: () => void;
  onSaved: (res: { error?: string }) => void;
}) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [startDate, setStartDate] = useState(task?.startDate?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(task?.endDate?.slice(0, 10) ?? '');
  const [memberIds, setMemberIds] = useState<string[]>(task?.members.map((m) => m.id) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleMember = (id: string) =>
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = () => {
    if (!title.trim()) { setError('Task title is required.'); return; }
    setError(null);
    startTransition(async () => {
      const res = task
        ? await updateProjectTaskAction(projectId, task.id, {
          title: title.trim(), description: description.trim(),
          startDate: startDate || null, endDate: endDate || null, memberUserIds: memberIds,
        })
        : await createProjectTaskAction({
          projectId, stageId, title: title.trim(), description: description.trim(),
          startDate: startDate || null, endDate: endDate || null,
          managerUserIds: [], memberUserIds: memberIds,
        });
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title={task ? 'Edit task' : 'Add task'}
      subtitle={isEndStage ? 'This stage is the "done" column - the task starts completed.' : undefined}
      icon="check-circle"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>{task ? 'Save' : 'Add'}</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="grid gap-3">
        <Field label="Title" htmlFor="tk-title">
          <input id="tk-title" value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </Field>
        <Field label="Description" htmlFor="tk-desc" hint="Optional.">
          <textarea id="tk-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${input} h-auto py-2`} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" htmlFor="tk-start" hint="Optional.">
            <input id="tk-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={input} />
          </Field>
          <Field label="Due date" htmlFor="tk-end" hint="Optional.">
            <input id="tk-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={input} />
          </Field>
        </div>
        <Field label="Members" hint="Optional - pick one or more.">
          <div className="flex flex-wrap gap-2">
            {employees.map((u) => (
              <button
                key={u.id} type="button" onClick={() => toggleMember(u.id)} aria-pressed={memberIds.includes(u.id)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  memberIds.includes(u.id) ? 'border-brand bg-brand/10 text-on-tint-brand' : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {u.fullName}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function EditProjectModal({
  project, employees, onClose, onSaved,
}: {
  project: ProjectDetailVM;
  employees: { id: string; fullName: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description);
  const [startDate, setStartDate] = useState(project.startDate.slice(0, 10));
  const [endDate, setEndDate] = useState(project.endDate?.slice(0, 10) ?? '');
  const [managerIds, setManagerIds] = useState<string[]>(project.managers.map((m) => m.id));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) => setManagerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const save = () => startTransition(async () => {
    const res = await updateProjectAction(project.id, {
      title, description, startDate, endDate: endDate || null, managerUserIds: managerIds,
    });
    if (res.error) setError(res.error);
    else onSaved();
  });

  return (
    <Modal
      title="Edit project"
      icon="pencil"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>Save</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="grid gap-3">
        <Field label="Title" htmlFor="pj-title">
          <input id="pj-title" value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </Field>
        <Field label="Description" htmlFor="pj-desc">
          <textarea id="pj-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={`${input} h-auto py-2`} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" htmlFor="pj-start">
            <input id="pj-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={input} />
          </Field>
          <Field label="End date" htmlFor="pj-end" hint="Optional.">
            <input id="pj-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={input} />
          </Field>
        </div>
        <Field label="Managers">
          <div className="flex flex-wrap gap-2">
            {employees.map((u) => (
              <button
                key={u.id} type="button" onClick={() => toggle(u.id)} aria-pressed={managerIds.includes(u.id)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  managerIds.includes(u.id) ? 'border-brand bg-brand/10 text-on-tint-brand' : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {u.fullName}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
