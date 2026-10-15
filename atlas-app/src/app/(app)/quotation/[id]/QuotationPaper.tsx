'use client';

import { ProductLink } from '@/components/document/ProductLink';
import { formatCurrency } from '@/lib/format';
import { amountInWords } from '@/lib/amount-in-words';
import type { QuotationDetail } from '@/server/quotations';
import { BUILT_IN_TEMPLATES, type TemplateOptions } from '@/lib/document-templates';

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/**
 * The printable quotation.
 *
 * This is the first thing a client's *customer* sees, and the sharpest test of
 * the white-label layer - organisation name, GSTIN, logo and accent colour all
 * come from the tenant record. Nothing here is hard-coded.
 *
 * Rendered on screen at A4 proportions so what you see is what prints. Print
 * styles hide the app chrome; a server-rendered PDF (A061) will replace the
 * browser dialog, but waiting for it would mean quotations nobody can send.
 */
export function QuotationPaper({ detail: q, template, linkProducts = false }: {
  detail: QuotationDetail;
  /**
   * The layout this branch chose (workstream C, 1 Oct 2026). Optional so
   * every existing caller keeps working: an unset template resolves to
   * Classic, which is exactly what this component did before.
   */
  template?: TemplateOptions;
  /** Product names open their history - in Atlas only, never on the customer's `/q/` link (G-36). */
  linkProducts?: boolean;
}) {
  const intra = q.taxMode === 'CGST_SGST';
  /**
   * GST was switched off on this document, so NOTHING about tax is printed -
   * no column, no HSN, no "Tax: 0" line (Vcare, 7 Oct 2026). "Zero per cent"
   * is a rate somebody chose and it would print; NONE means this document
   * does not deal in tax, and the customer should not see the word.
   */
  const noTax = q.taxMode === 'NONE';
  const t = template ?? BUILT_IN_TEMPLATES[0]!.options;

  return (
    <div className="mx-auto max-w-4xl">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #quotation-paper, #quotation-paper * { visibility: visible; }
          #quotation-paper {
            position: absolute; inset-inline-start: 0; top: 0; width: 100%;
            box-shadow: none; border: 0;
          }
          @page { margin: 12mm; }
        }
      `}</style>

      <div
        id="quotation-paper"
        className="rounded-lg border border-border bg-card p-6 shadow-card sm:p-10"
      >
        {/* ---- letterhead -------------------------------------------------- */}
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4">
          <div className="flex min-w-0 gap-3">
            {t.showLogo && q.org.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
              <img src={q.org.logoUrl} alt={q.org.name} className="h-14 w-14 shrink-0 rounded-lg object-contain" />
            ) : t.showLogo ? (
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-brand text-xl font-black text-brand-fg">
                {q.org.name.slice(0, 1)}
              </span>
            ) : null}
            <div className="min-w-0">
              <h2 className="text-lg font-bold leading-tight">{q.org.name}</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {q.storeName}
                {q.storeAddress && <><br />{q.storeAddress}</>}
              </p>
              {t.showGstin && q.org.gstin && (
                <p className="text-xs font-semibold">GSTIN: {q.org.gstin}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {[q.org.email, q.org.mobile].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          <div className="text-end">
            <p className="text-2xl font-black uppercase tracking-tight text-accent">
              Quotation
            </p>
            <dl className="mt-2 space-y-0.5 text-xs">
              <div className="flex justify-end gap-2">
                <dt className="text-muted-foreground">No:</dt>
                <dd className="font-mono font-semibold">{q.quotationNo}</dd>
              </div>
              <div className="flex justify-end gap-2">
                <dt className="text-muted-foreground">Date:</dt>
                <dd>{fmt(q.quotationDate)}</dd>
              </div>
              <div className="flex justify-end gap-2">
                <dt className="text-muted-foreground">Valid Until:</dt>
                <dd>{fmt(q.validUntil)}</dd>
              </div>
              {q.stateId && (
                <div className="flex justify-end gap-2">
                  <dt className="text-muted-foreground">Place of Supply:</dt>
                  <dd>{q.stateId}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        <div className="h-0.5 w-full bg-navy" />

        {/* ---- parties ----------------------------------------------------- */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="border-s-[3px] border-accent ps-3">
            <p className="text-micro font-bold uppercase text-muted-foreground">Bill To</p>
            <p className="text-sm font-bold">{q.organizationName ?? q.customerName}</p>
            {q.organizationName && <p className="text-xs">{q.customerName}</p>}
            <p className="text-xs">{q.phone}</p>
            {q.email && <p className="text-xs text-info">{q.email}</p>}
            {q.billingAddress && <p className="text-xs">{q.billingAddress}</p>}
            <p className="text-xs">{[q.cityId, q.stateId].filter(Boolean).join(', ')}</p>
            {q.gstin && <p className="text-xs font-semibold">GSTIN: {q.gstin}</p>}
          </div>

          <div className="border-s-[3px] border-brand ps-3">
            <p className="text-micro font-bold uppercase text-muted-foreground">Ship To</p>
            {!q.shippingAddress || q.shippingAddress === q.billingAddress ? (
              <p className="text-sm font-bold">Same as billing</p>
            ) : (
              <p className="text-xs">{q.shippingAddress}</p>
            )}
          </div>
        </div>

        {/* ---- items ------------------------------------------------------- */}
        <div className="thin-scroll mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-navy text-xs text-navy-fg">
                <th className="px-2 py-2 text-start font-semibold">#</th>
                <th className="px-2 py-2 text-start font-semibold">Product</th>
                <th className="px-2 py-2 text-start font-semibold">Code</th>
                <th className="px-2 py-2 text-end font-semibold">Qty</th>
                <th className="px-2 py-2 text-end font-semibold">Unit Price</th>
                <th className="px-2 py-2 text-end font-semibold">Disc%</th>
                {!noTax && <th className="px-2 py-2 text-end font-semibold">Tax%</th>}
                <th className="px-2 py-2 text-end font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {q.items.map((i) => (
                <tr key={i.srNo} className="border-b border-border">
                  <td className="px-2 py-2 text-xs text-muted-foreground">{i.srNo}</td>
                  <td className="px-2 py-2 text-xs font-semibold">{linkProducts ? <ProductLink id={i.productId}>{i.productName}</ProductLink> : i.productName}</td>
                  <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                    {i.productCode ?? '-'}
                  </td>
                  <td className="px-2 py-2 text-end text-xs tabular-nums">{i.qty}</td>
                  <td className="px-2 py-2 text-end font-mono text-xs tabular-nums">
                    {formatCurrency(i.unitPricePaise)}
                  </td>
                  <td className="px-2 py-2 text-end text-xs tabular-nums">{i.discountPct}%</td>
                  {!noTax && <td className="px-2 py-2 text-end text-xs tabular-nums">{i.taxRatePct}%</td>}
                  <td className="px-2 py-2 text-end font-mono text-xs font-semibold tabular-nums">
                    {formatCurrency(i.lineTotalPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ---- words + totals ---------------------------------------------- */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div>
              <p className="text-micro font-bold uppercase text-muted-foreground">
                Total In Words
              </p>
              <p className="text-xs font-semibold italic">
                {amountInWords(q.grandTotalPaise)}
              </p>
            </div>

            {(t.termsOverride || q.termsBody) && (
              <div>
                <p className="text-micro font-bold uppercase text-muted-foreground">
                  Terms &amp; Conditions
                </p>
                <p className="whitespace-pre-line text-xs leading-relaxed">
                  {t.termsOverride || q.termsBody}
                </p>
              </div>
            )}
          </div>

          <div>
            <table className="w-full text-sm">
              <tbody>
                {([
                  ['Sub Total', formatCurrency(q.subtotalPaise)],
                  ...(q.itemDiscountPaise ? [['Item Discounts', `− ${formatCurrency(q.itemDiscountPaise)}`]] : []),
                  ...(q.orderDiscountPaise ? [['Discount', `− ${formatCurrency(q.orderDiscountPaise)}`]] : []),
                  // "Taxable Value" is itself a tax word, so it goes too.
                  ...(noTax ? [] : [
                    ['Taxable Value', formatCurrency(q.taxableBasePaise)],
                    ...(intra
                      ? [['CGST', formatCurrency(q.cgstPaise)], ['SGST', formatCurrency(q.sgstPaise)]]
                      : [['IGST', formatCurrency(q.igstPaise)]]),
                  ]),
                  ...(q.deliveryCharge ? [['Delivery', formatCurrency(q.deliveryCharge)]] : []),
                ] as [string, string][]).map(([k, v]) => (
                  <tr key={k} className="border-b border-border/60">
                    <td className="py-1.5 pe-4 text-xs text-muted-foreground">{k}</td>
                    <td className="py-1.5 text-end font-mono text-xs tabular-nums">{v}</td>
                  </tr>
                ))}
                <tr className="bg-navy text-navy-fg">
                  <td className="px-2 py-2 text-sm font-bold">Total</td>
                  <td className="px-2 py-2 text-end font-mono text-sm font-bold tabular-nums text-accent">
                    {formatCurrency(q.grandTotalPaise)}
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="mt-10 text-end">
              <div className="ms-auto w-40">
                {t.showSeal && q.org.sealUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
                  <img src={q.org.sealUrl} alt="Company seal" className="ms-auto mb-1 h-16 w-16 object-contain" />
                )}
                <div className="border-t border-border pt-1">
                  <p className="text-xs text-muted-foreground">Authorised Signatory</p>
                  <p className="text-xs font-semibold">{q.org.name}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-6 border-t border-border pt-2 text-center text-xs text-muted-foreground">
          {q.salespersonName && `Prepared by ${q.salespersonName} · `}
          This is a quotation, not a tax invoice.
        </p>
      </div>
    </div>
  );
}
