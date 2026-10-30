'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { REASSIGN_LABEL, REASSIGN_REASONS, type ReassignReason } from '@/lib/scorecard/settings';

/**
 * Why a job moves to another technician (31 Oct 2026, scorecard). Credit
 * follows the holder; only "did not act" counts against the one it leaves.
 */
export function ReassignReason({ toName, busy, onClose, onConfirm }: {
  toName: string; busy: boolean; onClose: () => void; onConfirm: (reason: ReassignReason) => void;
}) {
  const [reason, setReason] = useState<ReassignReason | ''>('');
  return (
    <Modal title={`Reassign to ${toName}`} subtitle="Why is it moving from the technician who has it?" icon="user-plus" size="md" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!reason} onClick={() => reason && onConfirm(reason)}>Reassign</Button></>}>
      <fieldset className="grid gap-2">
        <legend className="sr-only">Reason</legend>
        {REASSIGN_REASONS.map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm">
            <input type="radio" name="reassign-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
            {REASSIGN_LABEL[r]}
          </label>
        ))}
      </fieldset>
      <p className="mt-3 text-xs text-muted-foreground">Only &quot;Technician did not act&quot; counts against the technician it is taken from.</p>
    </Modal>
  );
}
