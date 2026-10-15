import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { supplierView } from '@/server/record-views';
import { SectionCard, SummaryRow } from '@/components/ui/Layout';
import { DetailHeader } from '@/components/document/DetailHeader';
import { DocumentActivity } from '@/components/document/DocumentActivity';
import { formatCurrency } from '@/lib/format';

/**
 * ONE SUPPLIER (G-37, 10 Oct 2026). Every supplier name in Atlas - on a bill,
 * an order, a goods receipt, a payment, the GST report - opens this page.
 * Read-only: editing a supplier stays on the Suppliers list, paying them on
 * Payables.
 */
const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const words = (s: string) => s.replace(/_/g, ' ');

function Rows({ empty, children }: { empty: string; children: React.ReactNode[] }) {
  return children.length === 0
    ? <p className="px-2 py-1 text-sm text-muted-foreground">{empty}</p>
    : <div className="max-h-96 overflow-y-auto thin-scroll">{children}</div>;
}

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const s = await supplierView(ctx.scope, id);
  if (!s) notFound();
  const link = 'font-mono text-brand';
  const row = 'flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted';

  return (
    <div>
      <DetailHeader
        icon="truck"
        kind="Supplier"
        number={s.name}
        status={s.status === 'active' ? { label: 'Active', tone: 'success' } : { label: words(s.status), tone: 'neutral' }}
        facts={[
          { label: 'Code', value: s.partyCode },
          { label: 'Phone', value: `${s.phoneCc ?? ''} ${s.phone}`.trim() },
          { label: 'We owe them', value: formatCurrency(Math.max(0, s.payablePaise)) },
          { label: 'GSTIN', value: s.gstin },
        ]}
        backHref={`/suppliers?q=${encodeURIComponent(s.partyCode)}`}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          <SectionCard title={`Bills (${s.bills.length})`} icon="file-text" bodyClassName="p-2">
            <Rows empty="No bills from this supplier.">
              {s.bills.map((b) => (
                <Link key={b.id} href={`/purchase/bills/${b.id}`} className={row}>
                  <span className="min-w-0">
                    <span className={link}>{b.billNo}</span>
                    <span className="ms-2 text-xs text-muted-foreground">their no. {b.supplierBillNo} · {fmtDate(b.billDate)}</span>
                  </span>
                  <span className="shrink-0 text-end text-xs">
                    <span className="block font-mono">{formatCurrency(b.grandTotalPaise)}</span>
                    <span className={b.lifecycle === 'cancelled' ? 'text-muted-foreground' : b.amountPaidPaise >= b.grandTotalPaise ? 'text-success' : 'text-warning'}>
                      {b.lifecycle === 'cancelled' ? 'cancelled' : b.amountPaidPaise >= b.grandTotalPaise ? 'paid' : `${formatCurrency(b.grandTotalPaise - b.amountPaidPaise)} due ${fmtDate(b.dueDate)}`}
                    </span>
                  </span>
                </Link>
              ))}
            </Rows>
          </SectionCard>

          <SectionCard title={`Payments (${s.payments.length})`} icon="credit-card" bodyClassName="p-2">
            <Rows empty="Nothing paid to this supplier yet.">
              {s.payments.map((p) => (
                <Link key={p.id} href={`/purchase/payments/${p.id}`} className={row}>
                  <span><span className={link}>{p.paymentNo}</span><span className="ms-2 text-xs text-muted-foreground">{fmtDate(p.paidAt)} · {words(p.method)}</span></span>
                  <span className={`font-mono text-xs ${p.status === 'paid' ? '' : 'text-muted-foreground line-through'}`}>{formatCurrency(p.amountPaise)}</span>
                </Link>
              ))}
            </Rows>
          </SectionCard>

          <SectionCard title={`Purchase orders (${s.orders.length})`} icon="shopping-cart" bodyClassName="p-2">
            <Rows empty="No purchase orders to this supplier.">
              {s.orders.map((o) => (
                <Link key={o.id} href={`/purchase/orders/${o.id}`} className={row}>
                  <span><span className={link}>{o.orderNo}</span><span className="ms-2 text-xs text-muted-foreground">{fmtDate(o.orderDate)} · {words(o.status)}</span></span>
                  <span className="font-mono text-xs">{formatCurrency(o.grandTotalPaise)}</span>
                </Link>
              ))}
            </Rows>
          </SectionCard>

          <SectionCard title={`Goods received (${s.grns.length})`} icon="package" bodyClassName="p-2">
            <Rows empty="Nothing received from this supplier yet.">
              {s.grns.map((g) => (
                <Link key={g.id} href={`/goods-receipt/${g.id}`} className={row}>
                  <span className={link}>{g.grnNo}</span>
                  <span className="text-xs text-muted-foreground">{fmtDate(g.receivedDate)} · {words(g.status)}{g.supplierInvoiceNo ? ` · their bill ${g.supplierInvoiceNo}` : ''}</span>
                </Link>
              ))}
            </Rows>
          </SectionCard>

          {s.returns.length > 0 && (
            <SectionCard title={`Returns to them (${s.returns.length})`} icon="rotate-ccw" bodyClassName="p-2">
              <Rows empty="">
                {s.returns.map((r) => (
                  <Link key={r.id} href={`/purchase-return?q=${encodeURIComponent(r.returnNo)}&open=${r.id}`} className={row}>
                    <span className={link}>{r.returnNo}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(r.returnedAt)} · {words(r.lifecycle)}</span>
                  </Link>
                ))}
              </Rows>
            </SectionCard>
          )}
        </div>

        <div className="grid content-start gap-4">
          <SectionCard title="Money" icon="receipt">
            <SummaryRow label="Billed (not cancelled)" value={formatCurrency(s.billedPaise)} />
            <SummaryRow label="Paid" value={formatCurrency(s.paidPaise)} />
            <SummaryRow label={s.payablePaise < 0 ? 'Paid ahead (they owe us)' : 'We owe them'} value={formatCurrency(Math.abs(s.payablePaise))} strong />
            <Link href="/purchase/payables" className="mt-2 inline-block text-xs font-medium text-brand hover:underline">Pay on Payables</Link>
          </SectionCard>
          <SectionCard title="Details" icon="info">
            {s.contact && s.contact !== s.name && <SummaryRow label="Contact" value={s.contact} />}
            {s.email && <SummaryRow label="Email" value={s.email} />}
            {(s.addressLine1 || s.city) && <SummaryRow label="Address" value={[s.addressLine1, s.city, s.state].filter(Boolean).join(', ')} />}
            <SummaryRow label="On file since" value={fmtDate(s.createdAt)} />
            {s.isCustomer && (
              <Link href={`/customers/${s.id}`} className="mt-2 inline-block text-xs font-medium text-brand hover:underline">Also a customer - open their account</Link>
            )}
          </SectionCard>
        </div>
      </div>
      <DocumentActivity table="Party" rowId={s.id} />
    </div>
  );
}
