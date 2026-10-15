'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Layout';
import { formatCurrency } from '@/lib/format';
import { apply, issue, loadOpenInvoicesFor, unapply, voidCreditNote } from '../actions';

/**
 * Issue, apply, take back, cancel.
 *
 * Applying is the one that needs a real dialog rather than a button, because it
 * is a choice: which invoice should this credit clear? Auto-allocation makes
 * that choice on issue, but a customer who rings up about a specific invoice
 * expects it to be that one, and the system has to let somebody say so.
 */

interface OpenInvoice {
  id: string;
  invoiceNo: string;
  dueDate: string;
  grandTotalPaise: number;
  paidPaise: number;
  creditedPaise: number;
  outstandingPaise: number;
}

export function CreditNoteActions({
  id, creditNoteNo, lifecycle, unusedPaise, refundedPaise, appliedTo, partyId, canCredit,
}: {
  id: string;
  creditNoteNo: string;
  lifecycle: string;
  unusedPaise: number;
  refundedPaise: number;
  appliedTo: { invoiceId: string; invoiceNo: string; amountPaise: number }[];
  partyId: string | null;
  canCredit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [taking, setTaking] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) { setError(r.error); return; }
      setApplying(false); setTaking(false); setVoiding(false); setReason('');
      router.refresh();
    });
  };

  if (!canCredit) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <span className="max-w-md text-xs text-danger">{error}</span>}

      {lifecycle === 'draft' && (
        <Button variant="primary" icon="check" loading={pending} onClick={() => run(() => issue(id))}>
          Issue
        </Button>
      )}

      {lifecycle === 'issued' && unusedPaise > 0 && partyId && (
        <Button variant="primary" icon="file-text" onClick={() => setApplying(true)}>
          Apply to an invoice
        </Button>
      )}

      {lifecycle === 'issued' && appliedTo.length > 0 && (
        <Button icon="rotate-ccw" onClick={() => setTaking(true)}>Take back</Button>
      )}

      {lifecycle !== 'cancelled' && (
        <Button icon="x" onClick={() => setVoiding(true)}>Cancel</Button>
      )}

      {applying && partyId && (
        <ApplyDialog
          creditNoteNo={creditNoteNo}
          partyId={partyId}
          unusedPaise={unusedPaise}
          pending={pending}
          onClose={() => setApplying(false)}
          onApply={(invoiceId, amountPaise) => run(() => apply(id, invoiceId, amountPaise))}
        />
      )}

      {taking && (
        <Modal
          open
          title="Take credit back off an invoice"
          subtitle={creditNoteNo}
          icon="rotate-ccw"
          size="md"
          onClose={() => setTaking(false)}
        >
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            A negative row is written rather than the original being deleted, so
            &ldquo;applied on the 3rd, taken back on the 5th&rdquo; stays readable. The
            invoice becomes outstanding again and the credit is free to use elsewhere.
          </p>
          <div className="grid gap-2">
            {appliedTo.map((a) => (
              <TakeBackRow
                key={a.invoiceId}
                row={a}
                pending={pending}
                onTakeBack={(amount, why) => run(() => unapply(id, a.invoiceId, amount, why))}
              />
            ))}
          </div>
        </Modal>
      )}

      {voiding && (
        <Modal
          open
          title={`Cancel ${creditNoteNo}`}
          icon="x"
          tone="danger"
          size="sm"
          onClose={() => setVoiding(false)}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button onClick={() => setVoiding(false)}>Keep it</Button>
              <Button
                variant="danger" icon="x"
                disabled={!reason.trim() || pending || refundedPaise > 0} loading={pending}
                onClick={() => run(() => voidCreditNote(id, reason))}
              >
                Cancel credit note
              </Button>
            </div>
          }
        >
          {refundedPaise > 0 ? (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-danger">
              <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {formatCurrency(refundedPaise)} has already been refunded against this note.
                Reverse the refund first - otherwise money has left the business with nothing
                behind it.
              </span>
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                The document and its number stay on the record. Every invoice it was settling
                becomes outstanding again.
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Why is this being cancelled?"
                className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-sm outline-none focus:border-brand"
              />
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function ApplyDialog({
  creditNoteNo, partyId, unusedPaise, pending, onClose, onApply,
}: {
  creditNoteNo: string;
  partyId: string;
  unusedPaise: number;
  pending: boolean;
  onClose: () => void;
  onApply: (invoiceId: string, amountPaise: number) => void;
}) {
  const [invoices, setInvoices] = useState<OpenInvoice[] | null>(null);
  const [chosen, setChosen] = useState<string>('');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    loadOpenInvoicesFor(partyId).then((r) => setInvoices(r.invoices ?? []));
  }, [partyId]);

  const target = invoices?.find((i) => i.id === chosen);
  const paise = Math.round((Number(amount.replace(/,/g, '')) || 0) * 100);
  const ceiling = target ? Math.min(unusedPaise, target.outstandingPaise) : 0;
  const over = paise > ceiling;

  return (
    <Modal
      open
      title="Apply credit to an invoice"
      subtitle={`${creditNoteNo} · ${formatCurrency(unusedPaise)} available`}
      icon="file-text"
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" icon="check"
            disabled={!target || paise <= 0 || over || pending} loading={pending}
            onClick={() => target && onApply(target.id, paise)}
          >
            Apply {paise > 0 && !over ? formatCurrency(paise) : ''}
          </Button>
        </div>
      }
    >
      {invoices === null ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          This customer has nothing outstanding. The credit stays on their account and can be
          applied to a future invoice, or refunded.
        </p>
      ) : (
        <>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
            {invoices.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => {
                  setChosen(i.id);
                  setAmount((Math.min(unusedPaise, i.outstandingPaise) / 100).toString());
                }}
                className={`flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-start last:border-0 ${
                  chosen === i.id ? 'bg-brand/10' : 'hover:bg-muted'
                }`}
              >
                <span>
                  <span className="block font-mono text-xs font-medium">{i.invoiceNo}</span>
                  <span className="block text-xs text-muted-foreground">
                    due {new Date(i.dueDate).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}
                    {i.paidPaise > 0 && ` · ${formatCurrency(i.paidPaise)} paid`}
                    {i.creditedPaise > 0 && ` · ${formatCurrency(i.creditedPaise)} credited`}
                  </span>
                </span>
                <span className="text-end">
                  <span className="block text-xs tabular-nums font-medium">
                    {formatCurrency(i.outstandingPaise)}
                  </span>
                  <span className="block text-xs text-muted-foreground">outstanding</span>
                </span>
              </button>
            ))}
          </div>

          {target && (
            <div className="mt-3">
              <Field
                label="How much ₹"
                required
                hint={`At most ${formatCurrency(ceiling)} - the smaller of what is unused and what that invoice owes`}
                htmlFor="ap-amount"
              >
                <input
                  id="ap-amount" value={amount} inputMode="decimal"
                  onChange={(e) => setAmount(e.target.value)}
                  className={`h-9 w-full rounded-lg border px-3 text-sm outline-none sm:w-52 ${
                    over ? 'border-danger bg-danger/5' : 'border-border bg-card focus:border-brand'
                  }`}
                />
              </Field>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function TakeBackRow({
  row, pending, onTakeBack,
}: {
  row: { invoiceId: string; invoiceNo: string; amountPaise: number };
  pending: boolean;
  onTakeBack: (amountPaise: number, reason: string) => void;
}) {
  const [why, setWhy] = useState('');
  const [amount, setAmount] = useState((row.amountPaise / 100).toString());
  const paise = Math.round((Number(amount.replace(/,/g, '')) || 0) * 100);
  const over = paise > row.amountPaise;

  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs font-medium">{row.invoiceNo}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatCurrency(row.amountPaise)} applied
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <input
          value={amount} inputMode="decimal"
          onChange={(e) => setAmount(e.target.value)}
          className={`h-8 w-28 rounded-lg border px-2 text-end text-sm outline-none ${
            over ? 'border-danger bg-danger/5' : 'border-border bg-card focus:border-brand'
          }`}
        />
        <input
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder="Why is it being taken back?"
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand"
        />
        <Button
          size="sm" icon="rotate-ccw"
          disabled={!why.trim() || paise <= 0 || over || pending}
          onClick={() => onTakeBack(paise, why)}
        >
          Take back
        </Button>
      </div>
    </div>
  );
}
