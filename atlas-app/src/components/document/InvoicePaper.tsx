import { ProductLink } from '@/components/document/ProductLink';
import { formatCurrency } from '@/lib/format';
import { amountInWords } from '@/lib/amount-in-words';
import { daysOverdue } from '@/lib/invoice-status';
import type { InvoiceDetail } from '@/server/invoices';

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/**
 * The tax invoice as paper - the one layout for the staff view (and its
 * print / PDF) and the customer's no-login link /i/<token> (6 Oct 2026).
 * Kept in one place so what the customer opens is exactly what was printed.
 */
export function InvoicePaper({ i, linkProducts = false }: {
  i: InvoiceDetail;
  /** Product names open their history - in Atlas only, never on the customer's `/i/` link (G-36). */
  linkProducts?: boolean;
}) {
  /*
    NO TAX ON THIS INVOICE (8 Oct 2026).

    This paper is what the CUSTOMER opens - `/i/<token>` renders it - so it
    is the one place Pravin's "with GST off they see nothing at all" has to
    hold. `taxMode` gained NONE on 7 Oct and this line did not hear about
    it, so a no-GST invoice printed an IGST row at zero: a tax, of the wrong
    kind, that happens to be zero today.
  */
  const noTax = i.taxMode === 'NONE';
  const intra = i.taxMode === 'CGST_SGST';
  const over = daysOverdue(i);

  return (
    <div
      id="invoice-paper"
      className="relative rounded-lg border border-border bg-card p-6 shadow-card sm:p-10"
    >
      {i.lifecycle === 'cancelled' && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="rotate-[-20deg] rounded border-4 border-danger px-8 py-2 text-4xl font-black uppercase tracking-widest text-danger opacity-25">
            Cancelled
          </span>
        </span>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 pb-4">
        <div className="flex min-w-0 gap-3">
          {i.org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
            <img src={i.org.logoUrl} alt={i.org.name} className="h-14 w-14 shrink-0 rounded-lg object-contain" />
          ) : (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-brand text-xl font-black text-brand-fg">
              {i.org.name.slice(0, 1)}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">{i.org.name}</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {i.storeName}
              {i.storeAddress && <><br />{i.storeAddress}</>}
            </p>
            {i.org.gstin && <p className="text-xs font-semibold">GSTIN: {i.org.gstin}</p>}
            <p className="text-xs text-muted-foreground">
              {[i.org.email, i.org.mobile].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        <div className="text-end">
          <p className="text-2xl font-black uppercase tracking-tight text-accent">
            Tax Invoice
          </p>
          <dl className="mt-2 space-y-0.5 text-xs">
            <div className="flex justify-end gap-2">
              <dt className="text-muted-foreground">No:</dt>
              <dd className="font-mono font-semibold">{i.invoiceNo}</dd>
            </div>
            <div className="flex justify-end gap-2">
              <dt className="text-muted-foreground">Date:</dt>
              <dd>{fmt(i.invoiceDate)}</dd>
            </div>
            <div className="flex justify-end gap-2">
              <dt className="text-muted-foreground">Due:</dt>
              <dd className={over > 0 && i.duePaise > 0 ? 'font-semibold text-danger' : ''}>
                {fmt(i.dueDate)}
              </dd>
            </div>
            {i.orderNo && (
              <div className="flex justify-end gap-2">
                <dt className="text-muted-foreground">Order:</dt>
                <dd className="font-mono">{i.orderNo}</dd>
              </div>
            )}
            {i.stateId && (
              <div className="flex justify-end gap-2">
                <dt className="text-muted-foreground">Place of Supply:</dt>
                <dd>{i.stateId}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      <div className="h-0.5 w-full bg-navy" />

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="border-s-[3px] border-accent ps-3">
          <p className="text-micro font-bold uppercase text-muted-foreground">Bill To</p>
          <p className="text-sm font-bold">{i.organizationName ?? i.customerName}</p>
          {i.organizationName && <p className="text-xs">{i.customerName}</p>}
          <p className="text-xs">{i.phone}</p>
          {i.email && <p className="text-xs text-info">{i.email}</p>}
          {i.billingAddress && <p className="text-xs">{i.billingAddress}</p>}
          <p className="text-xs">{[i.cityId, i.stateId].filter(Boolean).join(', ')}</p>
          {i.gstin && <p className="text-xs font-semibold">GSTIN: {i.gstin}</p>}
        </div>

        <div className="border-s-[3px] border-brand ps-3">
          <p className="text-micro font-bold uppercase text-muted-foreground">Ship To</p>
          {!i.shippingAddress || i.shippingAddress === i.billingAddress ? (
            <p className="text-sm font-bold">Same as billing</p>
          ) : (
            <p className="text-xs">{i.shippingAddress}</p>
          )}
          {i.irn && (
            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
              IRN: {i.irn}
            </p>
          )}
        </div>
      </div>

      <div className="thin-scroll mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-navy text-xs text-navy-fg">
              <th className="px-2 py-2 text-start font-semibold">#</th>
              <th className="px-2 py-2 text-start font-semibold">Description</th>
              <th className="px-2 py-2 text-start font-semibold">HSN</th>
              <th className="px-2 py-2 text-end font-semibold">Qty</th>
              <th className="px-2 py-2 text-end font-semibold">Rate</th>
              <th className="px-2 py-2 text-end font-semibold">Disc%</th>
              {!noTax && <th className="px-2 py-2 text-end font-semibold">GST%</th>}
              <th className="px-2 py-2 text-end font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {i.items.map((x) => (
              <tr key={x.srNo} className="border-b border-border">
                <td className="px-2 py-2 text-xs text-muted-foreground">{x.srNo}</td>
                <td className="px-2 py-2">
                  <p className="text-xs font-semibold">{linkProducts ? <ProductLink id={x.productId}>{x.productName}</ProductLink> : x.productName}</p>
                  {x.productCode && (
                    <p className="font-mono text-xs text-muted-foreground">{x.productCode}</p>
                  )}
                  {/* The serials sold on this line (15 Oct 2026): the customer's
                      warranty proof, and what staff look an invoice up by. */}
                  {x.serials.length > 0 && (
                    <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                      S/N: {x.serials.join(', ')}
                    </p>
                  )}
                </td>
                <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                  {x.hsnCode ?? '-'}
                </td>
                <td className="px-2 py-2 text-end text-xs tabular-nums">{x.qty}</td>
                <td className="px-2 py-2 text-end font-mono text-xs tabular-nums">
                  {formatCurrency(x.unitPricePaise)}
                </td>
                <td className="px-2 py-2 text-end text-xs tabular-nums">{x.discountPct}%</td>
                {/* The line keeps its rate in the database; the paper simply
                    does not mention tax. Switching GST back on restores it. */}
                {!noTax && <td className="px-2 py-2 text-end text-xs tabular-nums">{x.taxRatePct}%</td>}
                <td className="px-2 py-2 text-end font-mono text-xs font-semibold tabular-nums">
                  {formatCurrency(x.lineTotalPaise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          <div>
            <p className="text-micro font-bold uppercase text-muted-foreground">
              Amount In Words
            </p>
            <p className="text-xs font-semibold italic">
              {amountInWords(i.grandTotalPaise)}
            </p>
          </div>

          {i.termsBody && (
            <div>
              <p className="text-micro font-bold uppercase text-muted-foreground">
                Terms &amp; Conditions
              </p>
              <p className="whitespace-pre-line text-xs leading-relaxed">{i.termsBody}</p>
            </div>
          )}

          <p className="text-xs leading-relaxed text-muted-foreground">
            {noTax
              ? 'No GST charged on this invoice.'
              : intra
                ? 'Intra-state supply. CGST and SGST charged.'
                : 'Inter-state supply. IGST charged.'}
            {' '}Tax is charged on the value after all discounts.
          </p>
        </div>

        <div>
          <table className="w-full text-sm">
            <tbody>
              {([
                ['Sub Total', formatCurrency(i.subtotalPaise)],
                ...(i.itemDiscountPaise ? [['Item Discounts', `− ${formatCurrency(i.itemDiscountPaise)}`]] : []),
                ...(i.orderDiscountPaise ? [['Discount', `− ${formatCurrency(i.orderDiscountPaise)}`]] : []),
                // Taxable value is a tax idea; without tax it is the
                // subtotal printed a second time.
                ...(noTax ? [] : [
                  ['Taxable Value', formatCurrency(i.taxableBasePaise)],
                  ...(intra
                    ? [['CGST', formatCurrency(i.cgstPaise)], ['SGST', formatCurrency(i.sgstPaise)]]
                    : [['IGST', formatCurrency(i.igstPaise)]]),
                ]),
                ...(i.deliveryCharge ? [['Delivery', formatCurrency(i.deliveryCharge)]] : []),
              ] as [string, string][]).map(([k, v]) => (
                <tr key={k} className="border-b border-border/60">
                  <td className="py-1.5 pe-4 text-xs text-muted-foreground">{k}</td>
                  <td className="py-1.5 text-end font-mono text-xs tabular-nums">{v}</td>
                </tr>
              ))}
              <tr className="bg-navy text-navy-fg">
                <td className="px-2 py-2 text-sm font-bold">Total</td>
                <td className="px-2 py-2 text-end font-mono text-sm font-bold tabular-nums text-accent">
                  {formatCurrency(i.grandTotalPaise)}
                </td>
              </tr>
              {i.amountPaidPaise > 0 && (
                <>
                  <tr className="border-b border-border/60">
                    <td className="py-1.5 pe-4 text-xs text-muted-foreground">Received</td>
                    <td className="py-1.5 text-end font-mono text-xs tabular-nums text-success">
                      − {formatCurrency(i.amountPaidPaise)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pe-4 text-xs font-bold">Balance Due</td>
                    <td className={`py-1.5 text-end font-mono text-xs font-bold tabular-nums ${i.duePaise > 0 ? 'text-danger' : 'text-success'}`}>
                      {formatCurrency(i.duePaise)}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>

          <div className="mt-10 flex items-end justify-between gap-4">
            {(i.org.paymentQrUrl || i.org.paymentLink) && (
              <div className="text-start">
                {i.org.paymentQrUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
                  <img src={i.org.paymentQrUrl} alt="Scan to pay" className="h-20 w-20 object-contain" />
                )}
                {i.org.paymentLink && (
                  <p className="mt-1 max-w-[10rem] break-all text-xs text-muted-foreground">
                    {i.org.paymentLink}
                  </p>
                )}
              </div>
            )}
            <div className="ms-auto w-40 text-end">
              {i.org.sealUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
                <img src={i.org.sealUrl} alt="Company seal" className="ms-auto mb-1 h-16 w-16 object-contain" />
              )}
              <div className="border-t border-border pt-1">
                <p className="text-xs text-muted-foreground">Authorised Signatory</p>
                <p className="text-xs font-semibold">{i.org.name}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-6 border-t border-border pt-2 text-center text-xs text-muted-foreground">
        {i.salespersonName && `Prepared by ${i.salespersonName} · `}
        This is a computer-generated tax invoice.
      </p>
    </div>
  );
}
