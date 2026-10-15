import { SupplierLink } from '@/components/document/SupplierLink';
import { ProductLink } from '@/components/document/ProductLink';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { purchaseOrderView } from '@/server/record-views';
import { SectionCard, SummaryRow } from '@/components/ui/Layout';
import { DetailHeader } from '@/components/document/DetailHeader';
import { formatCurrency } from '@/lib/format';
import { documentTrail } from '@/server/document-trail';
import { DocumentTrail } from '@/components/document/DocumentTrail';
import { DocumentActivity } from '@/components/document/DocumentActivity';

/**
 * ONE PURCHASE ORDER (G-29, 10 Oct 2026). What was ordered, how much of each
 * line has arrived, and the goods receipts and bills that followed - each a
 * link. Editing stays on the purchase-order list.
 */
const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-';

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const o = await purchaseOrderView(ctx.scope, id);
  if (!o) notFound();
  const trail = await documentTrail(ctx.scope, 'purchase_order', o.id);
  const link = 'font-mono text-brand hover:underline';
  const tone = o.status === 'cancelled' ? 'danger' : o.status === 'received' || o.status === 'closed' ? 'success' : o.status === 'draft' ? 'warning' : 'info';

  return (
    <div>
      <DetailHeader
        icon="shopping-cart"
        kind="Purchase order"
        number={o.orderNo}
        status={{ label: o.status.replace(/_/g, ' '), tone }}
        facts={[
          { label: 'Supplier', value: <SupplierLink id={o.partyId}>{o.supplierLabel}</SupplierLink> },
          { label: 'Ordered', value: fmtDate(o.orderDate) },
          { label: 'Expected', value: o.expectedDeliveryDate ? fmtDate(o.expectedDeliveryDate) : null },
          { label: 'Total', value: formatCurrency(o.grandTotalPaise) },
        ]}
        backHref={`/purchase/orders?q=${encodeURIComponent(o.orderNo)}`}
      />
      <DocumentTrail steps={trail} />

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Lines" icon="package" className="lg:col-span-2" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Item</th>
                  <th className="px-3 py-2 text-right font-semibold">Ordered</th>
                  <th className="px-3 py-2 text-right font-semibold">Received</th>
                  <th className="px-3 py-2 text-right font-semibold">Rate</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <ProductLink id={i.productId} className="block font-medium">{i.productName}</ProductLink>
                      {i.productCode && <span className="block font-mono text-xs text-muted-foreground">{i.productCode}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.qty}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${i.receivedQty < i.qty ? 'text-warning' : 'text-success'}`}>{i.receivedQty}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{formatCurrency(i.unitCostPaise)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatCurrency(i.lineTotalPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="grid content-start gap-4">
          <SectionCard title="Amount" icon="receipt">
            <SummaryRow label="Taxable value" value={formatCurrency(o.taxableBasePaise)} />
            {o.igstPaise > 0 ? <SummaryRow label="IGST" value={formatCurrency(o.igstPaise)} /> : (
              <>
                <SummaryRow label="CGST" value={formatCurrency(o.cgstPaise)} />
                <SummaryRow label="SGST" value={formatCurrency(o.sgstPaise)} />
              </>
            )}
            <SummaryRow label="Total" value={formatCurrency(o.grandTotalPaise)} strong />
          </SectionCard>
          <SectionCard title="Goods received" icon="package" bodyClassName="p-2">
            {o.goodsReceipts.length === 0 ? <p className="px-2 py-1 text-sm text-muted-foreground">Nothing received yet.</p>
              : o.goodsReceipts.map((g) => (
                <Link key={g.id} href={`/goods-receipt/${g.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                  <span className={link}>{g.grnNo}</span>
                  <span className="text-xs text-muted-foreground">{fmtDate(g.receivedDate)} · {g.status.replace(/_/g, ' ')}</span>
                </Link>
              ))}
          </SectionCard>
          {o.bills.length > 0 && (
            <SectionCard title="Supplier bills" icon="file-text" bodyClassName="p-2">
              {o.bills.map((b) => (
                <Link key={b.id} href={`/purchase/bills/${b.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                  <span className={link}>{b.billNo}</span>
                  {b.supplierBillNo && <span className="text-xs text-muted-foreground">their no. {b.supplierBillNo}</span>}
                </Link>
              ))}
            </SectionCard>
          )}
          {o.notes && <SectionCard title="Notes" icon="info"><p className="text-sm">{o.notes}</p></SectionCard>}
        </div>
      </div>
      <DocumentActivity table="PurchaseOrder" rowId={id} />
    </div>
  );
}
