'use client';

import { EmployeeLink } from '@/components/document/EmployeeLink';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { istDate } from '@/lib/date-ranges';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import type { LeaveTypeRow, AllocationsView } from '@/server/leave-types';
import {
  saveLeaveTypeAction, removeLeaveTypeAction, saveAllocationAction, addCompOffEntryAction,
  decideCompOffRequestAction, requestLeaveAllocationAction, decideLeaveAllocationRequestAction,
  saveRestrictedPeriodAction, removeRestrictedPeriodAction,
} from './actions';

interface PendingCompOffRow {
  id: string;
  userId: string;
  userName: string;
  days: number;
  reason: string | null;
  createdAt: string;
}

interface RestrictedPeriodRowVM {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  description: string | null;
  departmentId: string | null;
  departmentName: string | null;
  includeAllLeaveTypes: boolean;
  specificLeaveTypeIds: string[];
  excludedLeaveTypeIds: string[];
  isActive: boolean;
}

interface PendingAllocationRequestRow {
  id: string;
  userId: string;
  userName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  requestedDays: number;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

/**
 * Leave categories (the master list) and what each employee is allowed of
 * them (the per-year grid), on one screen with two tabs.
 *
 * "Taken" and "Balance" are never typed in here - they are read-only,
 * computed server-side from approved leave requests. Only "Allowed" and
 * comp-off entries are editable, because those are the only two numbers a
 * person actually decides.
 */

interface Props {
  leaveTypes: LeaveTypeRow[];
  allocations: AllocationsView;
  pendingCompOff: PendingCompOffRow[];
  pendingAllocationRequests: PendingAllocationRequestRow[];
  restrictedPeriods: RestrictedPeriodRowVM[];
  departments: { id: string; name: string }[];
  year: number;
  storeName: string;
  scopeIsAll: boolean;
  canEdit: boolean;
}

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

export function LeaveTypesClient({
  leaveTypes, allocations, pendingCompOff, pendingAllocationRequests, restrictedPeriods, departments,
  year, storeName, scopeIsAll, canEdit,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<'types' | 'allocations' | 'restricted'>('types');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A server action's revalidatePath() invalidates the cache, but this
  // component still needs its own refresh() call to actually re-fetch and
  // re-render with the new data - otherwise the confirmation banner shows
  // while the table underneath it keeps displaying what was there before
  // the edit, until the next full navigation. Same fix GridClient's own
  // LeaveModal already uses.
  const report = (res: { error?: string; message?: string }) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : res.message ?? null);
    if (!res.error) router.refresh();
  };

  if (scopeIsAll) {
    return (
      <div>
        <PageHeader badge="LT" title="Leave types" subtitle="Categories, quotas and who has how much left" />
        <Card>
          <EmptyState
            icon="building"
            title="Choose a branch first"
            hint="Leave quotas are set per branch, the same as working hours and the holiday calendar."
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        badge="LT"
        title="Leave types"
        subtitle={`${storeName} · categories, quotas and who has how much left`}
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

      {pendingCompOff.length > 0 && (
        <PendingCompOffPanel requests={pendingCompOff} canEdit={canEdit} report={report} />
      )}

      {pendingAllocationRequests.length > 0 && (
        <PendingAllocationRequestPanel requests={pendingAllocationRequests} canEdit={canEdit} report={report} />
      )}

      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-1">
        {(['types', 'allocations', 'restricted'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`h-8 rounded-md px-3.5 text-sm font-medium transition ${
              tab === t ? 'bg-brand text-brand-fg' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {t === 'types' ? 'Leave types' : t === 'allocations' ? 'Allocations' : 'Restricted Periods'}
          </button>
        ))}
      </div>

      {tab === 'types' && <LeaveTypesTab leaveTypes={leaveTypes} canEdit={canEdit} report={report} />}
      {tab === 'allocations' && (
        <AllocationsTab allocations={allocations} leaveTypes={leaveTypes} year={year} canEdit={canEdit} report={report} />
      )}
      {tab === 'restricted' && (
        <RestrictedPeriodsTab periods={restrictedPeriods} leaveTypes={leaveTypes} departments={departments} canEdit={canEdit} report={report} />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------

/**
 * Comp-off redemptions an employee asked for, waiting on a decision -
 * separate from the Grant/Deduct button in the Allocations grid below,
 * which is a manager acting directly and never touches this list.
 */
function PendingCompOffPanel({
  requests, canEdit, report,
}: {
  requests: PendingCompOffRow[];
  canEdit: boolean;
  report: (res: { error?: string; message?: string }) => void;
}) {
  const [pending, startTransition] = useTransition();

  const decide = (id: string, decision: 'approved' | 'rejected') => {
    startTransition(async () => report(await decideCompOffRequestAction(id, decision, null)));
  };

  return (
    <div className="mb-4">
      <SectionCard title={`${requests.length} pending comp-off request${requests.length === 1 ? '' : 's'}`} icon="clock" bodyClassName="p-0">
        <ul className="divide-y divide-border">
          {requests.map((r) => (
            <li key={r.id} data-row-id={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{r.userName} - {Math.abs(r.days)} day{Math.abs(r.days) === 1 ? '' : 's'}</span>
                {r.reason && <span className="block truncate text-xs text-muted-foreground">{r.reason}</span>}
              </span>
              {canEdit && (
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="danger" disabled={pending} onClick={() => decide(r.id, 'rejected')}>Reject</Button>
                  <Button size="sm" variant="primary" disabled={pending} onClick={() => decide(r.id, 'approved')}>Approve</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

/** An employee asking for MORE days than their normal allocation - see `requestLeaveAllocationAction`. Approving one adds onto the current year's allocation, it never overwrites it. */
function PendingAllocationRequestPanel({
  requests, canEdit, report,
}: {
  requests: PendingAllocationRequestRow[];
  canEdit: boolean;
  report: (res: { error?: string; message?: string }) => void;
}) {
  const [pending, startTransition] = useTransition();

  const decide = (id: string, decision: 'approved' | 'rejected') => {
    startTransition(async () => report(await decideLeaveAllocationRequestAction(id, decision, null)));
  };

  return (
    <div className="mb-4">
      <SectionCard title={`${requests.length} pending leave allocation request${requests.length === 1 ? '' : 's'}`} icon="clock" bodyClassName="p-0">
        <ul className="divide-y divide-border">
          {requests.map((r) => (
            <li key={r.id} data-row-id={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{r.userName} - {r.requestedDays} extra {r.leaveTypeName} day{r.requestedDays === 1 ? '' : 's'}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.description}</span>
              </span>
              {canEdit && (
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="danger" disabled={pending} onClick={() => decide(r.id, 'rejected')}>Reject</Button>
                  <Button size="sm" variant="primary" disabled={pending} onClick={() => decide(r.id, 'approved')}>Approve</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

function RequestAllocationModal({
  leaveTypes, onClose, onSaved,
}: {
  leaveTypes: LeaveTypeRow[];
  onClose: () => void;
  onSaved: (res: { error?: string; message?: string }) => void;
}) {
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes.find((t) => t.isActive)?.id ?? '');
  const [days, setDays] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    const requestedDays = Number(days);
    if (!leaveTypeId || !Number.isFinite(requestedDays) || requestedDays <= 0) {
      setError('Choose a leave type and enter how many extra days you need.');
      return;
    }
    if (!description.trim()) {
      setError('Say why you need the extra days.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await requestLeaveAllocationAction(leaveTypeId, requestedDays, description.trim());
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title="Request more days"
      icon="plus"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>Send request</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="grid gap-3">
        <Field label="Leave type" htmlFor="lar-type">
          <select id="lar-type" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} className={input}>
            {leaveTypes.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Extra days" htmlFor="lar-days">
          <input id="lar-days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} className={input} />
        </Field>
        <Field label="Reason" htmlFor="lar-reason">
          <textarea id="lar-reason" value={description} onChange={(e) => setDescription(e.target.value)}
            rows={3} className={`${input} h-auto py-2`} placeholder="Why you need more than your usual quota." />
        </Field>
      </div>
    </Modal>
  );
}

function LeaveTypesTab({
  leaveTypes, canEdit, report,
}: {
  leaveTypes: LeaveTypeRow[];
  canEdit: boolean;
  report: (res: { error?: string; message?: string }) => void;
}) {
  const [editing, setEditing] = useState<LeaveTypeRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<LeaveTypeRow | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = () => {
    if (!removing) return;
    startTransition(async () => {
      const res = await removeLeaveTypeAction(removing.id);
      report(res);
      if (!res.error) setRemoving(null);
    });
  };

  return (
    <SectionCard
      title={`${leaveTypes.length} leave type${leaveTypes.length === 1 ? '' : 's'}`}
      icon="file-text"
      bodyClassName="p-0"
      action={canEdit && (
        <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing('new')}>
          Add type
        </Button>
      )}
    >
      {leaveTypes.length === 0 ? (
        <EmptyState
          icon="file-text"
          title="No leave types yet"
          hint="Add Casual, Sick, Earned - whatever categories this branch actually uses."
        />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Code</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Paid</th>
              <th className="px-4 py-2 font-medium">Default days/year</th>
              <th className="px-4 py-2 font-medium">Status</th>
              {canEdit && <th className="px-4 py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {leaveTypes.map((lt) => (
              <tr key={lt.id}>
                <td className="px-4 py-2.5 font-mono text-sm font-semibold">{lt.code}</td>
                <td className="px-4 py-2.5">{lt.name}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={lt.paidPercentage === 100 ? 'brand' : lt.paidPercentage === 0 ? 'neutral' : 'warning'}>
                    {lt.paidPercentage === 100 ? 'Paid' : lt.paidPercentage === 0 ? 'Unpaid' : `${lt.paidPercentage}% pay`}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                  {lt.defaultDaysPerYear ?? '—'}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={lt.isActive ? 'success' : 'neutral'}>{lt.isActive ? 'Active' : 'Inactive'}</Badge>
                </td>
                {canEdit && (
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setEditing(lt)}
                        className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        aria-label={`Edit ${lt.name}`}>
                        <Icon name="pencil" className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => setRemoving(lt)}
                        className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition hover:bg-danger/10 hover:text-danger"
                        aria-label={`Remove ${lt.name}`}>
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
        <LeaveTypeModal
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(res) => { report(res); if (!res.error) setEditing(null); }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Remove leave type"
          message={`"${removing.name}" will no longer appear when creating a new leave request or allocation. Past requests and allocations that already reference it are unaffected.`}
          confirmLabel="Remove"
          tone="danger"
          busy={pending}
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </SectionCard>
  );
}

function LeaveTypeModal({
  item, onClose, onSaved,
}: {
  item: LeaveTypeRow | null;
  onClose: () => void;
  onSaved: (res: { error?: string; message?: string }) => void;
}) {
  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [paidPercentage, setPaidPercentage] = useState(item?.paidPercentage ?? 100);
  const [days, setDays] = useState(item?.defaultDaysPerYear != null ? String(item.defaultDaysPerYear) : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!code.trim() || !name.trim()) {
      setError('Give the leave type a code and a name.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await saveLeaveTypeAction(item?.id ?? null, {
        code: code.trim(), name: name.trim(), paidPercentage,
        defaultDaysPerYear: days.trim() ? Number(days) : null,
      });
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title={item ? `Edit ${item.name}` : 'Add a leave type'}
      icon="file-text"
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" htmlFor="lt-code" hint="CL, SL, EL - shown wherever space is tight.">
          <input id="lt-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={10}
            placeholder="CL" className={`${input} uppercase`} />
        </Field>
        <Field label="Name" htmlFor="lt-name">
          <input id="lt-name" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Casual Leave" className={input} />
        </Field>
        <Field label="Pay during leave" htmlFor="lt-paid" hint="100 for fully paid, 0 for unpaid, or a partial-pay percentage in between.">
          <div className="flex items-center gap-2">
            <input id="lt-paid" type="number" min={0} max={100} value={paidPercentage}
              onChange={(e) => setPaidPercentage(Math.trunc(Number(e.target.value)))} className={input} />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </Field>
        <Field label="Default days/year" htmlFor="lt-days" hint="A starting point when allocating a new employee.">
          <input id="lt-days" type="number" min={0} max={365} value={days}
            onChange={(e) => setDays(e.target.value)} placeholder="12" className={input} />
        </Field>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------------

function AllocationsTab({
  allocations, leaveTypes, year, canEdit, report,
}: {
  allocations: AllocationsView;
  leaveTypes: LeaveTypeRow[];
  year: number;
  canEdit: boolean;
  report: (res: { error?: string; message?: string }) => void;
}) {
  const [editingCell, setEditingCell] = useState<{ userId: string; leaveTypeId: string; value: string } | null>(null);
  const [compOffFor, setCompOffFor] = useState<{ userId: string; userName: string } | null>(null);
  const [requestingMore, setRequestingMore] = useState(false);
  const [pending, startTransition] = useTransition();

  if (allocations.leaveTypes.length === 0) {
    return (
      <SectionCard title="Allocations" icon="users">
        <EmptyState icon="file-text" title="Add a leave type first" hint="Allocations are set per leave type - there is nothing to allocate yet." />
      </SectionCard>
    );
  }

  const saveCell = () => {
    if (!editingCell) return;
    const allowedDays = Number(editingCell.value);
    if (!Number.isFinite(allowedDays) || allowedDays < 0) {
      report({ error: 'Enter a number of days, 0 or more.' });
      return;
    }
    const { userId, leaveTypeId } = editingCell;
    startTransition(async () => {
      const res = await saveAllocationAction(userId, leaveTypeId, year, allowedDays);
      report(res);
      if (!res.error) setEditingCell(null);
    });
  };

  return (
    <SectionCard
      title={`Allocations for ${allocations.rows.length} ${allocations.rows.length === 1 ? 'person' : 'people'}`}
      icon="users"
      bodyClassName="p-0"
      action={
        <span className="flex items-center gap-2">
          <Button size="sm" variant="outline" icon="plus" onClick={() => setRequestingMore(true)}>Request more days</Button>
          <span className="flex items-center gap-1">
            <Link href={`/holiday/leave-types?y=${year - 1}`} className="grid h-7 w-7 place-items-center rounded border border-border bg-card transition hover:bg-muted" aria-label="Previous year">
              <Icon name="chevron-left" className="h-3.5 w-3.5" />
            </Link>
            <span className="px-1 text-sm font-medium tabular-nums">{year}</span>
            <Link href={`/holiday/leave-types?y=${year + 1}`} className="grid h-7 w-7 place-items-center rounded border border-border bg-card transition hover:bg-muted" aria-label="Next year">
              <Icon name="chevron-right" className="h-3.5 w-3.5" />
            </Link>
          </span>
        </span>
      }
    >
      <p className="border-b border-border px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
        A · T · B = Allowed, Taken, Balance. Taken counts only approved leave requests tagged with that
        type, overlapping {year} - it is never typed in directly. Click Allowed to change it.
      </p>

      {allocations.rows.length === 0 ? (
        <EmptyState icon="users" title="Nobody has access to this branch yet" />
      ) : (
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
                <th className="sticky left-0 bg-card px-4 py-2 font-medium">Employee</th>
                {allocations.leaveTypes.map((lt) => (
                  <th key={lt.id} className="px-3 py-2 text-center font-medium" title={lt.name}>{lt.code}</th>
                ))}
                <th className="px-3 py-2 text-center font-medium">Comp-off</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {allocations.rows.map((row) => (
                <tr key={row.userId}>
                  <td className="sticky left-0 bg-card px-4 py-2 font-medium"><EmployeeLink id={row.userId}>{row.userName}</EmployeeLink></td>
                  {row.cells.map((cell) => {
                    const isEditing = editingCell?.userId === row.userId && editingCell?.leaveTypeId === cell.leaveTypeId;
                    return (
                      <td key={cell.leaveTypeId} className="px-3 py-2 text-center tabular-nums">
                        {isEditing ? (
                          <span className="inline-flex items-center gap-1">
                            <input
                              autoFocus
                              type="number"
                              min={0}
                              value={editingCell.value}
                              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                              onKeyDown={(e) => e.key === 'Enter' && saveCell()}
                              className="h-7 w-14 rounded border border-brand bg-card px-1.5 text-center text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                            />
                            <button type="button" aria-label="Save" disabled={pending} onClick={saveCell}
                              className="grid h-6 w-6 place-items-center rounded text-success hover:bg-success/10">
                              <Icon name="check" className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => canEdit && setEditingCell({ userId: row.userId, leaveTypeId: cell.leaveTypeId, value: String(cell.allowedDays) })}
                            className="rounded px-1.5 py-0.5 text-sm transition hover:bg-muted disabled:hover:bg-transparent"
                            title="Click to change Allowed"
                          >
                            <span className="font-medium">{cell.allowedDays}</span>
                            <span className="text-muted-foreground"> · {cell.takenDays} · </span>
                            <span className={cell.balanceDays < 0 ? 'font-medium text-danger' : 'text-muted-foreground'}>
                              {cell.balanceDays}
                            </span>
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setCompOffFor({ userId: row.userId, userName: row.userName })}
                      className="rounded px-1.5 py-0.5 text-sm font-medium tabular-nums transition hover:bg-muted disabled:hover:bg-transparent"
                      title="Grant or adjust comp-off"
                    >
                      {row.compOffAvailable}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {compOffFor && (
        <CompOffModal
          userId={compOffFor.userId}
          userName={compOffFor.userName}
          onClose={() => setCompOffFor(null)}
          onSaved={(res) => { report(res); if (!res.error) setCompOffFor(null); }}
        />
      )}

      {requestingMore && (
        <RequestAllocationModal
          leaveTypes={leaveTypes}
          onClose={() => setRequestingMore(false)}
          onSaved={(res) => { report(res); if (!res.error) setRequestingMore(false); }}
        />
      )}
    </SectionCard>
  );
}

function CompOffModal({
  userId, userName, onClose, onSaved,
}: {
  userId: string;
  userName: string;
  onClose: () => void;
  onSaved: (res: { error?: string; message?: string }) => void;
}) {
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (sign: 1 | -1) => {
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter how many days, greater than zero.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addCompOffEntryAction(userId, n * sign, reason.trim() || null);
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title={`Comp-off - ${userName}`}
      subtitle="Grant days for working when nobody was scheduled to, or redeem/adjust existing ones."
      icon="clock"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="danger" loading={pending} onClick={() => save(-1)}>Deduct</Button>
          <Button variant="primary" loading={pending} onClick={() => save(1)}>Grant</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="grid gap-3">
        <Field label="Days" htmlFor="co-days">
          <input id="co-days" type="number" min={1} max={30} value={days}
            onChange={(e) => setDays(e.target.value)} placeholder="1" className={input} />
        </Field>
        <Field label="Reason" htmlFor="co-reason" hint="Optional, but worth recording - this shows up as an unexplained number otherwise.">
          <input id="co-reason" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Worked the Diwali weekend" className={input} />
        </Field>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------------

const fmtRestrictedDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

function scopeSummary(p: RestrictedPeriodRowVM, leaveTypes: LeaveTypeRow[]): string {
  const nameOf = (id: string) => leaveTypes.find((t) => t.id === id)?.code ?? id;
  if (p.includeAllLeaveTypes && p.excludedLeaveTypeIds.length === 0) return 'All leave types';
  if (p.excludedLeaveTypeIds.length > 0) return `All except ${p.excludedLeaveTypeIds.map(nameOf).join(', ')}`;
  if (p.specificLeaveTypeIds.length > 0) return p.specificLeaveTypeIds.map(nameOf).join(', ');
  return 'None';
}

function RestrictedPeriodsTab({
  periods, leaveTypes, departments, canEdit, report,
}: {
  periods: RestrictedPeriodRowVM[];
  leaveTypes: LeaveTypeRow[];
  departments: { id: string; name: string }[];
  canEdit: boolean;
  report: (res: { error?: string; message?: string }) => void;
}) {
  const [editing, setEditing] = useState<RestrictedPeriodRowVM | 'new' | null>(null);
  const [removing, setRemoving] = useState<RestrictedPeriodRowVM | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = () => {
    if (!removing) return;
    startTransition(async () => {
      const res = await removeRestrictedPeriodAction(removing.id);
      report(res);
      if (!res.error) setRemoving(null);
    });
  };

  return (
    <SectionCard
      title={`${periods.length} restricted period${periods.length === 1 ? '' : 's'}`}
      icon="calendar"
      bodyClassName="p-0"
      action={canEdit && <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing('new')}>Add period</Button>}
    >
      {periods.length === 0 ? (
        <EmptyState icon="calendar" title="No restricted periods" hint="Add a blackout window - year-end close, festival rush - to stop leave being requested for it." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Dates</th>
              <th className="px-4 py-2 font-medium">Department</th>
              <th className="px-4 py-2 font-medium">Applies to</th>
              <th className="px-4 py-2 font-medium">Status</th>
              {canEdit && <th className="px-4 py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {periods.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2.5 font-medium">{p.title}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{fmtRestrictedDate(p.startDate)} - {fmtRestrictedDate(p.endDate)}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{p.departmentName ?? 'Whole store'}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{scopeSummary(p, leaveTypes)}</td>
                <td className="px-4 py-2.5"><Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'Active' : 'Inactive'}</Badge></td>
                {canEdit && (
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setEditing(p)}
                        className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label={`Edit ${p.title}`}>
                        <Icon name="pencil" className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => setRemoving(p)}
                        className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition hover:bg-danger/10 hover:text-danger" aria-label={`Remove ${p.title}`}>
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
        <RestrictedPeriodModal
          item={editing === 'new' ? null : editing}
          leaveTypes={leaveTypes}
          departments={departments}
          onClose={() => setEditing(null)}
          onSaved={(res) => { report(res); if (!res.error) setEditing(null); }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Remove restricted period"
          message={`"${removing.title}" will no longer block leave requests for its dates.`}
          confirmLabel="Remove" tone="danger" busy={pending} onConfirm={remove} onClose={() => setRemoving(null)}
        />
      )}
    </SectionCard>
  );
}

type RestrictedScope = 'all' | 'except' | 'only';

function RestrictedPeriodModal({
  item, leaveTypes, departments, onClose, onSaved,
}: {
  item: RestrictedPeriodRowVM | null;
  leaveTypes: LeaveTypeRow[];
  departments: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (res: { error?: string; message?: string }) => void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  // India days - the UTC date is yesterday until 05:30, and a period saved at
  // midnight India time would otherwise open a day early.
  const [startDate, setStartDate] = useState(istDate(item ? new Date(item.startDate) : new Date()));
  const [endDate, setEndDate] = useState(istDate(item ? new Date(item.endDate) : new Date()));
  const [description, setDescription] = useState(item?.description ?? '');
  const [departmentId, setDepartmentId] = useState(item?.departmentId ?? '');
  const [scopeMode, setScopeMode] = useState<RestrictedScope>(
    item ? (item.excludedLeaveTypeIds.length > 0 ? 'except' : item.includeAllLeaveTypes ? 'all' : 'only') : 'all',
  );
  const [pickedTypeIds, setPickedTypeIds] = useState<Set<string>>(
    new Set(item ? (scopeMode === 'except' ? item.excludedLeaveTypeIds : item.specificLeaveTypeIds) : []),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleType = (id: string) => {
    const next = new Set(pickedTypeIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPickedTypeIds(next);
  };

  const save = () => {
    if (!title.trim()) { setError('Give this restricted period a title.'); return; }
    if (!startDate || !endDate) { setError('Set a start and end date.'); return; }
    setError(null);
    startTransition(async () => {
      const res = await saveRestrictedPeriodAction(item?.id ?? null, {
        title: title.trim(), startDate, endDate, description: description.trim() || null,
        departmentId: departmentId || null,
        includeAllLeaveTypes: scopeMode !== 'only',
        specificLeaveTypeIds: scopeMode === 'only' ? [...pickedTypeIds] : [],
        excludedLeaveTypeIds: scopeMode === 'except' ? [...pickedTypeIds] : [],
      });
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title={item ? `Edit ${item.title}` : 'Add a restricted period'}
      icon="calendar" size="md" onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose} disabled={pending}>Cancel</Button><Button variant="primary" loading={pending} onClick={save}>Save</Button></div>}
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="grid gap-3">
        <Field label="Title" htmlFor="rp-title" hint="Year-end close, festival rush.">
          <input id="rp-title" value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" htmlFor="rp-start">
            <input id="rp-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={input} />
          </Field>
          <Field label="End date" htmlFor="rp-end">
            <input id="rp-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={input} />
          </Field>
        </div>
        <Field label="Department" htmlFor="rp-dept" hint="Leave blank to restrict the whole store.">
          <select id="rp-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={input}>
            <option value="">Whole store</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Description" htmlFor="rp-desc">
          <input id="rp-desc" value={description} onChange={(e) => setDescription(e.target.value)} className={input} />
        </Field>

        <p className="mb-1 mt-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Which leave types</p>
        <div className="flex gap-2">
          {([['all', 'All leave types'], ['except', 'All except...'], ['only', 'Only...']] as [RestrictedScope, string][]).map(([mode, label]) => (
            <button key={mode} type="button" onClick={() => setScopeMode(mode)}
              className={`h-8 rounded-md border px-3 text-xs font-medium transition ${
                scopeMode === mode ? 'border-brand bg-brand/10 text-on-tint-brand' : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {scopeMode !== 'all' && (
          <div className="flex flex-wrap gap-2 rounded-lg border border-border p-2.5">
            {leaveTypes.map((t) => (
              <label key={t.id} className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={pickedTypeIds.has(t.id)} onChange={() => toggleType(t.id)} className="h-3.5 w-3.5 rounded border-border" />
                {t.name}
              </label>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
