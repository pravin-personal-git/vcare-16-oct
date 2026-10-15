'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import { DetailHeader } from '@/components/document/DetailHeader';
import { ActionBar } from '@/components/document/ActionBar';
import { DocSplit, DocKpi, DocPanel } from '@/components/document/DocSplit';
import { sayIfHeld } from '@/lib/held-message';
import { WithFormOptions } from '@/components/document/WithFormOptions';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, type BadgeTone } from '@/components/ui/Layout';
import { formatCurrency } from '@/lib/format';
import { docMessage } from '@/lib/wa-message';
import { openWhatsApp } from '@/lib/wa-open';
import { isExpired, type QuotationStatus } from '@/lib/quotation-totals';
import type { QuotationDetail } from '@/server/quotations';
import { QuotationForm } from '../QuotationForm';
import { changeStatus, getShareLink } from '../actions';
import { convertQuotation } from '../../sales/orders/actions';
import { QuotationPaper } from './QuotationPaper';
import type { TemplateOptions } from '@/lib/document-templates';
import { AttachmentPanel } from '@/components/ui/AttachmentPanel';

import type { AttachmentView } from '@/components/ui/Attachments';
import { ask } from '@/components/ui/ask';

const STATUS: Record<QuotationStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  converted: { label: 'Converted to Order', tone: 'brand' },
  expired: { label: 'Expired', tone: 'warning' },
};

export function QuotationViewClient({
  detail, storeState, categories, canAddProduct, canEdit,
  files, template,
}: {
  detail: QuotationDetail;
  /** The branch's chosen layout (workstream C). Undefined prints Classic. */
  template?: TemplateOptions;
  storeState: string | null;
  categories: { id: string; name: string; codePrefix: string | null }[];
  canAddProduct: boolean;
  canEdit: boolean;
  files: AttachmentView[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The send buttons' own line - a copied link or what went wrong (A1: no alert()).
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);

  const status: QuotationStatus = isExpired(detail.validUntil, detail.status)
    ? 'expired'
    : detail.status;

  const locked = status === 'converted';

  const daysLeft = Math.ceil((new Date(detail.validUntil).getTime() - Date.now()) / 86_400_000);
  const validLabel = new Date(detail.validUntil).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
  const convert = async () => {
    if (!(await ask.confirm({
      icon: 'shopping-cart',
      title: `Make a sales order from ${detail.quotationNo}?`,
      message: 'The items and prices are copied to a new order, and this quotation is locked so it cannot change afterwards.',
      confirmLabel: 'Make the order',
    }))) return;
    setBusy(true);
    const res = await convertQuotation(detail.id, { expectedDeliveryDate: null, requiresApproval: false });
    setBusy(false);
    if (res.error) await ask.error(res.error);
    else window.location.href = '/sales/orders';
  };

  const move = async (to: QuotationStatus) => {
    setBusy(true);
    const r = await changeStatus(detail.id, to);
    setBusy(false);
    if (r.error) await ask.error(r.error);
    else { sayIfHeld(r); window.location.reload(); }
  };

  const share = async () => {
    setNotice(null);
    const res = await getShareLink(detail.id);
    if (res.error || !res.url) return setNotice({ error: true, text: res.error ?? 'Could not create a link.' });
    const copied = await navigator.clipboard.writeText(res.url).then(() => true, () => false);
    setNotice({ error: false, text: copied ? `Link copied - anyone with it can view the quotation: ${res.url}` : res.url });
  };

  // wa.me carries text only, never a file - so we send a link to a page the
  // customer can open and print themselves. One wording for every document
  // (lib/wa-message) and the +91 rule from lib/revenue (A1, 11 Oct 2026).
  const whatsapp = async () => {
    setNotice(null);
    const err = await openWhatsApp(detail.phone, async () => {
      const res = await getShareLink(detail.id);
      if (res.error || !res.url) return { error: res.error ?? 'Could not create a link.' };
      return docMessage({
        kind: 'quotation', number: detail.quotationNo, customerName: detail.customerName, org: detail.org.name,
        amountPaise: detail.grandTotalPaise, validUntil: detail.validUntil, url: res.url,
      });
    });
    if (err) setNotice({ error: true, text: err });
  };

  return (
    <div>
      {/* ---- page head (the detail-page standard, F1b) ------------------- */}
      <DetailHeader
        icon="file-text"
        kind="Quotation"
        number={detail.quotationNo}
        status={STATUS[status]}
        facts={[
          { label: 'Customer', value: <CustomerLink id={detail.partyId} via={`quotation:${detail.id}`}>{detail.organizationName ?? detail.customerName}</CustomerLink> },
          { label: 'Total', value: formatCurrency(detail.grandTotalPaise) },
          { label: 'Valid until', value: new Date(detail.validUntil).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) },
        ]}
        backHref="/quotation"
        actions={
          <>
            <Button variant="outline" size="icon" icon="printer" title="Print" onClick={() => window.print()} />
            <Button variant="primary" size="icon" icon="download" title="Download PDF" onClick={() => window.print()} />
          </>
        }
      />

      <DocSplit
        title={`Quotation ${detail.quotationNo}`}
        paperId="quotation-paper-wrap"
        paper={<QuotationPaper detail={detail} template={template} linkProducts />}
        left={(
          <>
            {/* ---- action bar (Option A, 11 Oct 2026) ---------------------- */}
            <ActionBar
              next={status === 'draft'
                ? { label: 'Mark as sent', icon: 'send', kbd: 'N', disabled: busy, onClick: () => move('sent') }
                : !locked && status !== 'rejected'
                  ? { label: 'Convert to order', icon: 'shopping-cart', kbd: 'N', disabled: busy, onClick: convert }
                  : undefined}
              whatsapp={{ label: 'WhatsApp', onClick: whatsapp }}
              sendMenu={[
                { label: 'Copy share link', icon: 'copy', onClick: share },
                { label: 'Send email', icon: 'mail', onClick: () => window.open(`mailto:${detail.email ?? ''}?subject=${encodeURIComponent(`Quotation ${detail.quotationNo}`)}`) },
                { label: 'Print / save as PDF', icon: 'printer', onClick: () => window.print() },
              ]}
              actions={[
                {
                  label: 'Edit', icon: 'pencil', iconTone: 'brand', kbd: 'E', disabled: !canEdit || locked,
                  title: locked ? 'Converted to an order - the agreed numbers can no longer change' : canEdit ? undefined : 'You do not have permission to edit quotations',
                  onClick: () => setEditOpen(true),
                },
                ...(!['converted', 'accepted', 'rejected'].includes(status) ? [{ label: 'Accepted', icon: 'check-circle' as const, iconTone: 'success' as const, disabled: busy, onClick: () => move('accepted') }] : []),
              ]}
              more={[
                ...(detail.partyId ? [{ label: 'Open the customer', icon: 'user' as const, onClick: () => { window.location.href = `/customers/${detail.partyId}`; } }] : []),
                { label: 'Print', icon: 'printer', onClick: () => window.print() },
              ]}
              destructive={!['converted', 'rejected'].includes(status) ? { label: 'Mark rejected / lost…', icon: 'x-circle', disabled: busy, onClick: async () => {
                if (await ask.confirm({
                  tone: 'danger', icon: 'x-circle',
                  title: `Mark ${detail.quotationNo} as lost?`,
                  message: 'Use this when the customer said no or went elsewhere. The quotation stays on record as rejected.',
                  confirmLabel: 'Mark as lost', cancelLabel: 'Keep it open',
                })) void move('rejected');
              } } : undefined}
            />

            {notice && (
              <p role={notice.error ? 'alert' : 'status'} className={`no-print break-all rounded-lg px-3 py-2 text-xs ${notice.error ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>{notice.text}</p>
            )}

            {locked && (
              <p className="no-print flex items-start gap-2 rounded-lg border border-brand/25 bg-brand/[0.06] px-3 py-2.5 text-xs text-on-tint-brand">
                <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
                This quotation has become a sales order. It is read-only so the figures
                the customer agreed to cannot change after the fact.
              </p>
            )}

            <div className="no-print grid grid-cols-2 gap-3 lg:grid-cols-4">
              <DocKpi label="Value" value={formatCurrency(detail.grandTotalPaise)} />
              <DocKpi label="Margin" value={detail.profit && !detail.profit.unknown && detail.profit.marginPct !== null ? `${detail.profit.marginPct.toFixed(1)}%` : '—'} tone={detail.profit && (detail.profit.marginPct ?? 0) < 0 ? 'danger' : undefined} />
              <DocKpi label="Valid till" value={validLabel} tone={daysLeft < 0 ? 'danger' : daysLeft <= 3 ? 'warning' : undefined} />
              <DocKpi label="Salesperson" value={<span className="text-base">{detail.salespersonName ?? '—'}</span>} />
            </div>

            {status === 'sent' && (
              <DocPanel title="Follow-up" icon="clock">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className={daysLeft < 0 ? 'text-danger' : daysLeft <= 3 ? 'text-warning' : ''}>{daysLeft < 0 ? 'The validity has run out.' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left to accept.`}</span>
                  <Button size="sm" variant="wa" icon="whatsapp" onClick={whatsapp}>Nudge on WhatsApp</Button>
                  {detail.phone && <Button size="sm" variant="soft" icon="phone" iconTone="brand" onClick={() => window.open(`tel:${detail.phone}`)}>Call</Button>}
                </div>
              </DocPanel>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <DocPanel title="Customer" icon="user">
                <div className="text-sm">
                  <p className="font-semibold">{detail.partyId ? <a href={`/customers/${detail.partyId}`} className="hover:text-brand hover:underline">{detail.organizationName ?? detail.customerName}</a> : (detail.organizationName ?? detail.customerName)}</p>
                  {detail.organizationName && <p className="text-muted-foreground">{detail.customerName}</p>}
                  <p className="text-muted-foreground">{[detail.phone, detail.email].filter(Boolean).join(' · ')}</p>
                  {detail.gstin && <p className="font-mono text-xs text-muted-foreground">GSTIN {detail.gstin}</p>}
                </div>
              </DocPanel>
              <DocPanel title={`Items (${detail.items.length})`} icon="package">
                <ul className="space-y-1 text-sm">
                  {detail.items.slice(0, 5).map((it) => (
                    <li key={it.srNo} className="flex justify-between gap-3"><span className="truncate">{it.productName} × {it.qty}</span><span className="shrink-0 font-mono">{formatCurrency(it.lineTotalPaise)}</span></li>
                  ))}
                  {detail.items.length > 5 && <li className="text-xs text-muted-foreground">+{detail.items.length - 5} more - see the document</li>}
                </ul>
                <p className="mt-2 flex justify-between border-t border-border pt-2 text-sm font-semibold"><span>Total</span><span className="font-mono">{formatCurrency(detail.grandTotalPaise)}</span></p>
              </DocPanel>
            </div>

            <Card className="p-4 print:hidden">
              <AttachmentPanel docType="quotation" docId={detail.id} initial={files} readOnly={!canEdit} phone={detail.phone} docLabel={`Quotation ${detail.quotationNo}`} />
            </Card>
          </>
        )}
      />

      {editOpen && (
        <WithFormOptions need={['catalogue']} onClose={() => setEditOpen(false)}>
          {(o) => (
            <QuotationForm
              parties={o.buyers} leads={o.leads} products={o.catalogue}
              storeState={storeState} categories={categories}
              canAddProduct={canAddProduct}
              editQuotationId={detail.id}
              onClose={() => setEditOpen(false)}
            />
          )}
        </WithFormOptions>
      )}
    </div>
  );
}
