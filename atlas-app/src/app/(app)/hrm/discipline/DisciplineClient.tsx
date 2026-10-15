'use client';
import { EmployeeLink } from '@/components/document/EmployeeLink';
import { ListFilter } from '@/components/ui/ListFilter';

import { useState, useTransition } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import type { ActionTypeRow, DisciplinaryActionRow, ActionKind } from '@/server/discipline';
import { saveActionTypeAction, removeActionTypeAction, createDisciplinaryActionAction } from './actions';
import { newestFirst, oldestFirst, type CardListPage } from '@/lib/card-list';

interface ActionRowVM extends Omit<DisciplinaryActionRow, 'startDate' | 'createdAt'> {
  startDate: string;
  createdAt: string;
}

interface Props {
  listPage: CardListPage;
  actionTypes: ActionTypeRow[];
  actions: ActionRowVM[];
  employees: { id: string; fullName: string }[];
  scopeIsAll: boolean;
  canEdit: boolean;
}

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

const KIND_LABEL: Record<ActionKind, string> = { warning: 'Warning', suspension: 'Suspension', dismissal: 'Dismissal' };
const KIND_TONE: Record<ActionKind, 'warning' | 'danger'> = { warning: 'warning', suspension: 'danger', dismissal: 'danger' };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function DisciplineClient({ actionTypes, actions, employees, scopeIsAll, canEdit, listPage }: Props) {
  const [tab, setTab] = useState<'records' | 'types'>('records');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const report = (res: { error?: string; message?: string }) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : res.message ?? null);
  };

  if (scopeIsAll) {
    return (
      <div>
        <PageHeader badge="D" title="Policies & Discipline" subtitle="Warnings, suspensions and dismissals" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="Disciplinary records are kept per branch." />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader badge="D" title="Policies & Discipline" subtitle="Warnings, suspensions and dismissals - see Common Hub's Terms & Policy for policy documents" />

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
        {(['records', 'types'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`h-8 rounded-md px-3.5 text-sm font-medium transition ${
              tab === t ? 'bg-brand text-brand-fg' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {t === 'records' ? 'Records' : 'Action Types'}
          </button>
        ))}
      </div>

      {tab === 'records'
        ? <RecordsTab listPage={listPage} actions={actions} actionTypes={actionTypes} employees={employees} canEdit={canEdit} report={report} />
        : <ActionTypesTab actionTypes={actionTypes} canEdit={canEdit} report={report} />}
    </div>
  );
}

// -------------------------------------------------------------------------

function RecordsTab({
  actions, actionTypes, employees, canEdit, report, listPage,
}: {
  listPage: CardListPage;
  actions: ActionRowVM[];
  actionTypes: ActionTypeRow[];
  employees: { id: string; fullName: string }[];
  canEdit: boolean;
  report: (res: { error?: string; message?: string }) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <SectionCard
      title={`${listPage.total} record${listPage.total === 1 ? '' : 's'}`}
      icon="alert-triangle"
      bodyClassName="p-0"
      action={canEdit && (
        <Button
          size="sm" variant="primary" icon="plus"
          disabled={actionTypes.length === 0}
          title={actionTypes.length === 0 ? 'Add an action type first' : undefined}
          onClick={() => setAdding(true)}
        >
          Add record
        </Button>
      )}
    >
      {listPage.total === 0 ? (
        <EmptyState icon="alert-triangle" title="No disciplinary records" hint="Nothing has been logged for this branch." />
      ) : (
        <ListFilter
          server={listPage.server}
          exportScreen="discipline"
          rows={actions}
          // Date filter and sort (9 Oct 2026) - same keys as server/card-lists.
          dates={[{ key: 'from', label: 'Starts on', of: (r) => r.startDate }, { key: 'rec', label: 'Recorded on', of: (r) => r.createdAt }]}
          sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.startDate) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.startDate) }]}
          noun="records"
          placeholder="Employee, action, what happened…"
          searchOn={(a) => [a.userName, a.actionTypeTitle, a.description]}
          chipOf={(a) => (a.isCurrentlyBlocking ? 'blocking' : 'other')}
          chipLabel="Status"
          chips={[
            { value: 'blocking', label: 'Login blocked', count: listPage.chipCounts.blocking ?? 0 },
            { value: 'other', label: 'Not blocking', count: listPage.chipCounts.other ?? 0 },
          ]}
        >
          {(shown) => (shown.length === 0 ? (
            <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every record." />
          ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Employee</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Start</th>
              <th className="px-4 py-2 font-medium">Duration</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-2.5"><EmployeeLink id={a.userId}>{a.userName}</EmployeeLink></td>
                <td className="px-4 py-2.5">
                  <Badge tone={KIND_TONE[a.actionKind]}>{a.actionTypeTitle}</Badge>
                  <p className="mt-1 max-w-xs truncate text-xs text-muted-foreground">{a.description}</p>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(a.startDate)}</td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {a.durationDays !== null ? `${a.durationDays} day${a.durationDays === 1 ? '' : 's'}` : 'No end date'}
                </td>
                <td className="px-4 py-2.5">
                  {a.isCurrentlyBlocking
                    ? <Badge tone="danger" icon="lock">Login blocked</Badge>
                    : <span className="text-xs text-muted-foreground">-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
          ))}
        </ListFilter>
      )}

      {adding && (
        <AddRecordModal
          actionTypes={actionTypes}
          employees={employees}
          onClose={() => setAdding(false)}
          onSaved={(res) => { report(res); if (!res.error) setAdding(false); }}
        />
      )}
    </SectionCard>
  );
}

function AddRecordModal({
  actionTypes, employees, onClose, onSaved,
}: {
  actionTypes: ActionTypeRow[];
  employees: { id: string; fullName: string }[];
  onClose: () => void;
  onSaved: (res: { error?: string; message?: string }) => void;
}) {
  const [userId, setUserId] = useState(employees[0]?.id ?? '');
  const [actionTypeId, setActionTypeId] = useState(actionTypes.find((t) => t.isActive)?.id ?? '');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [duration, setDuration] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!userId || !actionTypeId || !description.trim()) {
      setError('Choose an employee and action type, and describe what happened.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createDisciplinaryActionAction({
        userId, actionTypeId, description: description.trim(), startDate,
        durationDays: duration.trim() ? Number(duration) : null,
      });
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title="Add a disciplinary record"
      icon="alert-triangle"
      size="sm"
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
        <Field label="Employee" htmlFor="da-user">
          <select id="da-user" value={userId} onChange={(e) => setUserId(e.target.value)} className={input}>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
          </select>
        </Field>
        <Field label="Action type" htmlFor="da-type">
          <select id="da-type" value={actionTypeId} onChange={(e) => setActionTypeId(e.target.value)} className={input}>
            {actionTypes.filter((t) => t.isActive).map((t) => (
              <option key={t.id} value={t.id}>{t.title} ({KIND_LABEL[t.actionKind]})</option>
            ))}
          </select>
        </Field>
        <Field label="Description" htmlFor="da-desc">
          <textarea id="da-desc" value={description} onChange={(e) => setDescription(e.target.value)}
            rows={3} className={`${input} h-auto py-2`} placeholder="What happened, and what was decided." />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" htmlFor="da-start">
            <input id="da-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={input} />
          </Field>
          <Field label="Duration (days)" htmlFor="da-duration" hint="Blank = no defined end.">
            <input id="da-duration" type="number" min={1} max={365} value={duration}
              onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 7" className={input} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------------

function ActionTypesTab({
  actionTypes, canEdit, report,
}: {
  actionTypes: ActionTypeRow[];
  canEdit: boolean;
  report: (res: { error?: string; message?: string }) => void;
}) {
  const [editing, setEditing] = useState<ActionTypeRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<ActionTypeRow | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = () => {
    if (!removing) return;
    startTransition(async () => {
      const res = await removeActionTypeAction(removing.id);
      report(res);
      if (!res.error) setRemoving(null);
    });
  };

  return (
    <SectionCard
      title={`${actionTypes.length} action type${actionTypes.length === 1 ? '' : 's'}`}
      icon="settings"
      bodyClassName="p-0"
      action={canEdit && (
        <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing('new')}>Add type</Button>
      )}
    >
      {actionTypes.length === 0 ? (
        <EmptyState
          icon="settings"
          title="No action types yet"
          hint="Add Warning, Suspension or Dismissal - whatever categories this branch actually uses."
        />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Kind</th>
              <th className="px-4 py-2 font-medium">Blocks login</th>
              <th className="px-4 py-2 font-medium">Status</th>
              {canEdit && <th className="px-4 py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {actionTypes.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-2.5 font-medium">{t.title}</td>
                <td className="px-4 py-2.5"><Badge tone={KIND_TONE[t.actionKind]}>{KIND_LABEL[t.actionKind]}</Badge></td>
                <td className="px-4 py-2.5">
                  {t.blockLogin ? <Badge tone="danger" icon="lock">Yes</Badge> : <span className="text-muted-foreground">No</span>}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
                </td>
                {canEdit && (
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setEditing(t)}
                        className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        aria-label={`Edit ${t.title}`}>
                        <Icon name="pencil" className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => setRemoving(t)}
                        className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition hover:bg-danger/10 hover:text-danger"
                        aria-label={`Remove ${t.title}`}>
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
        <ActionTypeModal
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(res) => { report(res); if (!res.error) setEditing(null); }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Deactivate action type"
          message={`"${removing.title}" will no longer appear when adding a new record. Past records that already reference it are unaffected.`}
          confirmLabel="Deactivate"
          tone="danger"
          busy={pending}
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </SectionCard>
  );
}

function ActionTypeModal({
  item, onClose, onSaved,
}: {
  item: ActionTypeRow | null;
  onClose: () => void;
  onSaved: (res: { error?: string; message?: string }) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [actionKind, setActionKind] = useState<ActionKind>(item?.actionKind ?? 'warning');
  const [blockLogin, setBlockLogin] = useState(item?.blockLogin ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!title.trim()) {
      setError('Give this action type a title.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await saveActionTypeAction(item?.id ?? null, { title: title.trim(), actionKind, blockLogin });
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title={item ? `Edit ${item.title}` : 'Add an action type'}
      icon="settings"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>{item ? 'Save' : 'Add'}</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="grid gap-3">
        <Field label="Title" htmlFor="at-title" hint="Shown when logging a record - e.g. First Warning, Unpaid Suspension.">
          <input id="at-title" value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </Field>
        <Field label="Kind" htmlFor="at-kind">
          <select id="at-kind" value={actionKind} onChange={(e) => setActionKind(e.target.value as ActionKind)} className={input}>
            <option value="warning">Warning</option>
            <option value="suspension">Suspension</option>
            <option value="dismissal">Dismissal</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={blockLogin} onChange={(e) => setBlockLogin(e.target.checked)}
            className="h-4 w-4 rounded border-border" />
          Block the employee&apos;s login while a record of this type is active
        </label>
      </div>
    </Modal>
  );
}
