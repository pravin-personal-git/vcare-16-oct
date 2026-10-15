import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getInvoiceByToken } from '@/server/invoices';
import { customerFilesForInvoice } from '@/server/attachments';
import { CustomerFileList } from '@/components/document/CustomerFileList';
import { InvoicePaper } from '@/components/document/InvoicePaper';
import { PrintButton } from '@/components/services/PrintButton';
import { formatCurrency } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Metadata and the page read the same invoice once per request. */
const load = cache((token: string) => getInvoiceByToken(token));

/**
 * The preview WhatsApp draws under the link: the business's name and logo,
 * not a bare URL. Never indexed - the link is the customer's alone.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const i = await load((await params).token);
  if (!i) return { title: 'Invoice', robots: { index: false, follow: false } };
  const title = `Invoice ${i.invoiceNo} from ${i.org.name}`;
  const description = `${formatCurrency(i.grandTotalPaise)}`
    + (i.duePaise > 0 ? ` · ${formatCurrency(i.duePaise)} due` : ' · paid');
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title, description, type: 'website', siteName: i.org.name,
      ...(i.org.logoUrl ? { images: [{ url: i.org.logoUrl, alt: i.org.name }] } : {}),
    },
  };
}

/**
 * Public invoice view (6 Oct 2026). No login - the token in the URL is the
 * credential, as for /q/<token>. This is what "Send WhatsApp" on an invoice
 * now sends: wa.me carries text only, so the customer gets the invoice as a
 * page and saves the PDF from the print dialog.
 */
export default async function PublicInvoice({ params }: { params: Promise<{ token: string }> }) {
  const i = await load((await params).token);
  if (!i) notFound();
  // Files the business marked "Customer sees it" (G5, 11 Oct 2026).
  const files = await customerFilesForInvoice(i.id);

  return (
    <main className="mx-auto max-w-4xl px-3 py-6 sm:px-6">
      <style>{`
        @media print {
          #invoice-paper { box-shadow: none; border: 0; padding: 0; }
          @page { margin: 12mm; }
        }
      `}</style>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {i.duePaise > 0
            ? <>Balance due <span className="font-semibold text-foreground">{formatCurrency(i.duePaise)}</span></>
            : 'Paid in full - thank you.'}
        </p>
        <PrintButton />
      </div>
      <InvoicePaper i={i} />
      <div className="mt-4"><CustomerFileList files={files} /></div>
    </main>
  );
}
