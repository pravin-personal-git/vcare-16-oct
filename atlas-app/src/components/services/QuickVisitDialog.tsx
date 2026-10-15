'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { reasonsFor, type VisitSubject } from '@/lib/visit-reasons';
import { scheduleVisitAction } from '@/app/(app)/services/actions';

/**
 * SCHEDULE A VISIT FROM THE THING ITSELF (G-24, 10 Oct 2026).
 *
 * From inside a complaint or an installation challan, the visit is obviously
 * for THAT document - sending the office to the Visit Scheduler to pick it
 * again from a search box was a second popup asking a question already
 * answered. Here the number and customer are fixed; only why, who and when
 * are asked. The reasons offered are the ones that belong to this kind of
 * document (lib/visit-reasons), so a complaint cannot be booked as a survey.
 */
export function QuickVisitDialog({ subject, subjectId, label, technicians, defaultTechnicianId = '', defaultReason, onClose, onDone }: {
  subject: VisitSubject;
  subjectId: string;
  /** "CMP-BR001-2026-0023 · Manan Nirmalkar" - what is being visited, shown, not chosen. */
  label: string;
  technicians: { id: string; fullName: string }[];
  defaultTechnicianId?: string;
  defaultReason?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const reasons = reasonsFor(subject);
  const [reason, setReason] = useState(defaultReason && reasons.some((r) => r.key === defaultReason) ? defaultReason : reasons[0]?.key ?? '');
  const [technicianId, setTechnicianId] = useState(defaultTechnicianId);
  const [scheduledAt, setScheduledAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // A survey is a looking trip; everything else is doing the work.
  const purpose = reason === 'installation_survey' ? 'info_collection' : 'field_visit';

  const save = () => {
    setError(null);
    if (!technicianId) { setError('Choose who is going.'); return; }
    if (!scheduledAt) { setError('Choose the date and time.'); return; }
    start(async () => {
      const r = await scheduleVisitAction(subjectId, technicianId, purpose, scheduledAt, reason);
      if (r.error) { setError(r.error); return; }
      onDone();
    });
  };

  return (
    <Modal title="Schedule a visit" icon="calendar" size="sm" onClose={onClose}
      footer={<><Button onClick={onClose} disabled={pending}>Cancel</Button><Button variant="primary" loading={pending} onClick={save}>Schedule</Button></>}>
      <div className="grid gap-3 text-sm">
        <p className="rounded-lg bg-muted px-3 py-2 font-medium" data-no-translate>{label}</p>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Why is somebody going?</legend>
          {reasons.map((r) => (
            <label key={r.key} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 ${r.key === reason ? 'border-brand bg-brand/[0.06]' : 'border-border hover:bg-muted/50'}`}>
              <input type="radio" name="quick-visit-reason" value={r.key} checked={r.key === reason} onChange={() => setReason(r.key)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-xs font-semibold">{r.label}</span>
                <span className="block text-micro text-muted-foreground">{r.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Who is going
          <select id="quick-visit-tech" value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} className="field-input">
            <option value="">Choose...</option>
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">When
          <input id="quick-visit-at" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="field-input" />
        </label>
        {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-on-tint-danger">{error}</p>}
      </div>
    </Modal>
  );
}
