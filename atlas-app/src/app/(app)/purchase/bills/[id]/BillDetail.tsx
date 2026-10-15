'use client';
import { SupplierLink } from '@/components/document/SupplierLink';
import { ProductLink } from '@/components/document/ProductLink';
import { DocumentTrail } from '@/components/document/DocumentTrail';
import type { TrailStep } from '@/lib/document-trail';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Card, Field, SectionCard, SummaryRow } from '@/components/ui/Layout';
import { DetailHeader } from '@/components/document/DetailHeader';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { BILL_STATUS_LABEL, billStatus, outstandingPaise } from '@/lib/purchase';
import { cancelBillAction, postBillAction } from '../actions';

interface ItemVM {
  id: string;
  srNo: number;
  productId?: string | null;
  productName: string;
  productCode: string | null;
  hsnCode: string | null;
  qty: number;
  unitCostPaise: number;
  discountPct: number;
  taxRatePct: number;
  lineTotalPaise: number;
  movedStock: boolean;
}

interface PaymentVM {
  id: string;
  paymentNo: string;
  paidAt: string;
  method: string;
  reference: string | null;
  status: string;
  amountPaise: number;
}

interface BillVM {
  id: string;
  billNo: string;
  supplierBillNo: string;
  supplierName: string;
  partyId?: string | null;
  gstin: string | null;
  billDate: string;
  dueDate: string;
  lifecycle: string;
  freightPaise: number;
  subtotalPaise: number;
  itemDiscountPaise: number;
  taxableBasePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  grandTotalPaise: number;
  amountPaidPaise: number;
  taxMode: string;
  notes: string | null;
  cancelReason: string | null;
  items: ItemVM[];
  payments: PaymentVM[];
}

const rupees = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function BillDetail({ bill, canEdit, trail = [] }: { bill: BillVM; canEdit: boolean; trail?: TrailStep[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState('');

  const owed = outstandingPaise({
    id: bill.id, grandTotalPaise: bill.grandTotalPaise, paidPaise: bill.amountPaidPaise,
  });

  const status = billStatus(
    {
      id: bill.id,
      grandTotalPaise: bill.grandTotalPaise,
      paidPaise: bill.amountPaidPaise,
      lifecycle: bill.lifecycle,
      dueDate: new Date(bill.dueDate),
    },
    new Date(),
  );

  const post = async () => {
    setBusy(true);
    setError(null);
    const r = await postBillAction(bill.id);
    setBusy(false);
    if (r.error) setError(r.error);
    else router.refresh();
  };

  return (
    <>
      <DetailHeader
        icon="receipt"
        kind="Purchase bill"
        number={bill.supplierBillNo}
        status={{
          label: BILL_STATUS_LABEL[status],
          tone: status === 'paid' ? 'success' : status === 'overdue' ? 'danger' : status === 'cancelled' || status === 'draft' ? 'neutral' : 'warning',
        }}
        facts={[
          { label: 'Supplier', value: bill.supplierName },
          { label: 'Our ref', value: bill.billNo },
          { label: 'Dated', value: fmtDate(bill.billDate) },
          { label: 'Due', value: fmtDate(bill.dueDate) },
          { label: 'Total', value: rupees(bill.grandTotalPaise) },
        ]}
        backHref="/purchase/bills"
        backLabel="All bills"
        actions={
          <>
            {canEdit && bill.lifecycle === 'draft' && (
              <Button variant="primary" onClick={post} loading={busy} disabled={busy}>
                Post it
              </Button>
            )}
            {canEdit && bill.lifecycle === 'received' && (
              <Button variant="danger" onClick={() => setShowCancel(true)}>Cancel bill</Button>
            )}
          </>
        }
      />
      <DocumentTrail steps={trail} />

      {error && (
        <Card className="mb-3 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <p className="text-xs leading-relaxed text-danger">{error}</p>
        </Card>
      )}

      {bill.lifecycle === 'draft' && (
        <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="flex-1 text-xs leading-relaxed">
            <strong>This is still a draft.</strong> Nothing has happened yet - no stock has gone
            on the shelf, nothing has been added to what you owe, and no cost has been recorded
            against these products. Post it once the goods have actually arrived.
          </p>
        </Card>
      )}

      {bill.lifecycle === 'cancelled' && (
        <Card className="mb-3 flex items-start gap-2.5 border-border bg-muted/40 px-3 py-2.5">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="flex-1 text-xs leading-relaxed">
            <strong>Cancelled.</strong> {bill.cancelReason}
            {' '}Stock was taken back out. The cost history was left alone - what these goods
            cost on the day they were bought is a fact, and cancelling the paperwork does not
            unmake it.
          </p>
        </Card>
      )}

      <div className="mb-4 grid gap-3 lg:grid-cols-[2fr_1fr]">
        <SectionCard title="Items" icon="package" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">Item</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Unit cost</th>
                  <th className="px-3 py-2 text-right font-semibold">GST</th>
                  <th className="px-3 py-2 text-right font-semibold">Taxable</th>
                </tr>
              </thead>
              <tbody>
                {bill.items.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-muted-foreground">{i.srNo}</td>
                    <td className="px-3 py-2">
                      <ProductLink id={i.productId} className="font-medium">{i.productName}</ProductLink>
                      <span className="ms-2 text-xs text-muted-foreground">
                        {i.productCode}
                        {i.hsnCode ? ` · HSN ${i.hsnCode}` : ''}
                      </span>
                      {i.movedStock && (
                        <Badge tone="success" className="ms-2">In stock</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.qty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{rupees(i.unitCostPaise)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {i.taxRatePct}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{rupees(i.lineTotalPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bill.lifecycle === 'received' && (
            <p className="border-t border-border bg-muted/20 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
              Lines marked <strong>In stock</strong> moved inventory. Services and one-off
              charges do not, and neither do lines with no product behind them - they still
              reach the profit and loss statement as a cost.
            </p>
          )}
        </SectionCard>

        <div className="flex flex-col gap-3">
          <SectionCard title="Totals" icon="receipt">
            <SummaryRow label="Subtotal" value={rupees(bill.subtotalPaise)} />
            {bill.itemDiscountPaise > 0 && (
              <SummaryRow label="Less discount" value={`− ${rupees(bill.itemDiscountPaise)}`} />
            )}
            {bill.freightPaise > 0 && (
              <SummaryRow label="Freight" value={rupees(bill.freightPaise)} />
            )}
            <SummaryRow label="Taxable value" value={rupees(bill.taxableBasePaise)} />
            {bill.taxMode === 'IGST'
              ? <SummaryRow label="IGST" value={rupees(bill.igstPaise)} />
              : (
                <>
                  <SummaryRow label="CGST" value={rupees(bill.cgstPaise)} />
                  <SummaryRow label="SGST" value={rupees(bill.sgstPaise)} />
                </>
              )}
            <SummaryRow label="Total" value={rupees(bill.grandTotalPaise)} strong />
          </SectionCard>

          <SectionCard title="Settlement" icon="credit-card">
            <SummaryRow label="Status" value={<Badge>{BILL_STATUS_LABEL[status]}</Badge>} />
            <SummaryRow label="Due" value={fmtDate(bill.dueDate)} />
            <SummaryRow label="Paid" value={rupees(bill.amountPaidPaise)} />
            <SummaryRow
              label="Outstanding"
              value={rupees(owed)}
              strong
              tone={owed > 0 ? 'danger' : 'success'}
            />
            {owed > 0 && bill.lifecycle === 'received' && (
              <Link href={bill.partyId ? `/purchase/payables?pay=${bill.partyId}` : '/purchase/payables'} className="mt-2 block">
                <Button size="sm" variant="primary" className="w-full">Pay this supplier</Button>
              </Link>
            )}
          </SectionCard>

          {bill.gstin && (
            <SectionCard title="Supplier" icon="users">
              <SummaryRow label="Name" value={<SupplierLink id={bill.partyId}>{bill.supplierName}</SupplierLink>} />
              <SummaryRow label="GSTIN" value={bill.gstin} />
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                The GST on this bill is <strong>input tax</strong> - money you reclaim, not money
                you collected. It is deliberately kept apart from output tax in the GST report.
              </p>
            </SectionCard>
          )}
        </div>
      </div>

      {bill.payments.length > 0 && (
        <SectionCard title="Payments against this bill" icon="credit-card" bodyClassName="p-0">
          <table className="w-full text-sm">
            <tbody>
              {bill.payments.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium"><Link href={`/purchase/payments/${p.id}`} className="font-mono text-brand hover:underline">{p.paymentNo}</Link></td>
                  <td className="px-3 py-2 text-xs">{fmtDate(p.paidAt)}</td>
                  <td className="px-3 py-2 text-xs capitalize">{p.method}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{p.reference ?? '-'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.status === 'reversed'
                      ? <span className="text-muted-foreground line-through">{rupees(p.amountPaise)}</span>
                      : rupees(p.amountPaise)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.status === 'reversed' && <Badge tone="neutral">Reversed</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      )}

      {bill.notes && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          <strong>Notes:</strong> {bill.notes}
        </p>
      )}

      {showCancel && (
        <Modal
          title={`Cancel ${bill.supplierBillNo}`}
          subtitle="Stock will be taken back out"
          icon="alert-triangle"
          tone="danger"
          size="sm"
          onClose={() => setShowCancel(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowCancel(false)} disabled={busy}>Keep it</Button>
              <Button
                variant="danger"
                disabled={!reason.trim() || busy}
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await cancelBillAction(bill.id, reason);
                  setBusy(false);
                  if (r.error) setError(r.error);
                  else { setShowCancel(false); router.refresh(); }
                }}
              >
                Cancel the bill
              </Button>
            </div>
          }
        >
          <Field label="Why" hint="Goes on the record.">
            <input
              className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Goods returned to supplier"
            />
          </Field>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            If any payment has been made against this bill it cannot be cancelled - reverse the
            payment first. Unwinding money that has already left the bank is not a cancellation,
            and doing it quietly would leave the cash unaccounted for.
          </p>
        </Modal>
      )}
    </>
  );
}
