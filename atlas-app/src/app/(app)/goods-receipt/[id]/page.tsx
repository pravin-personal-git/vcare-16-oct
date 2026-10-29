import { SupplierLink } from '@/components/document/SupplierLink';
import { ProductLink } from '@/components/document/ProductLink';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { grnView } from '@/server/record-views';
import { SectionCard, SummaryRow } from '@/components/ui/Layout';
import { DetailHeader } from '@/components/document/DetailHeader';
import { formatCurrency } from '@/lib/format';
import { documentTrail } from '@/server/document-trail';
import { DocumentTrail } from '@/components/document/DocumentTrail';
import { DocumentActivity } from '@/components/document/DocumentActivity';
import { LinkLine } from './LinkLine';
import { AddItems } from './AddItems';

/**
 * ONE GOODS RECEIPT (G-29, 10 Oct 2026). What came in from a supplier, the
 * serials it put into stock (each opens that unit's history), and the purchase
 * order and bill on either side of it.
 */
const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-';

export default async function GoodsReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const g = await grnView(ctx.scope, id);
  if (!g) notFound();
  const trail = await documentTrail(ctx.scope, 'goods_receipt', g.id);
  const link = 'font-mono text-brand hover:underline';
  const canEdit = ctx.scope.kind === 'single' && ctx.permissions.has('purchase.edit');
  // Same rule as addGrnLines: posted, and no bill has taken its lines yet.
  const canAdd = canEdit && g.status === 'posted' && !g.sourceBillId && !g.billedOnId && !g.bill;
  const tone = g.status === 'cancelled' ? 'danger' : g.status === 'draft' ? 'warning' : 'success';

  return (
    <div>
      <DetailHeader
        icon="package"
        kind="Goods receipt"
        number={g.grnNo}
        status={{ label: g.status.replace(/_/g, ' '), tone }}
        facts={[
          { label: 'Supplier', value: <SupplierLink id={g.partyId}>{g.supplierLabel}</SupplierLink> },
          { label: 'Received', value: fmtDate(g.receivedDate) },
          { label: 'Purchase order', value: g.purchaseOrder ? <Link href={`/purchase/orders/${g.purchaseOrder.id}`} className={link}>{g.purchaseOrder.orderNo}</Link> : null },
          { label: 'Bill', value: g.bill ? <Link href={`/purchase/bills/${g.bill.id}`} className={link}>{g.bill.billNo}</Link> : null },
        ]}
        backHref={`/goods-receipt?q=${encodeURIComponent(g.grnNo)}`}
      />
      <DocumentTrail steps={trail} />

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="What came in" icon="package" className="lg:col-span-2" bodyClassName="p-0"
          action={canAdd ? <AddItems grnId={g.id} grnNo={g.grnNo} partyId={g.partyId} /> : undefined}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Item</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Rate</th>
                  <th className="px-3 py-2 font-semibold">Serials</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((i) => (
                  <tr key={i.id} className="border-b border-border align-top last:border-0">
                    <td className="px-3 py-2">
                      <ProductLink id={i.productId} className="block font-medium">{i.productName}</ProductLink>
                      {i.productCode && <span className="block font-mono text-xs text-muted-foreground">{i.productCode}</span>}
                      {!i.productId && g.status === 'posted' && (
                        <LinkLine grnItemId={i.id} canEdit={canEdit} />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.qty}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{formatCurrency(i.unitCostPaise)}</td>
                    <td className="px-3 py-2">
                      {i.units.length === 0 ? <span className="text-xs text-muted-foreground">-</span> : (
                        <span className="flex flex-wrap gap-1.5">
                          {i.units.map((u) => (
                            <Link key={u.id} href={`/stock-units?q=${encodeURIComponent(u.serialNo ?? "")}&open=${u.id}`} className="font-mono text-xs text-brand hover:underline">{u.serialNo ?? "-"}</Link>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
        <div className="grid content-start gap-4">
          <SectionCard title="Details" icon="info">
            {g.supplierInvoiceNo && <SummaryRow label="Supplier's invoice no." value={g.supplierInvoiceNo} />}
            {g.createdByName && <SummaryRow label="Received by" value={g.createdByName} />}
            {g.notes && <SummaryRow label="Notes" value={g.notes} />}
          </SectionCard>
        </div>
      </div>
      <DocumentActivity table="GoodsReceiptNote" rowId={id} />
    </div>
  );
}
