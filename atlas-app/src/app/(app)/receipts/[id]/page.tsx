import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { receiptView } from '@/server/record-views';
import { SectionCard, SummaryRow } from '@/components/ui/Layout';
import { DetailHeader } from '@/components/document/DetailHeader';
import { formatCurrency } from '@/lib/format';
import { METHOD_LABEL } from '@/lib/receipt';
import { documentTrail } from '@/server/document-trail';
import { DocumentTrail } from '@/components/document/DocumentTrail';
import { DocumentActivity } from '@/components/document/DocumentActivity';
import { AttachmentPanel } from '@/components/ui/AttachmentPanel';
import { listAttachments } from '@/server/attachments';

/**
 * ONE RECEIPT (G-29, 10 Oct 2026). Money a customer paid: how, when, and the
 * invoices it settled - each one a link. Recording and reversing stay on the
 * receipts register; this is the page every link to a receipt now opens.
 */
const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const r = await receiptView(ctx.scope, id);
  if (!r) notFound();
  const [trail, files] = await Promise.all([
    documentTrail(ctx.scope, 'receipt', r.id),
    // Payment proof (11 Oct 2026): the UPI screenshot or cheque photo behind this receipt.
    listAttachments(ctx.scope, 'receipt', r.id).catch(() => []),
  ]);
  const link = 'font-mono text-brand hover:underline';

  return (
    <div>
      <DetailHeader
        icon="credit-card"
        kind="Receipt"
        number={r.receiptNo}
        status={r.status === 'received' ? { label: 'Received', tone: 'success' } : { label: r.status === 'bounced' ? 'Bounced' : 'Reversed', tone: 'danger' }}
        facts={[
          { label: 'Customer', value: r.party ? <Link href={`/customers/${r.party.id}?via=receipt:${r.id}`} className="text-brand hover:underline">{r.customerName}</Link> : null },
          { label: 'Received', value: fmtDate(r.receivedAt) },
          { label: 'Amount', value: formatCurrency(r.amountPaise) },
          { label: 'Method', value: METHOD_LABEL[r.method] ?? r.method },
        ]}
        backHref={`/receipts?q=${encodeURIComponent(r.receiptNo)}`}
      />
      <DocumentTrail steps={trail} />

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="What it paid" icon="receipt" className="lg:col-span-2" bodyClassName="p-2">
          {r.allocations.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">Not set against any invoice - it sits on the customer&apos;s account as an advance.</p>
          ) : r.allocations.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
              <span>
                <Link href={`/invoices/${a.invoice.id}`} className={link}>{a.invoice.invoiceNo}</Link>
                <span className="ms-2 text-xs text-muted-foreground">of {formatCurrency(a.invoice.grandTotalPaise)} · {fmtDate(a.allocatedAt)}{a.reason ? ` · ${a.reason}` : ''}</span>
              </span>
              <span className="tabular-nums">{formatCurrency(a.amountPaise)}</span>
            </div>
          ))}
        </SectionCard>

        <div className="grid content-start gap-4">
          <SectionCard title="Amount" icon="credit-card">
            <SummaryRow label="Received" value={formatCurrency(r.amountPaise)} />
            <SummaryRow label="Set against invoices" value={formatCurrency(r.appliedPaise)} />
            <SummaryRow label="On account" value={formatCurrency(r.onAccountPaise)} strong />
          </SectionCard>
          <SectionCard title="Details" icon="info">
            {r.reference && <SummaryRow label="Reference" value={r.reference} />}
            {r.salesOrder && <SummaryRow label="Sales order" value={<Link href={`/sales/orders/${r.salesOrder.id}`} className={link}>{r.salesOrder.orderNo}</Link>} />}
            {r.challan && <SummaryRow label="Installation challan" value={<Link href={`/services/installations/${r.challan.id}`} className={link}>{r.challan.challanNo}</Link>} />}
            {r.recordedByName && <SummaryRow label="Recorded by" value={r.recordedByName} />}
            {r.note && <SummaryRow label="Note" value={r.note} />}
          </SectionCard>
        </div>
      </div>
      <div className="mt-4">
        <AttachmentPanel docType="receipt" docId={r.id} initial={files} title="Payment proof"
          readOnly={!ctx.permissions.has('accounts.edit')} phone={r.party?.phone} docLabel={`Receipt ${r.receiptNo}`} />
      </div>
      <DocumentActivity table="Receipt" rowId={id} />
    </div>
  );
}
