'use client';
import { ListFilter } from '@/components/ui/ListFilter';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { newestFirst, oldestFirst, type CardListPage } from '@/lib/card-list';
import {
  submitResignationAction, decideResignationAction, completeOffboardingAction,
  loadSettlementAction, writeOffDuesAction,
  setOffboardingTaskStatusAction, createOffboardingStepAction, removeOffboardingStepAction, fetchOffboardingTasksAction,
} from './actions';

interface ResignationRow {
  id: string;
  userId: string;
  userName: string;
  reason: string | null;
  noticeDays: number;
  resignedOn: string;
  lastWorkingDay: string;
  status: string;
  decidedAt: string | null;
  decisionNote: string | null;
  completedAt: string | null;
  progress: { total: number; done: number; skipped: number; pending: number } | null;
}

interface StepRow {
  id: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

const STATUS_TONE = { submitted: 'warning', accepted: 'info', completed: 'success', rejected: 'danger' } as const;

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function OffboardingClient({
  resignations, steps, canViewAll, canManage, listPage, hasOwnPending,
}: {
  /** One server-side page (F1b). */
  listPage: CardListPage;
  /** The viewer has their own resignation waiting - read over every row on the server. */
  hasOwnPending: boolean;
  resignations: ResignationRow[];
  steps: StepRow[];
  canViewAll: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [resigning, setResigning] = useState(false);
  const [managingSteps, setManagingSteps] = useState(false);
  const [openRow, setOpenRow] = useState<ResignationRow | null>(null);
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

  return (
    <div>
      <PageHeader
        badge="OF"
        title="Offboarding"
        subtitle={canViewAll ? 'Resignations and exit checklists' : 'Your own resignation'}
        actions={
          <div className="flex gap-2">
            {canManage && <Button variant="outline" iconEnd="sliders" onClick={() => setManagingSteps(true)}>Steps</Button>}
            <Button variant="primary" iconEnd="plus" disabled={hasOwnPending} onClick={() => setResigning(true)}>Resign</Button>
          </div>
        }
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}

      <SectionCard title={`${listPage.total} resignation${listPage.total === 1 ? '' : 's'}`} icon="user" bodyClassName="p-0">
        {listPage.total === 0 ? (
          <EmptyState icon="user" title="Nothing here" hint="A resignation you submit, or that's waiting on you to decide, shows up here." />
        ) : (
          /* F1b / D17. Status chips carry their own counts, so "what is still
             waiting on a decision" is answered before reading a row. */
          <ListFilter
            server={listPage.server}
            exportScreen="offboarding"
            rows={resignations}
            // Date filter and sort (9 Oct 2026) - same keys as server/card-lists.
            dates={[{ key: 'resigned', label: 'Resigned on', of: (r) => r.resignedOn }, { key: 'last', label: 'Last working day', of: (r) => r.lastWorkingDay, future: true }]}
            sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.resignedOn) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.resignedOn) }]}
            noun="resignations"
            placeholder="Person, reason, status…"
            searchOn={(r) => [r.userName, r.reason, r.status, r.decisionNote]}
            chipOf={(r) => r.status}
            chipLabel="Status"
            chips={Object.keys(listPage.chipCounts).sort().map((s) => ({
              value: s, label: s, count: listPage.chipCounts[s] ?? 0,
            }))}
          >
            {(shown) => (shown.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every resignation." />
            ) : (
          <div className="divide-y divide-border">
            {shown.map((r) => (
              <button
                key={r.id}
                data-row-id={r.id}
                type="button"
                onClick={() => setOpenRow(r)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start transition hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{canViewAll ? r.userName : 'You'}</p>
                    <Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? 'neutral'}>{r.status}</Badge>
                    {r.progress && <Badge tone="neutral">{r.progress.done}/{r.progress.total} steps</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Last working day {new Date(r.lastWorkingDay).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
                    {' · '}{r.noticeDays} day notice
                    {r.reason && ` · ${r.reason}`}
                  </p>
                </div>
                <Icon name="chevron-right" className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
            ))}
          </ListFilter>
        )}
      </SectionCard>

      {resigning && (
        <ResignDialog
          busy={busy === 'resign'}
          onClose={() => setResigning(false)}
          onSubmit={async (input) => { if (await act('resign', () => submitResignationAction(input))) setResigning(false); }}
        />
      )}

      {managingSteps && (
        <StepsDialog
          steps={steps}
          busy={busy}
          onClose={() => setManagingSteps(false)}
          onAdd={(label) => act('step-add', () => createOffboardingStepAction(label))}
          onRemove={(id) => act(`step-rm-${id}`, () => removeOffboardingStepAction(id))}
        />
      )}

      {openRow && (
        <ResignationDetailDialog
          resignation={openRow}
          canManage={canManage}
          onClose={() => setOpenRow(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function ResignDialog({
  busy, onClose, onSubmit,
}: { busy: boolean; onClose: () => void; onSubmit: (input: { reason: string | null; noticeDays: number; lastWorkingDay: Date }) => void }) {
  const [reason, setReason] = useState('');
  const [noticeDays, setNoticeDays] = useState('30');
  const [lastWorkingDay, setLastWorkingDay] = useState(
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );

  return (
    <Modal
      title="Submit your resignation"
      subtitle="Goes to your own manager for a decision, same as a leave request"
      icon="user"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!lastWorkingDay}
            onClick={() => onSubmit({ reason: reason.trim() || null, noticeDays: Number(noticeDays) || 0, lastWorkingDay: new Date(lastWorkingDay) })}>
            Submit
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Field label="Notice period (days)" required htmlFor="rs-notice">
          <input id="rs-notice" type="number" min={0} value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Last working day" required htmlFor="rs-lwd">
          <input id="rs-lwd" type="date" value={lastWorkingDay} onChange={(e) => setLastWorkingDay(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Reason" htmlFor="rs-reason">
          <textarea id="rs-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand" />
        </Field>
      </div>
    </Modal>
  );
}

function StepsDialog({
  steps, busy, onClose, onAdd, onRemove,
}: {
  steps: StepRow[];
  busy: string | boolean;
  onClose: () => void;
  onAdd: (label: string) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
}) {
  const [label, setLabel] = useState('');

  return (
    <Modal title="Offboarding steps" subtitle="What every exit works through" icon="sliders" size="sm" onClose={onClose}>
      <div className="mb-3 flex gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Asset return, Exit interview, F&F settlement…" className={inputClass} />
        <Button variant="primary" loading={busy === 'step-add'} disabled={!label.trim()} onClick={async () => { if (await onAdd(label.trim())) setLabel(''); }}>
          Add
        </Button>
      </div>
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No steps yet - an accepted resignation will start with an empty checklist.</p>
      ) : (
        <ul className="divide-y divide-border">
          {steps.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2">
              <span className="text-sm">{s.label}</span>
              <Button size="sm" variant="outline" loading={busy === `step-rm-${s.id}`} onClick={() => onRemove(s.id)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function ResignationDetailDialog({
  resignation, canManage, onClose, onChanged,
}: { resignation: ResignationRow; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const [tasks, setTasks] = useState<{ id: string; label: string; status: string }[] | null>(null);
  const [busy, setBusy] = useState<string | boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(resignation.status);
  const [dues, setDues] = useState<{ loanPaise: number; advancePaise: number; owedToThemPaise: number; clear: boolean } | null>(null);
  const [writeOffReason, setWriteOffReason] = useState('');
  const [writingOff, setWritingOff] = useState(false);

  const showChecklist = status === 'accepted' || status === 'completed';

  function reload() {
    if (!showChecklist) return;
    fetchOffboardingTasksAction(resignation.userId).then((res) => {
      if (res.error) setError(res.error);
      else setTasks(res.data ?? []);
    });
  }

  useEffect(reload, [resignation.userId, showChecklist]);

  // Full and final (G-19): read whenever the drawer is open on a live
  // resignation, so the number is in front of whoever presses Complete.
  const loadDues = useCallback(() => {
    if (status === 'rejected') return;
    void loadSettlementAction(resignation.userId).then((res) => {
      if (!('error' in res) && res.data) setDues(res.data);
    });
  }, [resignation.userId, status]);

  useEffect(loadDues, [loadDues]);

  async function writeOff() {
    setBusy('writeoff');
    setError(null);
    const res = await writeOffDuesAction(resignation.userId, writeOffReason);
    if ('error' in res && res.error) setError(res.error);
    else { setWritingOff(false); setWriteOffReason(''); loadDues(); onChanged(); }
    setBusy(false);
  }

  async function decide(decision: 'accepted' | 'rejected') {
    setBusy(decision);
    setError(null);
    const res = await decideResignationAction(resignation.id, decision, null);
    if (res.error) setError(res.error);
    else { setStatus(decision); onChanged(); }
    setBusy(false);
  }

  async function complete() {
    setBusy('complete');
    setError(null);
    const res = await completeOffboardingAction(resignation.id);
    if (res.error) setError(res.error);
    else { setStatus('completed'); onChanged(); }
    setBusy(false);
  }

  async function toggleTask(taskId: string, taskStatus: 'done' | 'skipped' | 'pending') {
    setBusy(taskId);
    setError(null);
    const res = await setOffboardingTaskStatusAction(taskId, taskStatus);
    if (res.error) setError(res.error);
    else { reload(); onChanged(); }
    setBusy(false);
  }

  return (
    <Modal title={resignation.userName} subtitle={`Last working day ${new Date(resignation.lastWorkingDay).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}`} icon="user" size="lg" onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? 'neutral'}>{status}</Badge>
        <span className="text-xs text-muted-foreground">{resignation.noticeDays} day notice</span>
      </div>

      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      {resignation.reason && <p className="mb-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">{resignation.reason}</p>}

      {canManage && status === 'submitted' && (
        <div className="mb-4 flex gap-2">
          <Button size="sm" variant="outline" loading={busy === 'rejected'} onClick={() => decide('rejected')}>Reject</Button>
          <Button size="sm" variant="primary" loading={busy === 'accepted'} onClick={() => decide('accepted')}>Accept</Button>
        </div>
      )}

      {showChecklist && (
        <>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exit checklist</p>
          {!tasks ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No offboarding steps configured.</p>
          ) : (
            <ul className="mb-3 divide-y divide-border">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                  <span className={`text-sm ${t.status === 'skipped' ? 'text-muted-foreground line-through' : ''}`}>{t.label}</span>
                  {canManage && (
                    <div className="flex gap-1.5">
                      {t.status !== 'done' && <Button size="sm" variant={t.status === 'pending' ? 'primary' : 'outline'} loading={busy === t.id} onClick={() => toggleTask(t.id, 'done')}>Done</Button>}
                      {t.status !== 'skipped' && t.status !== 'done' && <Button size="sm" variant="outline" loading={busy === t.id} onClick={() => toggleTask(t.id, 'skipped')}>Skip</Button>}
                      {t.status !== 'pending' && <Button size="sm" variant="outline" loading={busy === t.id} onClick={() => toggleTask(t.id, 'pending')}>Undo</Button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/*
            G-19: offboarding used to finish without looking at money at all, so
            a loan or advance stayed against somebody whose login had just been
            switched off. `completeOffboarding` now refuses while anything is
            open; this is where you see what and deal with it.
          */}
          {dues && !dues.clear && (
            <div className="mb-3 rounded-lg border border-warning/40 bg-warning/[0.06] p-3">
              <p className="text-sm font-medium">Full and final - still open</p>
              <ul className="mt-1 grid gap-0.5 text-xs">
                {dues.loanPaise > 0 && <li>Staff loan outstanding: <strong>{formatCurrency(dues.loanPaise)}</strong></li>}
                {dues.advancePaise > 0 && <li>Advance outstanding: <strong>{formatCurrency(dues.advancePaise)}</strong></li>}
                {dues.owedToThemPaise > 0 && (
                  <li className="text-danger">
                    Expense claims <strong>the business owes them</strong>: <strong>{formatCurrency(dues.owedToThemPaise)}</strong> - pay this before they go
                  </li>
                )}
              </ul>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Offboarding cannot be completed until this is settled: recover it on the final payslip,
                settle it in cash on the Staff Balance screen, or write it off below.
              </p>
              {canManage && (dues.loanPaise > 0 || dues.advancePaise > 0) && (
                writingOff ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="text" value={writeOffReason} onChange={(e) => setWriteOffReason(e.target.value)}
                      placeholder="Why it is being written off"
                      className="h-8 min-w-[16rem] flex-1 rounded-lg border border-border bg-background px-2 text-sm"
                    />
                    <Button size="sm" variant="danger" disabled={!writeOffReason.trim()} loading={busy === 'writeoff'} onClick={writeOff}>
                      Write off {formatCurrency(dues.loanPaise + dues.advancePaise)}
                    </Button>
                    <Button size="sm" onClick={() => setWritingOff(false)}>Cancel</Button>
                  </div>
                ) : (
                  <Button size="sm" className="mt-2" onClick={() => setWritingOff(true)}>Write it off</Button>
                )
              )}
            </div>
          )}
          {dues?.clear && status === 'accepted' && (
            <p className="mb-3 text-xs text-success">Account is clear - nothing owed either way.</p>
          )}
          {canManage && status === 'accepted' && (
            <Button variant="primary" loading={busy === 'complete'} onClick={complete}>Complete offboarding</Button>
          )}
        </>
      )}
    </Modal>
  );
}
