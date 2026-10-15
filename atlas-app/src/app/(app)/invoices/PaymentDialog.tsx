'use client';

import { useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Segmented, SummaryRow } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { addPayment } from './actions';
import { ask } from '@/components/ui/ask';

/**
 * Record money received against an invoice.
 *
 * The amount defaults to the full balance, because settling in full is the
 * common case and the one people get wrong when they have to type it. Part
 * payments are a deliberate act.
 *
 * A reference is asked for on every method except cash - a bank transfer with
 * no UTR is unreconcilable three months later, which is exactly when someone
 * will ask about it.
 */
const METHODS = [
  { value: 'cash', label: 'Cash', icon: 'credit-card' as const },
  { value: 'upi', label: 'UPI', icon: 'send' as const },
  { value: 'bank', label: 'Bank', icon: 'building' as const },
  { value: 'cheque', label: 'Cheque', icon: 'file-text' as const },
];

const REFERENCE_LABEL: Record<string, string> = {
  cash: 'Receipt no (optional)',
  upi: 'UPI transaction ID',
  bank: 'UTR / transaction reference',
  cheque: 'Cheque number',
};

export function PaymentDialog({
  invoiceId, invoiceNo, customerName, duePaise, onClose,
}: {
  invoiceId: string;
  invoiceNo: string;
  customerName: string;
  duePaise: number;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(duePaise / 100);
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const amountPaise = Math.round(amount * 100);
  const remaining = duePaise - amountPaise;
  const tooMuch = amountPaise > duePaise;
  const needsReference = method !== 'cash' && !reference.trim();

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await addPayment(invoiceId, {
        amountRupees: amount, method, reference, note,
      });
      if (r.error) { setError(r.error); return; }
      if (r.message) await ask.tell(r.message);
      onClose();
      window.location.reload();
    });
  };

  return (
    <Modal
      title="Record Payment"
      subtitle={`${invoiceNo} · ${customerName}`}
      icon="credit-card"
      tone="brand"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="outline" icon="x" onClick={onClose} className="ms-auto">Cancel</Button>
          <Button
            variant="success" icon="check"
            onClick={submit} loading={pending}
            disabled={amountPaise <= 0 || tooMuch || needsReference}
          >
            Record {formatCurrency(Math.max(0, amountPaise))}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-card p-3">
          <SummaryRow label="Invoice total" value={formatCurrency(duePaise + 0)} />
          <SummaryRow strong label="Outstanding" value={formatCurrency(duePaise)} tone="danger" />
        </div>

        <Field
          label="Amount received"
          required
          error={tooMuch ? `That is more than the ${formatCurrency(duePaise)} outstanding.` : null}
          hint={
            !tooMuch && remaining > 0
              ? `${formatCurrency(remaining)} will still be due.`
              : !tooMuch && remaining === 0
                ? 'This settles the invoice in full.'
                : undefined
          }
        >
          <div className="flex items-center rounded border border-border bg-card transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
            <span className="ps-3 text-sm text-muted-foreground">₹</span>
            <input
              type="number" min={0} step="0.01" value={amount} autoFocus
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full bg-transparent px-2 py-2 text-sm outline-none"
            />
            {remaining !== 0 && (
              <button
                type="button"
                onClick={() => setAmount(duePaise / 100)}
                className="me-1 shrink-0 rounded px-2 py-1 text-xs font-medium text-brand hover:bg-brand/10"
              >
                Full
              </button>
            )}
          </div>
        </Field>

        <Field label="Method" required>
          <Segmented value={method} onChange={setMethod} options={METHODS} />
        </Field>

        <Field
          label={REFERENCE_LABEL[method]}
          required={method !== 'cash'}
          hint={
            method !== 'cash'
              ? 'Without this the payment cannot be reconciled against a statement later.'
              : undefined
          }
        >
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="field-input"
          />
        </Field>

        <Field label="Note">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything worth remembering about this payment"
            className="field-input"
          />
        </Field>

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          This is recorded as its own row, not just added to a total - so the
          customer&rsquo;s payment history survives, which is what you need the
          day a balance is disputed.
        </p>
      </div>
    </Modal>
  );
}
