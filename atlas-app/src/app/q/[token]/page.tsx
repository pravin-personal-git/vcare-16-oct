import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getQuotationByToken } from '@/server/quotations';
import { customerFiles } from '@/server/attachments';
import { CustomerFileList } from '@/components/document/CustomerFileList';
import { publicBrandUrl } from '@/server/storage';
import { formatCurrency } from '@/lib/format';
import { PrintButton } from '@/components/services/PrintButton';

export const dynamic = 'force-dynamic';

const fmt = (d: Date) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/** Metadata and the page read the same quotation once per request. */
const load = cache((token: string) => getQuotationByToken(token));

/**
 * The preview WhatsApp draws under the link (6 Oct 2026): the business's name
 * and logo instead of a bare URL. Never indexed - the link is the customer's.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const q = await load((await params).token);
  if (!q) return { title: 'Quotation', robots: { index: false, follow: false } };
  const org = q.store.organization;
  const title = `Quotation ${q.quotationNo} from ${org.name}`;
  const description = `${formatCurrency(q.grandTotalPaise)} · valid until ${fmt(q.validUntil)}`;
  const logo = publicBrandUrl(org.logoPath);
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title, description, type: 'website', siteName: org.name,
      ...(logo ? { images: [{ url: logo, alt: org.name }] } : {}),
    },
  };
}

/**
 * Public quotation view. No login - the token in the URL is the credential,
 * which is why it is 24 random bytes and can be rotated to revoke a link.
 *
 * This exists because wa.me links can only carry text, never a file. Sending a
 * customer a link they can open on their phone is the honest way to "send the
 * quotation" until the WhatsApp Business API (A141) can attach a document.
 */
export default async function PublicQuotation({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const q = await load(token);
  if (!q) notFound();

  /*
    NO TAX ON THIS QUOTATION (8 Oct 2026).

    This page is the link the customer is SENT. `QuotationPaper` was taught
    about NONE on 7 Oct and this file was not, so the one copy the customer
    actually opens still printed an IGST row at zero. Same fix, and the
    lesson is that a document has two renderers here, not one.
  */
  const noTax = q.taxMode === 'NONE';
  const intra = q.taxMode === 'CGST_SGST';
  const org = q.store.organization;
  const logo = publicBrandUrl(org.logoPath);
  const expired = new Date(q.validUntil) < new Date();
  // Files the business marked "Customer sees it" (G5, 11 Oct 2026).
  const files = (await customerFiles(q.storeId, [{ docType: 'quotation', docId: q.id }])).get(`quotation:${q.id}`) ?? [];

  return (
    <main className="mx-auto max-w-3xl bg-white p-6 text-black sm:p-10">
      {expired && (
        <p className="mb-4 rounded bg-amber-100 px-3 py-2 text-sm text-amber-900">
          This quotation expired on {fmt(q.validUntil)}. Please ask for a fresh one.
        </p>
      )}

      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-black pb-4">
        <div className="flex min-w-0 gap-3">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
            <img src={logo} alt={org.name} className="h-14 w-14 shrink-0 object-contain" />
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{org.name}</h1>
            <p className="text-xs">{q.store.name}{q.store.address ? ` · ${q.store.address}` : ''}</p>
            {org.gstin && <p className="text-xs">GSTIN: {org.gstin}</p>}
            <p className="text-xs">{[org.mobile, org.email].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <div className="text-end">
          <h2 className="text-lg font-bold">QUOTATION</h2>
          <p className="font-mono text-sm">{q.quotationNo}</p>
          <p className="text-xs">Date: {fmt(q.quotationDate)}</p>
          <p className="text-xs">Valid until: {fmt(q.validUntil)}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-micro font-semibold uppercase">Quotation for</p>
        <p className="font-medium">{q.organizationName ?? q.customerName}</p>
        {q.organizationName && <p className="text-xs">{q.customerName}</p>}
        {q.billingAddress && <p className="text-xs">{q.billingAddress}</p>}
        <p className="text-xs">{[q.cityId, q.stateId].filter(Boolean).join(', ')}</p>
        {q.gstin && <p className="text-xs">GSTIN: {q.gstin}</p>}
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-black text-xs">
              <th className="py-1.5 text-start">#</th>
              <th className="py-1.5 text-start">Description</th>
              <th className="py-1.5 text-end">Qty</th>
              <th className="py-1.5 text-end">Rate</th>
              {!noTax && <th className="py-1.5 text-end">GST%</th>}
              <th className="py-1.5 text-end">Amount</th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((i) => (
              <tr key={i.id} className="border-b border-gray-300">
                <td className="py-1.5 text-xs">{i.srNo}</td>
                <td className="py-1.5">
                  <p className="text-xs font-medium">{i.productName}</p>
                  {i.productCode && (
                    <p className="font-mono text-xs text-gray-600">{i.productCode}</p>
                  )}
                </td>
                <td className="py-1.5 text-end text-xs">{i.qty}</td>
                <td className="py-1.5 text-end font-mono text-xs">{formatCurrency(i.unitPricePaise)}</td>
                {!noTax && <td className="py-1.5 text-end text-xs">{Number(i.taxRatePct)}</td>}
                <td className="py-1.5 text-end font-mono text-xs">{formatCurrency(i.lineTotalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex justify-end">
        <table className="text-sm">
          <tbody>
            {[
              // Taxable value is a tax idea; with no tax it is the subtotal
              // printed twice.
              ...(noTax ? [] : [
                ['Taxable value', formatCurrency(q.taxableBasePaise)],
                ...(intra
                  ? [['CGST', formatCurrency(q.cgstPaise)], ['SGST', formatCurrency(q.sgstPaise)]]
                  : [['IGST', formatCurrency(q.igstPaise)]]),
              ]),
              ...(q.deliveryExempt || !q.deliveryCharge
                ? [] : [['Delivery', formatCurrency(q.deliveryCharge)]]),
            ].map(([k, v]) => (
              <tr key={k}>
                <td className="py-0.5 pe-8 text-xs">{k}</td>
                <td className="py-0.5 text-end font-mono text-xs">{v}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-black">
              <td className="py-1 pe-8 font-bold">Grand total</td>
              <td className="py-1 text-end font-mono font-bold">{formatCurrency(q.grandTotalPaise)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {q.termsBody && (
        <div className="mt-6 border-t border-gray-300 pt-3">
          <p className="text-micro font-semibold uppercase">Terms &amp; conditions</p>
          <p className="whitespace-pre-line text-xs leading-relaxed">{q.termsBody}</p>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-gray-500">
        Generated by {org.name}
      </p>
      <div className="mt-6"><CustomerFileList files={files} /></div>
    </main>
  );
}
