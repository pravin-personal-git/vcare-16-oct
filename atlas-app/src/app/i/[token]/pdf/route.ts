import { getInvoiceByToken } from '@/server/invoices';
import { pdfResponse } from '@/server/pdf-route';

export const dynamic = 'force-dynamic';

/** The invoice as a PDF, for WhatsApp (A3). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const i = await getInvoiceByToken(token);
  return pdfResponse(req, `/i/${token}`, i ? { docNo: i.invoiceNo } : null);
}
