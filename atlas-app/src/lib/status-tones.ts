/**
 * One colour per status word, for every module (F1 UI standard).
 *
 * "In progress" was brand-orange on complaints, amber on orders and blue on
 * tasks; a person scanning three screens read three meanings. Now the word
 * decides the colour, everywhere:
 *
 *   waiting / new     info (blue)     - received, open, assigned, pending, sent
 *   moving            warning (amber) - in progress, partial, on hold
 *   finished well     success (green) - resolved, done, paid, delivered, approved
 *   finished / off    neutral (grey)  - closed, cancelled, draft, void
 *   needs attention   danger (red)    - overdue, rejected, failed, urgent
 *
 * Unknown words are grey, never an error - a new status added in settings
 * should look plain, not broken.
 */
export type StatusTone = 'info' | 'warning' | 'success' | 'neutral' | 'danger';

const TONES: Record<string, StatusTone> = {
  new: 'info', open: 'info', received: 'info', assigned: 'info', pending: 'info', sent: 'info',
  issued: 'info', scheduled: 'info', todo: 'info', to_do: 'info', submitted: 'info', requested: 'info', unpaid: 'info',
  booked: 'info', confirmed: 'info',
  pending_approval: 'warning', packed: 'warning', shipped: 'warning',
  damage_or_lost: 'danger', refunded: 'neutral',

  in_progress: 'warning', inprogress: 'warning', partial: 'warning', partially_paid: 'warning', partial_paid: 'warning',
  on_hold: 'warning', hold: 'warning', processing: 'warning', dispatched: 'warning', in_transit: 'warning', started: 'warning',

  resolved: 'success', done: 'success', completed: 'success', complete: 'success', paid: 'success', delivered: 'success',
  approved: 'success', active: 'success', accepted: 'success', won: 'success', returned: 'success', received_back: 'success',

  closed: 'neutral', cancelled: 'neutral', canceled: 'neutral', draft: 'neutral', void: 'neutral', archived: 'neutral',
  inactive: 'neutral', expired: 'neutral', not_recorded: 'neutral',

  overdue: 'danger', rejected: 'danger', failed: 'danger', urgent: 'danger', escalated: 'danger', lost: 'danger', blocked: 'danger',
};

const key = (status: string) => status.trim().toLowerCase().replace(/[\s-]+/g, '_');

export function statusTone(status: string | null | undefined): StatusTone {
  return status ? TONES[key(status)] ?? 'neutral' : 'neutral';
}

/** "in_progress" → "In progress". */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return '-';
  const s = status.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
