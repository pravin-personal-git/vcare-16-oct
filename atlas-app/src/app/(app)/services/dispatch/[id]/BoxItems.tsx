'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { RMA_STATUS_LABEL, RMA_OUTCOME_LABEL, SUPPLIER_ANSWER_LABEL, SUPPLIER_ANSWERS, type RmaStatus, type RmaOutcome, type SupplierAnswer } from '@/lib/rma';
import { COURIER_PAID_BY, COURIER_PAID_BY_LABEL } from '@/lib/supplier-dispatch';
import { supplierAnswerAction, receiveAction, closeAtSupplierAction } from '../actions';

/**
 * THE ITEMS IN ONE BOX, AND WHAT CAME BACK (10 Oct 2026, repair flow stage 5).
 * Per item: the supplier's answer and quote, or closed with nothing back
 * (credit note / written reply). For the box: receive what came back, line by
 * line, on an RMA receipt - part of the box at a time if that is how it comes.
 */
export interface BoxCase {
  id: string; caseNo: string; status: string; productName: string; serialNo: string | null; outcome: string | null;
  replacementSerialNo: string | null; courierSharePaise: number | null; creditNoteNo: string | null; creditAmountPaise: number | null;
  supplierAnswer: string | null; supplierQuotePaise: number | null; supplierAnswerNote: string | null;
  closedOn: string | null; supplierReplyRef: string | null; supplierOnFile: boolean;
  receipt: { id: string; receiptNo: string } | null;
  complaint: { id: string; complaintNo: string } | null; customerId?: string | null; customerName: string | null;
}

const rupees = (p: number | null) => (p ? `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '-');
const RESULTS = [
  { v: 'repaired', label: 'Repaired - same serial' },
  { v: 'replaced', label: 'New serial sent' },
  { v: 'returned_unrepaired', label: 'Came back not repaired' },
] as const;

export function BoxItems({ dispatchId, cases, canEdit }: { dispatchId: string; cases: BoxCase[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [answering, setAnswering] = useState<BoxCase | null>(null);
  const [closing, setClosing] = useState<BoxCase | null>(null);
  const [receiving, setReceiving] = useState(false);
  const out = cases.filter((c) => c.status === 'sent');

  const done = (r: { error?: string; warnings?: string[]; receiptNo?: string }, ok: string) => {
    if (r.error) { setError(r.error); return; }
    setError(null); setAnswering(null); setClosing(null); setReceiving(false);
    setFlash([r.receiptNo ? `${ok} on ${r.receiptNo}.` : ok, ...(r.warnings ?? [])].join(' '));
    router.refresh();
  };

  return (
    <section className="rounded-xl border border-border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <h2 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">In this box ({cases.length})</h2>
        {canEdit && out.length > 0 && <Button size="sm" variant="primary" onClick={() => { setError(null); setReceiving(true); }}>Receive what came back</Button>}
      </div>
      {flash && <p className="mx-5 mt-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-on-tint-success" role="status">{flash}</p>}
      <div className="overflow-x-auto px-2 pb-3 pt-2">
        <table className="w-full min-w-[40rem] text-sm">
          <thead><tr className="text-micro uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-1.5 text-start font-medium">Item</th><th className="px-3 py-1.5 text-start font-medium">Complaint · customer</th>
            <th className="px-3 py-1.5 text-start font-medium">Supplier said · result</th><th className="px-3 py-1.5 text-end font-medium">Courier share</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {cases.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 align-top">
                  <p>{c.productName}</p>
                  <p className="text-xs text-muted-foreground">{c.serialNo ? <span className="font-mono">S/N {c.serialNo}</span> : 'no serial'} · <Link href={`/services/replacements?q=${encodeURIComponent(c.caseNo)}&open=${c.id}`} className="font-mono text-brand hover:underline">{c.caseNo}</Link></p>
                </td>
                <td className="px-3 py-2 align-top text-xs">
                  {c.complaint ? <Link href={`/services/complaints/${c.complaint.id}`} className="font-mono font-semibold text-brand hover:underline">{c.complaint.complaintNo}</Link> : '-'}
                  <p className="text-muted-foreground">{c.customerName ? <CustomerLink id={c.customerId}>{c.customerName}</CustomerLink> : 'Our stock'}</p>
                </td>
                <td className="px-3 py-2 align-top">
                  <Badge tone={c.status === 'sent' ? 'info' : c.status === 'cancelled' ? 'neutral' : 'success'}>{RMA_STATUS_LABEL[c.status as RmaStatus] ?? c.status}</Badge>
                  {c.supplierAnswer && (
                    <p className="mt-0.5 text-xs">Said: {SUPPLIER_ANSWER_LABEL[c.supplierAnswer as SupplierAnswer] ?? c.supplierAnswer}{c.supplierQuotePaise ? ` · quote ${rupees(c.supplierQuotePaise)}` : ''}{c.supplierAnswerNote ? ` · ${c.supplierAnswerNote}` : ''}</p>
                  )}
                  {c.outcome && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {c.closedOn === 'written_reply' ? 'Kept / scrapped by the supplier' : RMA_OUTCOME_LABEL[c.outcome as RmaOutcome] ?? c.outcome}
                      {c.replacementSerialNo ? <> · new <span className="font-mono">{c.replacementSerialNo}</span></> : null}
                      {c.creditNoteNo ? ` · CN ${c.creditNoteNo} ${rupees(c.creditAmountPaise)}` : ''}
                      {c.closedOn === 'written_reply' ? ` · their written reply${c.supplierReplyRef ? ` ${c.supplierReplyRef}` : ''}` : ''}
                      {c.receipt && <> · <Link href={`/services/dispatch/receipts/${c.receipt.id}`} className="font-mono text-brand hover:underline">{c.receipt.receiptNo}</Link></>}
                    </p>
                  )}
                  {canEdit && c.status === 'sent' && (
                    <p className="mt-1 flex flex-wrap gap-3 text-xs">
                      <button type="button" className="font-medium text-brand hover:underline" onClick={() => { setError(null); setAnswering(c); }}>Supplier&apos;s answer</button>
                      <button type="button" className="font-medium text-brand hover:underline" onClick={() => { setError(null); setClosing(c); }}>Closed without coming back</button>
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 text-end align-top tabular-nums">{rupees(c.courierSharePaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {answering && (
        <AnswerDialog c={answering} busy={pending} error={error} onClose={() => setAnswering(null)}
          onSave={(answer, quote, note) => start(async () => done(await supplierAnswerAction(answering.id, answer, quote, note), 'Supplier\'s answer saved.'))} />
      )}
      {closing && (
        <CloseDialog c={closing} busy={pending} error={error} onClose={() => setClosing(null)}
          onSave={(input) => start(async () => done(await closeAtSupplierAction(closing.id, input), `${closing.caseNo} closed at the supplier.`))} />
      )}
      {receiving && (
        <ReceiveDialog cases={out} busy={pending} error={error} onClose={() => setReceiving(false)}
          onSave={(input) => start(async () => done(await receiveAction(dispatchId, input), 'Received'))} />
      )}
    </section>
  );
}

function Err({ error }: { error: string | null }) {
  return error ? <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-on-tint-danger" role="alert">{error}</p> : null;
}

function AnswerDialog({ c, busy, error, onClose, onSave }: { c: BoxCase; busy: boolean; error: string | null; onClose: () => void; onSave: (answer: string, quote: string, note: string) => void }) {
  const [answer, setAnswer] = useState<string>(c.supplierAnswer ?? 'repair');
  const [quote, setQuote] = useState(c.supplierQuotePaise ? String(c.supplierQuotePaise / 100) : '');
  const [note, setNote] = useState(c.supplierAnswerNote ?? '');
  return (
    <Modal title={`What the supplier said - ${c.caseNo}`} icon="phone" size="md" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => onSave(answer, quote, note)}>Save</Button></>}>
      <div className="grid gap-3 text-sm">
        <p className="text-xs text-muted-foreground">{c.productName}{c.serialNo ? ` · S/N ${c.serialNo}` : ''}. When the customer pays for the repair, their estimate on the complaint is drafted from this quote plus your markup.</p>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">They will
          <select id="sa-answer" value={answer} onChange={(e) => setAnswer(e.target.value)} className="field-input">
            {SUPPLIER_ANSWERS.map((a) => <option key={a} value={a}>{SUPPLIER_ANSWER_LABEL[a]}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Their charge, before GST (₹) - blank if free under warranty
          <input id="sa-quote" type="number" min={0} step="0.01" value={quote} onChange={(e) => setQuote(e.target.value)} className="field-input" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Note
          <input id="sa-note" value={note} onChange={(e) => setNote(e.target.value)} className="field-input" placeholder="e.g. board burnt, 10 days" />
        </label>
        <Err error={error} />
      </div>
    </Modal>
  );
}

function CloseDialog({ c, busy, error, onClose, onSave }: {
  c: BoxCase; busy: boolean; error: string | null; onClose: () => void;
  onSave: (input: { kind: 'credit_note' | 'written_reply'; creditNoteNo: string; amount: string; replyRef: string; note: string }) => void;
}) {
  const [kind, setKind] = useState<'credit_note' | 'written_reply'>('credit_note');
  const [creditNoteNo, setNo] = useState('');
  const [amount, setAmount] = useState('');
  const [replyRef, setRef] = useState('');
  const [note, setNote] = useState('');
  return (
    <Modal title={`Closed without coming back - ${c.caseNo}`} icon="receipt" size="md" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => onSave({ kind, creditNoteNo, amount, replyRef, note })}>Close the case</Button></>}>
      <div className="grid gap-3 text-sm">
        <p className="text-xs text-muted-foreground">Nothing physical comes back, so there is no receipt. The old unit is marked &quot;kept by supplier&quot;. The customer&apos;s item waits on the complaint for what they get instead.</p>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5"><input type="radio" name="close-kind" checked={kind === 'credit_note'} onChange={() => setKind('credit_note')} />Credit note</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="close-kind" checked={kind === 'written_reply'} onChange={() => setKind('written_reply')} />Written reply (kept / scrapped it)</label>
        </div>
        {kind === 'credit_note' ? (
          <>
            {!c.supplierOnFile && <p className="text-xs text-warning">This case names no supplier on file - set the vendor on the case first, so the credit lands on their account.</p>}
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">Their credit note number
              <input id="cn-no" value={creditNoteNo} onChange={(e) => setNo(e.target.value)} className="field-input" />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">Amount (₹)
              <input id="cn-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="field-input" />
            </label>
          </>
        ) : (
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">Their reference (email, letter no.)
            <input id="wr-ref" value={replyRef} onChange={(e) => setRef(e.target.value)} className="field-input" />
          </label>
        )}
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">{kind === 'credit_note' ? 'Note' : 'What they said'}
          <input id="close-note" value={note} onChange={(e) => setNote(e.target.value)} className="field-input" />
        </label>
        <Err error={error} />
      </div>
    </Modal>
  );
}

function ReceiveDialog({ cases, busy, error, onClose, onSave }: {
  cases: BoxCase[]; busy: boolean; error: string | null; onClose: () => void;
  onSave: (input: { lines: { caseId: string; result: string; newSerialNo: string }[]; courier: string; docketNo: string; courierCharge: string; courierPaidBy: string; note: string }) => void;
}) {
  // Pre-filled from the supplier's answer where there is one; "not back yet" otherwise.
  const [lines, setLines] = useState(() => Object.fromEntries(cases.map((c) => [c.id, {
    result: c.supplierAnswer === 'repair' ? 'repaired' : c.supplierAnswer === 'replace' ? 'replaced' : c.supplierAnswer === 'cannot_repair' ? 'returned_unrepaired' : '',
    serial: '',
  }])));
  const [courier, setCourier] = useState('');
  const [docketNo, setDocket] = useState('');
  const [charge, setCharge] = useState('');
  const [paidBy, setPaidBy] = useState('none');
  const [note, setNote] = useState('');
  const ticked = cases.filter((c) => lines[c.id]?.result);
  return (
    <Modal title="Receive what came back" icon="download" size="lg" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!ticked.length}
        onClick={() => onSave({ lines: ticked.map((c) => ({ caseId: c.id, result: lines[c.id].result, newSerialNo: lines[c.id].serial })), courier, docketNo, courierCharge: charge, courierPaidBy: paidBy, note })}>
        Receive {ticked.length || ''}</Button></>}>
      <div className="grid gap-3 text-sm">
        <p className="text-xs text-muted-foreground">One RMA receipt for what is in your hands now. Leave an item on &quot;not back yet&quot; and receive it later. A customer&apos;s item stays theirs - nothing here goes into stock.</p>
        <div className="divide-y divide-border rounded-lg border border-border">
          {cases.map((c) => {
            const l = lines[c.id];
            const set = (p: Partial<typeof l>) => setLines((x) => ({ ...x, [c.id]: { ...x[c.id], ...p } }));
            return (
              <div key={c.id} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
                <div className="min-w-0">
                  <p className="font-medium">{c.productName}</p>
                  <p className="text-xs text-muted-foreground"><span className="font-mono">{c.caseNo}</span>{c.serialNo ? <> · S/N <span className="font-mono">{c.serialNo}</span></> : null}{c.complaint ? ` · ${c.complaint.complaintNo}` : ''}{c.supplierAnswer ? ` · said: ${SUPPLIER_ANSWER_LABEL[c.supplierAnswer as SupplierAnswer]}` : ''}</p>
                </div>
                <div className="grid gap-1.5">
                  <select aria-label={`What came back for ${c.caseNo}`} value={l.result} onChange={(e) => set({ result: e.target.value })} className="field-input">
                    <option value="">Not back yet</option>
                    {RESULTS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
                  </select>
                  {l.result === 'replaced' && (
                    <input aria-label={`New serial for ${c.caseNo}`} value={l.serial} onChange={(e) => set({ serial: e.target.value })} className="field-input font-mono" placeholder="New serial number" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Return courier - only if we paid for it</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">Courier
            <input id="rc-courier" value={courier} onChange={(e) => setCourier(e.target.value)} className="field-input" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">Docket
            <input id="rc-docket" value={docketNo} onChange={(e) => setDocket(e.target.value)} className="field-input" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">Charge (₹) - shared equally across what came back
            <input id="rc-charge" type="number" min={0} step="0.01" value={charge} onChange={(e) => setCharge(e.target.value)} className="field-input" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">Paid
            <select id="rc-paid" value={paidBy} onChange={(e) => setPaidBy(e.target.value)} className="field-input">
              {COURIER_PAID_BY.map((p) => <option key={p} value={p}>{COURIER_PAID_BY_LABEL[p]}</option>)}
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Note
          <input id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} className="field-input" />
        </label>
        <Err error={error} />
      </div>
    </Modal>
  );
}
