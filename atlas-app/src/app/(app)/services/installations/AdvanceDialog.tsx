'use client';

import { useEffect, useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Layout';
import { formatCurrency } from '@/lib/format';
import { METHOD_LABEL, type ReceiptMethod } from '@/lib/receipt';
import { loadChallanAdvancesAction, recordChallanAdvanceAction } from './actions';

/**
 * Money handed to the technician at the customer's premises.
 *
 * Pravin's rule: an advance sits with the challan it was collected on. Until
 * now the only place to record money before an invoice existed was against the
 * sales order, which is wrong for a job that runs four weeks across three
 * visits - somebody paying on the second visit has paid for THAT work, and a
 * month later nobody could tell which visit the money came from.
 *
 * What it writes is a real, numbered receipt, HELD on account. Not applied to
 * anything, because there is no invoice yet; "Bill a site" finds it through the
 * challan and applies it to the final invoice when that is raised.
 */

const METHODS: ReceiptMethod[] = ['cash', 'upi', 'bank', 'cheque', 'card'];

export function AdvanceDialog({ challanId, challanNo, onClose, onDone }: {
  challanId: string;
  challanNo: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ReceiptMethod>('cash');
  const [reference, setReference] = useState('');
  const [already, setAlready] = useState<Awaited<ReturnType<typeof loadChallanAdvancesAction>>>([]);

  // What has already been taken on this challan, so nobody records the same
  // fifty thousand twice because two people were on the phone about it.
  useEffect(() => {
    let live = true;
    loadChallanAdvancesAction(challanId)
      .then((rows) => { if (live) setAlready(rows); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [challanId]);

  const rupees = Number(amount);
  const valid = Number.isFinite(rupees) && rupees > 0;

  const submit = () => {
    if (!valid) return;
    setError(null);
    start(async () => {
      const r = await recordChallanAdvanceAction({
        challanId,
        amountRupees: rupees,
        method,
        reference: reference.trim() || null,
      });
      if (r.error) { setError(r.error); return; }
      onDone();
      onClose();
    });
  };

  const held = already.reduce((t, a) => t + a.heldPaise, 0);

  return (
    <Modal
      title="Money received on site"
      subtitle={`Held against ${challanNo} until the final invoice is raised.`}
      icon="credit-card"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" icon="x" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="credit-card" onClick={submit} loading={pending} disabled={!valid}>
            Raise the receipt
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && (
          <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-on-tint-danger">
            {error}
          </p>
        )}

        {already.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs">
            <p className="mb-1 font-medium">Already taken on this challan</p>
            {already.map((a) => (
              <p key={a.id} className="text-muted-foreground">
                <span className="font-mono">{a.receiptNo}</span> ·{' '}
                {formatCurrency(a.amountPaise)} · {METHOD_LABEL[a.method as ReceiptMethod] ?? a.method}
                {a.heldPaise < a.amountPaise && ' · part applied'}
              </p>
            ))}
            {held > 0 && (
              <p className="mt-1 font-medium">
                {formatCurrency(held)} still held, waiting for the invoice.
              </p>
            )}
          </div>
        )}

        <Field label="Amount received" hint="In rupees. It goes into the books today, as a receipt.">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="50000"
            className="field-input"
          />
        </Field>

        <Field label="How it was paid">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as ReceiptMethod)}
            className="field-input"
          >
            {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </select>
        </Field>

        <Field label="Reference" hint="UTR, cheque number, or whatever the customer can quote back.">
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Optional"
            className="field-input"
          />
        </Field>

        <p className="text-xs text-muted-foreground">
          This is <strong>not revenue yet</strong> and carries no GST. It is money the customer has
          paid in advance, and it comes off the final invoice when the site is billed.
        </p>
      </div>
    </Modal>
  );
}
