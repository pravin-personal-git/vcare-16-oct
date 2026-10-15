'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@/components/ui/Icon';
import { ListFilter } from '@/components/ui/ListFilter';
import { Badge, Field, PageHeader, SectionCard, EmptyState } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { scheduleInterviewAction, markInterviewCompletedAction } from './actions';

interface InterviewRowVM {
  id: string; candidateId: string; candidateName: string; jobOpeningTitle: string;
  scheduledAt: string; description: string | null; completed: boolean; feedback: string | null;
  interviewers: { id: string; fullName: string }[];
}

interface Props {
  interviews: InterviewRowVM[];
  candidates: { id: string; fullName: string; jobOpeningTitle: string }[];
  interviewers: { id: string; fullName: string }[];
  canManage: boolean;
}

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function InterviewsClient({ interviews, candidates, interviewers, canManage }: Props) {
  const [scheduling, setScheduling] = useState(false);
  const [completing, setCompleting] = useState<InterviewRowVM | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upcoming = interviews.filter((i) => !i.completed);
  const past = interviews.filter((i) => i.completed);

  const report = (res: { error?: string }, okMessage: string) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : okMessage);
  };

  return (
    <div>
      <PageHeader
        badge="IN"
        title="Interviews"
        subtitle="Schedule and record interview feedback"
        actions={canManage && (
          <Button size="sm" variant="primary" icon="plus" disabled={candidates.length === 0} onClick={() => setScheduling(true)}>
            Schedule interview
          </Button>
        )}
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

      <SectionCard title={`${upcoming.length} upcoming`} icon="calendar" bodyClassName="p-0" className="mb-4">
        {upcoming.length === 0 ? (
          <EmptyState icon="calendar" title="Nothing scheduled" hint="Schedule one against a candidate still in the pipeline." />
        ) : (
          <div className="divide-y divide-border">
            {upcoming.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{i.candidateName}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.jobOpeningTitle} · {fmtDateTime(i.scheduledAt)} · {i.interviewers.map((u) => u.fullName).join(', ')}
                  </p>
                  {i.description && <p className="mt-1 text-xs text-muted-foreground">{i.description}</p>}
                </div>
                {canManage && (
                  <Button size="sm" variant="outline" onClick={() => setCompleting(i)}>Mark completed</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={`${past.length} completed`} icon="check-circle" bodyClassName="p-0">
        {past.length === 0 ? (
          <EmptyState icon="check-circle" title="No completed interviews yet" />
        ) : (
          /* F1b: completed interviews pile up; find one by candidate, opening or interviewer. */
          <ListFilter
            rows={past}
            noun="interviews"
            paramKey="iq"
            placeholder="Candidate, opening, interviewer, feedback…"
            searchOn={(i) => [i.candidateName, i.jobOpeningTitle, i.feedback, ...i.interviewers.map((u) => u.fullName)]}
            exportAs={{ title: 'Interviews', columns: [
              { header: 'Candidate', value: (r) => r.candidateName }, { header: 'Opening', value: (r) => r.jobOpeningTitle },
              { header: 'When', value: (r) => r.scheduledAt.slice(0, 16).replace('T', ' ') },
              { header: 'Interviewers', value: (r) => r.interviewers.map((u) => u.fullName).join(', ') },
              { header: 'Feedback', value: (r) => r.feedback },
            ] }}
          >
            {(found) => (found.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every completed interview." />
            ) : (
          <div className="divide-y divide-border">
            {found.map((i) => (
              <div key={i.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{i.candidateName}</p>
                  <Badge tone="success">Completed</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {i.jobOpeningTitle} · {fmtDateTime(i.scheduledAt)} · {i.interviewers.map((u) => u.fullName).join(', ')}
                </p>
                {i.feedback && <p className="mt-1 rounded-lg border border-border bg-muted/30 p-2 text-xs">{i.feedback}</p>}
              </div>
            ))}
          </div>
            ))}
          </ListFilter>
        )}
      </SectionCard>

      {scheduling && (
        <ScheduleModal
          candidates={candidates}
          interviewers={interviewers}
          onClose={() => setScheduling(false)}
          onSaved={(res) => { report(res, 'Interview scheduled.'); if (!res.error) setScheduling(false); }}
        />
      )}
      {completing && (
        <CompleteModal
          interview={completing}
          onClose={() => setCompleting(null)}
          onSaved={(res) => { report(res, 'Interview marked completed.'); if (!res.error) setCompleting(null); }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------

function ScheduleModal({
  candidates, interviewers, onClose, onSaved,
}: {
  candidates: { id: string; fullName: string; jobOpeningTitle: string }[];
  interviewers: { id: string; fullName: string }[];
  onClose: () => void;
  onSaved: (res: { error?: string }) => void;
}) {
  const [candidateId, setCandidateId] = useState(candidates[0]?.id ?? '');
  const [interviewerIds, setInterviewerIds] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleInterviewer = (id: string) =>
    setInterviewerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = () => {
    if (!candidateId || !scheduledAt || interviewerIds.length === 0) {
      setError('Choose a candidate, at least one interviewer, and a date/time.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await scheduleInterviewAction({
        candidateId, scheduledAt, interviewerUserIds: interviewerIds, description: description.trim() || null,
      });
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title="Schedule interview"
      icon="calendar"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>Schedule</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="grid gap-3">
        <Field label="Candidate" htmlFor="iv-candidate">
          <select id="iv-candidate" value={candidateId} onChange={(e) => setCandidateId(e.target.value)} className={input}>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.fullName} - {c.jobOpeningTitle}</option>)}
          </select>
        </Field>
        <Field label="Date and time" htmlFor="iv-when">
          <input id="iv-when" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={input} />
        </Field>
        <Field label="Interviewers" hint="Pick one or more.">
          <div className="flex flex-wrap gap-2">
            {interviewers.map((u) => (
              <button
                key={u.id} type="button" onClick={() => toggleInterviewer(u.id)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  interviewerIds.includes(u.id) ? 'border-brand bg-brand/10 text-on-tint-brand' : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {u.fullName}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Description" htmlFor="iv-desc" hint="Optional.">
          <textarea id="iv-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${input} h-auto py-2`} />
        </Field>
      </div>
    </Modal>
  );
}

function CompleteModal({
  interview, onClose, onSaved,
}: {
  interview: InterviewRowVM;
  onClose: () => void;
  onSaved: (res: { error?: string }) => void;
}) {
  const [feedback, setFeedback] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await markInterviewCompletedAction(interview.id, feedback.trim() || null);
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title={`Complete interview - ${interview.candidateName}`}
      icon="check-circle"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>Mark completed</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <Field label="Feedback" htmlFor="iv-feedback" hint="Optional.">
        <textarea id="iv-feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={4} className={`${input} h-auto py-2`} />
      </Field>
    </Modal>
  );
}
