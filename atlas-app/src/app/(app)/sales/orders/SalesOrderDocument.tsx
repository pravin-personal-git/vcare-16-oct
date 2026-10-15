'use client';

import { ProductLink } from '@/components/document/ProductLink';
import { sayIfHeld, toast } from '@/lib/held-message';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCurrency } from '@/lib/format';
import type { SalesOrderDetail } from '@/server/sales-orders';
import { FULFILMENT_FLOW, PAYMENT_LABEL, type FulfilmentStatus } from '@/lib/sales-order-status';
import { nextStages, shownStages, stageName } from '@/lib/order-stages';
import { docMessage } from '@/lib/wa-message';
import { openWhatsApp } from '@/lib/wa-open';
import { ActionBar } from '@/components/document/ActionBar';
import { OrderStepper } from '@/components/document/OrderStepper';
import { DocSplit, DocKpi, DocPanel } from '@/components/document/DocSplit';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Layout';
import { loadSalesOrder, advanceOrder, addPayment, getOrderShareLink } from './actions';
import { AttachmentPanel } from '@/components/ui/AttachmentPanel';
import type { AttachmentView } from '@/components/ui/Attachments';
import { listOrderFiles } from './actions';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { ask } from '@/components/ui/ask';

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Printable order confirmation, plus the controls that move it through its
 * lifecycle.
 *
 * The status buttons are generated from the state machine rather than listed by
 * hand, so the UI can never offer a move the server would refuse.
 */
export function SalesOrderDocument({ id, onClose, initial }: {
  id: string;
  /** Given: a pop-up over a list. Left out: the order's own page (G-34). */
  onClose?: () => void;
  /** The page loads the order on the server, so it opens without a spinner. */
  initial?: { order: SalesOrderDetail; files: AttachmentView[] };
}) {
  const [o, setO] = useState<SalesOrderDetail | null>(initial?.order ?? null);
  const [files, setFiles] = useState<AttachmentView[]>(initial?.files ?? []);
  const [loading, setLoading] = useState(!initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) return;
    // Both in one pass. Loading the document and then the files means the
    // panel pops in after the paper has already settled.
    Promise.all([loadSalesOrder(id), listOrderFiles(id)]).then(([d, f]) => {
      setO(d);
      setFiles(f);
      setLoading(false);
    });
  }, [id, initial]);

  if (loading || !o) {
    return (
      <div role="status" aria-label="Loading" className="fixed inset-0 z-[200] grid place-items-center bg-navy/40">
        <div className="rounded-lg bg-card px-6 py-4 text-sm shadow-overlay">Loading…</div>
      </div>
    );
  }

  const customer = (name: string) => o.partyId
    ? <Link href={`/customers/${o.partyId}?via=order:${o.id}`} className="hover:text-brand hover:underline">{name}</Link>
    : name;

  /*
    NO TAX ON THIS ORDER (8 Oct 2026).

    `taxMode` gained a third value, NONE, on 7 Oct, and this line did not
    hear about it: `intra` came out false and the paper printed an IGST row
    at zero. Pravin's words were that with GST off the customer should see
    nothing at all - a zero IGST line is worse than nothing, because it
    tells them there is a tax, of the wrong kind, and that it happens to be
    zero today.
  */
  const noTax = o.taxMode === 'NONE';
  const intra = o.taxMode === 'CGST_SGST';
  const due = o.grandTotalPaise - o.amountPaidPaise;
  const moves = nextStages(o.fulfilmentStatus, o.stages);

  const move = async (to: FulfilmentStatus) => {
    // An AWB with no dispatch is a promise; a dispatch with no AWB is a lost
    // parcel. Ask for it at the moment it exists.
    let awbNo: string | null | undefined;
    if (to === 'dispatched') {
      const typed = await ask.text({
        icon: 'truck',
        title: `Dispatch ${o.orderNo}`,
        message: 'Add the courier or AWB number so anyone can track the parcel. Leave it empty if you do not have it yet.',
        label: 'Courier / AWB number',
        placeholder: 'e.g. DTDC D12345678',
        confirmLabel: 'Mark dispatched',
      });
      if (typed === null) return;
      awbNo = typed || null;
    }
    setBusy(true);
    const r = await advanceOrder(o.id, to, awbNo !== undefined ? { awbNo } : undefined);
    setBusy(false);
    if (r.error) await ask.error(r.error);
    else { sayIfHeld(r); window.location.reload(); }
  };

  const pay = async () => {
    const raw = await ask.text({
      icon: 'credit-card',
      title: 'Record a payment',
      message: `Still to come on ${o.orderNo}: ₹${(due / 100).toLocaleString('en-IN')}`,
      label: 'Amount received (₹)',
      defaultValue: String(due / 100),
      inputMode: 'decimal', required: true,
      validate: (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? null : 'Enter the amount received, like 5000.'),
      confirmLabel: 'Record payment',
    });
    if (raw === null) return;
    setBusy(true);
    const r = await addPayment(o.id, Number(raw));
    setBusy(false);
    if (r.error) await ask.error(r.error);
    else { await ask.tell({ tone: 'success', title: 'Payment recorded', message: r.message }); window.location.reload(); }
  };

  const paper = (
    <div id="order-doc" className="bg-white p-8 text-black shadow">
      <div className="flex items-start justify-between border-b-2 border-black pb-4">
        <div className="flex items-start gap-3">
          {o.org.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
            <img src={o.org.logoUrl} alt={o.org.name} className="h-12 w-12 shrink-0 object-contain" />
          )}
          <div>
            <h1 className="text-xl font-bold">{o.org.name}</h1>
            <p className="text-xs">{o.storeName}{o.storeAddress ? ` · ${o.storeAddress}` : ''}</p>
            {o.org.gstin && <p className="text-xs">GSTIN: {o.org.gstin}</p>}
            <p className="text-xs">{[o.org.mobile, o.org.email].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <div className="text-end">
          <h2 className="text-lg font-bold">SALES ORDER</h2>
          <p className="font-mono text-sm">{o.orderNo}</p>
          <p className="text-xs">Date: {fmt(o.orderDate)}</p>
          {o.expectedDeliveryDate && (
            <p className="text-xs">Expected: {fmt(o.expectedDeliveryDate)}</p>
          )}
          {o.quotationNo && (
            <p className="text-xs">Against quotation {o.quotationId
              ? <Link className="hover:text-brand hover:underline" href={`/quotation/${o.quotationId}`}>{o.quotationNo}</Link>
              : o.quotationNo}</p>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-micro font-semibold uppercase">Bill to</p>
          <p className="font-medium">{customer(o.organizationName ?? o.customerName)}</p>
          {o.organizationName && <p className="text-xs">{o.customerName}</p>}
          {o.billingAddress && <p className="text-xs">{o.billingAddress}</p>}
          <p className="text-xs">{[o.cityId, o.stateId].filter(Boolean).join(', ')}</p>
          <p className="text-xs">{o.phone}{o.email ? ` · ${o.email}` : ''}</p>
          {o.gstin && <p className="text-xs">GSTIN: {o.gstin}</p>}
        </div>
        <div>
          {o.shippingAddress && o.shippingAddress !== o.billingAddress && (
            <>
              <p className="text-micro font-semibold uppercase">Ship to</p>
              <p className="text-xs">{o.shippingAddress}</p>
            </>
          )}
          {o.awbNo && <p className="mt-2 text-xs">AWB / Docket: {o.awbNo}</p>}
          <p className="mt-2 text-xs">
            Status: {stageName(o.stages, o.fulfilmentStatus)} · {PAYMENT_LABEL[o.paymentStatus]}
          </p>
        </div>
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-black text-xs">
            <th className="py-1.5 text-start">#</th>
            <th className="py-1.5 text-start">Description</th>
            <th className="py-1.5 text-end">Qty</th>
            <th className="py-1.5 text-end">Rate</th>
            <th className="py-1.5 text-end">Disc%</th>
            {!noTax && <th className="py-1.5 text-end">GST%</th>}
            <th className="py-1.5 text-end">Amount</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((i) => (
            <tr key={i.srNo} className="border-b border-gray-300">
              <td className="py-1.5 text-xs">{i.srNo}</td>
              <td className="py-1.5">
                <p className="text-xs font-medium"><ProductLink id={i.productId}>{i.productName}</ProductLink></p>
                {i.productCode && <p className="font-mono text-xs text-gray-600">{i.productCode}</p>}
              </td>
              <td className="py-1.5 text-end text-xs">{i.qty}</td>
              <td className="py-1.5 text-end font-mono text-xs">{formatCurrency(i.unitPricePaise)}</td>
              <td className="py-1.5 text-end text-xs">{i.discountPct || '-'}</td>
              {/* The line keeps its own rate in the database; the paper
                  simply does not mention tax. Switch GST back on and the
                  right rate prints again. */}
              {!noTax && <td className="py-1.5 text-end text-xs">{i.taxRatePct}</td>}
              <td className="py-1.5 text-end font-mono text-xs">{formatCurrency(i.lineTotalPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <table className="text-sm">
          <tbody>
            {([
              ['Subtotal', formatCurrency(o.subtotalPaise)],
              ...(o.itemDiscountPaise ? [['Item discounts', `− ${formatCurrency(o.itemDiscountPaise)}`]] : []),
              ...(o.orderDiscountPaise ? [['Discount', `− ${formatCurrency(o.orderDiscountPaise)}`]] : []),
              // Taxable value is a tax idea. On a document that does not
              // deal in tax it is the subtotal said a second time.
              ...(noTax ? [] : [
                ['Taxable value', formatCurrency(o.taxableBasePaise)],
                ...(intra
                  ? [['CGST', formatCurrency(o.cgstPaise)], ['SGST', formatCurrency(o.sgstPaise)]]
                  : [['IGST', formatCurrency(o.igstPaise)]]),
              ]),
              ...(o.deliveryCharge ? [['Delivery', formatCurrency(o.deliveryCharge)]] : []),
            ] as [string, string][]).map(([k, v]) => (
              <tr key={k}>
                <td className="py-0.5 pe-8 text-xs">{k}</td>
                <td className="py-0.5 text-end font-mono text-xs">{v}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-black">
              <td className="py-1 pe-8 font-bold">Grand total</td>
              <td className="py-1 text-end font-mono font-bold">{formatCurrency(o.grandTotalPaise)}</td>
            </tr>
            {o.amountPaidPaise > 0 && (
              <>
                <tr>
                  <td className="py-0.5 pe-8 text-xs">Received</td>
                  <td className="py-0.5 text-end font-mono text-xs">− {formatCurrency(o.amountPaidPaise)}</td>
                </tr>
                <tr className="border-t border-black">
                  <td className="py-1 pe-8 text-xs font-bold">Balance due</td>
                  <td className="py-1 text-end font-mono text-xs font-bold">{formatCurrency(due)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {o.termsBody && (
        <div className="mt-6 border-t border-gray-300 pt-3">
          <p className="text-micro font-semibold uppercase">Terms &amp; conditions</p>
          <p className="whitespace-pre-line text-xs leading-relaxed">{o.termsBody}</p>
        </div>
      )}

      <div className="mt-8 flex items-end justify-between text-xs">
        <span>
          {(o.createdByName ?? o.salespersonName) && <span className="block">Prepared by {o.createdByName ?? o.salespersonName}</span>}
          {o.salespersonName && o.salespersonName !== o.createdByName && (
            <span className="block">Salesperson: {o.salespersonName}</span>
          )}
        </span>
        <span className="text-end">
          {o.org.sealUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
            <img src={o.org.sealUrl} alt="Company seal" className="ms-auto mb-1 h-14 w-14 object-contain" />
          )}
          <span className="block">For {o.org.name}</span>
        </span>
      </div>
    </div>
  );

  const forward = moves.find((m) => FULFILMENT_FLOW.includes(m));
  const exceptions = moves.filter((m) => !FULFILMENT_FLOW.includes(m));

  const controls = (
    <>
      <ActionBar
        status={(
          <>
            <Badge tone={o.paymentStatus === 'paid' ? 'success' : due > 0 ? 'danger' : 'warning'}>
              {PAYMENT_LABEL[o.paymentStatus]}{due > 0 && ` · ${formatCurrency(due)} due`}
            </Badge>
          </>
        )}
        next={forward ? { label: `Mark ${stageName(o.stages, forward)}`, icon: 'arrow-right', kbd: 'N', disabled: busy, onClick: () => move(forward) } : undefined}
        money={due > 0 ? { label: 'Record payment', disabled: busy, onClick: pay } : undefined}
        // The order's own customer link (/o) and one wording for every
        // document (A1/A2, 11 Oct 2026). No price in the message or on the
        // link - Pravin, W2.
        whatsapp={o.phone ? {
          label: 'WhatsApp', onClick: async () => {
            const err = await openWhatsApp(o.phone, async () => {
              const r = await getOrderShareLink(o.id);
              if (r.error || !r.url) return { error: r.error ?? 'Could not create a link.' };
              return docMessage({ kind: 'order', number: o.orderNo, customerName: o.customerName, org: o.org.name, status: stageName(o.stages, o.fulfilmentStatus), url: r.url });
            });
            if (err) toast(err);
          },
        } : undefined}
        sendMenu={[{
          label: 'Copy customer link', icon: 'copy', onClick: async () => {
            const r = await getOrderShareLink(o.id);
            if (r.error || !r.url) return toast(r.error ?? 'Could not create a link.');
            const copied = await navigator.clipboard.writeText(r.url).then(() => true, () => false);
            toast(copied ? `Customer link copied: ${r.url}` : r.url);
          },
        }]}
        actions={[{ label: 'Print', icon: 'printer', onClick: () => window.print() }]}
        more={[
          ...exceptions.filter((m) => m !== 'void').map((m) => ({ label: stageName(o.stages, m), icon: 'pause' as const, onClick: () => move(m) })),
          ...(onClose ? [{ label: 'Close', icon: 'x' as const, onClick: onClose }] : [{ label: 'All orders', icon: 'arrow-left' as const, onClick: () => { window.location.href = '/sales/orders'; } }]),
        ]}
        destructive={exceptions.includes('void') ? { label: `${stageName(o.stages, 'void')} (cancel order)…`, icon: 'ban', disabled: busy, onClick: async () => {
          if (await ask.confirm({
            tone: 'danger', icon: 'ban',
            title: `Cancel ${o.orderNo}?`,
            message: 'The order stays on record, marked void. Nothing more can be done on it.',
            confirmLabel: 'Cancel order', cancelLabel: 'Keep it',
          })) void move('void');
        } } : undefined}
      />
      <section className="no-print rounded border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-on-tint-brand"><Icon name="shopping-cart" className="h-4 w-4" /></span>
          <div className="me-auto min-w-0">
            <p className="truncate font-mono text-sm font-bold text-brand">{o.orderNo}</p>
            <p className="truncate text-xs text-muted-foreground">{customer(o.customerName)}</p>
          </div>
          {moves.length === 0 && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon name="lock" className="h-3.5 w-3.5" />This order is closed.</span>}
          {!FULFILMENT_FLOW.includes(o.fulfilmentStatus) && <Badge tone="warning">{stageName(o.stages, o.fulfilmentStatus)}</Badge>}
        </div>
        <OrderStepper stages={shownStages(o.stages)} current={o.fulfilmentStatus} cfg={o.stages} onPick={(st) => move(st)} allowed={forward ? [forward] : []} />
      </section>
    </>
  );

  const extras = (
    <>
    {/* Who approved it, including an admin override. Ours, not the
        customer's, so it stays off the printed copy. */}
    {o.approval && (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border bg-card px-4 py-2 text-xs print:hidden">
        <Icon name="check-circle" className="h-4 w-4 shrink-0 text-success" />
        <span>
          Approved{o.approval.byName ? ` by ${o.approval.byName}` : ''}
          {o.approval.at ? `, ${fmt(o.approval.at)}` : ''}
        </span>
        {o.approval.note && <span className="text-muted-foreground">· {o.approval.note}</span>}
      </div>
    )}

    {/* Outside the paper, and hidden when printing - the customer's PO is
        ours to keep, not something to staple to their copy. */}
    <div className="border-t border-border bg-card p-4 print:hidden">
      <AttachmentPanel
        docType="sales_order"
        docId={o.id}
        initial={files}
        phone={o.phone}
        docLabel={`Sales order ${o.orderNo}`}
      />
    </div>
    </>
  );

  const body = (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #order-doc, #order-doc * { visibility: visible; }
          #order-doc { position: absolute; inset-inline-start: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>
      {onClose ? (
        <div className="mx-auto max-w-4xl space-y-2">
          {controls}
          {paper}
          {extras}
        </div>
      ) : (
        <DocSplit
          title={`Sales order ${o.orderNo}`}
          paperId="order-doc-wrap"
          paper={paper}
          left={(
            <>
              {controls}
              <div className="no-print grid grid-cols-2 gap-3 lg:grid-cols-4">
                <DocKpi label="Value" value={formatCurrency(o.grandTotalPaise)} />
                <DocKpi label="Received" value={formatCurrency(o.amountPaidPaise)} tone={o.amountPaidPaise > 0 ? 'success' : undefined} />
                <DocKpi label="Due" value={formatCurrency(due)} tone={due > 0 ? 'danger' : 'success'} />
                <DocKpi label="Expected delivery" value={o.expectedDeliveryDate ? fmt(o.expectedDeliveryDate) : '—'} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <DocPanel title="Customer" icon="user">
                  <div className="text-sm">
                    <p className="font-semibold">{customer(o.organizationName ?? o.customerName)}</p>
                    {o.organizationName && <p className="text-muted-foreground">{o.customerName}</p>}
                    <p className="text-muted-foreground">{[o.phone, o.email].filter(Boolean).join(' · ')}</p>
                    {o.awbNo && <p className="mt-1 text-xs text-muted-foreground">AWB / docket {o.awbNo}</p>}
                  </div>
                </DocPanel>
                <DocPanel title={`Items (${o.items.length})`} icon="package">
                  <ul className="space-y-1 text-sm">
                    {o.items.slice(0, 5).map((it) => (
                      <li key={it.srNo} className="flex justify-between gap-3"><span className="truncate">{it.productName} × {it.qty}</span><span className="shrink-0 font-mono">{formatCurrency(it.lineTotalPaise)}</span></li>
                    ))}
                    {o.items.length > 5 && <li className="text-xs text-muted-foreground">+{o.items.length - 5} more - see the document</li>}
                  </ul>
                </DocPanel>
              </div>
              <div className="rounded border border-border bg-card">{extras}</div>
            </>
          )}
        />
      )}
    </>
  );

  // G-34: on its own page the same document sits in the page, not over it.
  return onClose
    ? <DialogFrame label="Sales order" onClose={onClose} className="thin-scroll fixed inset-0 z-[200] overflow-y-auto bg-navy/40 p-2 print:static print:bg-white print:p-0">{body}</DialogFrame>
    : <div className="print:p-0">{body}</div>;
}
