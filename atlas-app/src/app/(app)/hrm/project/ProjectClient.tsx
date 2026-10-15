'use client';
import { EmployeeLink } from '@/components/document/EmployeeLink';
import { ListFilter } from '@/components/ui/ListFilter';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Badge, Field, PageHeader, SectionCard, EmptyState, Segmented, type BadgeTone } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { createProjectAction, logTimesheetAction } from './actions';

interface ProjectRowVM {
  id: string; title: string; description: string; status: string;
  startDate: string; endDate: string | null;
  managers: { id: string; fullName: string }[];
  taskCount: number; completedTaskCount: number; createdAt: string;
}
interface TaskRowVM {
  id: string; projectId: string; projectTitle: string; stageId: string; stageTitle: string;
  title: string; status: string; endDate: string | null; members: { id: string; fullName: string }[];
}
interface TimesheetRowVM {
  id: string; projectId: string; projectTitle: string; taskId: string | null; taskTitle: string | null;
  userId: string; userName: string; date: string; minutesSpent: number; status: string; description: string;
}

interface Props {
  projects: ProjectRowVM[];
  tasks: TaskRowVM[];
  timesheets: TimesheetRowVM[];
  employees: { id: string; fullName: string }[];
  canManage: boolean;
}

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

const STATUS_TONE: Record<string, BadgeTone> = {
  new: 'neutral', in_progress: 'info', completed: 'success', on_hold: 'warning', cancelled: 'danger', expired: 'danger',
  to_do: 'neutral',
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

const fmtHours = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

const TASK_STATUS_COLUMNS = [
  { key: 'to_do', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'expired', label: 'Expired' },
];

export function ProjectClient({ projects, tasks, timesheets, employees, canManage }: Props) {
  const [tab, setTab] = useState<'dashboard' | 'projects' | 'tasks' | 'timesheet'>('dashboard');
  const [creating, setCreating] = useState(false);
  const [logging, setLogging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const report = (res: { error?: string }, okMessage: string) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : okMessage);
  };

  const activeProjects = projects.filter((p) => p.status === 'in_progress' || p.status === 'new');
  const tasksInProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const thisMonthMinutes = timesheets
    .filter((t) => new Date(t.date).getMonth() === new Date().getMonth())
    .reduce((sum, t) => sum + t.minutesSpent, 0);

  return (
    <div>
      <PageHeader
        badge="PR"
        title="Project"
        subtitle="Projects with stages, tasks and timesheets. Each person also sees their project tasks in Task Manager."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" icon="clock" onClick={() => setLogging(true)}>Log time</Button>
            {canManage && <Button size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>New project</Button>}
          </div>
        }
      />

      {error && (
        <div className="mb-3 flex gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className="mb-3 flex gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-on-tint-success">
          <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="mb-4">
        <Segmented
          options={[
            { value: 'dashboard', label: 'Dashboard' },
            { value: 'projects', label: `Projects (${projects.length})` },
            { value: 'tasks', label: `Tasks (${tasks.length})` },
            { value: 'timesheet', label: 'Timesheet' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'dashboard' && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SectionCard title="Active projects" icon="grid" bodyClassName="p-4">
              <p className="text-2xl font-bold">{activeProjects.length}</p>
            </SectionCard>
            <SectionCard title="Tasks in progress" icon="check-circle" bodyClassName="p-4">
              <p className="text-2xl font-bold">{tasksInProgress}</p>
            </SectionCard>
            <SectionCard title="Hours logged this month" icon="clock" bodyClassName="p-4">
              <p className="text-2xl font-bold">{fmtHours(thisMonthMinutes)}</p>
            </SectionCard>
          </div>
          <SectionCard title="Active projects" icon="grid" bodyClassName="p-0">
            {activeProjects.length === 0 ? (
              <EmptyState icon="grid" title="No active projects" />
            ) : (
              <div className="divide-y divide-border">
                {activeProjects.map((p) => (
                  <Link key={p.id} href={`/hrm/project/${p.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{p.title}</p>
                      <p className="text-xs text-muted-foreground">{p.completedTaskCount}/{p.taskCount} tasks complete</p>
                    </div>
                    <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status.replace('_', ' ')}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}

      {tab === 'projects' && (
        <SectionCard title={`${projects.length} project${projects.length === 1 ? '' : 's'}`} icon="grid" bodyClassName="p-0">
          {projects.length === 0 ? (
            <EmptyState icon="grid" title="No projects yet" hint="Create one to start tracking work against it." />
          ) : (
            /* F1b / D17. Searches the manager's name too - "what is Prachi
               running" is as common a question as finding a project by title. */
            <ListFilter
              exportAs={{ title: 'Projects', columns: [{ header: 'Project', value: (r) => r.title }, { header: 'Status', value: (r) => r.status }, { header: 'Start', value: (r) => r.startDate ? r.startDate.slice(0, 10) : '' }, { header: 'End', value: (r) => r.endDate ? r.endDate.slice(0, 10) : '' }, { header: 'Managers', value: (r) => r.managers.map((m) => m.fullName).join(', ') }, { header: 'Tasks done', value: (r) => `${r.completedTaskCount} of ${r.taskCount}` }] }}
              rows={projects}
              noun="projects"
              placeholder="Project, description, manager…"
              searchOn={(p) => [p.title, p.description, ...p.managers.map((m) => m.fullName)]}
              chipOf={(p) => p.status}
              chipLabel="Status"
              chips={[...new Set(projects.map((p) => p.status))].sort().map((s) => ({
                value: s, label: s, count: projects.filter((p) => p.status === s).length,
              }))}
            >
              {(shown) => (shown.length === 0 ? (
                <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every project." />
              ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Project</th>
                  <th className="px-4 py-2 font-medium">Managers</th>
                  <th className="px-4 py-2 font-medium">Tasks</th>
                  <th className="px-4 py-2 font-medium">Dates</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/hrm/project/${p.id}`} className="font-medium text-brand hover:underline">{p.title}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.managers.map((m) => m.fullName).join(', ') || '-'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.completedTaskCount}/{p.taskCount}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(p.startDate)}{p.endDate ? ` - ${fmtDate(p.endDate)}` : ''}</td>
                    <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status.replace('_', ' ')}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
              ))}
            </ListFilter>
          )}
        </SectionCard>
      )}

      {tab === 'tasks' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TASK_STATUS_COLUMNS.map((col) => {
            const items = tasks.filter((t) => t.status === col.key);
            return (
              <div key={col.key} className="flex flex-col rounded-lg border border-border bg-muted/30">
                <div className="flex items-center justify-between rounded-t-lg border-b border-border bg-card px-3 py-2">
                  <span className="text-xs font-semibold">{col.label}</span>
                  <Badge tone="neutral">{items.length}</Badge>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-2">
                  {items.length === 0 ? (
                    <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nothing here</p>
                  ) : (
                    items.map((t) => (
                      <Link key={t.id} href={`/hrm/project/${t.projectId}`} className="block rounded-lg border border-border bg-card p-2.5 shadow-card transition hover:border-brand/40">
                        <p className="truncate text-sm font-semibold">{t.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{t.projectTitle} · {t.stageTitle}</p>
                        {t.members.length > 0 && <p className="mt-1 truncate text-xs text-muted-foreground">{t.members.map((m) => m.fullName).join(', ')}</p>}
                      </Link>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'timesheet' && (
        <SectionCard title={`${timesheets.length} entr${timesheets.length === 1 ? 'y' : 'ies'}`} icon="clock" bodyClassName="p-0">
          {timesheets.length === 0 ? (
            <EmptyState icon="clock" title="No time logged yet" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-4 py-2 font-medium">Project / Task</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Duration</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {timesheets.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2.5 font-medium"><EmployeeLink id={t.userId}>{t.userName}</EmployeeLink></td>
                    <td className="px-4 py-2.5">
                      {t.projectTitle}{t.taskTitle ? ` / ${t.taskTitle}` : ''}
                      <p className="text-xs text-muted-foreground">{t.description}</p>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(t.date)}</td>
                    <td className="px-4 py-2.5">{fmtHours(t.minutesSpent)}</td>
                    <td className="px-4 py-2.5"><Badge tone={t.status === 'completed' ? 'success' : 'info'}>{t.status.replace('_', ' ')}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {creating && (
        <CreateProjectModal
          employees={employees}
          onClose={() => setCreating(false)}
          onSaved={(res) => { report(res, 'Project created.'); if (!res.error) setCreating(false); }}
        />
      )}
      {logging && (
        <LogTimeModal
          projects={projects}
          tasks={tasks}
          onClose={() => setLogging(false)}
          onSaved={(res) => { report(res, 'Time logged.'); if (!res.error) setLogging(false); }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------

function CreateProjectModal({
  employees, onClose, onSaved,
}: {
  employees: { id: string; fullName: string }[];
  onClose: () => void;
  onSaved: (res: { error?: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [managerIds, setManagerIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleManager = (id: string) =>
    setManagerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = () => {
    if (!title.trim()) { setError('Project title is required.'); return; }
    setError(null);
    startTransition(async () => {
      const res = await createProjectAction({
        title: title.trim(), description: description.trim(), startDate,
        endDate: endDate || null, managerUserIds: managerIds,
      });
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title="New project"
      icon="grid"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>Create</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="grid gap-3">
        <Field label="Title" htmlFor="pj-title">
          <input id="pj-title" value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </Field>
        <Field label="Description" htmlFor="pj-desc" hint="Optional.">
          <textarea id="pj-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${input} h-auto py-2`} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" htmlFor="pj-start">
            <input id="pj-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={input} />
          </Field>
          <Field label="End date" htmlFor="pj-end" hint="Optional.">
            <input id="pj-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={input} />
          </Field>
        </div>
        <Field label="Managers" hint="Optional - pick one or more.">
          <div className="flex flex-wrap gap-2">
            {employees.map((u) => (
              <button
                key={u.id} type="button" onClick={() => toggleManager(u.id)}
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

function LogTimeModal({
  projects, tasks, onClose, onSaved,
}: {
  projects: ProjectRowVM[];
  tasks: TaskRowVM[];
  onClose: () => void;
  onSaved: (res: { error?: string }) => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [taskId, setTaskId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const projectTasks = tasks.filter((t) => t.projectId === projectId);

  const save = () => {
    const minutesSpent = Number(hours || 0) * 60 + Number(minutes || 0);
    if (!projectId || minutesSpent <= 0 || !description.trim()) {
      setError('Choose a project, a duration greater than zero, and describe the work.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await logTimesheetAction({
        projectId, taskId: taskId || null, date, minutesSpent, description: description.trim(),
      });
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title="Log time"
      icon="clock"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>Log</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="grid gap-3">
        <Field label="Project" htmlFor="ts-project">
          <select id="ts-project" value={projectId} onChange={(e) => { setProjectId(e.target.value); setTaskId(''); }} className={input}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </Field>
        <Field label="Task" htmlFor="ts-task" hint="Optional - logged against the project itself if left blank.">
          <select id="ts-task" value={taskId} onChange={(e) => setTaskId(e.target.value)} className={input}>
            <option value="">No specific task</option>
            {projectTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date" htmlFor="ts-date" className="col-span-1">
            <input id="ts-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          </Field>
          <Field label="Hours" htmlFor="ts-hours">
            <input id="ts-hours" type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} className={input} />
          </Field>
          <Field label="Minutes" htmlFor="ts-minutes">
            <input id="ts-minutes" type="number" min={0} max={59} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={input} />
          </Field>
        </div>
        <Field label="Description" htmlFor="ts-desc">
          <textarea id="ts-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${input} h-auto py-2`} />
        </Field>
      </div>
    </Modal>
  );
}
