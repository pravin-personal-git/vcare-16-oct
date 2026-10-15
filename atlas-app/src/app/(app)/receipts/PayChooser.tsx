'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/format';
import { loadOpenInvoices, type OpenInvoiceOption } from './actions';
import { RecordReceiptDialog } from './RecordReceiptDialog';
import { Field } from '@/components/ui/Layout';
import { BuyerSearch } from '@/components/document/BuyerSearch';
import { searchBuyersAction } from '@/app/actions/search-options';

/**
 * "WHAT IS THIS PAYMENT FOR?" (11 Oct 2026, ops-pages demo tab 2 - approved).
 *
 * Record payment on a customer's page used to open a form typed by hand, with
 * the invoices underneath. It now asks one question first. One invoice → that
 * invoice's page opens with its payment panel open, which is the one place a
 * payment for an invoice is typed. Several (one cheque for three bills) → the
 * same receipt, split across exactly those, oldest first. An advance → a
 * receipt held on account.
 */
export function PayChooser({ party: given = null, onClose, onDone }: {
  /** Null from the Receipts list or a dashboard: the first question is who paid (G4, 11 Oct 2026). */
  party?: { id: string; label: string; sub: string } | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [party, setParty] = useState(given);
  if (!party) {
    return (
      <Modal title="Who paid?" subtitle="Pick the customer, then what the payment is for" icon="credit-card" size="md" onClose={onClose}
        footer={<Button onClick={onClose}>Cancel</Button>}>
        <Field label="From customer" required>
          <BuyerSearch
            search={searchBuyersAction}
            selected={null}
            onPick={(row) => {
              if (row) setParty({ id: row.id, label: row.company ? `${row.company} - ${row.name}` : row.name, sub: [row.code, row.phone].filter(Boolean).join(' · ') });
            }}
          />
        </Field>
      </Modal>
    );
  }
  return <ChooseInvoices party={party} onClose={onClose} onDone={onDone} />;
}

function ChooseInvoices({ party, onClose, onDone }: {
  party: { id: string; label: string; sub: string };
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<OpenInvoiceOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [advance, setAdvance] = useState(false);
  const [dialog, setDialog] = useState<null | { split: Record<string, number> }>(null);

  useEffect(() => {
    void loadOpenInvoices(party.id, 0).then((r) => {
      if (r.error) { setError(r.error); setRows([]); return; }
      const open = [...r.invoices].filter((i) => i.outstandingPaise > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      setRows(open);
      if (open[0]) setPick(new Set([open[0].id]));
    });
  }, [party.id]);

  if (dialog) {
    return <RecordReceiptDialog presetParty={party} presetSplit={dialog.split} onClose={onClose} onDone={onDone} />;
  }

  const chosen = (rows ?? []).filter((i) => pick.has(i.id));
  const total = chosen.reduce((n, i) => n + i.outstandingPaise, 0);
  const go = () => {
    if (advance) { setDialog({ split: {} }); return; }
    if (chosen.length === 1) { router.push(`/invoices/${chosen[0].id}?pay=1`); return; }
    setDialog({ split: Object.fromEntries(chosen.map((i) => [i.id, i.outstandingPaise])) });
  };

  return (
    <Modal title="What is this payment for?" subtitle={`${party.label} · tick the invoices it settles`} icon="credit-card" size="md" onClose={onClose}
      footer={(
        <>
          <span className="me-auto text-sm text-muted-foreground">{advance ? 'Advance - no invoice yet' : `${chosen.length} selected · `}{!advance && <b className="font-mono text-foreground">{formatCurrency(total)}</b>}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" iconEnd="arrow-right" disabled={!advance && chosen.length === 0} onClick={go}>
            {advance ? 'Record advance' : chosen.length === 1 ? 'Open invoice to record' : `Record across ${chosen.length} invoices`}
          </Button>
        </>
      )}>
      {rows === null && <p className="text-sm text-muted-foreground">Loading unpaid invoices…</p>}
      {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
      {rows && (
        <div className="grid gap-2">
          {rows.length === 0 && <p className="rounded-sm bg-surface px-3 py-3 text-sm text-muted-foreground">Nothing unpaid. A payment now is an advance.</p>}
          {rows.map((i) => (
            <label key={i.id} className={`btn-lift flex cursor-pointer items-center gap-3 rounded-sm border p-3 ${pick.has(i.id) && !advance ? 'border-brand bg-brand/5' : 'border-border'}`}>
              <input type="checkbox" disabled={advance} checked={pick.has(i.id)} onChange={() => setPick((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} className="h-4 w-4 accent-brand" />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-sm">{i.invoiceNo}</span>
                <span className="text-xs text-muted-foreground">{new Date(i.invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })}{i.daysOverdue > 0 ? ` · ${i.daysOverdue} days overdue` : ' · not yet due'}</span>
              </span>
              <span className="font-mono font-semibold text-danger">{formatCurrency(i.outstandingPaise)}</span>
            </label>
          ))}
          <label className="flex cursor-pointer items-center gap-3 rounded-sm border border-dashed border-border-strong p-3 text-sm text-muted-foreground">
            <input type="checkbox" checked={advance} onChange={() => setAdvance(!advance)} className="h-4 w-4 accent-brand" />
            Advance / on account - no invoice yet
          </label>
        </div>
      )}
    </Modal>
  );
}
