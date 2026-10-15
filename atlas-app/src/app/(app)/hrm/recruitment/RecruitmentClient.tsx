'use client';
import { ListFilter } from '@/components/ui/ListFilter';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard, Segmented } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import {
  createJobOpeningAction, setJobOpeningStatusAction, addCandidateAction, moveCandidateStageAction,
  addCandidateNoteAction, fetchCandidateActivityAction, linkHiredCandidateAction, fetchLinkableUsersAction,
} from './actions';
import { PipelineBoard } from './PipelineBoard';

type CandidateStage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';

interface JobOpeningRow {
  id: string;
  title: string;
  department: string | null;
  openings: number;
  description: string | null;
  status: string;
  candidateCount: number;
  hiredCount: number;
  createdAt: string;
}

interface CandidateRow {
  id: string;
  jobOpeningId: string;
  jobOpeningTitle: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  notes: string | null;
  stage: CandidateStage;
  hiredUserId: string | null;
  createdAt: string;
}

const STAGE_ORDER: CandidateStage[] = ['applied', 'screening', 'interview', 'offer', 'hired'];
const STAGE_LABEL: Record<CandidateStage, string> = {
  applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected',
};
const STAGE_TONE: Record<CandidateStage, 'neutral' | 'brand' | 'warning' | 'success' | 'danger' | 'info'> = {
  applied: 'neutral', screening: 'info', interview: 'brand', offer: 'warning', hired: 'success', rejected: 'danger',
};
const OPENING_STATUS_TONE = { open: 'success', on_hold: 'warning', closed: 'neutral' } as const;

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function RecruitmentClient({
  openings, candidates, canManage,
}: {
  openings: JobOpeningRow[];
  candidates: CandidateRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'openings' | 'candidates' | 'pipeline'>('openings');
  const [stageFilter, setStageFilter] = useState<'all' | CandidateStage>('all');
  const [creatingOpening, setCreatingOpening] = useState(false);
  const [addingCandidate, setAddingCandidate] = useState(false);
  const [openCandidate, setOpenCandidate] = useState<CandidateRow | null>(null);
  const [busy, setBusy] = useState<string | boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const openOpenings = openings.filter((o) => o.status === 'open');
  const shownCandidates = stageFilter === 'all' ? candidates : candidates.filter((c) => c.stage === stageFilter);

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
        badge="RC"
        title="Recruitment"
        subtitle="Openings and the candidates moving through them"
        actions={canManage ? (
          <div className="flex gap-2">
            <Button variant="outline" iconEnd="plus" onClick={() => setCreatingOpening(true)}>New Opening</Button>
            <Button variant="primary" iconEnd="user-plus" disabled={openOpenings.length === 0} onClick={() => setAddingCandidate(true)}>
              Add Candidate
            </Button>
          </div>
        ) : undefined}
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}

      <div className="mb-3">
        <Segmented
          options={[
            { value: 'openings', label: `Openings (${openings.length})` },
            { value: 'candidates', label: `Candidates (${candidates.length})` },
            { value: 'pipeline', label: 'Pipeline' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'openings' && (
        <SectionCard title={`${openings.length} opening${openings.length === 1 ? '' : 's'}`} icon="user-plus" bodyClassName="p-0">
          {openings.length === 0 ? (
            <EmptyState icon="user-plus" title="No openings yet" hint="Add one to start tracking candidates against it." />
          ) : (
            <ListFilter
              exportAs={{ title: 'Job openings', columns: [{ header: 'Title', value: (r) => r.title }, { header: 'Department', value: (r) => r.department }, { header: 'Openings', value: (r) => r.openings }, { header: 'Status', value: (r) => r.status }, { header: 'Candidates', value: (r) => r.candidateCount }, { header: 'Hired', value: (r) => r.hiredCount }, { header: 'Opened', value: (r) => r.createdAt ? r.createdAt.slice(0, 10) : '' }] }}
              rows={openings}
              noun="openings"
              paramKey="op"
              placeholder="Job title, status…"
              searchOn={(o) => [o.title, o.status.replace('_', ' ')]}
              chipOf={(o) => o.status}
              chipLabel="Status"
              chips={[...new Set(openings.map((o) => o.status))].sort().map((s) => ({
                value: s, label: s.replace('_', ' '), count: openings.filter((o) => o.status === s).length,
              }))}
            >
              {(shownOpenings) => (shownOpenings.length === 0 ? (
                <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every opening." />
              ) : (
            <div className="divide-y divide-border">
              {shownOpenings.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{o.title}</p>
                      <Badge tone={OPENING_STATUS_TONE[o.status as keyof typeof OPENING_STATUS_TONE] ?? 'neutral'}>{o.status.replace('_', ' ')}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {o.department && `${o.department} · `}{o.openings} opening{o.openings === 1 ? '' : 's'} · {o.candidateCount} candidate{o.candidateCount === 1 ? '' : 's'} · {o.hiredCount} hired
                    </p>
                  </div>
                  {canManage && o.status !== 'closed' && (
                    <div className="flex gap-2">
                      {o.status === 'open' ? (
                        <Button size="sm" variant="outline" loading={busy === `hold-${o.id}`} onClick={() => act(`hold-${o.id}`, () => setJobOpeningStatusAction(o.id, 'on_hold'))}>
                          Put on hold
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" loading={busy === `open-${o.id}`} onClick={() => act(`open-${o.id}`, () => setJobOpeningStatusAction(o.id, 'open'))}>
                          Reopen
                        </Button>
                      )}
                      <Button size="sm" variant="outline" loading={busy === `close-${o.id}`} onClick={() => act(`close-${o.id}`, () => setJobOpeningStatusAction(o.id, 'closed'))}>
                        Close
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
              ))}
            </ListFilter>
          )}
        </SectionCard>
      )}

      {tab === 'candidates' && (
        <>
          <div className="mb-3">
            <Segmented
              options={[
                { value: 'all', label: 'All' },
                ...STAGE_ORDER.map((s) => ({ value: s, label: STAGE_LABEL[s] })),
                { value: 'rejected', label: 'Rejected' },
              ]}
              value={stageFilter}
              onChange={setStageFilter}
            />
          </div>
          <SectionCard title={`${shownCandidates.length} candidate${shownCandidates.length === 1 ? '' : 's'}`} icon="users" bodyClassName="p-0">
            {shownCandidates.length === 0 ? (
              <EmptyState icon="users" title="No candidates here" hint="Add one against an open job posting." />
            ) : (
              /* The stage strip above already filters; what was missing is
                 search. Finding the person somebody just rang about, by name or
                 by phone number, is the whole job of this screen. */
              <ListFilter
                exportAs={{ title: 'Candidates', columns: [{ header: 'Name', value: (r) => r.fullName }, { header: 'Phone', value: (r) => r.phone }, { header: 'Email', value: (r) => r.email }, { header: 'Opening', value: (r) => r.jobOpeningTitle }, { header: 'Stage', value: (r) => r.stage }, { header: 'Source', value: (r) => r.source }, { header: 'Added', value: (r) => r.createdAt ? r.createdAt.slice(0, 10) : '' }] }}
                rows={shownCandidates}
                noun="candidates"
                paramKey="cand"
                placeholder="Name, phone, job opening, source…"
                searchOn={(c) => [c.fullName, c.phone, c.jobOpeningTitle, c.source]}
              >
                {(found) => (found.length === 0 ? (
                  <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every candidate at this stage." />
                ) : (
              <div className="divide-y divide-border">
                {found.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setOpenCandidate(c)}
                    className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start transition hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{c.fullName}</p>
                        <Badge tone={STAGE_TONE[c.stage]}>{STAGE_LABEL[c.stage]}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {c.jobOpeningTitle}{c.phone && ` · ${c.phone}`}{c.source && ` · ${c.source}`}
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
        </>
      )}

      {tab === 'pipeline' && (
        <PipelineBoard
          candidates={candidates}
          canManage={canManage}
          onOpenCandidate={setOpenCandidate}
          onChanged={() => router.refresh()}
        />
      )}

      {creatingOpening && (
        <OpeningDialog
          busy={busy === 'opening'}
          onClose={() => setCreatingOpening(false)}
          onSave={async (input) => { if (await act('opening', () => createJobOpeningAction(input))) setCreatingOpening(false); }}
        />
      )}

      {addingCandidate && (
        <CandidateDialog
          openings={openOpenings}
          busy={busy === 'candidate'}
          onClose={() => setAddingCandidate(false)}
          onSave={async (input) => { if (await act('candidate', () => addCandidateAction(input))) setAddingCandidate(false); }}
        />
      )}

      {openCandidate && (
        <CandidateDetailDialog
          candidate={openCandidate}
          canManage={canManage}
          onClose={() => setOpenCandidate(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function OpeningDialog({
  busy, onClose, onSave,
}: { busy: boolean; onClose: () => void; onSave: (input: { title: string; department: string | null; openings: number; description: string | null }) => void }) {
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [openings, setOpenings] = useState('1');
  const [description, setDescription] = useState('');

  return (
    <Modal
      title="New job opening"
      icon="user-plus"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!title.trim() || Number(openings) < 1}
            onClick={() => onSave({ title: title.trim(), department: department.trim() || null, openings: Number(openings), description: description.trim() || null })}>
            Create
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job title" required htmlFor="jo-title" className="sm:col-span-2">
          <input id="jo-title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Department" htmlFor="jo-dept">
          <input id="jo-dept" value={department} onChange={(e) => setDepartment(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Number of openings" required htmlFor="jo-count">
          <input id="jo-count" type="number" min={1} value={openings} onChange={(e) => setOpenings(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Description" htmlFor="jo-desc" className="sm:col-span-2">
          <textarea id="jo-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand" />
        </Field>
      </div>
    </Modal>
  );
}

function CandidateDialog({
  openings, busy, onClose, onSave,
}: {
  openings: JobOpeningRow[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: { jobOpeningId: string; fullName: string; phone: string | null; email: string | null; source: string | null; notes: string | null }) => void;
}) {
  const [jobOpeningId, setJobOpeningId] = useState(openings[0]?.id ?? '');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <Modal
      title="Add a candidate"
      icon="user-plus"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!fullName.trim() || !jobOpeningId}
            onClick={() => onSave({
              jobOpeningId, fullName: fullName.trim(), phone: phone.trim() || null,
              email: email.trim() || null, source: source.trim() || null, notes: notes.trim() || null,
            })}>
            Add
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job opening" required htmlFor="cd-opening" className="sm:col-span-2">
          <select id="cd-opening" value={jobOpeningId} onChange={(e) => setJobOpeningId(e.target.value)} className={inputClass}>
            {openings.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
        </Field>
        <Field label="Full name" required htmlFor="cd-name" className="sm:col-span-2">
          <input id="cd-name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Phone" htmlFor="cd-phone">
          <input id="cd-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Email" htmlFor="cd-email">
          <input id="cd-email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Source" hint="Referral, Job Portal, Direct…" htmlFor="cd-source" className="sm:col-span-2">
          <input id="cd-source" value={source} onChange={(e) => setSource(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Notes" htmlFor="cd-notes" className="sm:col-span-2">
          <textarea id="cd-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand" />
        </Field>
      </div>
    </Modal>
  );
}

function CandidateDetailDialog({
  candidate, canManage, onClose, onChanged,
}: { candidate: CandidateRow; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const [activity, setActivity] = useState<{ id: string; kind: string; body: string | null; stageFrom: string | null; stageTo: string | null; authorName: string | null; createdAt: string }[] | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [linkableUsers, setLinkableUsers] = useState<{ id: string; fullName: string }[] | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [busy, setBusy] = useState<string | boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState(candidate.stage);

  function reload() {
    fetchCandidateActivityAction(candidate.id).then((res) => {
      if (res.error) setError(res.error);
      else setActivity(res.data ?? []);
    });
  }

  useEffect(() => {
    reload();
    if (candidate.stage === 'hired' && canManage) {
      fetchLinkableUsersAction().then((res) => { if (res.data) setLinkableUsers(res.data); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.id]);

  async function advance(toStage: CandidateStage) {
    setBusy(`stage-${toStage}`);
    setError(null);
    const res = await moveCandidateStageAction(candidate.id, toStage, null);
    if (res.error) setError(res.error);
    else { setStage(toStage); reload(); onChanged(); }
    setBusy(false);
  }

  async function postNote() {
    if (!noteBody.trim()) return;
    setBusy('note');
    setError(null);
    const res = await addCandidateNoteAction(candidate.id, noteBody.trim());
    if (res.error) setError(res.error);
    else { setNoteBody(''); reload(); }
    setBusy(false);
  }

  async function link() {
    if (!selectedUserId) return;
    setBusy('link');
    setError(null);
    const res = await linkHiredCandidateAction(candidate.id, selectedUserId);
    if (res.error) setError(res.error);
    else { reload(); onChanged(); }
    setBusy(false);
  }

  const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(stage) + 1];

  return (
    <Modal title={candidate.fullName} subtitle={candidate.jobOpeningTitle} icon="user-plus" size="lg" onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>
        {candidate.phone && <span className="text-xs text-muted-foreground">{candidate.phone}</span>}
        {candidate.email && <span className="text-xs text-muted-foreground">{candidate.email}</span>}
      </div>

      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      {canManage && stage !== 'hired' && stage !== 'rejected' && (
        <div className="mb-4 flex flex-wrap gap-2">
          {nextStage && (
            <Button size="sm" variant="primary" loading={busy === `stage-${nextStage}`} onClick={() => advance(nextStage)}>
              Advance to {STAGE_LABEL[nextStage]}
            </Button>
          )}
          <Button size="sm" variant="outline" loading={busy === 'stage-rejected'} onClick={() => advance('rejected')}>
            Reject
          </Button>
        </div>
      )}

      {canManage && stage === 'hired' && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {!linkableUsers ? (
            <p className="text-xs text-muted-foreground">Loading user list…</p>
          ) : (
            <>
              <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className={`${inputClass} w-auto`}>
                <option value="">Link to a user account…</option>
                {linkableUsers.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </select>
              <Button size="sm" variant="outline" loading={busy === 'link'} disabled={!selectedUserId} onClick={link}>Link</Button>
            </>
          )}
        </div>
      )}

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activity</p>
      {!activity ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="mb-3 max-h-64 space-y-2 overflow-y-auto">
          {activity.map((a) => (
            <li key={a.id} className="border-b border-border pb-2 text-sm last:border-0">
              {a.kind === 'stage_change' ? (
                <span className="text-muted-foreground">
                  {a.authorName ?? 'Someone'} moved this from <strong>{a.stageFrom}</strong> to <strong>{a.stageTo}</strong>
                  {a.body && ` — ${a.body}`}
                </span>
              ) : (
                <span><span className="font-medium">{a.authorName ?? 'Someone'}:</span> {a.body}</span>
              )}
              <span className="block text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString('en-IN')}</span>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="flex gap-2">
          <input value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Add a note…" className={inputClass}
            onKeyDown={(e) => e.key === 'Enter' && postNote()} />
          <Button variant="outline" loading={busy === 'note'} disabled={!noteBody.trim()} onClick={postNote}>Post</Button>
        </div>
      )}
    </Modal>
  );
}
