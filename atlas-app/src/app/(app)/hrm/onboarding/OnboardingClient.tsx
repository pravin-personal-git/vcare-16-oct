'use client';
import { ListFilter } from '@/components/ui/ListFilter';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { newestFirst, oldestFirst, type CardListPage } from '@/lib/card-list';
import {
  startOnboardingAction, markConfirmedAction, setOnboardingTaskStatusAction,
  createOnboardingStepAction, removeOnboardingStepAction, fetchOnboardingTasksAction,
} from './actions';

interface JoinerRow {
  userId: string;
  fullName: string;
  dateOfJoining: string | null;
  employmentType: string;
  confirmedAt: string | null;
  progress: { total: number; done: number; skipped: number; pending: number };
}

interface StepRow {
  id: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function OnboardingClient({
  joiners, steps, canManage, listPage,
}: { joiners: JoinerRow[]; steps: StepRow[]; canManage: boolean; listPage: CardListPage }) {
  const router = useRouter();
  const [starting, setStarting] = useState<JoinerRow | null>(null);
  const [checklistFor, setChecklistFor] = useState<JoinerRow | null>(null);
  const [managingSteps, setManagingSteps] = useState(false);
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
        badge="OB"
        title="Onboarding"
        subtitle="New joiners and their onboarding checklist"
        actions={canManage ? <Button variant="outline" iconEnd="sliders" onClick={() => setManagingSteps(true)}>Steps</Button> : undefined}
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}

      <SectionCard title={`${listPage.total} team member${listPage.total === 1 ? '' : 's'}`} icon="user-plus" bodyClassName="p-0">
        {listPage.total === 0 ? (
          <EmptyState icon="user-plus" title="Nobody here yet" hint="Anyone holding a role in this store shows up here." />
        ) : (
          /* F1b / D17. The chip that matters is "whose onboarding is not
             finished" - the whole point of the screen, and previously only
             answerable by reading every progress bar. */
          <ListFilter
            server={listPage.server}
            exportScreen="onboarding"
            rows={joiners}
            // Date filter and sort (9 Oct 2026) - same keys as server/card-lists.
            dates={[{ key: 'joined', label: 'Joining date', of: (r) => r.dateOfJoining, future: true }, { key: 'confirmed', label: 'Confirmed on', of: (r) => r.confirmedAt }]}
            sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.dateOfJoining) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.dateOfJoining) }]}
            noun="people"
            placeholder="Name or employment type…"
            searchOn={(j) => [j.fullName, j.employmentType]}
            chipOf={(j) => (j.progress.pending > 0 ? 'open' : 'done')}
            chipLabel="Onboarding"
            chips={[
              { value: 'open', label: 'Still to finish', count: listPage.chipCounts.open ?? 0 },
              { value: 'done', label: 'Complete', count: listPage.chipCounts.done ?? 0 },
            ]}
          >
            {(shown) => (shown.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see everybody." />
            ) : (
          <div className="divide-y divide-border">
            {shown.map((j) => (
              <div key={j.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{j.fullName}</p>
                    {j.confirmedAt && <Badge tone="success">Confirmed</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {j.dateOfJoining
                      ? `Joined ${new Date(j.dateOfJoining).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}`
                      : 'Onboarding not started'}
                    {j.dateOfJoining && ` · ${j.employmentType.replace('_', ' ')}`}
                    {j.progress.total > 0 && ` · ${j.progress.done}/${j.progress.total} steps done`}
                  </p>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {j.progress.total === 0 ? (
                      <Button size="sm" variant="primary" onClick={() => setStarting(j)}>Start onboarding</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setChecklistFor(j)}>View checklist</Button>
                    )}
                    {j.dateOfJoining && !j.confirmedAt && (
                      <Button size="sm" variant="outline" loading={busy === `conf-${j.userId}`} onClick={() => act(`conf-${j.userId}`, () => markConfirmedAction(j.userId))}>
                        Mark confirmed
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
            ))}
          </ListFilter>
        )}
      </SectionCard>

      {starting && (
        <StartDialog
          joiner={starting}
          busy={busy === 'start'}
          onClose={() => setStarting(null)}
          onStart={async (input) => { if (await act('start', () => startOnboardingAction(starting.userId, input))) setStarting(null); }}
        />
      )}

      {checklistFor && (
        <ChecklistDialog joiner={checklistFor} onClose={() => setChecklistFor(null)} onChanged={() => router.refresh()} />
      )}

      {managingSteps && (
        <StepsDialog
          steps={steps}
          busy={busy}
          onClose={() => setManagingSteps(false)}
          onAdd={(label) => act('step-add', () => createOnboardingStepAction(label))}
          onRemove={(id) => act(`step-rm-${id}`, () => removeOnboardingStepAction(id))}
        />
      )}
    </div>
  );
}

function StartDialog({
  joiner, busy, onClose, onStart,
}: {
  joiner: JoinerRow;
  busy: boolean;
  onClose: () => void;
  onStart: (input: {
    dateOfJoining: Date | null; employmentType: string; personalEmail: string | null;
    address: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null;
  }) => void;
}) {
  const [dateOfJoining, setDateOfJoining] = useState(new Date().toISOString().slice(0, 10));
  const [employmentType, setEmploymentType] = useState('full_time');
  const [personalEmail, setPersonalEmail] = useState('');
  const [address, setAddress] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  return (
    <Modal
      title={`Start onboarding - ${joiner.fullName}`}
      subtitle="Generates every active onboarding step for this person"
      icon="user-plus"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!dateOfJoining}
            onClick={() => onStart({
              dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : null, employmentType,
              personalEmail: personalEmail.trim() || null, address: address.trim() || null,
              emergencyContactName: emergencyName.trim() || null, emergencyContactPhone: emergencyPhone.trim() || null,
            })}>
            Start onboarding
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date of joining" required htmlFor="ob-doj">
          <input id="ob-doj" type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Employment type" htmlFor="ob-type">
          <select id="ob-type" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} className={inputClass}>
            <option value="full_time">Full-time</option>
            <option value="part_time">Part-time</option>
            <option value="contract">Contract</option>
            <option value="intern">Intern</option>
          </select>
        </Field>
        <Field label="Personal email" htmlFor="ob-email" className="sm:col-span-2">
          <input id="ob-email" value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Address" htmlFor="ob-address" className="sm:col-span-2">
          <textarea id="ob-address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand" />
        </Field>
        <Field label="Emergency contact name" htmlFor="ob-em-name">
          <input id="ob-em-name" value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Emergency contact phone" htmlFor="ob-em-phone">
          <input id="ob-em-phone" value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} className={inputClass} />
        </Field>
      </div>
    </Modal>
  );
}

function ChecklistDialog({
  joiner, onClose, onChanged,
}: { joiner: JoinerRow; onClose: () => void; onChanged: () => void }) {
  const [tasks, setTasks] = useState<{ id: string; label: string; status: string; completedAt: string | null }[] | null>(null);
  const [busy, setBusy] = useState<string | boolean>(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    fetchOnboardingTasksAction(joiner.userId).then((res) => {
      if (res.error) setError(res.error);
      else setTasks(res.data ?? []);
    });
  }

  useEffect(reload, [joiner.userId]);

  async function toggle(taskId: string, status: 'done' | 'skipped' | 'pending') {
    setBusy(taskId);
    setError(null);
    const res = await setOnboardingTaskStatusAction(taskId, status);
    if (res.error) setError(res.error);
    else { reload(); onChanged(); }
    setBusy(false);
  }

  return (
    <Modal title={`Onboarding checklist - ${joiner.fullName}`} icon="user-plus" size="md" onClose={onClose}>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      {!tasks ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active onboarding steps configured.</p>
      ) : (
        <ul className="divide-y divide-border">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 py-2.5">
              <span className={`text-sm ${t.status === 'skipped' ? 'text-muted-foreground line-through' : ''}`}>{t.label}</span>
              <div className="flex gap-1.5">
                {t.status !== 'done' && (
                  <Button size="sm" variant={t.status === 'pending' ? 'primary' : 'outline'} loading={busy === t.id} onClick={() => toggle(t.id, 'done')}>Done</Button>
                )}
                {t.status !== 'skipped' && t.status !== 'done' && (
                  <Button size="sm" variant="outline" loading={busy === t.id} onClick={() => toggle(t.id, 'skipped')}>Skip</Button>
                )}
                {t.status !== 'pending' && (
                  <Button size="sm" variant="outline" loading={busy === t.id} onClick={() => toggle(t.id, 'pending')}>Undo</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
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
    <Modal title="Onboarding steps" subtitle="What every new joiner works through" icon="sliders" size="sm" onClose={onClose}>
      <div className="mb-3 flex gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ID card, Laptop setup, Bank details…" className={inputClass} />
        <Button variant="primary" loading={busy === 'step-add'} disabled={!label.trim()} onClick={async () => { if (await onAdd(label.trim())) setLabel(''); }}>
          Add
        </Button>
      </div>
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No steps yet - onboarding will start with an empty checklist.</p>
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
