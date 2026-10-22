'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import { SerialLinks } from '@/components/document/SerialLink';
import { sayIfHeld } from '@/lib/held-message';
import { WithFormOptions } from '@/components/document/WithFormOptions';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, type BadgeTone } from '@/components/ui/Layout';
import { formatCurrency } from '@/lib/format';
import { docMessage } from '@/lib/wa-message';
import { openWhatsApp } from '@/lib/wa-open';
import { daysOverdue, STATUS_LABEL, type InvoiceStatus } from '@/lib/invoice-status';
import type { InvoiceDetail } from '@/server/invoices';
import { PaymentDialog } from '../PaymentDialog';
import { issue, cancel, getInvoiceShareLink } from '../actions';
import { AttachmentPanel } from '@/components/ui/AttachmentPanel';
import type { AttachmentView } from '@/components/ui/Attachments';
import { InvoiceForm } from '../InvoiceForm';
import type { RevisionRow } from '@/server/invoices';
import { CostTrail } from './CostTrail';
import { InvoicePaper } from '@/components/document/InvoicePaper';
import { DetailHeader } from '@/components/document/DetailHeader';
import { ActionBar } from '@/components/document/ActionBar';
import { DocSplit, DocKpi, DocPanel } from '@/components/document/DocSplit';
import { ask } from '@/components/ui/ask';

const TONE: Record<InvoiceStatus, BadgeTone> = {
  draft: 'neutral', pending: 'warning', sent: 'info', partially_paid: 'warning',
  paid: 'success', overdue: 'danger', cancelled: 'neutral',
};

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', bank: 'Bank', cheque: 'Cheque',
  card: 'Card', adjustment: 'Adjustment', tds: 'TDS deducted', credit_note: 'Credit note',
};

export function InvoiceViewClient({
  detail: i, canIssue, canApprove, canSeeCosts, files, revisions, storeState, scopeIsAll,
}: {
  detail: InvoiceDetail;
  canIssue: boolean;
  canApprove: boolean;
  canSeeCosts: boolean;
  files: AttachmentView[];
  revisions: RevisionRow[];
  storeState: string | null;
  scopeIsAll: boolean;
}) {
  const [payOpen, setPayOpen] = useState(false);
  // Arrived from "What is this payment for?" (?pay=1): open the payment panel.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('pay') === '1' && i.duePaise > 0 && i.lifecycle === 'sent') {
      setPayOpen(true);
      sp.delete('pay');
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${sp.toString() ? `?${sp}` : ''}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [editOpen, setEditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const over = daysOverdue(i);

  // wa.me carries text only, so the message carries the invoice's own link -
  // the customer opens it and saves the PDF from there.
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const shareOnWhatsApp = async () => {
    setNotice(null);
    const err = await openWhatsApp(i.phone, async () => {
      const res = await getInvoiceShareLink(i.id);
      if (res.error || !res.url) return { error: res.error ?? 'Could not create a link.' };
      return docMessage({
        kind: 'invoice', number: i.invoiceNo, customerName: i.customerName, org: i.org.name,
        amountPaise: i.grandTotalPaise, duePaise: i.duePaise, dueBy: i.dueDate, url: res.url,
      });
    });
    if (err) setNotice({ error: true, text: err });
  };
  const copyLink = async () => {
    setNotice(null);
    const res = await getInvoiceShareLink(i.id);
    if (res.error || !res.url) return setNotice({ error: true, text: res.error ?? 'Could not create a link.' });
    const copied = await navigator.clipboard.writeText(res.url).then(() => true, () => false);
    setNotice({ error: false, text: copied ? `Link copied: ${res.url}` : res.url });
  };

  const run = async (fn: () => Promise<{ error?: string; message?: string }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.error) await ask.error(r.error);
    // A held action ("Sent for approval…") says so before the page reloads.
    else { sayIfHeld(r); window.location.reload(); }
  };

  return (
    <div>
      {/* ---- page head (the detail-page standard, F1b) ------------------- */}
      <DetailHeader
        icon="receipt"
        kind="Tax invoice"
        number={i.invoiceNo}
        status={{ label: STATUS_LABEL[i.status], tone: TONE[i.status] }}
        facts={[
          { label: 'Customer', value: <CustomerLink id={i.partyId} via={`invoice:${i.id}`}>{i.organizationName ?? i.customerName}</CustomerLink> },
          { label: 'Dated', value: fmt(i.invoiceDate) },
          { label: 'Total', value: formatCurrency(i.grandTotalPaise) },
          { label: 'Due', value: i.duePaise > 0 ? formatCurrency(i.duePaise) : null },
          { label: 'Overdue', value: i.status === 'overdue' ? `${over} days` : null },
        ]}
        backHref="/invoices"
        actions={
          <>
            <Button variant="outline" size="icon" icon="printer" title="Print" onClick={() => window.print()} />
            <Button variant="primary" size="icon" icon="download" title="Download PDF" onClick={() => window.print()} />
          </>
        }
      />

      {/* Print rules: only the paper prints. */}
      <style>{`
          @media print {
            body * { visibility: hidden; }
            #invoice-paper, #invoice-paper * { visibility: visible; }
            #invoice-paper {
              position: absolute; inset-inline-start: 0; top: 0; width: 100%;
              box-shadow: none; border: 0;
            }
            @page { margin: 12mm; }
          }
        `}</style>

      <DocSplit
        title={`Tax invoice ${i.invoiceNo}`}
        paperId="invoice-paper"
        paper={<InvoicePaper i={i} linkProducts />}
        left={(
          <>
            {/* ---- action bar (Option A, 11 Oct 2026) ---------------------- */}
            <ActionBar
              status={i.lifecycle === 'draft' ? undefined : <Badge tone="info" icon="check">Issued</Badge>}
              next={i.lifecycle === 'draft' ? {
                label: 'Issue invoice', icon: 'send', kbd: 'N', disabled: !canIssue || busy,
                onClick: () => run(() => issue(i.id)),
              } : undefined}
              money={i.duePaise > 0 && i.lifecycle === 'sent' ? { label: 'Record payment', kbd: 'P', disabled: busy, onClick: () => setPayOpen(true) } : undefined}
              whatsapp={{
                label: 'WhatsApp', disabled: i.lifecycle === 'draft' || busy,
                title: i.lifecycle === 'draft' ? 'Issue the invoice first' : 'Send the invoice link on WhatsApp',
                onClick: shareOnWhatsApp,
              }}
              sendMenu={[
                { label: 'Copy invoice link', icon: 'copy', disabled: i.lifecycle === 'draft', onClick: copyLink },
                { label: 'Print / save as PDF', icon: 'printer', onClick: () => window.print() },
              ]}
              actions={[
                {
                  label: 'Edit', icon: 'pencil', iconTone: 'brand', kbd: 'E',
                  disabled: !canApprove || i.lifecycle === 'cancelled' || scopeIsAll,
                  title: i.lifecycle === 'cancelled' ? 'A cancelled invoice is a closed record' : scopeIsAll ? 'Select a single store first' : canApprove ? 'The change is recorded - who, when and why' : 'Editing an issued invoice needs the approve permission',
                  onClick: () => setEditOpen(true),
                },
                ...(revisions.length > 0 ? [{ label: `${revisions.length} change${revisions.length === 1 ? '' : 's'}`, icon: 'clock' as const, onClick: () => setHistoryOpen((v) => !v) }] : []),
              ]}
              more={[
                ...(i.orderNo ? [{ label: `Open order ${i.orderNo}`, icon: 'shopping-cart' as const, onClick: () => { window.location.href = i.salesOrderId ? `/sales/orders/${i.salesOrderId}` : '/sales/orders'; } }] : []),
                ...(i.partyId ? [{ label: 'Open the customer', icon: 'user' as const, onClick: () => { window.location.href = `/customers/${i.partyId}`; } }] : []),
                { label: 'Print', icon: 'printer', onClick: () => window.print() },
              ]}
              destructive={i.lifecycle !== 'cancelled' && i.amountPaidPaise === 0 ? {
                label: 'Cancel invoice…', icon: 'ban', disabled: !canApprove || busy,
                title: canApprove ? undefined : 'Cancelling needs the approve permission',
                onClick: async () => {
                  const reason = await ask.text({
                    tone: 'danger', icon: 'ban',
                    title: `Cancel ${i.invoiceNo}?`,
                    message: 'The invoice stays on record, marked cancelled. Your reason goes on the audit trail.',
                    label: 'Why is it being cancelled?',
                    multiline: true, required: true,
                    confirmLabel: 'Cancel invoice', cancelLabel: 'Keep it',
                  });
                  if (reason === null) return;
                  run(() => cancel(i.id, reason));
                },
              } : undefined}
            />

            {notice && (
              <p role={notice.error ? 'alert' : 'status'} className={`no-print break-all rounded-lg px-3 py-2 text-xs ${notice.error ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>{notice.text}</p>
            )}

            {i.lifecycle === 'draft' && (
              <p className="no-print flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.07] px-3 py-2.5 text-xs text-on-tint-warning">
                <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  This is still a <strong>draft</strong>. It carries a number but has
                  not been issued, and no payment can be recorded against it. Check the
                  figures, then press Issue.
                </span>
              </p>
            )}

            <div className="no-print grid grid-cols-2 gap-3 lg:grid-cols-4">
              <DocKpi label="Total" value={formatCurrency(i.grandTotalPaise)} />
              <DocKpi label="Received" value={formatCurrency(i.amountPaidPaise)} tone={i.amountPaidPaise > 0 ? 'success' : undefined} />
              <DocKpi label="Due" value={formatCurrency(i.duePaise)} tone={i.duePaise > 0 ? 'danger' : 'success'} />
              <DocKpi label={i.status === 'overdue' ? 'Overdue' : 'Due date'} value={i.status === 'overdue' ? `${over} days` : fmt(i.dueDate)} tone={i.status === 'overdue' ? 'danger' : undefined} />
            </div>

            {i.lifecycle !== 'cancelled' && i.lifecycle !== 'draft' && (
              <DocPanel title="Payment" icon="credit-card" right={<Badge tone={i.duePaise > 0 ? 'warning' : 'success'}>{formatCurrency(i.amountPaidPaise)} of {formatCurrency(i.grandTotalPaise)}</Badge>}>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-success transition-all" style={{ width: `${i.grandTotalPaise ? Math.min(100, (i.amountPaidPaise / i.grandTotalPaise) * 100) : 0}%` }} />
                </div>
                {i.payments.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">Nothing received yet.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-border">
                    {i.payments.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <Badge tone="neutral">{METHOD_LABEL[p.method] ?? p.method}</Badge>
                        <span className="font-mono font-semibold tabular-nums text-success">{formatCurrency(p.amountPaise)}</span>
                        {p.reference && <span className="font-mono text-xs text-muted-foreground">{p.reference}</span>}
                        {p.note && <span className="text-xs text-muted-foreground">{p.note}</span>}
                        <span className="ms-auto text-xs text-muted-foreground">{fmt(p.paidAt)}{p.byName ? ` · ${p.byName}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </DocPanel>
            )}

            {/* Customer a third, items two thirds (15 Oct 2026): a name, a phone
                and an address never needed half the row, while the lines -
                and their serials - were squeezed into the other half. */}
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <DocPanel title="Customer" icon="user">
                <div className="text-sm">
                  <p className="font-semibold">{i.partyId ? <Link href={`/customers/${i.partyId}`} className="hover:text-brand hover:underline">{i.customerName}</Link> : i.customerName}</p>
                  {i.organizationName && <p className="text-muted-foreground">{i.organizationName}</p>}
                  <p className="text-muted-foreground">{[i.phone, i.email].filter(Boolean).join(' · ')}</p>
                  {i.gstin && <p className="font-mono text-xs text-muted-foreground">GSTIN {i.gstin}</p>}
                  {i.billingAddress && <p className="mt-1 text-xs text-muted-foreground">{i.billingAddress}</p>}
                </div>
              </DocPanel>
              <DocPanel title={`Items (${i.items.length})`} icon="package">
                <ul className="space-y-1.5 text-sm">
                  {i.items.map((it) => (
                    <li key={it.srNo}>
                      <div className="flex justify-between gap-3"><span className="min-w-0">{it.productName} × {it.qty}</span><span className="shrink-0 font-mono">{formatCurrency(it.lineTotalPaise)}</span></div>
                      {it.serials.length > 0 && (
                        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">S/N: <SerialLinks units={it.serials.map((serialNo) => ({ serialNo }))} /></p>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 flex justify-between border-t border-border pt-2 text-sm font-semibold"><span>Total</span><span className="font-mono">{formatCurrency(i.grandTotalPaise)}</span></p>
              </DocPanel>
            </div>

            <CostTrail invoiceId={i.id} allowed={canSeeCosts} />

            <Card className="p-4 print:hidden">
              <AttachmentPanel docType="invoice" docId={i.id} initial={files} readOnly={!canIssue} phone={i.phone} docLabel={`Invoice ${i.invoiceNo}`} />
            </Card>
          </>
        )}
      />

      {historyOpen && revisions.length > 0 && (
        <Card className="mt-3 p-4 print:hidden">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Icon name="clock" className="h-4 w-4 text-brand" />
            Change history
            <span className="ms-auto text-xs font-normal text-muted-foreground">
              newest first · version {i.version} is current
            </span>
          </h2>

          <ol className="space-y-3">
            {revisions.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Badge tone="brand">v{r.version}</Badge>
                  <span className="text-sm font-medium">{r.reason}</span>
                  <span className="ms-auto text-xs text-muted-foreground">
                    {r.changedByName ?? 'Unknown'} · {fmt(r.changedAt)}
                  </span>
                </div>

                <ul className="mt-2 space-y-0.5">
                  {r.changes.map((c, n) => (
                    <li key={n} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Icon name="chevron-right" className="mt-0.5 h-3 w-3 shrink-0" />
                      {c}
                    </li>
                  ))}
                </ul>

                {r.beforeGrandTotalPaise !== r.afterGrandTotalPaise && (
                  <p className="mt-2 font-mono text-xs tabular-nums">
                    <span className="text-muted-foreground line-through">
                      {formatCurrency(r.beforeGrandTotalPaise)}
                    </span>
                    <span className="mx-2 text-muted-foreground">→</span>
                    <span className="font-semibold">{formatCurrency(r.afterGrandTotalPaise)}</span>
                  </p>
                )}
              </li>
            ))}
          </ol>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Append-only. A revision is never edited or removed - the one somebody
            would want to remove is exactly the one worth keeping. The previous
            line set is stored with each entry, so what the invoice used to say
            is still recoverable.
          </p>
        </Card>
      )}

      {editOpen && (
        <WithFormOptions need={['catalogue']} onClose={() => setEditOpen(false)}>
          {(o) => (
            <InvoiceForm
              parties={o.buyers}
              products={o.catalogue}
              storeState={storeState}
              editInvoiceId={i.id}
              onClose={() => setEditOpen(false)}
            />
          )}
        </WithFormOptions>
      )}

      {payOpen && (
        <PaymentDialog
          invoiceId={i.id}
          invoiceNo={i.invoiceNo}
          customerName={i.customerName}
          duePaise={i.duePaise}
          onClose={() => setPayOpen(false)}
        />
      )}
    </div>
  );
}
