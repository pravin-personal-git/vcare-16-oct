'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Layout';

/**
 * Field-job controls on the job page (workflow slice 2): the reason prompt
 * for steps that need one, and moving or cancelling a visit with a reason -
 * the reason is what the customer and technician see in the trail.
 */

/** Steps the office must explain: cancel, send back, reopen. */
export function needsReason(from: string, to: string, needsCallback = false): string | null {
  if (to === 'cancelled') return 'Why is this job cancelled?';
  // The technician closed it without the customer's code (workflow slice 6).
  if (to === 'closed' && needsCallback) return 'Call the customer first - what did they say?';
  if (from === 'resolved' && to === 'in_progress') return 'Why is it going back to the technician?';
  if (from === 'closed' && to === 'in_progress') return 'Why is this job being reopened?';
  return null;
}

export function ReasonDialog({ title, busy, onClose, onConfirm }: {
  title: string; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={title} icon="alert-circle" size="md" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>Confirm</Button></>}>
      <Field label="Reason" required htmlFor="job-reason">
        <textarea id="job-reason" autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="field-input" />
      </Field>
    </Modal>
  );
}

/**
 * The office marks a visit done from the complaint page (25 Oct 2026, Vcare).
 * A field visit never checked in on the phone needs a reason, kept on the job.
 */
export function CompleteVisitDialog({ checkedIn, busy, onClose, onConfirm }: {
  checkedIn: boolean; busy: boolean; onClose: () => void;
  onConfirm: (input: { outcome: string; override: string | null }) => void;
}) {
  const [outcome, setOutcome] = useState('');
  const [why, setWhy] = useState('');
  const ready = checkedIn || why.trim();
  return (
    <Modal title="Mark visit completed" icon="check" size="md" onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Back</Button>
        <Button variant="primary" loading={busy} disabled={!ready}
          onClick={() => onConfirm({ outcome: outcome.trim(), override: checkedIn ? null : why.trim() })}>Mark completed</Button>
      </>}>
      <div className="grid gap-3">
        <Field label="What was done (the customer sees it)" htmlFor="visit-outcome">
          <textarea id="visit-outcome" autoFocus rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} className="field-input"
            placeholder="Camera angle fixed, DVR restarted…" />
        </Field>
        {!checkedIn && (
          <Field label="The technician did not check in at the site - why mark it done? (staff only)" required htmlFor="visit-why">
            <textarea id="visit-why" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} className="field-input"
              placeholder="Phone had no network at the site / customer confirmed on call…" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

const toLocalInput = (iso: string) => {
  // datetime-local wants local wall-clock time; the office works in India time.
  const d = new Date(iso);
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  return ist.toISOString().slice(0, 16);
};

export function VisitChangeDialog({ mode, scheduledAt, busy, onClose, onConfirm }: {
  mode: 'move' | 'cancel'; scheduledAt: string; busy: boolean;
  onClose: () => void; onConfirm: (input: { newAt: string | null; reason: string }) => void;
}) {
  const [when, setWhen] = useState(toLocalInput(scheduledAt));
  const [reason, setReason] = useState('');
  const ready = reason.trim() && (mode === 'cancel' || when);
  return (
    <Modal title={mode === 'move' ? 'Change visit time' : 'Cancel visit'} icon="calendar" size="md" onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Back</Button>
        <Button variant="primary" loading={busy} disabled={!ready}
          onClick={() => onConfirm({ newAt: mode === 'move' ? new Date(`${when}:00+05:30`).toISOString() : null, reason: reason.trim() })}>
          {mode === 'move' ? 'Move visit' : 'Cancel visit'}
        </Button>
      </>}>
      <div className="grid gap-3">
        {mode === 'move' && (
          <Field label="New date and time" required htmlFor="visit-when">
            <input id="visit-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="field-input" />
          </Field>
        )}
        <Field label="Reason (the customer sees it)" required htmlFor="visit-reason">
          <textarea id="visit-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="field-input"
            placeholder={mode === 'move' ? 'Customer asked for the afternoon / part not in stock yet…' : 'Customer fixed it themselves…'} />
        </Field>
      </div>
    </Modal>
  );
}

export function VisitTrail({ changes, fmt }: {
  changes: { id: string; kind: string; fromAt: string; toAt: string | null; reason: string; changedByName: string | null; requestedByCustomer: boolean }[];
  fmt: (iso: string) => string;
}) {
  if (!changes.length) return null;
  return (
    <ul className="mt-1.5 border-s-2 border-border ps-2.5 text-xs text-muted-foreground">
      {changes.map((ch) => (
        <li key={ch.id} className="py-0.5">
          {ch.kind === 'cancel' ? 'Cancelled' : <>Moved {fmt(ch.fromAt)} → {ch.toAt ? fmt(ch.toAt) : '-'}</>}
          {' · '}<span className="text-foreground">{ch.reason}</span>
          {ch.changedByName && ` · ${ch.changedByName}`}{ch.requestedByCustomer && ' (customer asked)'}
        </li>
      ))}
    </ul>
  );
}
