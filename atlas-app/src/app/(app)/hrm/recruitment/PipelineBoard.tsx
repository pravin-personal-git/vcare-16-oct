'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Layout';
import { moveCandidateStageAction } from './actions';

type CandidateStage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';

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

const COLUMNS: { stage: CandidateStage; label: string }[] = [
  { stage: 'applied', label: 'Applied' },
  { stage: 'screening', label: 'Screening' },
  { stage: 'interview', label: 'Interview' },
  { stage: 'offer', label: 'Offer' },
  { stage: 'hired', label: 'Hired' },
  { stage: 'rejected', label: 'Rejected' },
];

const STAGE_ORDER: CandidateStage[] = ['applied', 'screening', 'interview', 'offer', 'hired'];

/**
 * The kanban view over the same `Candidate.stage` data the flat table
 * already shows (roadmap §4.6) - additive UI, no new schema. Each card's
 * "Advance"/"Reject" buttons call the exact same `moveCandidateStageAction`
 * the table's detail dialog uses, so the two views can never disagree about
 * what moves are legal - `assertForwardOrRejection` in recruitment.ts is
 * still the one place that rule lives.
 */
export function PipelineBoard({
  candidates, canManage, onOpenCandidate, onChanged,
}: {
  candidates: CandidateRow[];
  canManage: boolean;
  onOpenCandidate: (c: CandidateRow) => void;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(candidateId: string, toStage: CandidateStage) {
    setBusyId(candidateId);
    setError(null);
    const res = await moveCandidateStageAction(candidateId, toStage, null);
    if (res.error) setError(res.error);
    else onChanged();
    setBusyId(null);
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <div className="grid grid-flow-col auto-cols-[16rem] gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((col) => {
          const items = candidates.filter((c) => c.stage === col.stage);
          const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(col.stage) + 1];
          return (
            <div key={col.stage} className="flex flex-col rounded-lg border border-border bg-muted/30">
              <div className="flex items-center justify-between rounded-t-lg border-b border-border bg-card px-3 py-2">
                <span className="text-xs font-semibold">{col.label}</span>
                <Badge tone="neutral">{items.length}</Badge>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-2">
                {items.length === 0 ? (
                  <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nothing here</p>
                ) : (
                  items.map((c) => (
                    <div key={c.id} className="rounded-lg border border-border bg-card p-2.5 shadow-card">
                      <button type="button" onClick={() => onOpenCandidate(c)} className="block w-full text-start">
                        <p className="truncate text-sm font-semibold">{c.fullName}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.jobOpeningTitle}</p>
                      </button>
                      {canManage && col.stage !== 'hired' && col.stage !== 'rejected' && (
                        <div className="mt-2 flex gap-1.5">
                          {nextStage && (
                            <button
                              type="button"
                              disabled={busyId === c.id}
                              onClick={() => move(c.id, nextStage)}
                              className="flex h-6 flex-1 items-center justify-center gap-1 rounded bg-brand/10 text-xs font-medium text-on-tint-brand transition hover:bg-brand/20 disabled:opacity-50"
                            >
                              <Icon name="chevron-right" className="h-3 w-3" /> Advance
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busyId === c.id}
                            onClick={() => move(c.id, 'rejected')}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-danger/10 text-on-tint-danger transition hover:bg-danger/20 disabled:opacity-50"
                            title="Reject"
                          >
                            <Icon name="x" className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
