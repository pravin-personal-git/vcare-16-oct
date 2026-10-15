'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, Segmented, StatusBadge } from '@/components/ui/Layout';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { useListParams } from '@/components/ui/useListParams';
import { TASK_STATUSES, TASK_PRIORITIES, type TaskStatus, type TaskPriority } from '@/lib/tasks';
import { saveTask, moveTask, removeTask, fetchAssignableUsers } from './actions';

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  createdByName: string | null;
  createdAt: string;
  completedAt: string | null;
  isOverdue: boolean;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });

const PRIORITY_TONE = { Low: 'neutral', Normal: 'brand', High: 'danger' } as const;

const STATUS_DOT_CLASS: Record<TaskStatus, string> = {
  Pending: 'bg-info', 'In Progress': 'bg-warning', Completed: 'bg-success', 'On Hold': 'bg-warning', Cancelled: 'bg-muted-foreground',
};

/**
 * Task Manager (F1 list standard, 26 Sep 2026). The server filters (search,
 * created date, person, status card) through server/tasks-list; this draws the
 * board or the list. Staff who don't hand out work open on "Assigned to me".
 */
export function TasksClient({
  tasks, counts, card, rangeLabel, people, layout, canEdit, canExport, views, isSingleStore, openTask = null, projectTasks = [],
  paging, total,
}: {
  /** List layout: one server-side page (F1b). Absent on the board. */
  paging?: ServerPaging;
  /** Tasks matching the filters, across all pages. */
  total?: number;
  /** F-04: the person's own open tasks inside HRM › Project. */
  projectTasks?: { id: string; title: string; status: string; endDate: string | null; projectId: string; projectTitle: string }[];
  tasks: TaskRow[];
  counts: Record<string, number>;
  card: string | null;
  rangeLabel: string;
  people: { id: string; fullName: string }[];
  layout: 'board' | 'list';
  canEdit: boolean;
  canExport: boolean;
  views: FilterBarViews;
  isSingleStore: boolean;
  /** From `?open=`, so a global-search hit opens the record itself. */
  openTask?: TaskRow | null;
}) {
  const router = useRouter();
  const list = useListParams();
  const [editing, setEditing] = useState<TaskRow | 'new' | null>(openTask);
  const [deleting, setDeleting] = useState<TaskRow | null>(null);
  const [busy, setBusy] = useState<string | boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<{ error?: string; ok?: boolean }>) {
    setBusy(key);
    setError(null);
    const res = await fn();
    if (res.error) setError(res.error);
    setBusy(false);
    router.refresh();
    return !res.error;
  }

  const cards: KpiCard[] = [
    { key: 'pending', label: 'Pending', count: counts.pending, icon: 'clock' },
    { key: 'in_progress', label: 'In progress', count: counts.in_progress, icon: 'refresh', tone: 'warning' },
    { key: 'on_hold', label: 'On hold', count: counts.on_hold, icon: 'pause' },
    { key: 'overdue', label: 'Overdue', count: counts.overdue, icon: 'alert-triangle', tone: counts.overdue ? 'danger' : 'default' },
    { key: 'completed', label: 'Completed', count: counts.completed, icon: 'check-circle', tone: 'success' },
    { key: 'cancelled', label: 'Cancelled', count: counts.cancelled, icon: 'ban' },
  ];

  const columns: Column<TaskRow>[] = [
    {
      key: 'title', header: 'Task', sortValue: (t) => t.title,
      render: (t) => (
        <button type="button" onClick={() => setEditing(t)} className="block max-w-[26rem] text-start">
          <span className="text-sm font-semibold hover:text-brand hover:underline">{t.title}</span>
          {t.description && <span className="line-clamp-1 block text-xs text-muted-foreground">{t.description}</span>}
        </button>
      ),
    },
    {
      key: 'status', header: 'Status', sortValue: (t) => t.status,
      render: (t) => (
        <div className="flex flex-wrap gap-1">
          <StatusBadge status={t.status} label={t.status} />
          {t.isOverdue && <StatusBadge status="overdue" />}
        </div>
      ),
    },
    { key: 'priority', header: 'Priority', sortValue: (t) => t.priority, render: (t) => <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge> },
    { key: 'assignee', header: 'Assigned to', sortValue: (t) => t.assignedToName, render: (t) => <span className="text-xs">{t.assignedToName ?? 'Unassigned'}</span> },
    { key: 'due', header: 'Due', sortValue: (t) => t.dueDate, render: (t) => <span className={`whitespace-nowrap text-xs ${t.isOverdue ? 'font-semibold text-danger' : ''}`}>{t.dueDate ? fmt(t.dueDate) : '-'}</span> },
    { key: 'createdBy', header: 'Given by', optional: true, sortValue: (t) => t.createdByName, render: (t) => <span className="text-xs">{t.createdByName ?? '-'}</span> },
    { key: 'createdAt', header: 'Created', optional: true, sortValue: (t) => t.createdAt, render: (t) => <span className="whitespace-nowrap text-xs">{fmt(t.createdAt)}</span> },
  ];

  const byStatus = (s: TaskStatus) => tasks.filter((t) => t.status === s);

  return (
    <div>
      <PageHeader
        badge="TM"
        title="Task Manager"
        subtitle="One-off work for people, tracked to done. Work inside a project lives in HRM › Project."
        actions={
          isSingleStore && canEdit ? (
            <Button variant="primary" iconEnd="user-plus" onClick={() => setEditing('new')}>+ Task</Button>
          ) : undefined
        }
      />

      {projectTasks.length > 0 && (
        <details className="mb-3 rounded-lg border border-border bg-card px-3 py-2">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Icon name="grid" className="h-4 w-4 text-brand" />
            Your tasks in projects ({projectTasks.length})
          </summary>
          <ul className="mt-2 divide-y divide-border text-sm">
            {projectTasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                <Link href={`/hrm/project/${t.projectId}`} className="font-medium text-brand hover:underline">{t.title}</Link>
                <span className="text-xs text-muted-foreground">{t.projectTitle}</span>
                <Badge tone={t.status === 'in_progress' ? 'info' : 'neutral'}>{t.status.replace(/_/g, ' ')}</Badge>
                {t.endDate && <span className="ms-auto text-xs text-muted-foreground">due {fmt(t.endDate)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}
      {!isSingleStore && (
        <Card className="mb-3 border-warning/40 bg-warning/10 p-3">
          <p className="text-sm"><strong>All Company</strong> is read-only. Select a single store to add or move a task.</p>
        </Card>
      )}

      <FilterBar
        searchPlaceholder="Task, details, person…"
        dates={{ defaultPreset: 'all', label: 'Created', activeLabel: rangeLabel }}
        people={{ label: 'Assigned to', options: people, defaultMine: !canEdit }}
        extra={
          <Segmented
            value={layout}
            onChange={(v) => list.set({ layout: v === 'board' ? null : v })}
            options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]}
          />
        }
        shown={total ?? tasks.length}
        clearKeys={['card']}
        exportScreen={canExport ? 'tasks' : null}
        views={views}
      />

      <KpiStrip cards={cards} activeKey={card} onSelect={(k) => list.set({ card: k })} columns={6} />

      {layout === 'board' ? (
        tasks.length === 0 ? (
          <Card className="p-0">
            <EmptyState icon="check-circle" title="No tasks match" hint="Try another person, a wider date range, or Clear all filters." />
          </Card>
        ) : (
          <div className="grid gap-3 overflow-x-auto pb-2 sm:grid-cols-2 lg:grid-cols-5">
            {TASK_STATUSES.map((status) => (
              <div key={status} className="min-w-[240px] rounded-lg border border-border bg-muted/20">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[status]}`} />
                  <p className="text-xs font-semibold">{status}</p>
                  <Badge tone="neutral" className="ms-auto">{byStatus(status).length}</Badge>
                </div>
                <div className="space-y-2 p-2">
                  {byStatus(status).map((t) => (
                    <TaskCard key={t.id} task={t} canEdit={canEdit} isSingleStore={isSingleStore} busy={busy}
                      onEdit={() => setEditing(t)} onDelete={() => setDeleting(t)}
                      onMove={(s) => act(`move-${t.id}`, () => moveTask(t.id, s))} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <DataGrid
          rows={tasks}
          server={paging}
          columns={columns}
          rowKey={(t) => t.id}
          emptyIcon="check-circle"
          emptyMessage="No tasks match"
          emptyHint="Try another person, a wider date range, or Clear all filters."
          actions={isSingleStore && canEdit ? [
            { label: 'Edit', icon: 'pencil', onSelect: (t) => setEditing(t) },
            ...TASK_STATUSES.map((s, i) => ({
              label: `Move to ${s}`, icon: 'refresh' as const, separatorBefore: i === 0,
              enabled: (t: TaskRow) => t.status !== s,
              onSelect: (t: TaskRow) => { void act(`move-${t.id}`, () => moveTask(t.id, s)); },
            })),
            { label: 'Delete', icon: 'trash', tone: 'danger', separatorBefore: true, onSelect: (t) => setDeleting(t) },
          ] : [{ label: 'Open', icon: 'external-link', onSelect: (t) => setEditing(t) }]}
          mobileCard={(t) => (
            <button type="button" onClick={() => setEditing(t)} className="block w-full text-start">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{t.title}</span>
                <StatusBadge status={t.isOverdue ? 'overdue' : t.status} label={t.isOverdue ? 'Overdue' : t.status} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t.assignedToName ?? 'Unassigned'}{t.dueDate && ` · due ${fmt(t.dueDate)}`} · {t.priority}
              </p>
            </button>
          )}
        />
      )}

      {editing && (
        <TaskForm
          task={editing === 'new' ? null : editing}
          busy={busy === 'save'}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const ok = await act('save', () => saveTask(editing === 'new' ? null : editing.id, input));
            if (ok) setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete task?"
          message={`"${deleting.title}" will be removed.`}
          confirmLabel="Delete"
          tone="danger"
          busy={busy === 'delete'}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const ok = await act('delete', () => removeTask(deleting.id));
            if (ok) setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function TaskCard({
  task, canEdit, isSingleStore, busy, onEdit, onDelete, onMove,
}: {
  task: TaskRow; canEdit: boolean; isSingleStore: boolean; busy: string | boolean;
  onEdit: () => void; onDelete: () => void; onMove: (s: TaskStatus) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium leading-snug">{task.title}</p>
        <Badge tone={PRIORITY_TONE[task.priority]} className="shrink-0">{task.priority}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {task.assignedToName ?? 'Unassigned'}
        {task.dueDate && ` · ${fmt(task.dueDate)}`}
        {task.isOverdue && <span className="ms-1 text-danger">Overdue</span>}
      </p>
      {isSingleStore && canEdit && (
        <div className="mt-2 flex items-center gap-1.5">
          <select
            value={task.status}
            disabled={busy === `move-${task.id}`}
            onChange={(e) => onMove(e.target.value as TaskStatus)}
            className="h-7 flex-1 rounded border border-border bg-background px-1.5 text-xs"
          >
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" onClick={onEdit} className="grid h-7 w-7 place-items-center rounded hover:bg-muted" title="Edit">
            <Icon name="chevron-right" className="h-3.5 w-3.5 rotate-45" />
          </button>
          <button type="button" onClick={onDelete} className="grid h-7 w-7 place-items-center rounded text-danger hover:bg-danger/10" title="Delete">
            <Icon name="x-circle" className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function TaskForm({
  task, busy, onClose, onSave,
}: {
  task: TaskRow | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: {
    title: string; description: string | null; priority: TaskPriority;
    dueDate: Date | null; assignedToId: string | null;
  }) => void;
}) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'Normal');
  const [dueDate, setDueDate] = useState(task?.dueDate?.slice(0, 10) ?? '');
  const [assignedToId, setAssignedToId] = useState(task?.assignedToId ?? '');
  const [users, setUsers] = useState<{ id: string; fullName: string }[]>([]);

  useEffect(() => {
    fetchAssignableUsers().then((res) => { if (res.data) setUsers(res.data); });
  }, []);

  return (
    <Modal
      title={task ? 'Edit task' : 'New task'}
      icon="check-circle"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!title.trim()}
            onClick={() => onSave({
              title: title.trim(),
              description: description.trim() || null,
              priority,
              dueDate: dueDate ? new Date(dueDate) : null,
              assignedToId: assignedToId || null,
            })}>
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" required htmlFor="tk-title" className="sm:col-span-2">
          <input id="tk-title" value={title} onChange={(e) => setTitle(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand" />
        </Field>
        <Field label="Description" htmlFor="tk-desc" className="sm:col-span-2">
          <textarea id="tk-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand" />
        </Field>
        <Field label="Priority" htmlFor="tk-priority">
          <select id="tk-priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand">
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Due date" htmlFor="tk-due">
          <input id="tk-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand" />
        </Field>
        <Field label="Assign to" htmlFor="tk-assignee" className="sm:col-span-2">
          <select id="tk-assignee" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand">
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
