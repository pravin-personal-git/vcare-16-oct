'use client';

import { useEffect, useState, useTransition } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge, Field, PageHeader, SectionCard, EmptyState } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  createSkillZoneAction, fetchSkillZoneCandidatesAction, addCandidateToSkillZoneAction, removeCandidateFromSkillZoneAction,
} from './actions';

interface SkillZoneVM {
  id: string; title: string; description: string | null; activeCandidateCount: number; createdAt: string;
}
interface CandidateOptionVM {
  id: string; fullName: string; jobOpeningTitle: string; stage: string;
}
interface SkillZoneCandidateVM {
  id: string; candidateId: string; candidateName: string; jobOpeningTitle: string;
  reason: string; isActive: boolean; addedOn: string;
}

interface Props {
  zones: SkillZoneVM[];
  candidates: CandidateOptionVM[];
  canManage: boolean;
}

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

export function TalentPoolClient({ zones, candidates, canManage }: Props) {
  const [creating, setCreating] = useState(false);
  const [openZone, setOpenZone] = useState<SkillZoneVM | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const report = (res: { error?: string }, okMessage: string) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : okMessage);
  };

  return (
    <div>
      <PageHeader
        badge="TP"
        title="Talent Pool"
        subtitle="Candidates kept for later"
        actions={canManage && <Button size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>New talent pool</Button>}
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

      {zones.length === 0 ? (
        <SectionCard title="Talent pools" icon="users" bodyClassName="p-0">
          <EmptyState icon="users" title="No talent pools yet" hint="Create one to start keeping strong candidates for later openings." />
        </SectionCard>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {zones.map((z) => (
            <button
              key={z.id} type="button" onClick={() => setOpenZone(z)}
              className="rounded-lg border border-border bg-card p-4 text-start shadow-card transition hover:border-brand/40"
            >
              <p className="text-sm font-semibold">{z.title}</p>
              {z.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{z.description}</p>}
              <div className="mt-3">
                <Badge tone="info">{z.activeCandidateCount} candidate{z.activeCandidateCount === 1 ? '' : 's'}</Badge>
              </div>
            </button>
          ))}
        </div>
      )}

      {creating && (
        <CreateZoneModal
          onClose={() => setCreating(false)}
          onSaved={(res) => { report(res, 'Talent pool created.'); if (!res.error) setCreating(false); }}
        />
      )}
      {openZone && (
        <ZoneDetailModal
          zone={openZone}
          candidates={candidates}
          canManage={canManage}
          onClose={() => setOpenZone(null)}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------

function CreateZoneModal({ onClose, onSaved }: { onClose: () => void; onSaved: (res: { error?: string }) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!title.trim()) { setError('Name is required.'); return; }
    setError(null);
    startTransition(async () => {
      const res = await createSkillZoneAction({ title: title.trim(), description: description.trim() || null });
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title="New talent pool"
      icon="users"
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
        <Field label="Name" htmlFor="tp-title">
          <input id="tp-title" value={title} onChange={(e) => setTitle(e.target.value)} className={input} placeholder="e.g. Strong backend candidates" />
        </Field>
        <Field label="Description" htmlFor="tp-desc" hint="Optional.">
          <textarea id="tp-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${input} h-auto py-2`} />
        </Field>
      </div>
    </Modal>
  );
}

function ZoneDetailModal({
  zone, candidates, canManage, onClose,
}: {
  zone: SkillZoneVM;
  candidates: CandidateOptionVM[];
  canManage: boolean;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<SkillZoneCandidateVM[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [candidateId, setCandidateId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | boolean>(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    fetchSkillZoneCandidatesAction(zone.id).then((res) => {
      if (res.error) setError(res.error);
      else setEntries(res.data ?? []);
    });
  }

  useEffect(reload, [zone.id]);

  async function addToZone() {
    if (!candidateId || !reason.trim()) { setError('Choose a candidate and say why.'); return; }
    setBusy('add');
    setError(null);
    const res = await addCandidateToSkillZoneAction({ skillZoneId: zone.id, candidateId, reason: reason.trim() });
    if (res.error) setError(res.error);
    else { setAdding(false); setCandidateId(''); setReason(''); reload(); }
    setBusy(false);
  }

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    const res = await removeCandidateFromSkillZoneAction(id);
    if (res.error) setError(res.error);
    else reload();
    setBusy(false);
  }

  const active = entries?.filter((e) => e.isActive) ?? [];

  return (
    <Modal title={zone.title} subtitle={zone.description ?? undefined} icon="users" size="md" onClose={onClose}>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      {canManage && (
        adding ? (
          <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3">
            <div className="grid gap-2">
              <select value={candidateId} onChange={(e) => setCandidateId(e.target.value)} className={input}>
                <option value="">Choose a candidate…</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.fullName} - {c.jobOpeningTitle}</option>)}
              </select>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why keep them for later?" className={input} />
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => setAdding(false)} disabled={busy === 'add'}>Cancel</Button>
                <Button size="sm" variant="primary" loading={busy === 'add'} onClick={addToZone}>Add</Button>
              </div>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" icon="plus" className="mb-4" onClick={() => setAdding(true)}>Add candidate</Button>
        )
      )}

      {entries === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : active.length === 0 ? (
        <EmptyState icon="users" title="Nobody here yet" />
      ) : (
        <div className="divide-y divide-border">
          {active.map((e) => (
            <div key={e.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{e.candidateName}</p>
                <p className="text-xs text-muted-foreground">{e.jobOpeningTitle} · {e.reason}</p>
              </div>
              {canManage && (
                <button type="button" disabled={busy === e.id} onClick={() => remove(e.id)} className="text-xs font-medium text-danger hover:underline">
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
