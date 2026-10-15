import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { getBill } from '@/server/purchases';
import { BillDetail } from './BillDetail';
import { documentTrail } from '@/server/document-trail';
import { DocumentActivity } from '@/components/document/DocumentActivity';

export default async function BillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireContext();

  let bill;
  try {
    bill = await getBill(ctx.scope, id);
  } catch {
    notFound();
  }

  return (
    <>
    <BillDetail
      bill={{
        id: bill.id,
        billNo: bill.billNo,
        supplierBillNo: bill.supplierBillNo,
        supplierName: bill.supplierName,
        partyId: bill.partyId,
        gstin: bill.gstin,
        billDate: bill.billDate.toISOString(),
        dueDate: bill.dueDate.toISOString(),
        lifecycle: bill.lifecycle,
        freightPaise: bill.freightPaise,
        subtotalPaise: bill.subtotalPaise,
        itemDiscountPaise: bill.itemDiscountPaise,
        taxableBasePaise: bill.taxableBasePaise,
        cgstPaise: bill.cgstPaise,
        sgstPaise: bill.sgstPaise,
        igstPaise: bill.igstPaise,
        grandTotalPaise: bill.grandTotalPaise,
        amountPaidPaise: bill.amountPaidPaise,
        taxMode: bill.taxMode,
        notes: bill.notes,
        cancelReason: bill.cancelReason,
        items: bill.items.map((i) => ({
          id: i.id,
          srNo: i.srNo,
          productId: i.productId,
          productName: i.productName,
          productCode: i.productCode,
          hsnCode: i.hsnCode,
          qty: i.qty,
          unitCostPaise: i.unitCostPaise,
          discountPct: Number(i.discountPct),
          taxRatePct: Number(i.taxRatePct),
          lineTotalPaise: i.lineTotalPaise,
          movedStock: i.movedStock,
        })),
        payments: bill.allocations.map((a) => ({
          id: a.payment.id,
          paymentNo: a.payment.paymentNo,
          paidAt: a.payment.paidAt.toISOString(),
          method: a.payment.method,
          reference: a.payment.reference,
          status: a.payment.status,
          amountPaise: a.amountPaise,
        })),
      }}
      canEdit={ctx.permissions.has('purchase.edit')}
      trail={await documentTrail(ctx.scope, 'bill', bill.id)}
    />
      <DocumentActivity table="PurchaseBill" rowId={id} />
    </>
  );
}
