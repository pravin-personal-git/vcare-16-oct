'use client';
import { EmployeeLink } from '@/components/document/EmployeeLink';
import { ListFilter } from '@/components/ui/ListFilter';

import { useState, useTransition } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import type { WorkTypeRow, ShiftRow, ShiftDayRow, EmployeeAssignmentRow } from '@/server/work-schedules';
import { WEEKDAY_LABELS } from '@/lib/weekdays';
import {
  saveWorkTypeAction, removeWorkTypeAction, saveShiftAction, removeShiftAction, assignEmployeeScheduleAction,
} from './actions';

interface Props {
  workTypes: WorkTypeRow[];
  shifts: ShiftRow[];
  assignments: EmployeeAssignmentRow[];
  scopeIsAll: boolean;
  canEdit: boolean;
}

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

export function WorkSchedulesClient({ workTypes, shifts, assignments, scopeIsAll, canEdit }: Props) {
  const [tab, setTab] = useState<'types' | 'shifts' | 'assignment'>('shifts');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const report = (res: { error?: string; message?: string }) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : res.message ?? null);
  };

  if (scopeIsAll) {
    return (
      <div>
        <PageHeader badge="WS" title="Work Schedules" subtitle="Shifts and work types" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="Shifts are configured per branch." />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader badge="WS" title="Work Schedules" subtitle="Named shifts, work types, and who's assigned to which" />

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

      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-1">
        {(['shifts', 'types', 'assignment'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`h-8 rounded-md px-3.5 text-sm font-medium transition ${
              tab === t ? 'bg-brand text-brand-fg' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {t === 'shifts' ? 'Shifts' : t === 'types' ? 'Work Types' : 'Employee Assignment'}
          </button>
        ))}
      </div>

      {tab === 'shifts' && <ShiftsTab shifts={shifts} canEdit={canEdit} report={report} />}
      {tab === 'types' && <WorkTypesTab workTypes={workTypes} canEdit={canEdit} report={report} />}
      {tab === 'assignment' && (
        <AssignmentTab assignments={assignments} shifts={shifts} workTypes={workTypes} canEdit={canEdit} report={report} />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------

function WorkTypesTab({
  workTypes, canEdit, report,
}: {
  workTypes: WorkTypeRow[];
  canEdit: boolean;
  report: (res: { error?: string; message?: string }) => void;
}) {
  const [editing, setEditing] = useState<WorkTypeRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<WorkTypeRow | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openEdit = (item: WorkTypeRow | 'new') => {
    setLabel(item === 'new' ? '' : item.label);
    setError(null);
    setEditing(item);
  };

  const save = () => {
    if (!label.trim()) { setError('Give this work type a label.'); return; }
    setError(null);
    startTransition(async () => {
      const res = await saveWorkTypeAction(editing === 'new' ? null : (editing as WorkTypeRow).id, label);
      if (res.error) setError(res.error);
      else { report(res); setEditing(null); }
    });
  };

  const remove = () => {
    if (!removing) return;
    startTransition(async () => {
      const res = await removeWorkTypeAction(removing.id);
      report(res);
      if (!res.error) setRemoving(null);
    });
  };

  return (
    <SectionCard
      title={`${workTypes.length} work type${workTypes.length === 1 ? '' : 's'}`}
      icon="tag"
      bodyClassName="p-0"
      action={canEdit && <Button size="sm" variant="primary" icon="plus" onClick={() => openEdit('new')}>Add type</Button>}
    >
      {workTypes.length === 0 ? (
        <EmptyState icon="tag" title="No work types yet" hint="Add Remote, On-site, or Hybrid - whatever this branch actually uses." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Label</th>
              <th className="px-4 py-2 font-medium">Status</th>
              {canEdit && <th className="px-4 py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {workTypes.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-2.5 font-medium">{t.label}</td>
                <td className="px-4 py-2.5"><Badge tone={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Active' : 'Inactive'}</Badge></td>
                {canEdit && (
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      <button type="button" onClick={() => openEdit(t)}
                        className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label={`Edit ${t.label}`}>
                        <Icon name="pencil" className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => setRemoving(t)}
                        className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition hover:bg-danger/10 hover:text-danger" aria-label={`Remove ${t.label}`}>
                        <Icon name="trash" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <Modal
          title={editing === 'new' ? 'Add a work type' : `Edit ${(editing as WorkTypeRow).label}`}
          icon="tag" size="sm" onClose={() => setEditing(null)}
          footer={<div className="flex justify-end gap-2"><Button onClick={() => setEditing(null)} disabled={pending}>Cancel</Button><Button variant="primary" loading={pending} onClick={save}>Save</Button></div>}
        >
          {error && <p className="mb-3 text-xs text-danger">{error}</p>}
          <Field label="Label" htmlFor="wt-label">
            <input id="wt-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Remote" className={input} />
          </Field>
        </Modal>
      )}

      {removing && (
        <ConfirmDialog
          title="Deactivate work type"
          message={`"${removing.label}" will no longer appear when assigning an employee. Anyone already assigned keeps it until changed.`}
          confirmLabel="Deactivate" tone="danger" busy={pending} onConfirm={remove} onClose={() => setRemoving(null)}
        />
      )}
    </SectionCard>
  );
}

// -------------------------------------------------------------------------

function blankSchedule(): ShiftDayRow[] {
  return [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    dayOfWeek, startTime: '09:30', endTime: '18:30', minWorkingMinutes: 495,
    isNightShift: false, autoPunchOutEnabled: false, autoPunchOutTime: null,
  }));
}

function ShiftsTab({
  shifts, canEdit, report,
}: {
  shifts: ShiftRow[];
  canEdit: boolean;
  report: (res: { error?: string; message?: string }) => void;
}) {
  const [editing, setEditing] = useState<ShiftRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<ShiftRow | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = () => {
    if (!removing) return;
    startTransition(async () => {
      const res = await removeShiftAction(removing.id);
      report(res);
      if (!res.error) setRemoving(null);
    });
  };

  return (
    <SectionCard
      title={`${shifts.length} shift${shifts.length === 1 ? '' : 's'}`}
      icon="clock"
      bodyClassName="p-0"
      action={canEdit && <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing('new')}>Add shift</Button>}
    >
      {shifts.length === 0 ? (
        <EmptyState icon="clock" title="No shifts yet" hint="Add Day Shift, Night Shift - whatever this branch actually runs." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Label</th>
              <th className="px-4 py-2 font-medium">Runs</th>
              <th className="px-4 py-2 font-medium">Status</th>
              {canEdit && <th className="px-4 py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shifts.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2.5 font-medium">{s.label}</td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {s.schedule.length === 0 ? '-' : s.schedule.map((d) => WEEKDAY_LABELS[d.dayOfWeek].slice(0, 3)).join(', ')}
                </td>
                <td className="px-4 py-2.5"><Badge tone={s.isActive ? 'success' : 'neutral'}>{s.isActive ? 'Active' : 'Inactive'}</Badge></td>
                {canEdit && (
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setEditing(s)}
                        className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label={`Edit ${s.label}`}>
                        <Icon name="pencil" className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => setRemoving(s)}
                        className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition hover:bg-danger/10 hover:text-danger" aria-label={`Remove ${s.label}`}>
                        <Icon name="trash" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <ShiftModal
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(res) => { report(res); if (!res.error) setEditing(null); }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Deactivate shift"
          message={`"${removing.label}" will no longer appear when assigning an employee. Anyone already assigned keeps it until changed.`}
          confirmLabel="Deactivate" tone="danger" busy={pending} onConfirm={remove} onClose={() => setRemoving(null)}
        />
      )}
    </SectionCard>
  );
}

function ShiftModal({
  item, onClose, onSaved,
}: {
  item: ShiftRow | null;
  onClose: () => void;
  onSaved: (res: { error?: string; message?: string }) => void;
}) {
  const [label, setLabel] = useState(item?.label ?? '');
  const [days, setDays] = useState<Map<number, ShiftDayRow>>(
    new Map((item?.schedule ?? blankSchedule()).map((d) => [d.dayOfWeek, d])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleDay = (dayOfWeek: number) => {
    const next = new Map(days);
    if (next.has(dayOfWeek)) next.delete(dayOfWeek);
    else next.set(dayOfWeek, { dayOfWeek, startTime: '09:30', endTime: '18:30', minWorkingMinutes: 495, isNightShift: false, autoPunchOutEnabled: false, autoPunchOutTime: null });
    setDays(next);
  };

  const updateDay = (dayOfWeek: number, patch: Partial<ShiftDayRow>) => {
    const existing = days.get(dayOfWeek);
    if (!existing) return;
    setDays(new Map(days).set(dayOfWeek, { ...existing, ...patch }));
  };

  const save = () => {
    if (!label.trim()) { setError('Give this shift a label.'); return; }
    setError(null);
    startTransition(async () => {
      const res = await saveShiftAction(item?.id ?? null, label.trim(), [...days.values()].sort((a, b) => a.dayOfWeek - b.dayOfWeek));
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title={item ? `Edit ${item.label}` : 'Add a shift'}
      icon="clock" size="md" onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose} disabled={pending}>Cancel</Button><Button variant="primary" loading={pending} onClick={save}>Save</Button></div>}
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <Field label="Label" htmlFor="shift-label" hint="Day Shift, Night Shift, Weekend On-call.">
        <input id="shift-label" value={label} onChange={(e) => setLabel(e.target.value)} className={input} />
      </Field>

      <p className="mb-1.5 mt-3 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
        Which days this shift runs
      </p>
      <div className="grid gap-2">
        {WEEKDAY_LABELS.map((weekday, dayOfWeek) => {
          const day = days.get(dayOfWeek);
          return (
            <div key={dayOfWeek} className="rounded-lg border border-border p-2.5">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={!!day} onChange={() => toggleDay(dayOfWeek)} className="h-4 w-4 rounded border-border" />
                {weekday}
              </label>
              {day && (
                <div className="mt-2 grid grid-cols-2 gap-2 ps-6 sm:grid-cols-4">
                  <input type="time" value={day.startTime} onChange={(e) => updateDay(dayOfWeek, { startTime: e.target.value })} className={input} />
                  <input type="time" value={day.endTime} onChange={(e) => updateDay(dayOfWeek, { endTime: e.target.value })} className={input} />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" checked={day.isNightShift} onChange={(e) => updateDay(dayOfWeek, { isNightShift: e.target.checked })} className="h-3.5 w-3.5 rounded border-border" />
                    Night shift
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input type="checkbox" checked={day.autoPunchOutEnabled}
                      onChange={(e) => updateDay(dayOfWeek, { autoPunchOutEnabled: e.target.checked, autoPunchOutTime: e.target.checked ? (day.autoPunchOutTime ?? day.endTime) : null })}
                      className="h-3.5 w-3.5 rounded border-border" />
                    Auto check-out
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------------

function AssignmentTab({
  assignments, shifts, workTypes, canEdit, report,
}: {
  assignments: EmployeeAssignmentRow[];
  shifts: ShiftRow[];
  workTypes: WorkTypeRow[];
  canEdit: boolean;
  report: (res: { error?: string; message?: string }) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const save = (userId: string, shiftId: string | null, workTypeId: string | null) => {
    setSavingUserId(userId);
    startTransition(async () => {
      const res = await assignEmployeeScheduleAction(userId, shiftId, workTypeId);
      report(res);
      setSavingUserId(null);
    });
  };

  return (
    <SectionCard title={`${assignments.length} ${assignments.length === 1 ? 'person' : 'people'}`} icon="users" bodyClassName="p-0">
      {assignments.length === 0 ? (
        <EmptyState icon="users" title="Nobody has access to this branch yet" />
      ) : (
        /* Only this table gets a filter (F1b / D17). The work-type and shift
           tables above hold a handful of rows each - a search box over four
           items is furniture, not a feature. This one is every person in the
           branch, and "who is still unassigned" is the reason it gets opened. */
        <ListFilter
          rows={assignments}
          noun="people"
          placeholder="Employee name…"
          searchOn={(a) => [a.userName]}
          chipOf={(a) => (a.shiftId && a.workTypeId ? 'assigned' : 'unassigned')}
          chipLabel="Assignment"
          chips={[
            { value: 'unassigned', label: 'Not fully assigned', count: assignments.filter((a) => !a.shiftId || !a.workTypeId).length },
            { value: 'assigned', label: 'Assigned', count: assignments.filter((a) => a.shiftId && a.workTypeId).length },
          ]}
        >
          {(shown) => (shown.length === 0 ? (
            <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see everyone." />
          ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Employee</th>
              <th className="px-4 py-2 font-medium">Shift</th>
              <th className="px-4 py-2 font-medium">Work Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((a) => (
              <tr key={a.userId}>
                <td className="px-4 py-2.5 font-medium"><EmployeeLink id={a.userId}>{a.userName}</EmployeeLink></td>
                <td className="px-4 py-2.5">
                  <select
                    disabled={!canEdit || (pending && savingUserId === a.userId)}
                    value={a.shiftId ?? ''}
                    onChange={(e) => save(a.userId, e.target.value || null, a.workTypeId)}
                    className={input}
                  >
                    <option value="">Unassigned</option>
                    {shifts.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2.5">
                  <select
                    disabled={!canEdit || (pending && savingUserId === a.userId)}
                    value={a.workTypeId ?? ''}
                    onChange={(e) => save(a.userId, a.shiftId, e.target.value || null)}
                    className={input}
                  >
                    <option value="">Unassigned</option>
                    {workTypes.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
          ))}
        </ListFilter>
      )}
    </SectionCard>
  );
}
