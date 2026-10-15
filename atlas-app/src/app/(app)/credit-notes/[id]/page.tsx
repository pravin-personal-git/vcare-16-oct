import { ProductLink } from '@/components/document/ProductLink';
import { CustomerLink } from '@/components/document/CustomerLink';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { getCreditNoteDetail } from '@/server/credit-notes';
import { Badge, Card, SectionCard, SummaryRow } from '@/components/ui/Layout';
import { DetailHeader } from '@/components/document/DetailHeader';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { CREDIT_REASON_LABEL, creditNoteCutoff } from '@/lib/returns';
import { CreditNoteActions } from './CreditNoteActions';
import { documentTrail } from '@/server/document-trail';
import { DocumentTrail } from '@/components/document/DocumentTrail';
import { DocumentActivity } from '@/components/document/DocumentActivity';

const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export default async function CreditNoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireContext();
  const c = await getCreditNoteDetail(ctx.scope, id);
  if (!c) notFound();

  const trail = await documentTrail(ctx.scope, 'credit_note', c.id);
  const canCredit = ctx.scope.kind === 'single' && ctx.permissions.has('returns.credit');
  const livePaidRefunds = c.refunds.filter((r) => r.status === 'paid');

  return (
    <div>
      <DetailHeader
        icon="receipt"
        kind="Credit note"
        number={c.creditNoteNo}
        status={c.lifecycle === 'cancelled' ? { label: 'Cancelled', tone: 'danger' }
          : c.lifecycle === 'draft' ? { label: 'Draft', tone: 'warning' } : { label: 'Issued', tone: 'success' }}
        facts={[
          { label: 'Customer', value: <CustomerLink id={c.partyId} via={`credit:${c.id}`}>{c.customerName}</CustomerLink> },
          { label: 'Invoice', value: <Link href={`/invoices/${c.invoiceId}`} className="font-mono text-brand hover:underline">{c.invoiceNo}</Link> },
          { label: 'Return', value: c.salesReturnId && c.returnNo
            ? <Link href={`/sales-return/${c.salesReturnId}`} className="font-mono text-brand hover:underline">{c.returnNo}</Link> : null },
          { label: 'Dated', value: fmtDate(c.creditNoteDate) },
          { label: 'Amount', value: formatCurrency(c.grandTotalPaise) },
        ]}
        backHref="/credit-notes"
        actions={
          <CreditNoteActions
            id={c.id}
            creditNoteNo={c.creditNoteNo}
            lifecycle={c.lifecycle}
            unusedPaise={c.unusedPaise}
            refundedPaise={c.refundedPaise}
            appliedTo={c.appliedTo}
            partyId={c.partyId}
            canCredit={canCredit}
          />
        }
      />
      <DocumentTrail steps={trail} />

      {c.lifecycle === 'cancelled' && c.cancelReason && (
        <Card className="mb-3 flex items-start gap-2.5 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <Icon name="x" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="text-xs leading-relaxed">
            <strong className="text-danger">Cancelled.</strong> {c.cancelReason}
            {' '}Every invoice it was settling is outstanding again. The document and its
            number stay on the record - a credit note series has to remain unbroken.
          </p>
        </Card>
      )}

      {c.pastTaxCutoff && c.lifecycle !== 'cancelled' && (
        <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-xs leading-relaxed">
            <strong className="text-warning">This may be too late to reduce your GST liability.</strong>
            {' '}
            {c.invoiceNo} was raised on {fmtDate(c.invoiceDate)}, and the outer limit for a
            credit note against that supply was around {fmtDate(creditNoteCutoff(c.invoiceDate))}.
            The credit note is still valid commercially - the customer is owed the full
            {' '}{formatCurrency(c.grandTotalPaise)} - but you may have to absorb the
            {' '}{formatCurrency(c.cgstPaise + c.sgstPaise + c.igstPaise)} of tax rather than
            recover it. <strong>Confirm with your accountant before filing.</strong>
          </p>
        </Card>
      )}

      {c.lifecycle === 'issued' && c.unusedPaise > 0 && (
        <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-xs leading-relaxed">
            <strong className="text-warning">{formatCurrency(c.unusedPaise)} is unused.</strong>
            {' '}It is applied to nothing and has not been refunded, so it reduces no invoice
            and appears on no statement - {c.customerName} has no way of knowing it exists.
            Apply it to an outstanding invoice, or refund it.
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="What is being credited" icon="receipt" className="lg:col-span-2" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Item</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Rate</th>
                  <th className="px-3 py-2 text-right font-semibold">GST</th>
                  <th className="px-3 py-2 text-right font-semibold">Taxable</th>
                  <th className="px-3 py-2 text-right font-semibold">Tax</th>
                </tr>
              </thead>
              <tbody>
                {c.items.map((i) => (
                  <tr key={i.srNo} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <ProductLink id={i.productId} className="block font-medium">{i.productName}</ProductLink>
                      {i.productCode && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {i.productCode}
                          {i.hsnCode && <span className="ms-2">HSN {i.hsnCode}</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.qty}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">
                      {formatCurrency(i.unitPricePaise)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                      {i.taxRatePct}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatCurrency(i.lineTotalPaise)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-xs text-muted-foreground">
                      {formatCurrency(i.taxPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border bg-muted/20 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
            Tax mode is <strong>{c.taxMode === 'IGST' ? 'IGST' : 'CGST + SGST'}</strong>, copied
            from {c.invoiceNo} and not changeable. An interstate supply cannot be credited as
            an intrastate one - that would reclaim tax from two states that never received it,
            and the mismatch surfaces months later against the customer&rsquo;s GSTR-2B.
          </p>
        </SectionCard>

        <div className="grid content-start gap-4">
          <SectionCard title="Amount" icon="receipt">
            <SummaryRow label="Taxable value" value={formatCurrency(c.taxableBasePaise)} />
            {c.taxMode === 'IGST' ? (
              <SummaryRow label="IGST" value={formatCurrency(c.igstPaise)} />
            ) : (
              <>
                <SummaryRow label="CGST" value={formatCurrency(c.cgstPaise)} />
                <SummaryRow label="SGST" value={formatCurrency(c.sgstPaise)} />
              </>
            )}
            <SummaryRow label="Total credit" value={formatCurrency(c.grandTotalPaise)} strong />

            <div className="mt-3 space-y-1 border-t border-border pt-3">
              <SummaryRow label="Set against invoices" value={formatCurrency(c.allocatedPaise)} />
              <SummaryRow label="Refunded" value={formatCurrency(c.refundedPaise)} />
              <SummaryRow label="Unused" value={formatCurrency(c.unusedPaise)} strong />
            </div>
          </SectionCard>

          {c.appliedTo.length > 0 && (
            <SectionCard title="Applied to" icon="file-text" bodyClassName="p-2">
              {c.appliedTo.map((a) => (
                <Link
                  key={a.invoiceId}
                  href={`/invoices/${a.invoiceId}`}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="font-mono text-brand">{a.invoiceNo}</span>
                  <span className="tabular-nums">{formatCurrency(a.amountPaise)}</span>
                </Link>
              ))}
            </SectionCard>
          )}

          {c.refunds.length > 0 && (
            <SectionCard title="Refunds" icon="credit-card" bodyClassName="p-2">
              {c.refunds.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-2 py-1.5 text-sm">
                  <span>
                    <span className="block font-mono text-xs">{r.refundNo}</span>
                    <span className="block text-xs text-muted-foreground">
                      {fmtDate(r.refundedAt)} · {r.method}
                      {r.reference && ` · ${r.reference}`}
                    </span>
                  </span>
                  <span className="text-end">
                    <span className="block tabular-nums">{formatCurrency(r.amountPaise)}</span>
                    {r.status !== 'paid' && <Badge tone="danger">Reversed</Badge>}
                  </span>
                </div>
              ))}
              {livePaidRefunds.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Every refund here was reversed, so the credit is usable again.
                </p>
              )}
            </SectionCard>
          )}

          <SectionCard title="Details" icon="info">
            <SummaryRow label="Reason" value={CREDIT_REASON_LABEL[c.reason] ?? c.reason} />
            {c.reasonNote && <SummaryRow label="Detail" value={c.reasonNote} />}
            <SummaryRow label="Dated" value={fmtDate(c.creditNoteDate)} />
            <SummaryRow label="Against invoice of" value={fmtDate(c.invoiceDate)} />
            {c.gstin && <SummaryRow label="Customer GSTIN" value={c.gstin} />}
            <SummaryRow label="Issued by" value={c.org.name} />
          </SectionCard>
        </div>
      </div>
      <DocumentActivity table="CreditNote" rowId={id} />
    </div>
  );
}
