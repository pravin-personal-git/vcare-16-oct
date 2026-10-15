'use client';

import { EmployeeLink } from '@/components/document/EmployeeLink';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import type { EmployeeTypeRow, EmployeeTagRow, EmployeeConfigAssignmentRow } from '@/server/employee-config';
import { TAG_COLOR_TOKENS, type TagColorToken } from '@/lib/tag-colors';
import {
  saveEmployeeTypeAction, removeEmployeeTypeAction, saveEmployeeTagAction, removeEmployeeTagAction,
  assignEmployeeConfigAction,
} from './actions';

/** Static, literal Tailwind classes per token - Tailwind can only detect classes it can see as text, never a `bg-${x}` interpolation. */
const SWATCH_BG: Record<TagColorToken, string> = {
  brand: 'bg-brand', navy: 'bg-navy', accent: 'bg-accent',
  success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info',
};

function TagSwatch({ color, className = 'h-2 w-2' }: { color: string; className?: string }) {
  const cls = SWATCH_BG[color as TagColorToken] ?? SWATCH_BG.brand;
  return <span className={`inline-block shrink-0 rounded-full ${cls} ${className}`} />;
}

interface Props {
  employeeTypes: EmployeeTypeRow[];
  employeeTags: EmployeeTagRow[];
  assignments: EmployeeConfigAssignmentRow[];
  scopeIsAll: boolean;
  canEdit: boolean;
}

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

export function EmployeeConfigClient({ employeeTypes, employeeTags, assignments, scopeIsAll, canEdit }: Props) {
  const [tab, setTab] = useState<'assignment' | 'types' | 'tags'>('assignment');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const report = (res: { error?: string; message?: string }) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : res.message ?? null);
  };

  if (scopeIsAll) {
    return (
      <div>
        <PageHeader badge="EC" title="Employee Configuration" subtitle="Employee types and tags" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="Employee configuration is set per branch." />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader badge="EC" title="Employee Configuration" subtitle="Descriptive employee types and tags - for display, not pay or eligibility rules" />

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
        {(['assignment', 'types', 'tags'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`h-8 rounded-md px-3.5 text-sm font-medium transition ${
              tab === t ? 'bg-brand text-brand-fg' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {t === 'assignment' ? 'Employee Assignment' : t === 'types' ? 'Employee Types' : 'Employee Tags'}
          </button>
        ))}
      </div>

      {tab === 'assignment' && (
        <AssignmentTab assignments={assignments} employeeTypes={employeeTypes} employeeTags={employeeTags} canEdit={canEdit} report={report} />
      )}
      {tab === 'types' && <EmployeeTypesTab employeeTypes={employeeTypes} canEdit={canEdit} report={report} />}
      {tab === 'tags' && <EmployeeTagsTab employeeTags={employeeTags} canEdit={canEdit} report={report} />}
    </div>
  );
}

// -------------------------------------------------------------------------

function EmployeeTypesTab({
  employeeTypes, canEdit, report,
}: {
  employeeTypes: EmployeeTypeRow[];
  canEdit: boolean;
  report: (res: { error?: string; message?: string }) => void;
}) {
  const [editing, setEditing] = useState<EmployeeTypeRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<EmployeeTypeRow | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openEdit = (item: EmployeeTypeRow | 'new') => {
    setLabel(item === 'new' ? '' : item.label);
    setError(null);
    setEditing(item);
  };

  const save = () => {
    if (!label.trim()) { setError('Give this employee type a label.'); return; }
    setError(null);
    startTransition(async () => {
      const res = await saveEmployeeTypeAction(editing === 'new' ? null : (editing as EmployeeTypeRow).id, label);
      if (res.error) setError(res.error);
      else { report(res); setEditing(null); }
    });
  };

  const remove = () => {
    if (!removing) return;
    startTransition(async () => {
      const res = await removeEmployeeTypeAction(removing.id);
      report(res);
      if (!res.error) setRemoving(null);
    });
  };

  return (
    <SectionCard
      title={`${employeeTypes.length} employee type${employeeTypes.length === 1 ? '' : 's'}`}
      icon="tag"
      bodyClassName="p-0"
      action={canEdit && <Button size="sm" variant="primary" icon="plus" onClick={() => openEdit('new')}>Add type</Button>}
    >
      {employeeTypes.length === 0 ? (
        <EmptyState icon="tag" title="No employee types yet" hint="Add Full-Time Contractor, Seasonal - whatever this branch actually uses." />
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
            {employeeTypes.map((t) => (
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
          title={editing === 'new' ? 'Add an employee type' : `Edit ${(editing as EmployeeTypeRow).label}`}
          icon="tag" size="sm" onClose={() => setEditing(null)}
          footer={<div className="flex justify-end gap-2"><Button onClick={() => setEditing(null)} disabled={pending}>Cancel</Button><Button variant="primary" loading={pending} onClick={save}>Save</Button></div>}
        >
          {error && <p className="mb-3 text-xs text-danger">{error}</p>}
          <Field label="Label" htmlFor="et-label">
            <input id="et-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Full-Time Contractor" className={input} />
          </Field>
        </Modal>
      )}

      {removing && (
        <ConfirmDialog
          title="Deactivate employee type"
          message={`"${removing.label}" will no longer appear when assigning an employee. Anyone already assigned keeps it until changed.`}
          confirmLabel="Deactivate" tone="danger" busy={pending} onConfirm={remove} onClose={() => setRemoving(null)}
        />
      )}
    </SectionCard>
  );
}

// -------------------------------------------------------------------------

function EmployeeTagsTab({
  employeeTags, canEdit, report,
}: {
  employeeTags: EmployeeTagRow[];
  canEdit: boolean;
  report: (res: { error?: string; message?: string }) => void;
}) {
  const [editing, setEditing] = useState<EmployeeTagRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<EmployeeTagRow | null>(null);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<TagColorToken>(TAG_COLOR_TOKENS[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openEdit = (item: EmployeeTagRow | 'new') => {
    setLabel(item === 'new' ? '' : item.label);
    setColor(item === 'new' ? TAG_COLOR_TOKENS[0] : (item.color as TagColorToken));
    setError(null);
    setEditing(item);
  };

  const save = () => {
    if (!label.trim()) { setError('Give this tag a label.'); return; }
    setError(null);
    startTransition(async () => {
      const res = await saveEmployeeTagAction(editing === 'new' ? null : (editing as EmployeeTagRow).id, label, color);
      if (res.error) setError(res.error);
      else { report(res); setEditing(null); }
    });
  };

  const remove = () => {
    if (!removing) return;
    startTransition(async () => {
      const res = await removeEmployeeTagAction(removing.id);
      report(res);
      if (!res.error) setRemoving(null);
    });
  };

  return (
    <SectionCard
      title={`${employeeTags.length} tag${employeeTags.length === 1 ? '' : 's'}`}
      icon="tag"
      bodyClassName="p-0"
      action={canEdit && <Button size="sm" variant="primary" icon="plus" onClick={() => openEdit('new')}>Add tag</Button>}
    >
      {employeeTags.length === 0 ? (
        <EmptyState icon="tag" title="No tags yet" hint="Add Remote-first, Key Holder - whatever labels this branch finds useful." />
      ) : (
        <div className="flex flex-wrap gap-2 p-4">
          {employeeTags.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs">
              <TagSwatch color={t.color} />
              {t.label}
              {!t.isActive && <span className="text-muted-foreground">(inactive)</span>}
              {canEdit && (
                <span className="ms-1 flex gap-0.5">
                  <button type="button" onClick={() => openEdit(t)} aria-label={`Edit ${t.label}`} className="text-muted-foreground hover:text-foreground">
                    <Icon name="pencil" className="h-3 w-3" />
                  </button>
                  <button type="button" onClick={() => setRemoving(t)} aria-label={`Remove ${t.label}`} className="text-muted-foreground hover:text-danger">
                    <Icon name="trash" className="h-3 w-3" />
                  </button>
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          title={editing === 'new' ? 'Add a tag' : `Edit ${(editing as EmployeeTagRow).label}`}
          icon="tag" size="sm" onClose={() => setEditing(null)}
          footer={<div className="flex justify-end gap-2"><Button onClick={() => setEditing(null)} disabled={pending}>Cancel</Button><Button variant="primary" loading={pending} onClick={save}>Save</Button></div>}
        >
          {error && <p className="mb-3 text-xs text-danger">{error}</p>}
          <div className="grid gap-3">
            <Field label="Label" htmlFor="tag-label">
              <input id="tag-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Key Holder" className={input} />
            </Field>
            <Field label="Colour" htmlFor="tag-color">
              <div className="flex flex-wrap gap-1.5">
                {TAG_COLOR_TOKENS.map((c) => (
                  <button key={c} type="button" onClick={() => setColor(c)}
                    className={`grid h-7 w-7 place-items-center rounded-full border-2 ${color === c ? 'border-foreground' : 'border-transparent'}`}
                    aria-label={c}
                  >
                    <TagSwatch color={c} className="h-5 w-5" />
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Modal>
      )}

      {removing && (
        <ConfirmDialog
          title="Deactivate tag"
          message={`"${removing.label}" will no longer appear when tagging an employee. Anyone already tagged keeps it until changed.`}
          confirmLabel="Deactivate" tone="danger" busy={pending} onConfirm={remove} onClose={() => setRemoving(null)}
        />
      )}
    </SectionCard>
  );
}

// -------------------------------------------------------------------------

function AssignmentTab({
  assignments, employeeTypes, employeeTags, canEdit, report,
}: {
  assignments: EmployeeConfigAssignmentRow[];
  employeeTypes: EmployeeTypeRow[];
  employeeTags: EmployeeTagRow[];
  canEdit: boolean;
  report: (res: { error?: string; message?: string }) => void;
}) {
  const [editing, setEditing] = useState<EmployeeConfigAssignmentRow | null>(null);

  return (
    <SectionCard title={`${assignments.length} ${assignments.length === 1 ? 'person' : 'people'}`} icon="users" bodyClassName="p-0">
      {assignments.length === 0 ? (
        <EmptyState icon="users" title="Nobody has access to this branch yet" />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Employee</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Tags</th>
              {canEdit && <th className="px-4 py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {assignments.map((a) => (
              <tr key={a.userId}>
                <td className="px-4 py-2.5 font-medium"><EmployeeLink id={a.userId}>{a.userName}</EmployeeLink></td>
                <td className="px-4 py-2.5 text-muted-foreground">{a.employeeTypeTagLabel ?? '-'}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {a.tagIds.length === 0 ? <span className="text-muted-foreground">-</span> : a.tagIds.map((id) => {
                      const t = employeeTags.find((x) => x.id === id);
                      return t ? (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                          <TagSwatch color={t.color} className="h-1.5 w-1.5" />
                          {t.label}
                        </span>
                      ) : null;
                    })}
                  </div>
                </td>
                {canEdit && (
                  <td className="px-4 py-2.5">
                    <button type="button" onClick={() => setEditing(a)}
                      className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label={`Edit ${a.userName}`}>
                      <Icon name="pencil" className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <AssignmentModal
          assignment={editing}
          employeeTypes={employeeTypes}
          employeeTags={employeeTags}
          onClose={() => setEditing(null)}
          onSaved={(res) => { report(res); if (!res.error) setEditing(null); }}
        />
      )}
    </SectionCard>
  );
}

function AssignmentModal({
  assignment, employeeTypes, employeeTags, onClose, onSaved,
}: {
  assignment: EmployeeConfigAssignmentRow;
  employeeTypes: EmployeeTypeRow[];
  employeeTags: EmployeeTagRow[];
  onClose: () => void;
  onSaved: (res: { error?: string; message?: string }) => void;
}) {
  const [typeId, setTypeId] = useState(assignment.employeeTypeTagId ?? '');
  const [tagIds, setTagIds] = useState<Set<string>>(new Set(assignment.tagIds));
  const [pending, startTransition] = useTransition();

  const toggleTag = (id: string) => {
    const next = new Set(tagIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTagIds(next);
  };

  const save = () => {
    startTransition(async () => {
      const res = await assignEmployeeConfigAction(assignment.userId, typeId || null, [...tagIds]);
      if (res.error) onSaved(res);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title={assignment.userName}
      icon="users" size="sm" onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose} disabled={pending}>Cancel</Button><Button variant="primary" loading={pending} onClick={save}>Save</Button></div>}
    >
      <div className="grid gap-3">
        <Field label="Employee Type" htmlFor="asn-type">
          <select id="asn-type" value={typeId} onChange={(e) => setTypeId(e.target.value)} className={input}>
            <option value="">Unassigned</option>
            {employeeTypes.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Tags" htmlFor="asn-tags">
          <div className="flex flex-wrap gap-2">
            {employeeTags.filter((t) => t.isActive).map((t) => (
              <button key={t.id} type="button" onClick={() => toggleTag(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                  tagIds.has(t.id) ? 'border-brand bg-brand/10' : 'border-border'
                }`}
              >
                <TagSwatch color={t.color} />
                {t.label}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
