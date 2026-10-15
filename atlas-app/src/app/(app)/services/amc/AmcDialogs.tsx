'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { addDays, addMonths, startOfDay } from '@/lib/expiry';
import { setAmcStatusAction, renewAmcContractAction, type ActionState } from './actions';

const fmt = (d: Date) =>
  d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Cancelling a contract, with a real reason.
 *
 * The server has always required one. The list previously sent a hardcoded
 * string - "Cancelled from the contracts list" - because there was no dialog,
 * which satisfied the check and recorded nothing worth reading. A required
 * field filled in by the code is worse than no field: it looks like an answer.
 */
export function CancelAmcDialog({
  contractId, contractNo, customerName, onClose, onDone,
}: {
  contractId: string;
  contractNo: string;
  customerName: string;
  onClose: () => void;
  onDone: (res: ActionState) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) {
      setError('Say why it is being cancelled - this is what somebody reads in six months.');
      return;
    }
    setBusy(true);
    const res = await setAmcStatusAction(contractId, 'cancelled', reason.trim());
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onDone(res);
  };

  return (
    <Modal
      title={`Cancel ${contractNo}`}
      subtitle={customerName}
      icon="ban"
      tone="danger"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Keep it</Button>
          <Button variant="danger" onClick={submit} loading={busy} icon="ban">
            Cancel contract
          </Button>
        </div>
      }
    >
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded border border-danger/30 bg-danger/[0.06] px-3 py-2 text-xs">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span>{error}</span>
        </p>
      )}

      <p className="mb-3 text-xs text-muted-foreground">
        Cancelling means the agreement <strong>ended</strong>, not that it
        lapsed. It cannot be undone, and the customer stops being covered from
        now on - any complaint raised afterwards will read as chargeable.
      </p>

      <label htmlFor="amcdialo-f77" className="mb-1 block text-micro font-semibold uppercase tracking-wide text-muted-foreground">
        Why *
      </label>
      <textarea id="amcdialo-f77"
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder="Customer moved premises · equipment sold on · non-payment · replaced by a new contract…"
        className="w-full rounded border border-border bg-card px-2.5 py-2 text-sm outline-none focus:border-brand"
      />
    </Modal>
  );
}

/**
 * Renewing, with a choice of period and price.
 *
 * Was hardcoded to twelve months at last year's price. Every maintenance
 * business reprices on renewal, so a fixed price made the button either wrong
 * or unusable - and the period is a negotiation too.
 *
 * The dates are shown before committing, because "starts the day after the old
 * one ends" is a rule worth seeing rather than trusting.
 */
export function RenewAmcDialog({
  contractId, contractNo, customerName, currentEnd, currentAmountPaise, onClose, onDone,
}: {
  contractId: string;
  contractNo: string;
  customerName: string;
  /** ISO string - it crossed the server boundary. */
  currentEnd: string;
  currentAmountPaise: number;
  onClose: () => void;
  onDone: (res: ActionState) => void;
}) {
  const [months, setMonths] = useState('12');
  const [amount, setAmount] = useState((currentAmountPaise / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const m = Math.max(1, Math.trunc(Number(months) || 0));

  // The same arithmetic the server will use: start the day after the old term
  // ends, run `m` months, finish a day short of the anniversary.
  const start = addDays(startOfDay(new Date(currentEnd)), 1);
  const end = addDays(addMonths(start, m), -1);

  const newPaise = Math.round((Number(amount) || 0) * 100);
  const change = newPaise - currentAmountPaise;

  const submit = async () => {
    if (m < 1) { setError('A renewal must run for at least a month.'); return; }
    if (newPaise < 0) { setError('The amount cannot be negative.'); return; }
    setBusy(true);
    const res = await renewAmcContractAction(contractId, m, newPaise);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onDone(res);
  };

  const field = 'h-9 w-full rounded border border-border bg-card px-2.5 text-sm outline-none focus:border-brand';
  const label = 'mb-1 block text-micro font-semibold uppercase tracking-wide text-muted-foreground';

  return (
    <Modal
      title={`Renew ${contractNo}`}
      subtitle={customerName}
      icon="refresh"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} icon="refresh">
            Create the renewal
          </Button>
        </div>
      }
    >
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded border border-danger/30 bg-danger/[0.06] px-3 py-2 text-xs">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <span>{error}</span>
        </p>
      )}

      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="amcdialo-f170" className={label}>Term (months)</label>
          <input id="amcdialo-f170"
            autoFocus type="number" min="1" value={months}
            onChange={(e) => setMonths(e.target.value)} className={field}
          />
        </div>
        <div>
          <label htmlFor="amcdialo-f177" className={label}>Price for the new term (₹)</label>
          <input id="amcdialo-f177"
            type="number" min="0" step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${field} font-mono tabular-nums`}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-xs">
        <p>
          New term runs <strong>{fmt(start)}</strong> to <strong>{fmt(end)}</strong>
        </p>
        <p className="mt-1 text-muted-foreground">
          Starts the day after {contractNo} ends, so there is no gap and no overlap.
          The old term stays on file - it is what covered last year&rsquo;s calls.
        </p>
        {change !== 0 && (
          <p className={`mt-1.5 font-medium ${change > 0 ? 'text-warning' : 'text-success'}`}>
            {change > 0 ? 'Increase' : 'Reduction'} of {formatCurrency(Math.abs(change))}{' '}
            on {formatCurrency(currentAmountPaise)}
          </p>
        )}
        {newPaise > 0 && (
          <p className="mt-1.5 text-muted-foreground">
            The new contract will need its own invoice - it appears under
            &ldquo;Not invoiced&rdquo; until you raise one.
          </p>
        )}
      </div>
    </Modal>
  );
}
