import { SupplierLink } from '@/components/document/SupplierLink';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { supplierPaymentView } from '@/server/record-views';
import { SectionCard, SummaryRow } from '@/components/ui/Layout';
import { DetailHeader } from '@/components/document/DetailHeader';
import { formatCurrency } from '@/lib/format';
import { METHOD_LABEL } from '@/lib/receipt';
import { documentTrail } from '@/server/document-trail';
import { DocumentTrail } from '@/components/document/DocumentTrail';
import { DocumentActivity } from '@/components/document/DocumentActivity';

/**
 * ONE SUPPLIER PAYMENT (G-29, 10 Oct 2026). Money paid to a supplier and the
 * bills it settled, each a link. Paying and reversing stay on Payables.
 */
const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export default async function SupplierPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const p = await supplierPaymentView(ctx.scope, id);
  if (!p) notFound();
  const trail = await documentTrail(ctx.scope, 'supplier_payment', p.id);
  const link = 'font-mono text-brand hover:underline';

  return (
    <div>
      <DetailHeader
        icon="credit-card"
        kind="Supplier payment"
        number={p.paymentNo}
        status={p.status === 'reversed' ? { label: 'Reversed', tone: 'danger' } : { label: 'Paid', tone: 'success' }}
        facts={[
          { label: 'Supplier', value: <SupplierLink id={p.partyId}>{p.supplierLabel}</SupplierLink> },
          { label: 'Paid', value: fmtDate(p.paidAt) },
          { label: 'Amount', value: formatCurrency(p.amountPaise) },
          { label: 'Method', value: METHOD_LABEL[p.method] ?? p.method },
        ]}
        backHref="/purchase/payables"
        backLabel="Back to payables"
      />
      <DocumentTrail steps={trail} />

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Bills it paid" icon="file-text" className="lg:col-span-2" bodyClassName="p-2">
          {p.allocations.length === 0 ? <p className="px-2 py-1.5 text-sm text-muted-foreground">Not set against any bill - an advance to the supplier.</p>
            : p.allocations.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                <span>
                  <Link href={`/purchase/bills/${a.bill.id}`} className={link}>{a.bill.billNo}</Link>
                  <span className="ms-2 text-xs text-muted-foreground">{a.bill.supplierBillNo ? `their no. ${a.bill.supplierBillNo} · ` : ''}of {formatCurrency(a.bill.grandTotalPaise)}</span>
                </span>
                <span className="tabular-nums">{formatCurrency(a.amountPaise)}</span>
              </div>
            ))}
        </SectionCard>
        <div className="grid content-start gap-4">
          <SectionCard title="Amount" icon="credit-card">
            <SummaryRow label="Paid" value={formatCurrency(p.amountPaise)} />
            <SummaryRow label="Set against bills" value={formatCurrency(p.appliedPaise)} />
            <SummaryRow label="Advance" value={formatCurrency(Math.max(0, p.amountPaise - p.appliedPaise))} strong />
          </SectionCard>
          <SectionCard title="Details" icon="info">
            {p.reference && <SummaryRow label="Reference" value={p.reference} />}
            {p.recordedByName && <SummaryRow label="Recorded by" value={p.recordedByName} />}
            {p.note && <SummaryRow label="Note" value={p.note} />}
          </SectionCard>
        </div>
      </div>
      <DocumentActivity table="SupplierPayment" rowId={id} />
    </div>
  );
}
